import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast, { imports: false, strict: false });
}

async function withFixture(
  fn: (testDir: string, config: SafeShellConfig) => Promise<void>,
): Promise<void> {
  const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
  const config: SafeShellConfig = {
    permissions: {
      read: [Deno.cwd(), testDir, "/tmp"],
      write: [testDir, "/tmp"],
      run: [],
    },
    timeout: 5000,
  };

  try {
    await fn(testDir, config);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
}

describe("Bug: cd error reporting", () => {
  it("should report failed cd stderr and continue a newline-separated script", async () => {
    await withFixture(async (testDir, config) => {
      const missingDir = `${testDir}/missing-dir`;
      const code = transpileBash(
        `cd ${missingDir}
pwd
echo blah blah
pwd`,
      );

      assertStringIncludes(code, `$.cd("${missingDir}")`);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stderr, `cd: ${missingDir}: No such file or directory`);
      assertEquals(result.stdout.trim().split(/\r?\n/), [
        testDir,
        "blah blah",
        testDir,
      ]);
    });
  });
});
