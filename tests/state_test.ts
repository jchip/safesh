/**
 * State Management Tests for SafeShell
 *
 * Tests for ENV, VARS, CWD persistence and path expansion:
 * - Environment variable management (ENV)
 * - Shell variable persistence (VARS)
 * - Current working directory (CWD) persistence
 * - Path expansion and normalization
 *
 * SSH-198
 */

import { assertEquals, assertNotEquals, assertExists } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { createShellManager, ShellManager } from "../src/runtime/shell.ts";
import { executeCode } from "../src/runtime/executor.ts";
import type { SafeShellConfig, Shell } from "../src/core/types.ts";
import { join, resolve, normalize } from "@std/path";
import { ensureDir } from "@std/fs";

// Test directory for state persistence tests
const TEST_DIR = "/tmp/safesh-state-test";
const TEST_SUBDIR = join(TEST_DIR, "subdir");

// Helper to create test config with permissions for test directory
function createTestConfig(cwd: string = TEST_DIR): SafeShellConfig {
  return {
    permissions: {
      read: [TEST_DIR, "/tmp"],
      write: [TEST_DIR, "/tmp"],
      env: ["PATH", "HOME", "TEST_VAR", "CUSTOM_VAR"],
    },
    timeout: 5000,
  };
}

// Helper to create a test shell
function makeTestShell(manager: ShellManager, overrides: Partial<Shell> = {}): Shell {
  const shell = manager.create({
    cwd: TEST_DIR,
    env: {},
    ...overrides,
  });
  return shell;
}

// Setup test environment
async function setupTestEnv() {
  await ensureDir(TEST_DIR);
  await ensureDir(TEST_SUBDIR);
  await Deno.writeTextFile(join(TEST_DIR, "test.txt"), "test content\n");
  await Deno.writeTextFile(join(TEST_SUBDIR, "nested.txt"), "nested content\n");
}

// Cleanup test environment
async function cleanupTestEnv() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
}

describe("State Management - Environment Variables (ENV)", () => {
  let manager: ShellManager;

  beforeEach(async () => {
    await setupTestEnv();
    manager = createShellManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it("should set environment variables via Deno.env.set()", () => {
    const shell = makeTestShell(manager);

    // Set env var through manager
    manager.setEnv(shell.id, "TEST_VAR", "test_value");

    assertEquals(shell.env.TEST_VAR, "test_value");
  });

  it("should read environment variables", () => {
    const shell = makeTestShell(manager, {
      env: { CUSTOM_VAR: "custom_value" },
    });

    assertEquals(shell.env.CUSTOM_VAR, "custom_value");
  });

  it("should persist environment variables across shell updates", () => {
    const shell = makeTestShell(manager);

    manager.setEnv(shell.id, "VAR1", "value1");
    manager.setEnv(shell.id, "VAR2", "value2");

    assertEquals(shell.env.VAR1, "value1");
    assertEquals(shell.env.VAR2, "value2");

    // Update with new env var
    manager.update(shell.id, { env: { VAR3: "value3" } });

    // All variables should still be present (merge behavior)
    assertEquals(shell.env.VAR1, "value1");
    assertEquals(shell.env.VAR2, "value2");
    assertEquals(shell.env.VAR3, "value3");
  });

  it("should unset environment variables", () => {
    const shell = makeTestShell(manager, {
      env: { TO_REMOVE: "remove_me" },
    });

    assertEquals(shell.env.TO_REMOVE, "remove_me");

    manager.unsetEnv(shell.id, "TO_REMOVE");

    assertEquals(shell.env.TO_REMOVE, undefined);
  });

  it("should inherit parent process environment by default", () => {
    const shell = makeTestShell(manager);

    // PATH should be inherited from parent process
    assertExists(shell.env.PATH);
    assertNotEquals(shell.env.PATH, "");
  });

  it("should merge provided env with parent env", () => {
    const shell = manager.create({
      cwd: TEST_DIR,
      env: { CUSTOM: "value" },
    });

    // Should have both parent env (like PATH) and custom env
    assertExists(shell.env.PATH);
    assertEquals(shell.env.CUSTOM, "value");
  });

  it("should allow overriding parent env vars", () => {
    const originalPath = Deno.env.get("PATH");

    const shell = manager.create({
      cwd: TEST_DIR,
      env: { PATH: "/custom/path" },
    });

    assertEquals(shell.env.PATH, "/custom/path");
    assertNotEquals(shell.env.PATH, originalPath);
  });
});

describe("State Management - Shell Variables (VARS)", () => {
  let manager: ShellManager;

  beforeEach(async () => {
    await setupTestEnv();
    manager = createShellManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it("should set and get shell variables", () => {
    const shell = makeTestShell(manager);

    manager.setVar(shell.id, "counter", 42);

    assertEquals(manager.getVar(shell.id, "counter"), 42);
    assertEquals(shell.vars.counter, 42);
  });

  it("should persist variables across commands", () => {
    const shell = makeTestShell(manager);

    manager.setVar(shell.id, "data", { key: "value" });
    const retrieved = manager.getVar(shell.id, "data");

    assertEquals(retrieved, { key: "value" });
  });

  it("should support complex data types", () => {
    const shell = makeTestShell(manager);

    const complexData = {
      array: [1, 2, 3],
      nested: { deep: { value: "test" } },
      mixed: ["string", 123, { obj: true }],
    };

    manager.setVar(shell.id, "complex", complexData);
    const retrieved = manager.getVar(shell.id, "complex");

    assertEquals(retrieved, complexData);
  });

  it("should maintain separate variable scopes per shell", () => {
    const shell1 = makeTestShell(manager);
    const shell2 = makeTestShell(manager);

    manager.setVar(shell1.id, "shared_name", "shell1_value");
    manager.setVar(shell2.id, "shared_name", "shell2_value");

    assertEquals(manager.getVar(shell1.id, "shared_name"), "shell1_value");
    assertEquals(manager.getVar(shell2.id, "shared_name"), "shell2_value");
  });

  it("should merge vars with update()", () => {
    const shell = makeTestShell(manager);

    shell.vars = { existing: "value" };
    manager.update(shell.id, { vars: { new: "data" } });

    assertEquals(shell.vars.existing, "value");
    assertEquals(shell.vars.new, "data");
  });

  it("should handle undefined variables gracefully", () => {
    const shell = makeTestShell(manager);

    const result = manager.getVar(shell.id, "nonexistent");

    assertEquals(result, undefined);
  });

  it("should support variable deletion by setting to undefined", () => {
    const shell = makeTestShell(manager);

    manager.setVar(shell.id, "temp", "value");
    assertEquals(shell.vars.temp, "value");

    manager.setVar(shell.id, "temp", undefined);
    assertEquals(shell.vars.temp, undefined);
  });

  it("should store primitive types correctly", () => {
    const shell = makeTestShell(manager);

    manager.setVar(shell.id, "string", "text");
    manager.setVar(shell.id, "number", 123);
    manager.setVar(shell.id, "boolean", true);
    manager.setVar(shell.id, "null", null);

    assertEquals(manager.getVar(shell.id, "string"), "text");
    assertEquals(manager.getVar(shell.id, "number"), 123);
    assertEquals(manager.getVar(shell.id, "boolean"), true);
    assertEquals(manager.getVar(shell.id, "null"), null);
  });
});

describe("State Management - Current Working Directory (CWD)", () => {
  let manager: ShellManager;

  beforeEach(async () => {
    await setupTestEnv();
    manager = createShellManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it("should set initial CWD on shell creation", () => {
    const shell = manager.create({ cwd: TEST_DIR });

    assertEquals(shell.cwd, TEST_DIR);
  });

  it("should change directory with cd()", () => {
    const shell = makeTestShell(manager);

    assertEquals(shell.cwd, TEST_DIR);

    manager.cd(shell.id, TEST_SUBDIR);

    assertEquals(shell.cwd, TEST_SUBDIR);
  });

  it("should persist CWD across commands", () => {
    const shell = makeTestShell(manager);

    manager.cd(shell.id, TEST_SUBDIR);
    assertEquals(shell.cwd, TEST_SUBDIR);

    // Simulate another operation
    manager.setEnv(shell.id, "TEST", "value");

    // CWD should still be the changed directory
    assertEquals(shell.cwd, TEST_SUBDIR);
  });

  it("should update CWD via update()", () => {
    const shell = makeTestShell(manager);

    manager.update(shell.id, { cwd: TEST_SUBDIR });

    assertEquals(shell.cwd, TEST_SUBDIR);
  });

  it("should use default CWD when not specified", () => {
    const shell = manager.create();

    assertEquals(shell.cwd, TEST_DIR);
  });

  it("should handle absolute path changes", () => {
    const shell = makeTestShell(manager);

    manager.cd(shell.id, "/tmp");
    assertEquals(shell.cwd, "/tmp");

    manager.cd(shell.id, TEST_DIR);
    assertEquals(shell.cwd, TEST_DIR);
  });

  it("should maintain separate CWD per shell", () => {
    const shell1 = manager.create({ cwd: TEST_DIR });
    const shell2 = manager.create({ cwd: TEST_SUBDIR });

    assertEquals(shell1.cwd, TEST_DIR);
    assertEquals(shell2.cwd, TEST_SUBDIR);

    manager.cd(shell1.id, "/tmp");

    // shell1 changed, shell2 unchanged
    assertEquals(shell1.cwd, "/tmp");
    assertEquals(shell2.cwd, TEST_SUBDIR);
  });
});

describe("State Management - Path Expansion", () => {
  let manager: ShellManager;

  beforeEach(async () => {
    await setupTestEnv();
    manager = createShellManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it("should handle absolute paths", () => {
    const absolutePath = join(TEST_DIR, "test.txt");
    const normalized = normalize(absolutePath);

    assertEquals(normalized, absolutePath);
  });

  it("should resolve relative paths from CWD", () => {
    const shell = makeTestShell(manager);

    // Relative path from TEST_DIR
    const relativePath = "test.txt";
    const resolvedPath = resolve(shell.cwd, relativePath);

    assertEquals(resolvedPath, join(TEST_DIR, "test.txt"));
  });

  it("should handle nested relative paths", () => {
    const shell = makeTestShell(manager);

    const relativePath = "subdir/nested.txt";
    const resolvedPath = resolve(shell.cwd, relativePath);

    assertEquals(resolvedPath, join(TEST_DIR, "subdir/nested.txt"));
  });

  it("should handle parent directory references (..)", () => {
    const shell = manager.create({ cwd: TEST_SUBDIR });

    const parentPath = "..";
    const resolvedPath = resolve(shell.cwd, parentPath);

    assertEquals(resolvedPath, TEST_DIR);
  });

  it("should handle current directory references (.)", () => {
    const shell = makeTestShell(manager);

    const currentPath = ".";
    const resolvedPath = resolve(shell.cwd, currentPath);

    assertEquals(resolvedPath, TEST_DIR);
  });

  it("should normalize paths with multiple slashes", () => {
    const messyPath = TEST_DIR + "//subdir///nested.txt";
    const normalized = normalize(messyPath);

    assertEquals(normalized, join(TEST_DIR, "subdir/nested.txt"));
  });

  it("should handle path expansion relative to changed CWD", () => {
    const shell = makeTestShell(manager);

    // Change to subdir
    manager.cd(shell.id, TEST_SUBDIR);

    // Resolve relative path from new CWD
    const relativePath = "nested.txt";
    const resolvedPath = resolve(shell.cwd, relativePath);

    assertEquals(resolvedPath, join(TEST_SUBDIR, "nested.txt"));
  });

  it("should preserve absolute paths regardless of CWD", () => {
    const shell = makeTestShell(manager);

    const absolutePath = "/tmp/absolute/path.txt";
    const resolvedPath = resolve(shell.cwd, absolutePath);

    assertEquals(resolvedPath, absolutePath);
  });
});

describe("State Management - Integration Tests", () => {
  let manager: ShellManager;

  beforeEach(async () => {
    await setupTestEnv();
    manager = createShellManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it("should persist all state types together", () => {
    const shell = makeTestShell(manager);

    // Set various state
    manager.setEnv(shell.id, "ENV_VAR", "env_value");
    manager.setVar(shell.id, "shell_var", "var_value");
    manager.cd(shell.id, TEST_SUBDIR);

    // Retrieve and verify all state
    assertEquals(shell.env.ENV_VAR, "env_value");
    assertEquals(shell.vars.shell_var, "var_value");
    assertEquals(shell.cwd, TEST_SUBDIR);
  });

  it("should maintain state across multiple operations", () => {
    const shell = makeTestShell(manager);

    // Initial state
    manager.setVar(shell.id, "counter", 0);
    manager.setEnv(shell.id, "STATUS", "starting");

    // Update state
    manager.setVar(shell.id, "counter", 1);
    manager.cd(shell.id, TEST_SUBDIR);
    manager.setEnv(shell.id, "STATUS", "running");

    // Final update
    manager.setVar(shell.id, "counter", 2);
    manager.setEnv(shell.id, "STATUS", "completed");

    // Verify final state
    assertEquals(shell.vars.counter, 2);
    assertEquals(shell.env.STATUS, "completed");
    assertEquals(shell.cwd, TEST_SUBDIR);
  });

  it("should maintain state independence between shells", () => {
    const shell1 = manager.create({ cwd: TEST_DIR });
    const shell2 = manager.create({ cwd: TEST_SUBDIR });

    // Set different state in each shell
    manager.setEnv(shell1.id, "SHELL", "shell1");
    manager.setEnv(shell2.id, "SHELL", "shell2");

    manager.setVar(shell1.id, "id", 1);
    manager.setVar(shell2.id, "id", 2);

    // Verify isolation
    assertEquals(shell1.env.SHELL, "shell1");
    assertEquals(shell2.env.SHELL, "shell2");

    assertEquals(shell1.vars.id, 1);
    assertEquals(shell2.vars.id, 2);

    assertEquals(shell1.cwd, TEST_DIR);
    assertEquals(shell2.cwd, TEST_SUBDIR);
  });

  it("should update lastActivityAt on state changes", () => {
    const shell = makeTestShell(manager);
    const initialActivity = shell.lastActivityAt.getTime();

    // Wait a bit to ensure timestamp changes
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    return (async () => {
      await sleep(10);

      // Touch should update lastActivityAt
      manager.touch(shell.id);

      const newActivity = shell.lastActivityAt.getTime();
      assertEquals(newActivity > initialActivity, true);
    })();
  });

  it("should retrieve shell by ID and maintain state", () => {
    const shell = makeTestShell(manager);

    // Set state
    manager.setEnv(shell.id, "TEST", "value");
    manager.setVar(shell.id, "data", { key: "val" });
    manager.cd(shell.id, TEST_SUBDIR);

    // Retrieve shell by ID
    const retrieved = manager.get(shell.id);

    assertExists(retrieved);
    assertEquals(retrieved!.env.TEST, "value");
    assertEquals(retrieved!.vars.data, { key: "val" });
    assertEquals(retrieved!.cwd, TEST_SUBDIR);
  });

  it("should handle getOrCreate with existing shell", () => {
    const shell = makeTestShell(manager);

    manager.setVar(shell.id, "existing", true);

    const { shell: retrieved, created } = manager.getOrCreate(shell.id);

    assertEquals(created, false);
    assertEquals(retrieved.id, shell.id);
    assertEquals(retrieved.vars.existing, true);
  });

  it("should handle getOrCreate with new shell", () => {
    const { shell, created } = manager.getOrCreate("new-shell", {
      cwd: TEST_SUBDIR,
      env: { NEW: "shell" },
    });

    assertEquals(created, true);
    assertEquals(shell.id, "new-shell");
    assertEquals(shell.cwd, TEST_SUBDIR);
    assertEquals(shell.env.NEW, "shell");
  });

  it("should serialize shell state correctly", () => {
    const shell = makeTestShell(manager);

    manager.setEnv(shell.id, "ENV", "value");
    manager.setVar(shell.id, "var", 123);
    manager.cd(shell.id, TEST_SUBDIR);

    const serialized = manager.serialize(shell);

    assertEquals(serialized.shellId, shell.id);
    assertEquals(serialized.cwd, TEST_SUBDIR);
    assertEquals(serialized.env.ENV, "value");
    assertEquals(serialized.vars.var, 123);
    assertExists(serialized.createdAt);
    assertExists(serialized.lastActivityAt);
  });
});

describe("State Management - Edge Cases", () => {
  let manager: ShellManager;

  beforeEach(async () => {
    await setupTestEnv();
    manager = createShellManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it("should handle empty environment variables", () => {
    const shell = makeTestShell(manager);

    manager.setEnv(shell.id, "EMPTY", "");

    assertEquals(shell.env.EMPTY, "");
  });

  it("should handle special characters in env var values", () => {
    const shell = makeTestShell(manager);

    manager.setEnv(shell.id, "SPECIAL", "value with spaces and $pecial ch@rs!");

    assertEquals(shell.env.SPECIAL, "value with spaces and $pecial ch@rs!");
  });

  it("should handle empty string as shell variable", () => {
    const shell = makeTestShell(manager);

    manager.setVar(shell.id, "empty", "");

    assertEquals(shell.vars.empty, "");
  });

  it("should return false when updating nonexistent shell", () => {
    const result = manager.setEnv("nonexistent", "KEY", "value");

    assertEquals(result, false);
  });

  it("should return false when changing CWD of nonexistent shell", () => {
    const result = manager.cd("nonexistent", "/tmp");

    assertEquals(result, false);
  });

  it("should return false when setting var on nonexistent shell", () => {
    const result = manager.setVar("nonexistent", "key", "value");

    assertEquals(result, false);
  });

  it("should return undefined when getting var from nonexistent shell", () => {
    const result = manager.getVar("nonexistent", "key");

    assertEquals(result, undefined);
  });

  it("should handle very long environment variable values", () => {
    const shell = makeTestShell(manager);
    const longValue = "x".repeat(10000);

    manager.setEnv(shell.id, "LONG", longValue);

    assertEquals(shell.env.LONG, longValue);
    assertEquals(shell.env.LONG?.length, 10000);
  });

  it("should handle deeply nested variable objects", () => {
    const shell = makeTestShell(manager);

    const deepObj = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: "deep",
            },
          },
        },
      },
    };

    manager.setVar(shell.id, "deep", deepObj);
    const retrieved = manager.getVar(shell.id, "deep") as typeof deepObj;

    assertEquals(retrieved.level1.level2.level3.level4.value, "deep");
  });

  it("should handle CWD with special characters", () => {
    const shell = makeTestShell(manager);
    const specialPath = "/tmp/path with spaces";

    manager.cd(shell.id, specialPath);

    assertEquals(shell.cwd, specialPath);
  });
});
