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
  const code = transpileForExecution(`printf "  spaced value  \n" | while IFS= read -r line; do echo "[$line]"; done`);

  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim(), "[  spaced value  ]");
});

Deno.test("piped while read loop in middle of pipeline feeds downstream", async () => {
  const code = transpileForExecution(`printf "a foo
b bar
c baz
" | while read letter word; do echo "$letter:$word"; done | grep "b:"`);

  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim(), "b:bar");
});

Deno.test("piped while read loop in middle with multi-stage downstream", async () => {
  const code = transpileForExecution(`printf "3 c
1 a
2 b
" | while read n w; do echo "$n $w"; done | sort -k1,1n | grep "2"`);

  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim(), "2 b");
});
