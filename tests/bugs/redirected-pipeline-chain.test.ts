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

describe("Bug: redirected pipeline chains", () => {
  it("executes chained redirected pipe filters without async iterable errors", async () => {
    const code = transpileBash(
      `printf "checkout ok\\n" 2>&1 | tail -2 && echo "---cherry-pick my commit---" && printf "picked\\n" 2>&1 | tail -5`,
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertStringIncludes(result.stdout, "checkout ok");
    assertStringIncludes(result.stdout, "---cherry-pick my commit---");
    assertStringIncludes(result.stdout, "picked");
  });

  it("short-circuits a stream RHS to an empty stream", async () => {
    const code = transpileBash(`false && printf "skip\\n" 2>&1 | tail -1`);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(
      result.stderr.includes("is not async iterable"),
      false,
      `stderr: ${result.stderr}\ncode:\n${code}`,
    );
    assertEquals(result.stdout.trim(), "");
  });
});
