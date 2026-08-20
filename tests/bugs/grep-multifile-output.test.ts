import { assertEquals } from "@std/assert";
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

/**
 * Fixture mirroring the real grep reference output (macOS BSD grep, 2026-08-19):
 *
 * ```
 * $ grep -n loaded a.md b.md
 * a.md:1:alpha loaded
 * a.md:3:gamma loaded
 * b.md:2:epsilon loaded
 * ```
 *
 * `run` intentionally omits "grep" so a regression that falls back to
 * $.cmd("grep", ...) fails loudly instead of passing via the real binary.
 */
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
    await Deno.writeTextFile(
      `${testDir}/a.md`,
      ["alpha loaded", "beta", "gamma loaded"].join("\n") + "\n",
    );
    await Deno.writeTextFile(
      `${testDir}/b.md`,
      ["delta", "epsilon loaded"].join("\n") + "\n",
    );

    await fn(testDir, config);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
}

describe("Bug: multi-operand grep output shape", () => {
  it("should prefix filenames and restart line numbers per operand for -n", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(`grep -n loaded a.md b.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(
        result.stdout,
        "a.md:1:alpha loaded\na.md:3:gamma loaded\nb.md:2:epsilon loaded\n",
        `code:\n${code}`,
      );
    });
  });

  it("should prefix filenames for multiple operands without -n", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(`grep loaded a.md b.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(
        result.stdout,
        "a.md:alpha loaded\na.md:gamma loaded\nb.md:epsilon loaded\n",
        `code:\n${code}`,
      );
    });
  });

  it("should emit matches in operand order regardless of argument order", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(`grep -n loaded b.md a.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(
        result.stdout,
        "b.md:2:epsilon loaded\na.md:1:alpha loaded\na.md:3:gamma loaded\n",
        `code:\n${code}`,
      );
    });
  });

  it("should prefix filenames for a glob expanding to multiple files", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(`grep -n loaded *.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(
        result.stdout,
        "a.md:1:alpha loaded\na.md:3:gamma loaded\nb.md:2:epsilon loaded\n",
        `code:\n${code}`,
      );
    });
  });

  it("should omit the prefix when a glob expands to a single file", async () => {
    await withFixture(async (testDir, config) => {
      await Deno.remove(`${testDir}/b.md`);
      const code = transpileBash(`grep -n loaded *.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "1:alpha loaded\n3:gamma loaded\n", `code:\n${code}`);
    });
  });

  it("should omit the prefix for a single literal file operand", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(`grep -n loaded a.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "1:alpha loaded\n3:gamma loaded\n", `code:\n${code}`);
    });
  });

  it("should prefix filenames for inverted multi-operand matches", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(`grep -v loaded a.md b.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "a.md:beta\nb.md:delta\n", `code:\n${code}`);
    });
  });

  it("should return non-zero when no operand matches", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(
        `grep -n "jdbc:postgresql://" a.md b.md && echo "STILL PRESENT" || echo "gone"`,
      );
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "gone\n", `code:\n${code}`);
    });
  });
});
