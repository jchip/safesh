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
    run: ["printf", "grep"],
  },
  timeout: 5000,
};

describe("Bug: conditional pipeline status", () => {
  it("uses the final pipeline command status for false branches", async () => {
    const code = transpileBash(
      `if printf "alpha\\n" | grep -c beta; then echo match; else echo miss; fi`,
    );

    const result = await executeCode(code, config);

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "miss\n");
  });

  it("uses the final pipeline command status for true branches", async () => {
    const code = transpileBash(
      `if printf "alpha\\n" | grep -c alpha; then echo match; else echo miss; fi`,
    );

    const result = await executeCode(code, config);

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "match\n");
  });
});
