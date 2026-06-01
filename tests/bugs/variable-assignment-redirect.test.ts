import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

describe("Bug: variable assignment redirects", () => {
  it("does not append stderr redirection methods to a pure assignment value", async () => {
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), "/tmp"],
        write: ["/tmp"],
      },
      timeout: 5000,
    };
    const code = transpileBash(
      `p=target
real="opfs/$p" 2>/dev/null
echo "$real"`,
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim(), "opfs/target");
    assertEquals(result.stderr, "");
    assertEquals(code.includes('.stderr("/dev/null")'), false, code);
  });
});
