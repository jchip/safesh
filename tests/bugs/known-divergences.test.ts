/**
 * Known-divergence pins for open bugs that the differential harness cannot express.
 *
 * tests/conformance/differential.test.ts compares bash stdout + exit code, so it
 * covers any bug observable that way (see the `xfail` entries there). The bugs
 * pinned HERE are not observable that way:
 *
 *   - the defect is in the SHAPE of the generated TypeScript, not its stdout
 *   - the defect is in a hook DECISION, before any code runs
 *
 * Same discipline as the differential `xfail`s: each test asserts the buggy
 * behaviour that exists today and fails loudly the moment it changes, so the
 * pin cannot silently outlive the bug. When one starts failing, that is the
 * signal to delete the test and close the ticket — not to adjust the assertion.
 */
import { assert, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { runBashPrehook } from "../helpers.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

/** The line carrying the $.cmd(...) call, where the options object lands. */
function cmdLine(code: string): string {
  return code.split("\n").find((l) => l.includes("$.cmd")) ?? "";
}

function stillBroken(ticket: string, what: string): string {
  return `${ticket} appears FIXED: ${what}. Delete this pin and close ${ticket}.`;
}

describe("Known divergence SSH-686: env-assignment prefix drops 2>&1", () => {
  // `VAR=x cmd >/dev/null 2>&1` must emit BOTH env and mergeStreams. Today the
  // options object is built by either the env prefix or the redirection
  // lowering and they do not merge, so mergeStreams is silently lost and the
  // stderr the user asked to suppress is printed. Not visible to the
  // differential harness: it compares stdout, and this leaks on stderr.
  it("keeps mergeStreams when there is no env prefix (control)", () => {
    const line = cmdLine(transpileBash("fyn run build >/dev/null 2>&1"));
    assertStringIncludes(line, "mergeStreams: true");
  });

  it("loses mergeStreams with a single env assignment", () => {
    const line = cmdLine(transpileBash("NODE_ENV=production fyn run build >/dev/null 2>&1"));
    assertStringIncludes(line, 'env: { NODE_ENV: "production" }');
    assert(
      !line.includes("mergeStreams"),
      stillBroken("SSH-686", `mergeStreams now survives an env prefix — emitted: ${line.trim()}`),
    );
  });

  it("loses mergeStreams with multiple env assignments", () => {
    const line = cmdLine(
      transpileBash("NODE_ENV=production FYNMESH_SOURCEMAP=1 fyn run build >/dev/null 2>&1"),
    );
    assertStringIncludes(line, "FYNMESH_SOURCEMAP");
    assert(
      !line.includes("mergeStreams"),
      stillBroken("SSH-686", `mergeStreams now survives an env prefix — emitted: ${line.trim()}`),
    );
  });

  it("does keep a plain 2>file redirection alongside an env prefix", () => {
    // Only the 2>&1 merge is lost; the stderr-to-file form already composes.
    const line = cmdLine(transpileBash("NODE_ENV=production fyn run build 2>out.txt"));
    assertStringIncludes(line, 'env: { NODE_ENV: "production" }');
    assertStringIncludes(line, '.stderr("out.txt")');
  });
});

describe("Known divergence SSH-688: transpile() has no guard for a source string", () => {
  // transpile(program: AST.Program) requires a parsed AST. Handing it a bash
  // string fails deep inside with "program.body is not iterable" instead of an
  // actionable message naming parse().
  it("throws an unhelpful TypeError instead of naming parse()", () => {
    let message = "(no error thrown)";
    try {
      // deno-lint-ignore no-explicit-any
      (transpile as any)("ls /nonexistent | cat");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // One assertion on the exact current message: any change to it — a real
    // guard naming parse(), or no throw at all — reports the ticket.
    assert(
      message.includes("program.body is not iterable"),
      stillBroken("SSH-688", `transpile() now reports something else — got: ${message}`),
    );
  });
});

describe("Known divergence SSH-685: two command substitutions denied as too complex", () => {
  // knownBadPatterns[3] in hooks/bash-prehook.ts excludes only newline and
  // backtick from its gap classes, so two ${...} substitutions emitted on one
  // line let the regex start in the first and match the `.stdout()` of the
  // second. The generated TypeScript is valid — this is a pure false positive.
  const one = `echo "a=$(ls dist/*.map 2>/dev/null | wc -l | tr -d ' ')"`;
  const two =
    `echo "a=$(ls dist/*.map 2>/dev/null | wc -l | tr -d ' ') b=$(grep -l foo dist/*.js 2>/dev/null | wc -l | tr -d ' ')"`;

  it("allows a single command substitution (control)", async () => {
    const r = await runBashPrehook(one, Deno.cwd());
    assertStringIncludes(r.stdout, '"permissionDecision":"allow"');
  });

  it("denies two command substitutions in one string", async () => {
    const r = await runBashPrehook(two, Deno.cwd());
    assert(
      !r.stdout.includes('"permissionDecision":"allow"'),
      stillBroken("SSH-685", "two command substitutions are now allowed"),
    );
    assertStringIncludes(r.stdout, "too complex for automatic transpilation");
  });
});

describe("Known divergence SSH-687: misplaced /*#*/ prompts to approve it as a command", () => {
  // detectMisplacedSignature() is only consulted in the transpile CATCH path,
  // so when the text after the signature still parses as bash, `/*#*/` is
  // treated as an ordinary command word and lands in the permission gate.
  // Choosing "always allow" there persists `/*#*/` into allowedCommands.
  for (const cmd of ["echo a; /*#*/ echo hi", "echo a; /*#*/", "echo a && /*#*/ ls"]) {
    it(`asks to approve a command named /*#*/ for: ${cmd}`, async () => {
      const r = await runBashPrehook(cmd, Deno.cwd());
      assert(
        r.stdout.includes("BLOCKED: /*#*/"),
        stillBroken(
          "SSH-687",
          `the misplaced signature is no longer surfaced as a command name — got: ${
            r.stdout.slice(0, 200)
          }`,
        ),
      );
    });
  }
});
