import { assertEquals, assertStringIncludes } from "@std/assert";
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
    run: ["printf", "cut"],
  },
  timeout: 5000,
};

describe("Bug: mixed quoted command args", () => {
  it("removes quote syntax before building argv", async () => {
    const code = transpileBash(`printf "alpha beta\\n" | cut -d' ' -f1`);

    assertStringIncludes(code, `"cut", "-d ", "-f1"`);

    const result = await executeCode(code, config);

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "alpha\n");
  });
});
