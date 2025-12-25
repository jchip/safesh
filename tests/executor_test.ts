/**
 * Tests for the code execution engine
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { executeCode, buildPermissionFlags } from "../src/runtime/executor.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

const testConfig: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
  },
  timeout: 5000,
};

Deno.test("buildPermissionFlags - generates correct flags", () => {
  const flags = buildPermissionFlags(testConfig, "/project");

  assertEquals(flags.length, 2);
  assertStringIncludes(flags[0] ?? "", "--allow-read=");
  assertStringIncludes(flags[1] ?? "", "--allow-write=");
});

Deno.test("buildPermissionFlags - expands CWD variable", () => {
  const config: SafeShellConfig = {
    permissions: {
      read: ["${CWD}", "/tmp"],
    },
  };

  const flags = buildPermissionFlags(config, "/my/project");

  assertEquals(flags.length, 1);
  assertStringIncludes(flags[0] ?? "", "/my/project");
});

Deno.test("executeCode - runs simple code", async () => {
  const result = await executeCode(
    'console.log("hello from safesh");',
    testConfig,
  );

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "hello from safesh");
});

Deno.test("executeCode - captures stderr", async () => {
  const result = await executeCode(
    'console.error("error message");',
    testConfig,
  );

  assertEquals(result.success, true);
  assertStringIncludes(result.stderr, "error message");
});

Deno.test("executeCode - returns non-zero exit code on error", async () => {
  const result = await executeCode(
    'throw new Error("test error");',
    testConfig,
  );

  assertEquals(result.success, false);
  assertEquals(result.code !== 0, true);
});

Deno.test({
  name: "executeCode - respects timeout",
  // Skip sanitizers due to complex process cleanup on timeout
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const shortTimeoutConfig: SafeShellConfig = {
      ...testConfig,
      timeout: 100, // 100ms
    };

    try {
      await executeCode(
        'await new Promise(r => setTimeout(r, 5000));', // Sleep 5s
        shortTimeoutConfig,
      );
      // Should not reach here
      assertEquals(true, false, "Should have thrown timeout error");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timed out");
    }
  },
});
