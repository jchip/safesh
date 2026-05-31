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

async function withFixture(
  fn: (testDir: string, config: SafeShellConfig) => Promise<void>,
): Promise<void> {
  const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
  const config: SafeShellConfig = {
    permissions: {
      read: [Deno.cwd(), testDir, "/tmp"],
      write: [testDir, "/tmp"],
      run: ["python3"],
    },
    timeout: 5000,
  };

  try {
    await fn(testDir, config);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
}

describe("Bug: test guard with exit", () => {
  it("uses the post-cd cwd in a command substitution equality guard", async () => {
    await withFixture(async (testDir, config) => {
      const targetDir = `${testDir}/target`;
      await Deno.mkdir(targetDir);

      const code = transpileBash(
        `cd ${targetDir}
test "$(python3 -c "import os; print(os.getcwd())")" = "${targetDir}" || { echo "WRONG BRANCH"; exit 7; }
echo OK`,
      );

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "OK");
    });
  });

  it("captures output builtins inside command substitution", async () => {
    await withFixture(async (testDir, config) => {
      const targetDir = `${testDir}/target`;
      await Deno.mkdir(targetDir);

      const code = transpileBash(
        `cd ${targetDir}
test "$(pwd)" = "${targetDir}" || { echo "WRONG BRANCH"; exit 7; }
echo OK`,
      );

      assertEquals(code.includes("__cmdSubText(console.log"), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "OK");
    });
  });

  it("treats exit in a failed guard as a shell builtin", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(
        `test "master" = "EXP-234" || { echo "WRONG BRANCH"; exit 7; }
echo should-not-print`,
      );

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.code, 7, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "WRONG BRANCH");
      assertEquals(result.stdout.includes("should-not-print"), false);
      assertEquals(result.stderr.includes("Command not found"), false);
    });
  });
});
