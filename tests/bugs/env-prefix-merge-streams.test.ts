/**
 * SSH-686: `VAR=x cmd >/dev/null 2>&1` silently lost the `2>&1`.
 *
 * The command options object is assembled by whichever path runs — the
 * env-assignment prefix, the timeout handler, or the redirection lowering — and
 * they did not compose: the env branch emitted `{ env: ... }` and dropped
 * `mergeStreams`, so stderr the script asked to suppress still printed. A
 * silent semantics change, not a crash.
 *
 * Each option source now contributes to one object.
 */
import { assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { transpileSource } from "../../src/bash/transpiler2/mod.ts";

const opts = { imports: false, strict: false } as const;

/** The emitted line carrying the $.cmd(...) call, where options land. */
function cmdLine(bash: string): string {
  const line = transpileSource(bash, opts).split("\n").find((l) => l.includes("$.cmd"));
  if (!line) throw new Error(`no $.cmd(...) emitted for: ${bash}`);
  return line.trim();
}

describe("SSH-686: env prefix composes with 2>&1", () => {
  it("keeps mergeStreams with no env prefix", () => {
    assertStringIncludes(cmdLine("fyn run build >/dev/null 2>&1"), "mergeStreams: true");
  });

  it("keeps both env and mergeStreams for a single assignment", () => {
    const line = cmdLine("NODE_ENV=production fyn run build >/dev/null 2>&1");
    assertStringIncludes(line, 'env: { NODE_ENV: "production" }');
    assertStringIncludes(line, "mergeStreams: true");
  });

  it("keeps both env and mergeStreams for multiple assignments", () => {
    const line = cmdLine(
      "NODE_ENV=production FYNMESH_SOURCEMAP=1 fyn run build >/dev/null 2>&1",
    );
    assertStringIncludes(line, 'NODE_ENV: "production"');
    assertStringIncludes(line, 'FYNMESH_SOURCEMAP: "1"');
    assertStringIncludes(line, "mergeStreams: true");
  });

  it("emits one options object, not two", () => {
    // Regression guard on the shape: a second `$.cmd({` would mean the options
    // were emitted separately rather than merged.
    const line = cmdLine("NODE_ENV=production fyn run build >/dev/null 2>&1");
    assertStringIncludes(line, '$.cmd({ env: { NODE_ENV: "production" }, mergeStreams: true }');
  });

  it("still routes 2>file to .stderr() alongside an env prefix", () => {
    const line = cmdLine("NODE_ENV=production fyn run build 2>out.txt");
    assertStringIncludes(line, 'env: { NODE_ENV: "production" }');
    assertStringIncludes(line, '.stderr("out.txt")');
  });
});

describe("SSH-686: the timeout handler composes with 2>&1 too", () => {
  // Same defect in the sibling handler: it built { timeout, env } and dropped
  // mergeStreams. Found while verifying the env-prefix fix.
  it("keeps timeout and mergeStreams", () => {
    const line = cmdLine("timeout 5 fyn run build >/dev/null 2>&1");
    assertStringIncludes(line, "timeout: 5000");
    assertStringIncludes(line, "mergeStreams: true");
  });

  it("keeps timeout, env and mergeStreams together", () => {
    const line = cmdLine("NODE_ENV=x timeout 5 fyn run build >/dev/null 2>&1");
    assertStringIncludes(line, "timeout: 5000");
    assertStringIncludes(line, 'env: { NODE_ENV: "x" }');
    assertStringIncludes(line, "mergeStreams: true");
  });
});
