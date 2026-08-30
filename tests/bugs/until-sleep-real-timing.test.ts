import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { runBashPrehook } from "../helpers.ts";

const EXEC_CONFIG: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp", "/dev/null"],
  },
  timeout: 5000,
};

function run(script: string) {
  const code = transpile(parse(script), { imports: false, strict: false });
  return executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });
}

// A prior debugging session misdiagnosed a stalled background watcher as
// "safesh transpiles bash sleep/until and doesn't preserve sleep semantics
// for run_in_background" -- claiming a transpiled `until ... sleep 30 ...
// done` loop spun through 60+ iterations in under a second because `sleep`
// became a no-op. Direct reproduction of the exact command shape (a
// non-piped `grep -qE ... 2>/dev/null` condition, matching the original
// incident) showed this was never true: `sleep` is transpiled into a real
// awaited subprocess call (src/external/runner.ts) and the until loop's
// `while(true)` codegen genuinely awaits each iteration
// (src/bash/transpiler2/handlers/control.ts). These tests pin that down
// with real wall-clock assertions so the same wrong theory doesn't need to
// be re-litigated by digging through the transpiler again.

Deno.test("until loop with sleep body blocks for real wall-clock time (not a transpilation no-op)", async () => {
  const start = Date.now();
  const r = await run(
    `i=0
until grep -qE 'NEVERMATCH' /tmp/safesh-timing-nonexistent.log 2>/dev/null; do
  i=$((i+1))
  [ $i -gt 3 ] && { echo 'WATCHER TIMEOUT'; exit 1; }
  sleep 1
done
echo done`,
  );
  const elapsed = Date.now() - start;

  assertEquals(r.success, false, r.stderr);
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "WATCHER TIMEOUT");
  // 3 real `sleep 1` iterations must actually block ~3s. A mis-transpiled or
  // un-awaited sleep would let all iterations fly by in well under a second.
  assert(elapsed >= 2500, `expected >=2500ms for 3x real sleep(1s), got ${elapsed}ms`);
});

Deno.test("bash-prehook run_in_background rewrite still real-times an until/sleep loop", async () => {
  const cwd = Deno.cwd();
  const script = `i=0
until grep -qE 'NEVERMATCH' /tmp/safesh-timing-nonexistent-bg.log 2>/dev/null; do
  i=$((i+1))
  [ $i -gt 3 ] && { echo 'WATCHER TIMEOUT'; exit 1; }
  sleep 1
done
echo done`;

  const hookResult = await runBashPrehook(script, cwd, { runInBackground: true });
  assertEquals(hookResult.code, 0, hookResult.stderr);

  const decision = JSON.parse(hookResult.stdout.trim());
  const command = decision.hookSpecificOutput?.updatedInput?.command as string | undefined;
  assert(command, `expected rewritten command, stdout=${hookResult.stdout}`);
  assertStringIncludes(command, "SAFESH_RUN_IN_BACKGROUND=1");

  const start = Date.now();
  const child = new Deno.Command("/bin/sh", {
    args: ["-c", command],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await child.output();
  const elapsed = Date.now() - start;
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 1, stderr);
  assertStringIncludes(stdout, "WATCHER TIMEOUT");
  // Same real-time expectation, but through the actual prehook rewrite and
  // SAFESH_RUN_IN_BACKGROUND=1 desh subprocess path used for run_in_background
  // Bash tool calls -- the exact path the original (wrong) diagnosis blamed.
  assert(elapsed >= 2500, `expected >=2500ms for 3x real sleep(1s), got ${elapsed}ms`);
});
