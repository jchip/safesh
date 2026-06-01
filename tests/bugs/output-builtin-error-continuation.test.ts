import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

describe("Bug: output builtin error continuation", () => {
  it("prints ls errors and continues semicolon-separated commands", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const missing = `${testDir}/missing`;
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
      },
      timeout: 5000,
    };

    try {
      const code = transpileBash(`ls -la ${missing}; echo after`);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "after");
      assertStringIncludes(result.stderr, "ls: No such file or directory");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
