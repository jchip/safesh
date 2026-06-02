import { assertEquals } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

const CONFIG: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
  },
  timeout: 5000,
};

function transpileForExecution(script: string): string {
  return transpile(parse(script), { imports: false, strict: false });
}

Deno.test("default parameter expansion in echo uses fallback for unset variables", async () => {
  const code = transpileForExecution(
    'echo "SAFESH_SSH69_UNSET_VAR in this shell = [${SAFESH_SSH69_UNSET_VAR:-<unset>}]"; echo "SAFESH_SSH69_UNSET_VAR_2 in this shell = [${SAFESH_SSH69_UNSET_VAR_2:-<unset>}]"',
  );

  const result = await executeCode(code, CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim().split(/\r?\n/), [
    "SAFESH_SSH69_UNSET_VAR in this shell = [<unset>]",
    "SAFESH_SSH69_UNSET_VAR_2 in this shell = [<unset>]",
  ]);
});
