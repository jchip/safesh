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
    run: ["printf", "tr", "cut"],
  },
  timeout: 5000,
};

describe("Bug: pipeline into subshell read group", () => {
  it("pipes into one-shot read inside a subshell", async () => {
    const code = transpileBash(
      `printf " 123\\n" | tr -d " " | (read p; printf "$p\\n" | tail -1 | cut -c1-160)`,
    );

    assertEquals(
      code.includes(".pipe((async () =>"),
      false,
      "piped subshell reads must not be emitted as .pipe(async IIFE)",
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertStringIncludes(result.stdout, "123");
  });
});
