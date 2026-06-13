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

// SSH-621: the `test` command (the command form of `[ ]`) now lowers to $.cmd's
// native test evaluator instead of shelljs $.test (file-tests only, boolean), so
// numeric/string/`-z` tests and conditions work. Values verified vs /bin/bash.
Deno.test("test command evaluates operators and drives conditions (SSH-621)", async () => {
  const cases: Array<[string, string]> = [
    [`if test 0 -lt 2; then echo yes; else echo "no=$?"; fi`, "yes"],
    [`if test 5 -lt 2; then echo yes; else echo "no=$?"; fi`, "no=1"],
    [`test 3 -eq 3; echo "r=$?"`, "r=0"],
    [`test a = b; echo "r=$?"`, "r=1"],
    [`test -n x && echo found`, "found"],
    [`test -z "" && echo empty`, "empty"],
    [`if test a = a; then echo "eq=$?"; fi`, "eq=0"],
  ];
  for (const [script, expected] of cases) {
    const r = await run(script);
    assertEquals(r.success, true, `stderr: ${r.stderr}\n${script}`);
    assertEquals(r.stdout.trim(), expected, script);
  }
});

Deno.test("test command in a while-loop condition (SSH-621)", async () => {
  const r = await run(`n=0; while test $n -lt 2; do echo $n; n=$((n+1)); done`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim().split("\n"), ["0", "1"]);
});
