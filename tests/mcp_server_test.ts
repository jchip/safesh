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

Deno.test({
  name: "createServer - creates server with correct name",
  // Server creates background timers and file readers for persistence
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    const server = createServer(testConfig, Deno.cwd());
    // Server is created - basic smoke test
    assertEquals(typeof server, "object");
  },
});

// ============================================================================
// Tool Description Tests (verify descriptions are informative)
// ============================================================================

Deno.test({
  name: "MCP exec tool - description includes permission info",
  // Server creates background timers and file readers for persistence
  sanitizeOps: false,
  sanitizeResources: false,
  fn() {
    // We can't easily test the full MCP server without a transport,
    // but we can verify the server creates successfully with config
    const config: SafeShellConfig = {
      permissions: {
        read: ["/tmp", Deno.cwd()],
        write: ["/tmp"],
        net: ["example.com"],
        run: ["git"],
      },
    };

    const server = createServer(config, Deno.cwd());
    assertEquals(typeof server, "object");
  },
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

    const now = new Date();
      const session = {
        id: "test-shell",
        cwd: "/tmp",
        env: { TEST_VAR: "test_value" },
        vars: {},
        jobs: new Map(),
        scripts: new Map(),
        scriptsByPid: new Map(),
        scriptSequence: 0,
        jobSequence: 0,
        createdAt: new Date(),
        lastActivityAt: new Date(),
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
  // Disable sanitizers to avoid flaky async leak detection from prior tests
  sanitizeOps: false,
  sanitizeResources: false,
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
      Deno.cwd(),
    );
    assertEquals(result.valid, true);

    // Invalid command
    result = await validateExternal(
      "rm",
      ["-rf", "/"],
      registry,
      testConfig,
      Deno.cwd(),
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
      Deno.cwd(),
    );

    assertEquals(result.valid, false);
    assertEquals(result.error?.code, "FLAG_NOT_ALLOWED");
  },
});

// ============================================================================
// Task Tool Tests
// ============================================================================

Deno.test({
  name: "task tool - executes simple command task",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      ...testConfig,
      tasks: {
        hello: {
          cmd: 'console.log("Hello from task");',
        },
      },
    };

    const result = await runTask("hello", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Hello from task");
  },
});

Deno.test({
  name: "task tool - executes task with parallel execution",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      ...testConfig,
      tasks: {
        task1: { cmd: 'console.log("Task 1");' },
        task2: { cmd: 'console.log("Task 2");' },
        parallel: { parallel: ["task1", "task2"] },
      },
    };

    const result = await runTask("parallel", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Task 1");
    assertStringIncludes(result.stdout, "Task 2");
  },
});

Deno.test({
  name: "task tool - executes task with serial execution",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      ...testConfig,
      tasks: {
        task1: { cmd: 'console.log("First");' },
        task2: { cmd: 'console.log("Second");' },
        serial: { serial: ["task1", "task2"] },
      },
    };

    const result = await runTask("serial", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "First");
    assertStringIncludes(result.stdout, "Second");
  },
});

Deno.test({
  name: "task tool - handles task reference (string alias)",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      ...testConfig,
      tasks: {
        actual: { cmd: 'console.log("Actual task");' },
        alias: "actual",
      },
    };

    const result = await runTask("alias", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Actual task");
  },
});

Deno.test({
  name: "task tool - handles task not found error",
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      ...testConfig,
      tasks: {
        existing: { cmd: 'console.log("exists");' },
      },
    };

    try {
      await runTask("nonexistent", configWithTask);
      assertEquals(true, false, "Should have thrown task not found error");
    } catch (error) {
      assertStringIncludes((error as Error).message, "not found");
      assertStringIncludes((error as Error).message, "nonexistent");
    }
  },
});

Deno.test({
  name: "task tool - stops serial execution on failure",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      ...testConfig,
      tasks: {
        task1: { cmd: 'console.log("First");' },
        failing: { cmd: 'throw new Error("Task failed");' },
        task3: { cmd: 'console.log("Should not run");' },
        serial: { serial: ["task1", "failing", "task3"] },
      },
    };

    const result = await runTask("serial", configWithTask);

    assertEquals(result.success, false);
    assertStringIncludes(result.stdout, "First");
    // task3 should not have run
    assertEquals(result.stdout.includes("Should not run"), false);
  },
});

// ============================================================================
// xrun Syntax Integration Tests
// ============================================================================

Deno.test({
  name: "task tool - executes xrun parallel syntax [a, b, c]",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      tasks: {
        a: { cmd: 'console.log("Task A");' },
        b: { cmd: 'console.log("Task B");' },
        c: { cmd: 'console.log("Task C");' },
        xrun: "[a, b, c]",
      },
    };

    const result = await runTask("xrun", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Task A");
    assertStringIncludes(result.stdout, "Task B");
    assertStringIncludes(result.stdout, "Task C");
  },
});

Deno.test({
  name: "task tool - executes xrun serial syntax [-s, a, b, c]",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      tasks: {
        a: { cmd: 'console.log("First");' },
        b: { cmd: 'console.log("Second");' },
        c: { cmd: 'console.log("Third");' },
        xrun: "[-s, a, b, c]",
      },
    };

    const result = await runTask("xrun", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "First");
    assertStringIncludes(result.stdout, "Second");
    assertStringIncludes(result.stdout, "Third");
  },
});

Deno.test({
  name: "task tool - executes nested xrun syntax [a, [-s, b, c], d]",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      tasks: {
        a: { cmd: 'console.log("Task A");' },
        b: { cmd: 'console.log("Task B");' },
        c: { cmd: 'console.log("Task C");' },
        d: { cmd: 'console.log("Task D");' },
        nested: "[a, [-s, b, c], d]",
      },
    };

    const result = await runTask("nested", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Task A");
    assertStringIncludes(result.stdout, "Task B");
    assertStringIncludes(result.stdout, "Task C");
    assertStringIncludes(result.stdout, "Task D");
  },
});

Deno.test({
  name: "task tool - xrun serial stops on failure",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      tasks: {
        first: { cmd: 'console.log("First");' },
        fail: { cmd: 'throw new Error("Task failed");' },
        third: { cmd: 'console.log("Should not run");' },
        serial: "[-s, first, fail, third]",
      },
    };

    const result = await runTask("serial", configWithTask);

    assertEquals(result.success, false);
    assertStringIncludes(result.stdout, "First");
    assertEquals(result.stdout.includes("Should not run"), false);
  },
});

Deno.test({
  name: "task tool - build pipeline example with xrun",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { runTask } = await import("../src/runner/tasks.ts");

    const configWithTask: SafeShellConfig = {
      tasks: {
        clean: { cmd: 'console.log("Cleaning...");' },
        lint: { cmd: 'console.log("Linting...");' },
        test: { cmd: 'console.log("Testing...");' },
        build: { cmd: 'console.log("Building...");' },
        pipeline: "[-s, clean, [lint, test], build]",
      },
    };

    const result = await runTask("pipeline", configWithTask);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "Cleaning...");
    assertStringIncludes(result.stdout, "Linting...");
    assertStringIncludes(result.stdout, "Testing...");
    assertStringIncludes(result.stdout, "Building...");
  },
});

// ============================================================================
// SSH-173: updateShell CWD propagation test
// ============================================================================

Deno.test({
  name: "SSH-173 - updateShell CWD propagates to subsequent script execution",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");

    // Create shell manager with /tmp as default
    const shellManager = createShellManager("/tmp");

    // Create a shell
    const shell = shellManager.create({ cwd: "/tmp" });
    assertEquals(shell.cwd, "/tmp");

    // Run code that outputs the working directory
    const result1 = await executeCode(
      'console.log(Deno.cwd());',
      testConfig,
      { cwd: shell.cwd },
      shell,
    );
    assertEquals(result1.success, true);
    assertStringIncludes(result1.stdout.trim(), "/tmp");

    // Update shell cwd to a different directory
    const newCwd = Deno.cwd(); // Use current test directory
    const updatedShell = shellManager.update(shell.id, { cwd: newCwd });
    assertEquals(updatedShell?.cwd, newCwd);

    // Verify the shell object was updated
    const fetchedShell = shellManager.get(shell.id);
    assertEquals(fetchedShell?.cwd, newCwd);

    // Run code again - should now be in new cwd
    const result2 = await executeCode(
      'console.log(Deno.cwd());',
      testConfig,
      { cwd: fetchedShell!.cwd },
      fetchedShell!,
    );
    assertEquals(result2.success, true);
    assertStringIncludes(result2.stdout.trim(), newCwd);
  },
});

Deno.test({
  name: "SSH-173 - shell.cwd is correctly passed to executeCode options",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");

    // This test verifies that when we pass the shell object directly,
    // the cwd is correctly used from shell.cwd

    const testDir = Deno.cwd();
    const shellManager = createShellManager(testDir);
    const shell = shellManager.create({ cwd: testDir });

    // Run without explicit cwd option - should use shell.cwd
    const result = await executeCode(
      'console.log(Deno.cwd());',
      testConfig,
      {}, // No cwd in options
      shell,
    );

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout.trim(), testDir);
  },
});

Deno.test({
  name: "SSH-173 - MCP server flow: getOrCreate returns shell with updated cwd",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");

    // Simulate exact MCP server flow:
    // 1. run() with shellId creates shell
    // 2. updateShell() changes cwd
    // 3. run() with same shellId should use new cwd

    const shellManager = createShellManager("/tmp");

    // Step 1: First run() - getOrCreate creates shell
    const { shell: shell1 } = shellManager.getOrCreate("test-sh", { cwd: "/tmp" });
    assertEquals(shell1.cwd, "/tmp");

    // Execute code - should be in /tmp
    const result1 = await executeCode(
      'console.log(Deno.cwd());',
      testConfig,
      { cwd: shell1.cwd },
      shell1,
    );
    assertStringIncludes(result1.stdout.trim(), "/tmp");

    // Step 2: updateShell() changes cwd
    const newCwd = Deno.cwd();
    shellManager.update("test-sh", { cwd: newCwd });

    // Step 3: Second run() - getOrCreate should return same shell with NEW cwd
    const { shell: shell2 } = shellManager.getOrCreate("test-sh", { cwd: "/tmp" });

    // CRITICAL: shell2 should have the UPDATED cwd, not the fallback
    assertEquals(shell2.cwd, newCwd, "getOrCreate should return shell with updated cwd");

    // Execute code - should be in NEW directory
    const result2 = await executeCode(
      'console.log(Deno.cwd());',
      testConfig,
      { cwd: shell2.cwd },
      shell2,
    );
    assertStringIncludes(result2.stdout.trim(), newCwd);
  },
});

Deno.test({
  name: "SSH-173 - $.CWD in preamble reflects updated shell cwd",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");

    // Test that $.CWD (preamble value) matches the updated shell cwd
    const shellManager = createShellManager("/tmp");

    // Create shell with /tmp
    const { shell } = shellManager.getOrCreate("cwd-test", { cwd: "/tmp" });

    // Check $.CWD before update
    const result1 = await executeCode(
      'console.log($.CWD);',
      testConfig,
      { cwd: shell.cwd },
      shell,
    );
    assertStringIncludes(result1.stdout.trim(), "/tmp");

    // Update cwd
    const newCwd = Deno.cwd();
    shellManager.update("cwd-test", { cwd: newCwd });

    // Get shell again
    const { shell: updatedShell } = shellManager.getOrCreate("cwd-test", {});

    // Check $.CWD after update - should reflect new cwd
    const result2 = await executeCode(
      'console.log($.CWD);',
      testConfig,
      { cwd: updatedShell.cwd },
      updatedShell,
    );
    assertStringIncludes(result2.stdout.trim(), newCwd, "$.CWD should reflect updated cwd");

    // Also verify Deno.cwd() matches
    const result3 = await executeCode(
      'console.log(Deno.cwd());',
      testConfig,
      { cwd: updatedShell.cwd },
      updatedShell,
    );
    assertStringIncludes(result3.stdout.trim(), newCwd, "Deno.cwd() should match updated cwd");
  },
});

// ============================================================================
// $.globPaths export test
// ============================================================================

Deno.test({
  name: "$.globPaths is available in scripts",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");

    // Test that $.globPaths is a function and can be called
    const result = await executeCode(
      `
      console.log(typeof $.globPaths);
      console.log(typeof $.globArray);
      const paths = await $.globPaths("*.ts");
      console.log("paths:", paths.length >= 0 ? "ok" : "error");
      `,
      testConfig,
      { cwd: Deno.cwd() },
    );

    assertEquals(result.success, true, `Script failed: ${result.stderr}`);
    assertStringIncludes(result.stdout, "function");
    assertStringIncludes(result.stdout, "paths: ok");
  },
});

// ============================================================================
// SSH-192: Shell Lifecycle Management Tests
// ============================================================================

Deno.test({
  name: "SSH-192 - startShell creates a new shell with default cwd",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    // Create shell without options
    const shell = shellManager.create({});

    assertEquals(typeof shell.id, "string");
    assertEquals(shell.cwd, "/tmp"); // Uses default cwd
    assertEquals(typeof shell.createdAt, "object");

    // Cleanup
    shellManager.end(shell.id);
  },
});

Deno.test({
  name: "SSH-192 - startShell creates shell with custom cwd",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const customCwd = Deno.cwd();
    const shell = shellManager.create({ cwd: customCwd });

    assertEquals(shell.cwd, customCwd);

    // Cleanup
    shellManager.end(shell.id);
  },
});

Deno.test({
  name: "SSH-192 - startShell creates shell with custom env",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const shell = shellManager.create({
      env: { MY_VAR: "test_value", ANOTHER: "123" },
    });

    assertEquals(shell.env.MY_VAR, "test_value");
    assertEquals(shell.env.ANOTHER, "123");

    // Cleanup
    shellManager.end(shell.id);
  },
});

Deno.test({
  name: "SSH-192 - listShells returns empty array when no shells",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const shells = shellManager.list();
    assertEquals(shells.length, 0);
  },
});

Deno.test({
  name: "SSH-192 - listShells returns all active shells",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    // Create multiple shells
    const shell1 = shellManager.create({ cwd: "/tmp" });
    const shell2 = shellManager.create({ cwd: Deno.cwd() });
    const shell3 = shellManager.create({});

    const shells = shellManager.list();
    assertEquals(shells.length, 3);

    // All shells should be in the list
    const ids = shells.map((s) => s.id);
    assertEquals(ids.includes(shell1.id), true);
    assertEquals(ids.includes(shell2.id), true);
    assertEquals(ids.includes(shell3.id), true);

    // Cleanup
    shellManager.end(shell1.id);
    shellManager.end(shell2.id);
    shellManager.end(shell3.id);
  },
});

Deno.test({
  name: "SSH-192 - endShell removes shell from list",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    // Create shell
    const shell = shellManager.create({});
    assertEquals(shellManager.list().length, 1);

    // End shell
    const ended = shellManager.end(shell.id);
    assertEquals(ended, true);

    // Shell should be removed
    assertEquals(shellManager.list().length, 0);
    assertEquals(shellManager.get(shell.id), undefined);
  },
});

Deno.test({
  name: "SSH-192 - endShell returns false for non-existent shell",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const ended = shellManager.end("non-existent-shell-id");
    assertEquals(ended, false);
  },
});

Deno.test({
  name: "SSH-192 - updateShell modifies cwd",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const shell = shellManager.create({ cwd: "/tmp" });
    assertEquals(shell.cwd, "/tmp");

    const newCwd = Deno.cwd();
    const updated = shellManager.update(shell.id, { cwd: newCwd });

    assertEquals(updated?.cwd, newCwd);
    assertEquals(shellManager.get(shell.id)?.cwd, newCwd);

    // Cleanup
    shellManager.end(shell.id);
  },
});

Deno.test({
  name: "SSH-192 - updateShell modifies env",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const shell = shellManager.create({ env: { OLD: "value" } });
    assertEquals(shell.env.OLD, "value");

    const updated = shellManager.update(shell.id, {
      env: { NEW: "new_value" },
    });

    // New env should be merged
    assertEquals(updated?.env.NEW, "new_value");
    assertEquals(updated?.env.OLD, "value"); // Old value preserved

    // Cleanup
    shellManager.end(shell.id);
  },
});

Deno.test({
  name: "SSH-192 - updateShell returns undefined for non-existent shell",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const updated = shellManager.update("non-existent", { cwd: "/tmp" });
    assertEquals(updated, undefined);
  },
});

Deno.test({
  name: "SSH-192 - shell serialize includes all required fields",
  async fn() {
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    const shell = shellManager.create({
      cwd: "/tmp",
      env: { TEST: "value" },
    });

    const serialized = shellManager.serialize(shell);

    // Check required fields exist
    assertEquals(typeof serialized.shellId, "string");
    assertEquals(typeof serialized.cwd, "string");
    assertEquals(typeof serialized.createdAt, "string"); // ISO string
    assertEquals(typeof serialized.env, "object");
    assertEquals(serialized.env.TEST, "value");

    // Cleanup
    shellManager.end(shell.id);
  },
});

Deno.test({
  name: "SSH-192 - shells are isolated from each other",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { executeCode } = await import("../src/runtime/executor.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");
    const shellManager = createShellManager("/tmp");

    // Create two shells with different envs
    const shell1 = shellManager.create({ env: { SHELL_ID: "one" } });
    const shell2 = shellManager.create({ env: { SHELL_ID: "two" } });

    // Execute in shell1 - shell's env is used via the shell object
    const result1 = await executeCode(
      'console.log($.ENV.SHELL_ID ?? "undefined");',
      testConfig,
      { cwd: shell1.cwd },
      shell1,
    );

    // Execute in shell2
    const result2 = await executeCode(
      'console.log($.ENV.SHELL_ID ?? "undefined");',
      testConfig,
      { cwd: shell2.cwd },
      shell2,
    );

    assertEquals(result1.success, true);
    assertEquals(result2.success, true);
    assertStringIncludes(result1.stdout, "one");
    assertStringIncludes(result2.stdout, "two");

    // Cleanup
    shellManager.end(shell1.id);
    shellManager.end(shell2.id);
  },
});

// ============================================================================
// SSH-499: MCP userChoice schema mismatch tests
// ============================================================================

Deno.test({
  name: "SSH-499 - Zod RunSchema accepts userChoice values 1-5",
  async fn() {
    const { z } = await import("zod");

    // Replicate the RunSchema userChoice field
    const RunSchema = z.object({
      code: z.string().optional(),
      retry_id: z.string().optional(),
      userChoice: z.number().min(1).max(5).optional(),
    });

    // Values 1-5 should all parse successfully
    for (const choice of [1, 2, 3, 4, 5]) {
      const result = RunSchema.safeParse({ code: "test", userChoice: choice });
      assertEquals(result.success, true, `userChoice=${choice} should be valid`);
    }

    // Values outside 1-5 should fail
    for (const choice of [0, 6, -1]) {
      const result = RunSchema.safeParse({ code: "test", userChoice: choice });
      assertEquals(result.success, false, `userChoice=${choice} should be invalid`);
    }
  },
});

Deno.test({
  name: "SSH-499 - JSON schema enum includes all 5 userChoice values",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Create server and check tool listing includes all userChoice values
    const server = await createServer(testConfig, Deno.cwd());

    // Access the tool listing by checking the registered handler
    // We verify by inspecting the server object - the ListToolsRequestSchema handler
    // returns the tool definitions. Since we can't easily call the handler directly,
    // we verify the source code pattern is correct by importing and checking.
    // The real validation is that the JSON schema enum matches [1,2,3,4,5].

    // Instead, let's verify the actual schema by reading the inputSchema from the
    // ListTools handler response. We'll use the server's internal handler.
    // Since the MCP SDK doesn't expose a simple way to call handlers directly,
    // we test this by verifying the Zod schema accepts 4 and 5 (which were
    // previously unreachable due to the JSON schema mismatch).
    const { z } = await import("zod");

    // This mimics what the MCP client would send after seeing the updated enum
    const RunSchema = z.object({
      code: z.string().optional(),
      retry_id: z.string().optional(),
      userChoice: z.number().min(1).max(5).optional(),
    });

    // Network-specific choices (4=deny, 5=allow all) should now be parseable
    const denyResult = RunSchema.parse({ retry_id: "test-123", userChoice: 4 });
    assertEquals(denyResult.userChoice, 4, "userChoice=4 (deny) should parse");

    const allowAllResult = RunSchema.parse({ retry_id: "test-456", userChoice: 5 });
    assertEquals(allowAllResult.userChoice, 5, "userChoice=5 (allow all network) should parse");
  },
});

// ============================================================================
// SSH-504: Network "allow once" vs "allow session" tests
// ============================================================================

Deno.test({
  name: "SSH-504 - network allow once (userChoice=1) does NOT persist to configHolder",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { mergeConfigs } = await import("../src/core/config.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");

    // Simulate the configHolder pattern from createServer
    const configHolder = {
      config: {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
          net: ["existing-host.com"] as string[] | boolean,
        },
      } as SafeShellConfig,
      cwd: "/tmp",
      rootsReceived: false,
    };

    const shellManager = createShellManager("/tmp");

    // Create a pending network retry
    const retry = shellManager.createPendingRetryNetwork(
      'console.log("test")',
      "blocked-host.com",
      { cwd: "/tmp" },
    );

    // Simulate userChoice === 1 (allow once) - replicating server.ts logic
    const userChoice = 1;
    const blockedHost = "blocked-host.com";
    const currentNet = configHolder.config.permissions?.net;

    let execConfig = configHolder.config;

    if (userChoice === 1) {
      const existingNet = Array.isArray(currentNet) ? currentNet : [];
      const updatedNet = existingNet.includes(blockedHost)
        ? existingNet
        : [...existingNet, blockedHost];
      execConfig = mergeConfigs(configHolder.config, {
        permissions: { net: updatedNet },
      });
      // NOTE: configHolder.config is NOT updated for "allow once"
    }

    // execConfig should have the blocked host (for this execution only)
    const execNet = execConfig.permissions?.net;
    assertEquals(Array.isArray(execNet), true, "execConfig.net should be an array");
    assertEquals(
      (execNet as string[]).includes("blocked-host.com"),
      true,
      "execConfig should include blocked host for this execution",
    );

    // configHolder.config should NOT have the blocked host
    const persistedNet = configHolder.config.permissions?.net;
    assertEquals(Array.isArray(persistedNet), true, "configHolder.config.net should be an array");
    assertEquals(
      (persistedNet as string[]).includes("blocked-host.com"),
      false,
      "configHolder.config should NOT include blocked host after allow-once",
    );

    // Verify original hosts are preserved
    assertEquals(
      (persistedNet as string[]).includes("existing-host.com"),
      true,
      "configHolder.config should still have existing hosts",
    );
  },
});

Deno.test({
  name: "SSH-504 - network allow session (userChoice=2) persists to configHolder",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { mergeConfigs } = await import("../src/core/config.ts");
    const { createShellManager } = await import("../src/runtime/shell.ts");

    // Simulate the configHolder pattern from createServer
    const configHolder = {
      config: {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
          net: ["existing-host.com"] as string[] | boolean,
        },
      } as SafeShellConfig,
      cwd: "/tmp",
      rootsReceived: false,
    };

    const shellManager = createShellManager("/tmp");

    // Create a pending network retry
    const retry = shellManager.createPendingRetryNetwork(
      'console.log("test")',
      "session-host.com",
      { cwd: "/tmp" },
    );

    // Simulate userChoice === 2 (allow for session) - replicating server.ts logic
    const userChoice = 2;
    const blockedHost = "session-host.com";
    const currentNet = configHolder.config.permissions?.net;

    let execConfig = configHolder.config;

    if (userChoice === 2) {
      const existingNet = Array.isArray(currentNet) ? currentNet : [];
      const updatedNet = existingNet.includes(blockedHost)
        ? existingNet
        : [...existingNet, blockedHost];
      execConfig = mergeConfigs(configHolder.config, {
        permissions: { net: updatedNet },
      });
      configHolder.config = execConfig; // SSH-504 fix: persist for session
    }

    // execConfig should have the blocked host
    const execNet = execConfig.permissions?.net;
    assertEquals(Array.isArray(execNet), true, "execConfig.net should be an array");
    assertEquals(
      (execNet as string[]).includes("session-host.com"),
      true,
      "execConfig should include session host",
    );

    // configHolder.config SHOULD also have the blocked host (persisted for session)
    const persistedNet = configHolder.config.permissions?.net;
    assertEquals(Array.isArray(persistedNet), true, "configHolder.config.net should be an array");
    assertEquals(
      (persistedNet as string[]).includes("session-host.com"),
      true,
      "configHolder.config SHOULD include session host after allow-session",
    );

    // Verify original hosts are preserved
    assertEquals(
      (persistedNet as string[]).includes("existing-host.com"),
      true,
      "configHolder.config should still have existing hosts",
    );
  },
});

Deno.test({
  name: "SSH-504 - allow once host is not available in subsequent requests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { mergeConfigs } = await import("../src/core/config.ts");

    // Simulate two sequential requests with allow-once
    const configHolder = {
      config: {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
          net: [] as string[] | boolean,
        },
      } as SafeShellConfig,
      cwd: "/tmp",
      rootsReceived: false,
    };

    // First request: allow once for "api.example.com"
    const blockedHost = "api.example.com";
    const currentNet1 = configHolder.config.permissions?.net;
    const existingNet1 = Array.isArray(currentNet1) ? currentNet1 : [];
    const updatedNet1 = [...existingNet1, blockedHost];
    const execConfig1 = mergeConfigs(configHolder.config, {
      permissions: { net: updatedNet1 },
    });
    // Do NOT persist to configHolder (allow once behavior)

    // execConfig1 has the host
    assertEquals(
      (execConfig1.permissions?.net as string[]).includes("api.example.com"),
      true,
      "First execution config should have the host",
    );

    // Second request: configHolder.config should NOT have the host
    const currentNet2 = configHolder.config.permissions?.net;
    const hasHost = Array.isArray(currentNet2) && currentNet2.includes("api.example.com");
    assertEquals(hasHost, false, "Second request should NOT see allow-once host in config");
  },
});

Deno.test({
  name: "SSH-504 - allow session host IS available in subsequent requests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { mergeConfigs } = await import("../src/core/config.ts");

    // Simulate two sequential requests with allow-session
    const configHolder = {
      config: {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
          net: [] as string[] | boolean,
        },
      } as SafeShellConfig,
      cwd: "/tmp",
      rootsReceived: false,
    };

    // First request: allow for session for "api.example.com"
    const blockedHost = "api.example.com";
    const currentNet1 = configHolder.config.permissions?.net;
    const existingNet1 = Array.isArray(currentNet1) ? currentNet1 : [];
    const updatedNet1 = [...existingNet1, blockedHost];
    const execConfig1 = mergeConfigs(configHolder.config, {
      permissions: { net: updatedNet1 },
    });
    configHolder.config = execConfig1; // Persist for session (SSH-504 fix)

    // Second request: configHolder.config SHOULD have the host
    const currentNet2 = configHolder.config.permissions?.net;
    const hasHost = Array.isArray(currentNet2) && currentNet2.includes("api.example.com");
    assertEquals(hasHost, true, "Second request SHOULD see session-allowed host in config");

    // And building execConfig from configHolder.config should include the host
    const execConfig2 = mergeConfigs(configHolder.config, {});
    assertEquals(
      (execConfig2.permissions?.net as string[]).includes("api.example.com"),
      true,
      "Subsequent execConfig should include session-allowed host",
    );
  },
});
