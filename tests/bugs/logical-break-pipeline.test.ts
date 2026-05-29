import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
    run: ["printf"],
  },
  timeout: 5000,
};

describe("Bug: logical pipeline break", () => {
  it("keeps break in loop scope after a successful pipeline", async () => {
    const code = transpileBash(
      `for p in 1 2; do printf "$p\\n" | grep 1 && break; echo "after-$p"; done; echo done`,
    );

    assertEquals(code.includes("(async () => { break"), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertStringIncludes(result.stdout, "1");
    assertStringIncludes(result.stdout, "done");
    assertEquals(result.stdout.includes("after-1"), false);
    assertEquals(result.stdout.includes("after-2"), false);
  });
});
