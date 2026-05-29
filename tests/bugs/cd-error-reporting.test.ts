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

  it("should preserve cd with stderr redirection in an && chain", async () => {
    await withFixture(async (testDir, config) => {
      const targetDir = `${testDir}/target`;
      await Deno.mkdir(targetDir);

      const code = transpileBash(
        `cd ${targetDir} 2>/dev/null && echo marker && pwd`,
      );

      assertStringIncludes(code, `$.cd("${targetDir}")`);
      assertEquals(code.includes('$.cmd("cd"'), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim().split(/\r?\n/), ["marker", targetDir]);
    });
  });

  it("should not run the right side of && when redirected cd fails", async () => {
    await withFixture(async (testDir, config) => {
      const missingDir = `${testDir}/missing-dir`;
      const code = transpileBash(
        `cd ${missingDir} 2>/dev/null && echo should-not-print`,
      );

      assertStringIncludes(code, `$.cd("${missingDir}")`);
      assertEquals(code.includes('$.cmd("cd"'), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.stderr, "", `code:\n${code}`);
      assertEquals(result.stdout.trim(), "");
    });
  });

  it("should redirect stdout from print and output builtins without spawning external commands", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(
        `echo hello > echo.txt
pwd > pwd.txt`,
      );

      assertStringIncludes(code, "$.echo({ silent: true }");
      assertStringIncludes(code, "$.pwd()");
      assertEquals(code.includes('$.cmd("echo"'), false, code);
      assertEquals(code.includes('$.cmd("pwd"'), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "");
      assertEquals(await Deno.readTextFile(`${testDir}/echo.txt`), "hello\n");
      assertEquals(await Deno.readTextFile(`${testDir}/pwd.txt`), `${testDir}\n`);
    });
  });

  it("should use redirected async builtins for && exit status", async () => {
    await withFixture(async (testDir, config) => {
      const targetDir = `${testDir}/target`;
      await Deno.mkdir(targetDir);
      const code = transpileBash(
        `test -d ${targetDir} > test.txt && echo ok
test -d ${testDir}/missing > missing.txt && echo should-not-print`,
      );

      assertStringIncludes(code, "$.test(");
      assertEquals(code.includes('$.cmd("test"'), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "ok");
      assertEquals(await Deno.readTextFile(`${testDir}/test.txt`), "");
      assertEquals(await Deno.readTextFile(`${testDir}/missing.txt`), "");
    });
  });

  it("should redirect stderr from throwing output builtins without spawning external commands", async () => {
    await withFixture(async (testDir, config) => {
      const missingPath = `${testDir}/missing-file`;
      const code = transpileBash(
        `ls ${missingPath} 2> ls.err && echo should-not-print`,
      );

      assertStringIncludes(code, `$.ls("${missingPath}")`);
      assertEquals(code.includes('$.cmd("ls"'), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.stderr, "", `code:\n${code}`);
      assertEquals(result.stdout.trim(), "");
      assertStringIncludes(
        await Deno.readTextFile(`${testDir}/ls.err`),
        "ls: No such file or directory",
      );
    });
  });
});
