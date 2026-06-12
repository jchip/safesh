/**
 * Unit tests for passthrough-analyzer.ts (SSH-576)
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { parse } from "../bash/mod.ts";
import { analyzeForPassthrough } from "./passthrough-analyzer.ts";
import { globHasMatch } from "../../hooks/bash-prehook.ts";

function analyze(script: string, opts: Parameters<typeof analyzeForPassthrough>[1] = {}) {
  return analyzeForPassthrough(parse(script), {
    env: (name) => (name === "HOME" ? "/home/u" : undefined),
    ...opts,
  });
}

describe("passthrough-analyzer", () => {
  describe("eligible scripts", () => {
    it("accepts a plain pipeline and enumerates all commands", () => {
      const result = analyze("git log --oneline | grep foo | head -3");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals([...result.commands].sort(), ["git", "grep", "head"]);
    });

    it("recurses into command substitutions (sound extraction)", () => {
      const result = analyze("echo $(git rev-parse HEAD)");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.commands.has("git"));
      assert(result.commands.has("echo"));
    });

    it("finds commands hidden in assignment-prefix substitutions", () => {
      const result = analyze("FOO=$(curl example.com) bar --x");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.commands.has("curl"), "curl inside prefix cmdsub must be visible");
      assert(result.commands.has("bar"));
    });

    it("accepts control flow with analyzable bodies", () => {
      // "$f" stays quoted: unquoted loop variables word-split under bash
      // but not zsh, so they force fallback (SSH-579)
      const result = analyze('for f in $(ls); do wc -l "$f"; done');
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.commands.has("ls"));
      assert(result.commands.has("wc"));
    });

    it("resolves command names from in-script assignments", () => {
      const result = analyze('TOOL=./bin/tool\n"$TOOL" --version');
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.commands.has("./bin/tool"));
    });

    it("accepts logical chains, negation, and arithmetic", () => {
      const result = analyze("test -f x && echo $((1+2)) || false");
      assertEquals(result.eligible, true, result.reasons.join("; "));
    });
  });

  describe("ineligible constructs", () => {
    const cases: [string, string, string][] = [
      ["carrier eval", 'eval "ls"', "carrier"],
      ["carrier xargs", "echo hi | xargs somecmd", "carrier"],
      ["carrier bash -c", "bash -c 'ls'", "carrier"],
      ["carrier env", "env FOO=1 somecmd", "carrier"],
      ["carrier find", "find . -name '*.ts'", "carrier"],
      ["sandboxed rm", "rm foo.txt", "sandboxed"],
      ["sandboxed mv", "mv a b", "sandboxed"],
      ["heredoc", "cat <<EOF\nhello\nEOF", "heredoc"],
      ["here-string", "grep x <<< 'data'", "heredoc"],
      ["process substitution", "diff <(sort a) <(sort b)", "process substitution"],
      ["function declaration", "f() { ls; }", "function"],
      ["background job", "sleep 5 &", "background"],
      ["unresolvable command name", '"$UNDEFINED_CMD_XYZ" --version', "not statically resolvable"],
    ];

    for (const [label, script, reasonFragment] of cases) {
      it(`rejects ${label}`, () => {
        const result = analyze(script);
        assertEquals(result.eligible, false, `expected ineligible: ${script}`);
        assert(
          result.reasons.some((r) => r.includes(reasonFragment)),
          `expected reason containing "${reasonFragment}", got: ${result.reasons.join("; ")}`,
        );
      });
    }

    it("rejects blocked (dangerous) commands, including nested ones", () => {
      const blocked = new Set(["dd"]);
      const top = analyze("dd if=/dev/zero of=x", { blockedCommands: blocked });
      assertEquals(top.eligible, false);

      const nested = analyze("echo $(dd if=/dev/zero of=x)", { blockedCommands: blocked });
      assertEquals(nested.eligible, false, "dangerous command inside cmdsub must be caught");
    });
  });

  describe("zsh hazards (SSH-579)", () => {
    it("rejects unquoted words starting with = (zsh =-expansion)", () => {
      const result = analyze("echo ===");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("=-expansion")));
    });

    it("accepts quoted = words", () => {
      const result = analyze("echo '==='");
      assertEquals(result.eligible, true, result.reasons.join("; "));
    });

    it("collects glob patterns for match verification", () => {
      const result = analyze("wc -l src/*.ts tests/*.ts");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.globs.sort(), ["src/*.ts", "tests/*.ts"]);
    });

    it("rejects unquoted expansions that would word-split", () => {
      const result = analyze('FLAGS="-l -a"\nls $FLAGS');
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("word-split")));
    });

    it("accepts unquoted expansions with safe static values", () => {
      const result = analyze("DIR=src\nls $DIR");
      assertEquals(result.eligible, true, result.reasons.join("; "));
    });

    it("accepts quoted expansions regardless of value", () => {
      const result = analyze('FLAGS="-l -a"\nls "$FLAGS"');
      assertEquals(result.eligible, true, result.reasons.join("; "));
    });

    it("rejects unresolvable unquoted expansions in arguments", () => {
      const result = analyze("ls $TOTALLY_UNSET_VAR_XYZ");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("not statically resolvable")));
    });

    it("rejects unquoted loop variables in command arguments", () => {
      const result = analyze("for f in $(ls); do wc -l $f; done");
      assertEquals(result.eligible, false);
    });
  });

  describe("redirect and cd targets", () => {
    it("collects static redirect targets with operations", () => {
      const result = analyze("sort data.txt > out.txt 2>/dev/null < in.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(
        result.redirects.map((r) => `${r.operation}:${r.path}`).sort(),
        ["read:in.txt", "write:out.txt"],
      );
    });

    it("skips device paths and fd duplication", () => {
      const result = analyze("ls 2>&1 >/dev/null");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects.length, 0);
    });

    it("expands tilde in redirect targets", () => {
      const result = analyze("echo hi > ~/out.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "/home/u/out.txt", operation: "write" }]);
    });

    it("rejects dynamic redirect targets", () => {
      const result = analyze("echo hi > $UNKNOWN_TARGET_XYZ");
      assertEquals(result.eligible, false);
    });

    it("collects cd targets as read checks", () => {
      const result = analyze("cd src && cat mod.ts");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.redirects.some((r) => r.path === "src" && r.operation === "read"));
    });

    it("rejects unresolvable cd targets", () => {
      const result = analyze('cd "$SOME_UNSET_DIR_XYZ"');
      assertEquals(result.eligible, false);
    });
  });

  describe("cwd tracking (SSH-590 fix #1)", () => {
    it("resolves redirect targets against an absolute cd (verified escape)", () => {
      // cd /home/u && echo x > .ssh/authorized_keys: native bash writes
      // /home/u/.ssh/authorized_keys, not <cwd>/.ssh/authorized_keys.
      const result = analyze("cd /home/u && echo x > .ssh/authorized_keys");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(
        result.redirects.some((r) =>
          r.operation === "write" && r.path === "/home/u/.ssh/authorized_keys"
        ),
        `write target must resolve under the cd dir, got: ${
          result.redirects.map((r) => `${r.operation}:${r.path}`).join(", ")
        }`,
      );
      // And the bare relative form is NOT emitted (which would pass the check).
      assert(!result.redirects.some((r) => r.path === ".ssh/authorized_keys"));
    });

    it("resolves redirect targets against a relative cd, keeping base-relative", () => {
      const result = analyze("cd sub && echo x > out.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(
        result.redirects.some((r) => r.operation === "write" && r.path === "sub/out.txt"),
        result.redirects.map((r) => `${r.operation}:${r.path}`).join(", "),
      );
    });

    it("tracks cd through multiple relative segments", () => {
      const result = analyze("cd a/b && cd ../c && echo x > y");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(
        result.redirects.some((r) => r.operation === "write" && r.path === "a/c/y"),
        result.redirects.map((r) => `${r.operation}:${r.path}`).join(", "),
      );
    });

    it("marks cwd unknown after a cd to an unknown directory", () => {
      // `cd $D` is unresolvable -> reject; this guards the unknown-cwd path.
      const result = analyze("cd /tmp || cd $D\necho x > y");
      assertEquals(result.eligible, false);
    });

    it("makes cwd unknown after a cd inside a conditional", () => {
      const result = analyze("if true; then cd /etc; fi\necho x > passwd");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("unknown working directory")));
    });

    it("does not leak cd from a subshell into the parent cwd", () => {
      const result = analyze("(cd /etc); echo x > local.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      // local.txt stays relative to base (subshell cd does not affect parent).
      assert(result.redirects.some((r) => r.operation === "write" && r.path === "local.txt"));
    });

    it("does not leak cd from a pipe segment into the parent cwd", () => {
      const result = analyze("cd /etc | cat\necho x > local.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.redirects.some((r) => r.operation === "write" && r.path === "local.txt"));
    });

    it("makes cwd unknown after a relative cd inside a loop body", () => {
      const result = analyze("for i in 1 2; do cd sub; echo x > out; done");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("unknown working directory")));
    });

    it("treats cd - as an unknown directory", () => {
      const result = analyze("cd -\necho x > y");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("unknown working directory")));
    });

    it("resolves a redirect inside an && chain against the chain's cwd", () => {
      // echo runs only if the cd succeeded, so it sees the cd'd cwd.
      const result = analyze("cd a/b && cd ../c && echo x > y");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(
        result.redirects.some((r) => r.operation === "write" && r.path === "a/c/y"),
        result.redirects.map((r) => `${r.operation}:${r.path}`).join(", "),
      );
    });

    it("makes cwd unknown after an && chain that changed it (early-exit escape)", () => {
      // If `cd /outside` succeeds but `cd /project` fails, native bash runs the
      // next statement in /outside — so a linear assumption would be unsound.
      const result = analyze("cd /outside && cd /project\necho secret > x");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("unknown working directory")));
    });

    it("does not leak a failed cd from an || operand", () => {
      // `cd missing || cd /tmp`: the second cd runs from the original cwd.
      const result = analyze("cd missing || cd /tmp\necho x > y");
      // Both operands change cwd, so the post-|| cwd is unknown -> reject.
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("unknown working directory")));
    });

    it("handles a cd in the if-test for the consequent", () => {
      // The consequent runs only if `cd sub` succeeded, so it sees sub/.
      const result = analyze("if cd sub; then echo x > out; fi");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.redirects.some((r) => r.operation === "write" && r.path === "sub/out"));
    });
  });

  describe("case patterns (SSH-590 fix #2)", () => {
    it("walks command substitutions in case patterns (verified escape)", () => {
      const result = analyze("case $1 in $(evilcmd)) echo hi;; esac");
      assert(
        result.commands.has("evilcmd"),
        `cmdsub in a case pattern must be enumerated, got: ${[...result.commands].join(", ")}`,
      );
    });

    it("rejects a carrier hidden in a case pattern", () => {
      const result = analyze("case $1 in $(eval payload)) echo hi;; esac");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("carrier")));
    });
  });

  describe("loop variables (SSH-590 fix #3)", () => {
    it("invalidates the loop variable inside the body (verified escape)", () => {
      // d=. seeds a static value; the loop var must not keep it.
      const result = analyze('d=.\nfor d in /etc /root; do cd "$d"; done');
      assertEquals(result.eligible, false);
      // The only recorded read must NOT be the stale "." value.
      assert(!result.redirects.some((r) => r.path === "." && r.operation === "read"));
    });

    it("invalidates variables reassigned inside a loop body", () => {
      const result = analyze('p=src\nfor i in 1 2; do cd "$p"; p=/etc; done');
      assertEquals(result.eligible, false);
    });

    it("invalidates the loop variable after the loop too", () => {
      const result = analyze('x=safe\nfor x in a b; do echo "$x"; done\ncd "$x"');
      assertEquals(result.eligible, false);
    });
  });

  describe("tilde-user (SSH-590 fix #4)", () => {
    it("rejects cd to another user's home", () => {
      const result = analyze("cd ~root/x");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("cd target")));
    });

    it("rejects a redirect to another user's home", () => {
      const result = analyze("echo x > ~root/y");
      assertEquals(result.eligible, false);
      assert(result.reasons.some((r) => r.includes("redirect target")));
    });

    it("still expands plain ~ and ~/", () => {
      const result = analyze("echo x > ~/out.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "/home/u/out.txt", operation: "write" }]);
    });
  });

  describe("redirect classification (SSH-590 fix #5)", () => {
    it("records <> as both a read and a write", () => {
      const result = analyze("grep x <> both.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(
        result.redirects.map((r) => `${r.operation}:${r.path}`).sort(),
        ["read:both.txt", "write:both.txt"],
      );
    });

    it("treats >& with a file target as a write", () => {
      const result = analyze("echo hi >& out.log");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "out.log", operation: "write" }]);
    });

    it("treats <& with a file target as a read", () => {
      const result = analyze("cat <& in.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "in.txt", operation: "read" }]);
    });

    it("treats &> and &>> as writes", () => {
      const result = analyze("echo hi &> all.log\necho hi &>> all.log");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(
        result.redirects.map((r) => `${r.operation}:${r.path}`),
        ["write:all.log", "write:all.log"],
      );
    });

    it("treats >| as a write", () => {
      const result = analyze("echo hi >| out.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "out.txt", operation: "write" }]);
    });

    it("skips fd close/move targets (>&-, 2>&1-)", () => {
      const result = analyze("echo hi >&-\necho hi 2>&1-");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects.length, 0);
    });
  });

  describe("globstar parity (SSH-590 fix #6)", () => {
    it("does not match ** recursively, mirroring bash's default", async () => {
      const dir = await Deno.makeTempDir();
      try {
        await Deno.mkdir(`${dir}/a/b`, { recursive: true });
        await Deno.writeTextFile(`${dir}/a/b/x.ts`, "");

        // bash with globstar off treats ** like * (single segment), so a
        // recursive pattern that only matches deeper than one level must NOT
        // report a match — otherwise the analyzer approves a file set bash
        // never produces.
        assertEquals(await globHasMatch("**/*.ts", dir), false);
        // A single-level glob still matches as both shells agree.
        await Deno.writeTextFile(`${dir}/top.ts`, "");
        assertEquals(await globHasMatch("*.ts", dir), true);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });
  });
});
