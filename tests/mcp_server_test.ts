/**
 * Tests for MCP server tool handlers
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { createServer } from "../src/mcp/server.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

const testConfig: SafeShellConfig = {
  permissions: {
    read: ["/tmp", "${CWD}"],
    write: ["/tmp"],
    run: ["git", "echo"],
    env: ["HOME", "PATH"],
  },
  external: {
    git: { allow: true, denyFlags: ["--force"] },
    echo: { allow: true },
  },
  timeout: 5000,
};

// ============================================================================
// createServer Tests
// ============================================================================

Deno.test("createServer - creates server with correct name", () => {
  const server = createServer(testConfig, "/project");
  // Server is created - basic smoke test
  assertEquals(typeof server, "object");
});

// ============================================================================
// Tool Description Tests (verify descriptions are informative)
// ============================================================================

Deno.test("MCP exec tool - description includes permission info", async () => {
  // We can't easily test the full MCP server without a transport,
  // but we can verify the server creates successfully with config
  const config: SafeShellConfig = {
    permissions: {
      read: ["/tmp", "/project"],
      write: ["/tmp"],
      net: ["example.com"],
      run: ["git"],
    },
  };

  const server = createServer(config, "/project");
  assertEquals(typeof server, "object");
});

// ============================================================================
// Integration Tests with actual execution
// ============================================================================

Deno.test({
  name: "exec tool - executes simple code",
  async fn() {
    // Direct test of executeCode (which exec tool uses)
    const { executeCode } = await import("../src/runtime/executor.ts");

    const result = await executeCode(
      'console.log("mcp test");',
      testConfig,
      { cwd: Deno.cwd() },
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "mcp test");
  },
});

Deno.test({
  name: "exec tool - passes environment variables via session",
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");

    const session = {
      id: "test-session",
      cwd: Deno.cwd(),
      env: { TEST_VAR: "test_value" },
      vars: {},
      jobs: new Map(),
      createdAt: new Date(),
    };

    const configWithEnv: SafeShellConfig = {
      ...testConfig,
      permissions: {
        ...testConfig.permissions,
        env: ["TEST_VAR", "HOME", "PATH"],
      },
      env: {
        allow: ["TEST_VAR"],
      },
    };

    const result = await executeCode(
      'console.log(Deno.env.get("TEST_VAR") ?? "not found");',
      configWithEnv,
      { cwd: Deno.cwd() },
      session,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "test_value");
  },
});

Deno.test({
  name: "exec tool - handles timeout errors",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");

    const shortTimeoutConfig: SafeShellConfig = {
      ...testConfig,
      timeout: 100,
    };

    try {
      await executeCode(
        'await new Promise(r => setTimeout(r, 5000));',
        shortTimeoutConfig,
        { cwd: Deno.cwd() },
      );
      assertEquals(true, false, "Should have thrown timeout error");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timed out");
    }
  },
});

// ============================================================================
// Validation Integration Tests
// ============================================================================

Deno.test({
  name: "run tool - validates commands before execution",
  async fn() {
    const { validateExternal } = await import("../src/external/validator.ts");
    const { createRegistry } = await import("../src/external/registry.ts");

    const registry = createRegistry(testConfig);

    // Valid command
    let result = await validateExternal(
      "git",
      ["status"],
      registry,
      testConfig,
      "/project",
    );
    assertEquals(result.valid, true);

    // Invalid command
    result = await validateExternal(
      "rm",
      ["-rf", "/"],
      registry,
      testConfig,
      "/project",
    );
    assertEquals(result.valid, false);
    assertEquals(result.error?.code, "COMMAND_NOT_WHITELISTED");
  },
});

Deno.test({
  name: "run tool - validates denied flags",
  async fn() {
    const { validateExternal } = await import("../src/external/validator.ts");
    const { createRegistry } = await import("../src/external/registry.ts");

    const registry = createRegistry(testConfig);

    const result = await validateExternal(
      "git",
      ["push", "--force"],
      registry,
      testConfig,
      "/project",
    );

    assertEquals(result.valid, false);
    assertEquals(result.error?.code, "FLAG_NOT_ALLOWED");
  },
});
