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
    run: ["false", "printf"],
  },
  timeout: 5000,
};

describe("Bug: grouped logical pipelines", () => {
  it("runs || fallback commands based on exit status", async () => {
    const code = transpileBash(`false || printf "fallback\\n"`);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "fallback\n");
  });

  it("pipes captured subshell stdout to downstream transforms", async () => {
    const code = transpileBash(`(printf "a\\nb\\n") | head -1`);

    assertEquals(code.includes("})().stdout()"), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim(), "a");
  });

  it("pipes grouped || fallback output to downstream transforms", async () => {
    const code = transpileBash(`(false || false || printf "first\\nsecond\\n") | head -1`);

    assertEquals(code.includes("})().stdout()"), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertStringIncludes(result.stdout, "first");
    assertEquals(result.stdout.includes("second"), false);
  });
});
