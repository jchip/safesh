/**
 * Unit tests for passthrough-analyzer.ts (SSH-576)
 */

import { assert, assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { parse } from "../bash/mod.ts";
import { analyzeForPassthrough } from "./passthrough-analyzer.ts";

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
      const result = analyze("for f in $(ls); do wc -l $f; done");
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
});
