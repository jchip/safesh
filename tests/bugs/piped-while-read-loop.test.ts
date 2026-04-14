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

function transpileForExecution(script: string): string {
  const ast = parse(script);
  return transpile(ast, { imports: false, strict: false });
}

Deno.test("piped while read loop executes and splits fields", async () => {
  const code = transpileForExecution(`printf "a one
b two words
" | while read hash msg; do echo "$hash|$msg"; done`);

  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim().split("\n"), ["a|one", "b|two words"]);
});

Deno.test("piped while IFS= read -r preserves raw line content", async () => {
  const code = transpileForExecution(`printf "  spaced value  
" | while IFS= read -r line; do echo "[$line]"; done`);

  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim(), "[  spaced value  ]");
});
