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

describe("Bug: cat stream errors", () => {
  it("prints a missing-file error and continues a newline-separated script", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
      },
      timeout: 5000,
    };

    try {
      const missingFile = `${testDir}/missing.txt`;
      const code = transpileBash(
        `cat ${missingFile}
echo after`,
      );

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "after");
      assertStringIncludes(result.stderr, `cat: ${missingFile}: No such file or directory`);
      assertEquals(result.stderr.includes("Uncaught"), false);
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
