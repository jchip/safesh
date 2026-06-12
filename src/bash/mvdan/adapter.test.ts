/**
 * Tests for the mvdan/sh → SafeShell AST adapter (SSH-585)
 *
 * Two layers:
 * 1. Analysis-contract tests: the passthrough analyzer, fed by this adapter,
 *    must reach the right permission decisions — including for constructs
 *    the legacy parser cannot produce (the soundness traps).
 * 2. Differential corpus: every script from the analyzer's own test corpus
 *    must produce the same eligibility and command enumeration through both
 *    front-ends. A mvdan-eligible / legacy-ineligible divergence is a
 *    SECURITY failure; the reverse is conservatism and listed explicitly.
 */

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { parse } from "../mod.ts";
import { analyzeForPassthrough } from "../../hooks/passthrough-analyzer.ts";
import { MvdanParseError, parseWithMvdan } from "./adapter.ts";

const TEST_ENV = (name: string) => (name === "HOME" ? "/home/u" : undefined);

function analyzeMvdan(script: string, opts: Parameters<typeof analyzeForPassthrough>[1] = {}) {
  return analyzeForPassthrough(parseWithMvdan(script), { env: TEST_ENV, ...opts });
}

function analyzeLegacy(script: string, opts: Parameters<typeof analyzeForPassthrough>[1] = {}) {
  return analyzeForPassthrough(parse(script), { env: TEST_ENV, ...opts });
}

describe("mvdan adapter analysis contract", () => {
  describe("eligible scripts", () => {
    it("accepts a plain pipeline and enumerates all commands", () => {
      const result = analyzeMvdan("git log --oneline | grep foo | head -3");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals([...result.commands].sort(), ["git", "grep", "head"]);
    });

    it("recurses into command substitutions", () => {
      const result = analyzeMvdan("echo $(git rev-parse HEAD)");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals([...result.commands].sort(), ["echo", "git"]);
    });

    it("finds commands in assignment-prefix substitutions", () => {
      const result = analyzeMvdan("FOO=$(curl example.com) bar --x");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assert(result.commands.has("curl"));
      assert(result.commands.has("bar"));
    });

    it("finds commands in declaration substitutions (export FOO=$(cmd))", () => {
      // DeclClause path: the legacy parser presents export as a command;
      // the adapter must surface the nested substitution the same way
      const result = analyzeMvdan("export FOO=$(git rev-parse HEAD)");
      assert(result.commands.has("git"), "substitution inside export must be visible");
      assert(result.commands.has("export"));
    });

    it("collects static redirect targets", () => {
      const result = analyzeMvdan("sort data.txt > out.txt 2>/dev/null < in.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      const paths = result.redirects.map((r) => `${r.operation}:${r.path}`).sort();
      assertEquals(paths, ["read:in.txt", "write:out.txt"]);
    });

    it("collects cd targets for path checking", () => {
      const result = analyzeMvdan("cd src && cat mod.ts");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "src", operation: "read" }]);
    });

    it("resolves static variables for command arguments", () => {
      const result = analyzeMvdan("DIR=src\nls $DIR");
      assertEquals(result.eligible, true, result.reasons.join("; "));
    });

    it("collects glob patterns for the caller to verify", () => {
      const result = analyzeMvdan("wc -l src/*.ts");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.globs, ["src/*.ts"]);
    });

    it("expands tilde in redirect targets", () => {
      const result = analyzeMvdan("echo hi > ~/out.txt");
      assertEquals(result.eligible, true, result.reasons.join("; "));
      assertEquals(result.redirects, [{ path: "/home/u/out.txt", operation: "write" }]);
    });
  });

  describe("default-deny constructs", () => {
    const cases: [string, string][] = [
      ['eval "ls"', "carrier"],
      ["echo hi | xargs somecmd", "carrier"],
      ["rm foo.txt", "sandboxed"],
      ["cat <<EOF\nhello\nEOF", "heredoc"],
      ["grep x <<< 'data'", "heredoc"],
      ["diff <(sort a) <(sort b)", "process substitution"],
      ["f() { ls; }", "function"],
      ["sleep 5 &", "background"],
      ['"$UNDEFINED_CMD_XYZ" --version', "not statically resolvable"],
      ["echo ===", "=-expansion"],
      ["ls $TOTALLY_UNSET_VAR_XYZ", "not statically resolvable"],
      ["echo hi > $UNKNOWN_TARGET_XYZ", "redirect target"],
    ];
    for (const [script, reasonFragment] of cases) {
      it(`rejects ${JSON.stringify(script)}`, () => {
        const result = analyzeMvdan(script);
        assertEquals(result.eligible, false, `expected ineligible: ${script}`);
        assert(
          result.reasons.some((r) => r.includes(reasonFragment)),
          `expected reason containing "${reasonFragment}", got: ${result.reasons.join("; ")}`,
        );
      });
    }
  });

  describe("soundness traps the legacy parser cannot even produce", () => {
    it("rejects command substitution inside arithmetic expansion", () => {
      // The analyzer assumes $(( )) cannot hide commands; mvdan parses them
      const result = analyzeMvdan("echo $(( $(somecmd) + 1 ))");
      assertEquals(result.eligible, false);
      assertEquals(result.commands.has("somecmd"), false, "must not claim enumeration");
    });

    it("rejects command substitution inside (( ))", () => {
      const result = analyzeMvdan("(( $(somecmd) ))");
      assertEquals(result.eligible, false);
    });

    it("rejects command substitution inside a C-style for header", () => {
      const result = analyzeMvdan("for ((i=$(somecmd); i<3; i++)); do echo $i; done");
      assertEquals(result.eligible, false);
    });

    it("rejects command substitution inside array subscripts", () => {
      const result = analyzeMvdan("echo ${a[$(somecmd)]}");
      assertEquals(result.eligible, false);
    });

    it("rejects command substitution inside array element subscripts", () => {
      const result = analyzeMvdan("arr=([$(touch x)]=v)");
      assertEquals(result.eligible, false);
      assertEquals(result.commands.has("touch"), false, "must not claim enumeration");
    });

    it("rejects command substitution inside associative array element subscripts", () => {
      const result = analyzeMvdan("declare -A arr=([key$(somecmd)]=v)");
      assertEquals(result.eligible, false);
    });

    it("keeps substitution-free array element subscripts eligible", () => {
      const result = analyzeMvdan("arr=([0]=a [1]=b)\necho ok");
      assertEquals(result.eligible, true);
    });

    it("rejects pattern-replacement expansions (pattern can hide $(...))", () => {
      const result = analyzeMvdan("echo ${x/$(somecmd)/y}");
      assertEquals(result.eligible, false);
    });

    it("walks expansion default-value words", () => {
      const result = analyzeMvdan("echo ${x:-$(somecmd)}");
      assert(result.commands.has("somecmd"), "command in :- default must be visible");
    });

    it("rejects append assignments (+=) instead of mis-resolving them", () => {
      // a+=x mapped as a=x would let `cd $a` check the wrong path
      const result = analyzeMvdan('a=/tmp\na+="/sub"\ncd $a');
      assertEquals(result.eligible, false);
    });

    it("rejects naked exports instead of treating the value as empty", () => {
      const result = analyzeMvdan("export PATH\ncd $PATH");
      assertEquals(result.eligible, false);
    });

    it("rejects $'...' ANSI-C quoting instead of taking it literally", () => {
      const result = analyzeMvdan("cd $'\\x2ftmp'");
      assertEquals(result.eligible, false);
    });

    it("rejects |& (not representable in the legacy AST)", () => {
      const result = analyzeMvdan("cmd1 |& cmd2");
      assertEquals(result.eligible, false);
    });

    it("rejects coproc", () => {
      const result = analyzeMvdan("coproc mycop { cat; }");
      assertEquals(result.eligible, false);
    });

    it("rejects select loops", () => {
      const result = analyzeMvdan("select x in a b; do echo $x; done");
      assertEquals(result.eligible, false);
    });

    it("rejects extended globs", () => {
      const result = analyzeMvdan("ls ?(a|b).txt");
      assertEquals(result.eligible, false);
    });
  });

  describe("parse errors", () => {
    it("throws MvdanParseError with position info on invalid input", () => {
      assertThrows(
        () => parseWithMvdan('if [ -n "" ; then echo x fi'),
        MvdanParseError,
      );
    });
  });
});

// =============================================================================
// Differential corpus: legacy front-end vs mvdan front-end
// =============================================================================

describe("mvdan vs legacy differential", () => {
  // Scripts from the analyzer's own corpus plus structural variety.
  const CORPUS: string[] = [
    "git log --oneline | grep foo | head -3",
    "echo $(git rev-parse HEAD)",
    "FOO=$(curl example.com) bar --x",
    "test -f x && echo $((1+2)) || false",
    "echo ===",
    "echo '==='",
    "wc -l src/*.ts tests/*.ts",
    "DIR=src\nls $DIR",
    "ls $TOTALLY_UNSET_VAR_XYZ",
    "for f in $(ls); do wc -l $f; done",
    "sort data.txt > out.txt 2>/dev/null < in.txt",
    "ls 2>&1 >/dev/null",
    "echo hi > ~/out.txt",
    "echo hi > $UNKNOWN_TARGET_XYZ",
    "cd src && cat mod.ts",
    'cd "$SOME_UNSET_DIR_XYZ"',
    'eval "ls"',
    "echo hi | xargs somecmd",
    "bash -c 'ls'",
    "env FOO=1 somecmd",
    "find . -name '*.ts'",
    "rm foo.txt",
    "mv a b",
    "cat <<EOF\nhello\nEOF",
    "grep x <<< 'data'",
    "diff <(sort a) <(sort b)",
    "f() { ls; }",
    "sleep 5 &",
    '"$UNDEFINED_CMD_XYZ" --version',
    'if [ -n "$x" ]; then echo a; elif true; then echo b; else echo c; fi',
    "while read -r line; do echo $line; done < input.txt",
    "case $1 in a) echo a;; *) echo b;; esac",
    "(cd src && ls)",
    "{ echo a; echo b; } 2>/dev/null",
    "[[ -n $x && $y == foo ]]",
    "until false; do break; done",
    "! grep -q x f",
    "a=1 b=2 somecmd",
    "echo `git rev-parse HEAD`",
    "ARR=(a b $(git tag))\necho ok",
  ];

  for (const script of CORPUS) {
    it(`agrees on ${JSON.stringify(script.slice(0, 60))}`, () => {
      let legacy: ReturnType<typeof analyzeLegacy> | undefined;
      try {
        legacy = analyzeLegacy(script);
      } catch {
        legacy = undefined; // legacy parse failure → transpile fallback today
      }
      const mv = analyzeMvdan(script);

      if (legacy === undefined) {
        // mvdan parsing scripts the legacy parser cannot is the payoff; the
        // analysis itself still applies, nothing to compare against.
        return;
      }

      // SECURITY INVARIANT: the mvdan front-end must never grant passthrough
      // where the legacy front-end denies it.
      if (!legacy.eligible) {
        assertEquals(
          mv.eligible,
          false,
          `mvdan grants what legacy denies (${legacy.reasons.join("; ")})`,
        );
      } else {
        // Coverage parity: deny here means lost passthrough, list explicitly
        // if ever intentional.
        assertEquals(
          mv.eligible,
          true,
          `mvdan denies what legacy grants: ${mv.reasons.join("; ")}`,
        );
        // Sound enumeration: identical command sets when both grant.
        assertEquals([...mv.commands].sort(), [...legacy.commands].sort());
        assertEquals(
          mv.redirects.map((r) => `${r.operation}:${r.path}`).sort(),
          legacy.redirects.map((r) => `${r.operation}:${r.path}`).sort(),
        );
        assertEquals([...mv.globs].sort(), [...legacy.globs].sort());
      }
    });
  }
});
