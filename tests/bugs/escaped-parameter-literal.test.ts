import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast, { imports: false, strict: false });
}

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
    run: [],
  },
  timeout: 5000,
};

describe("Bug: escaped parameter expansion literal", () => {
  it("keeps escaped parameter expansion literal inside double quotes", async () => {
    const code = transpileBash(
      'echo "=== \\${DB_URL} comments preserved verbatim? ==="',
    );

    const result = await executeCode(code, config);

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "=== ${DB_URL} comments preserved verbatim? ===\n");
  });
});
