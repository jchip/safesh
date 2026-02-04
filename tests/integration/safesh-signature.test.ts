/**
 * Integration tests for SafeShell signature prefix execution
 *
 * SSH-480: End-to-end tests for direct SafeShell TypeScript execution via bash-prehook
 *
 * These tests verify the full execution path:
 * 1. Command detection (detectTypeScript, detectHybridCommand)
 * 2. Code transformation (generateInlineErrorHandler)
 * 3. Execution via desh
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";

describe("SafeShell signature execution", () => {
  const DESH_PATH = new URL("../../src/cli/desh.ts", import.meta.url).pathname;

  /**
   * Helper to run a command via desh and capture output
   */
  async function runDesh(code: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", DESH_PATH, "-q", "-c", code],
      stdout: "piped",
      stderr: "piped",
    });

    const result = await cmd.output();
    return {
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      code: result.code,
    };
  }

  describe("direct TypeScript execution", () => {
    it("executes simple console.log", async () => {
      const result = await runDesh('console.log("hello from safesh");');

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "hello from safesh");
    });

    it("executes code with SafeShell $ APIs", async () => {
      const result = await runDesh("console.log($.pwd());");

      assertEquals(result.code, 0);
      // Should output current working directory
      assertStringIncludes(result.stdout, "/");
    });

    it("executes async code", async () => {
      const result = await runDesh(`
        const exists = await $.fs.exists("deno.json");
        console.log("exists:", exists);
      `);

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "exists: true");
    });

    it("handles errors gracefully", async () => {
      const result = await runDesh('throw new Error("test error");');

      assertEquals(result.code, 1);
      assertStringIncludes(result.stderr, "test error");
    });

    it("executes multiline code", async () => {
      const result = await runDesh(`
        const a = 1;
        const b = 2;
        console.log("sum:", a + b);
      `);

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "sum: 3");
    });

    it("executes code with template literals", async () => {
      const result = await runDesh('const name = "world"; console.log(`Hello ${name}!`);');

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "Hello world!");
    });

    it("executes code with special characters", async () => {
      const result = await runDesh('console.log("line1\\nline2");');

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "line1\nline2");
    });
  });

  describe("SafeShell $ API usage", () => {
    it("uses $.fs.read to read files", async () => {
      const result = await runDesh(`
        const content = await $.fs.read("deno.json");
        console.log(content.includes("safesh") ? "found" : "not found");
      `);

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "found");
    });

    it("uses $.glob to find files", async () => {
      const result = await runDesh(`
        const files = await $.globPaths("*.json");
        console.log("count:", files.length);
        // globPaths returns full paths, check if any contain deno.json
        console.log("has deno.json:", files.some(f => f.endsWith("deno.json")));
      `);

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "has deno.json: true");
    });

    it("uses $.text utilities", async () => {
      const result = await runDesh(`
        const lines = $.text.lines("a\\nb\\nc");
        console.log("count:", lines.length);
      `);

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "count: 3");
    });

    it("uses $.path utilities", async () => {
      const result = await runDesh(`
        const base = $.path.basename("/foo/bar/baz.txt");
        console.log("base:", base);
      `);

      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "base: baz.txt");
    });
  });

  describe("error handling in generated code", () => {
    it("catches synchronous errors", async () => {
      const result = await runDesh(`
        const x: any = null;
        x.foo(); // Should throw TypeError
      `);

      assertEquals(result.code, 1);
      // Should have error message in stderr
      assertEquals(result.stderr.length > 0, true, "Should have error output");
    });

    it("catches asynchronous errors", async () => {
      const result = await runDesh(`
        await Promise.reject(new Error("async error"));
      `);

      assertEquals(result.code, 1);
      assertStringIncludes(result.stderr, "async error");
    });

    it("catches errors in async operations", async () => {
      const result = await runDesh(`
        // Try to read a non-existent file
        await $.fs.read("/nonexistent/path/file.txt");
      `);

      assertEquals(result.code, 1);
      // Should have some error output
      assertEquals(result.stderr.length > 0, true, "Should have error output");
    });
  });

  describe("code validity checks", () => {
    it("rejects syntactically invalid code", async () => {
      const result = await runDesh("const x = {;"); // Invalid syntax

      assertEquals(result.code, 1);
      // Should have syntax error
      assertEquals(result.stderr.length > 0, true, "Should have error output");
    });

    it("handles empty code", async () => {
      const result = await runDesh("");

      // Empty code returns exit code 1 (requires code to execute)
      // This is expected behavior - desh -c requires actual code
      assertEquals(result.code, 1);
    });

    it("handles comment-only code", async () => {
      const result = await runDesh("// just a comment");

      assertEquals(result.code, 0);
    });
  });
});
