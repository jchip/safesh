import { assertEquals } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

const EXEC_CONFIG: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
  },
  timeout: 5000,
};

function run(script: string) {
  const code = transpile(parse(script), { imports: false, strict: false });
  return executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });
}

// SSH-619: $? at the start of an else/elif branch must reflect the failed
// condition's exit status (bash), not 0. All expected values verified against
// /bin/bash.
Deno.test("else/elif branch $? is the failed condition's status (SSH-619)", async () => {
  const cases: Array<[string, string]> = [
    // else after a `[ ]` test that fails -> condition status 1
    [`if [ -n "" ]; then echo yes; else echo "x=$?"; fi`, "x=1"],
    // else after a command condition (`false`) -> its status 1
    [`if false; then echo yes; else echo "x=$?"; fi`, "x=1"],
    // ticket repro: condition with a command substitution
    [`if [ -n "$(echo)" ]; then echo yes; else echo "x=$?"; fi`, "x=1"],
    // elif branch -> the nested (succeeding) condition's status 0
    [`if [ -n "" ]; then echo a; elif [ -z "" ]; then echo "x=$?"; fi`, "x=0"],
    // final else after two failing conditions -> the last condition's status 1
    [`if false; then :; elif false; then :; else echo "x=$?"; fi`, "x=1"],
  ];
  for (const [script, expected] of cases) {
    const r = await run(script);
    assertEquals(r.success, true, `stderr: ${r.stderr}\n${script}`);
    assertEquals(r.stdout.trim(), expected, script);
  }
});

Deno.test("then branch and no-else cases keep bash $? semantics (SSH-619)", async () => {
  const cases: Array<[string, string]> = [
    // then runs because the condition succeeded -> $? is 0
    [`if [ -n "x" ]; then echo "x=$?"; fi`, "x=0"],
    [`if true; then echo "x=$?"; else echo no; fi`, "x=0"],
    // condition fails, no else -> no branch runs, if status is 0
    [`if [ -n "" ]; then echo y; fi; echo "x=$?"`, "x=0"],
    // status after an executed branch is its last command's status
    [`if false; then :; else false; fi; echo "x=$?"`, "x=1"],
  ];
  for (const [script, expected] of cases) {
    const r = await run(script);
    assertEquals(r.success, true, `stderr: ${r.stderr}\n${script}`);
    assertEquals(r.stdout.trim(), expected, script);
  }
});
