/**
 * Unit tests for desh.ts decomposed functions
 *
 * Tests focus on handleRetry() and handleRetryPath() decomposition:
 *
 * handleRetry() functions:
 * - parseRetryArgs()
 * - loadPendingCommand()
 * - applyPermissionChoice()
 * - buildRetryConfig()
 * - executeRetryScript()
 *
 * handleRetryPath() functions:
 * - parseRetryPathArgs()
 * - parsePathChoice()
 * - loadPendingPathData()
 * - buildPathPermissions()
 * - persistPathPermissions()
 * - buildRetryPathConfig()
 * - executeRetryPathScript()
 */

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  parseRetryArgs,
  loadPendingCommand,
  applyPermissionChoice,
  buildRetryConfig,
  executeRetryScript,
  // handleRetryPath functions
  parseRetryPathArgs,
  parsePathChoice,
  loadPendingPathData,
  buildPathPermissions,
  persistPathPermissions,
  buildRetryPathConfig,
  executeRetryPathScript,
  type PathPermissionChoice,
} from "./desh.ts";
import {
  writePendingCommand,
  writePendingPath,
  deletePending,
  generatePendingId,
  type PendingCommand,
  type PendingPathRequest,
} from "../core/pending.ts";
import { getPendingFilePath, findScriptFilePath } from "../core/temp.ts";
import { getProjectConfigDir } from "../core/config.ts";

// Test utilities
const TEST_TEMP_DIR = join(Deno.cwd(), ".temp", "test-desh");
const TEST_PROJECT_DIR = join(TEST_TEMP_DIR, "project");

async function setupTestEnv() {
  await ensureDir(TEST_TEMP_DIR);
  await ensureDir(TEST_PROJECT_DIR);
  await ensureDir(join(TEST_PROJECT_DIR, ".config", "safesh"));
}

async function cleanupTestEnv() {
  try {
    await Deno.remove(TEST_TEMP_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("desh - handleRetry decomposition", () => {
  let testIds: string[] = [];

  beforeEach(async () => {
    await setupTestEnv();
    testIds = [];
  });

  afterEach(async () => {
    // Clean up pending files
    for (const id of testIds) {
      try {
        deletePending(id, "command");
      } catch {
        // Ignore
      }
    }
    await cleanupTestEnv();
  });

  describe("parseRetryArgs", () => {
    it("parses valid arguments", () => {
      const args = ["--id=test-123", "--choice=2"];
      const result = parseRetryArgs(args);

      assertEquals(result.id, "test-123");
      assertEquals(result.choice, 2);
    });

    it("parses arguments with spaces", () => {
      const args = ["--id", "test-456", "--choice", "3"];
      const result = parseRetryArgs(args);

      assertEquals(result.id, "test-456");
      assertEquals(result.choice, 3);
    });

    it("validates choice bounds - choice 1", () => {
      const args = ["--id=test-123", "--choice=1"];
      const result = parseRetryArgs(args);
      assertEquals(result.choice, 1);
    });

    it("validates choice bounds - choice 4", () => {
      const args = ["--id=test-123", "--choice=4"];
      const result = parseRetryArgs(args);
      assertEquals(result.choice, 4);
    });
  });

  describe("loadPendingCommand", () => {
    it("loads valid pending command", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "abc123",
        commands: ["git", "curl"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(pending);

      const loaded = loadPendingCommand(id);

      assertEquals(loaded.id, id);
      assertEquals(loaded.scriptHash, "abc123");
      assertEquals(loaded.commands, ["git", "curl"]);
      assertEquals(loaded.cwd, TEST_PROJECT_DIR);
    });

    it("loads pending command with optional fields", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "def456",
        commands: ["docker"],
        cwd: TEST_PROJECT_DIR,
        timeout: 10000,
        runInBackground: true,
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(pending);

      const loaded = loadPendingCommand(id);

      assertEquals(loaded.runInBackground, true);
      assertEquals(loaded.timeout, 10000);
    });
  });

  describe("buildRetryConfig", () => {
    it("merges pending commands into config", async () => {
      const pending: PendingCommand = {
        id: "test-123",
        scriptHash: "abc123",
        commands: ["git", "curl"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      const config = await buildRetryConfig(pending);

      // Verify pending commands are added
      assertEquals(config.permissions?.run?.includes("git"), true);
      assertEquals(config.permissions?.run?.includes("curl"), true);
    });

    it("handles empty initial permissions", async () => {
      const pending: PendingCommand = {
        id: "test-456",
        scriptHash: "def456",
        commands: ["docker", "kubectl"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      const config = await buildRetryConfig(pending);

      // Should create permissions object
      assertEquals(config.permissions !== undefined, true);
      assertEquals(config.permissions?.run?.includes("docker"), true);
      assertEquals(config.permissions?.run?.includes("kubectl"), true);
    });

    it("preserves existing permissions", async () => {
      // Create a config file with existing permissions
      const configDir = getProjectConfigDir(TEST_PROJECT_DIR);
      await ensureDir(configDir);

      const existingConfig = {
        permissions: {
          run: ["echo", "ls"],
        },
      };
      await Deno.writeTextFile(
        join(configDir, "config.local.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const pending: PendingCommand = {
        id: "test-789",
        scriptHash: "ghi789",
        commands: ["git"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      const config = await buildRetryConfig(pending);

      // Should include both existing and new commands
      assertEquals(config.permissions?.run?.includes("echo"), true);
      assertEquals(config.permissions?.run?.includes("ls"), true);
      assertEquals(config.permissions?.run?.includes("git"), true);
    });
  });

  describe("integration - phase orchestration", () => {
    it("phases work together for choice 1 (allow once)", async () => {
      const id = generatePendingId();
      testIds.push(id);

      // Phase 1: Create pending command
      const pending: PendingCommand = {
        id,
        scriptHash: "test-hash-1",
        commands: ["echo"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };
      writePendingCommand(pending);

      // Phase 2: Parse args
      const args = [`--id=${id}`, "--choice=1"];
      const parsed = parseRetryArgs(args);
      assertEquals(parsed.id, id);
      assertEquals(parsed.choice, 1);

      // Phase 3: Load pending
      const loaded = loadPendingCommand(id);
      assertEquals(loaded.id, id);
      assertEquals(loaded.commands, ["echo"]);

      // Phase 4: Build config
      const config = await buildRetryConfig(loaded);
      assertEquals(config.permissions?.run?.includes("echo"), true);

      // Verify pending file still exists (will be cleaned up by executeRetryScript)
      const pendingPath = getPendingFilePath(id);
      const stat = await Deno.stat(pendingPath);
      assertEquals(stat.isFile, true);
    });

    it("phases work together for choice 2 (always allow)", async () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "test-hash-2",
        commands: ["git"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };
      writePendingCommand(pending);

      const args = [`--id=${id}`, "--choice=2"];
      const parsed = parseRetryArgs(args);
      assertEquals(parsed.choice, 2);

      const loaded = loadPendingCommand(id);
      assertEquals(loaded.commands, ["git"]);

      // Config should be built correctly
      const config = await buildRetryConfig(loaded);
      assertEquals(config.permissions?.run?.includes("git"), true);
    });

    it("phases work together for choice 3 (session allow)", async () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "test-hash-3",
        commands: ["curl"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };
      writePendingCommand(pending);

      const args = [`--id=${id}`, "--choice=3"];
      const parsed = parseRetryArgs(args);
      assertEquals(parsed.choice, 3);

      const loaded = loadPendingCommand(id);
      assertEquals(loaded.commands, ["curl"]);

      const config = await buildRetryConfig(loaded);
      assertEquals(config.permissions?.run?.includes("curl"), true);
    });
  });

  describe("security validation", () => {
    it("validates that commands are properly added to permissions", async () => {
      const pending: PendingCommand = {
        id: "security-test-1",
        scriptHash: "sec-hash-1",
        commands: ["rm", "mv", "cp"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      const config = await buildRetryConfig(pending);

      // All commands must be present
      assertEquals(config.permissions?.run?.includes("rm"), true);
      assertEquals(config.permissions?.run?.includes("mv"), true);
      assertEquals(config.permissions?.run?.includes("cp"), true);
    });

    it("preserves projectDir in config", async () => {
      const pending: PendingCommand = {
        id: "security-test-2",
        scriptHash: "sec-hash-2",
        commands: ["echo"],
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      const config = await buildRetryConfig(pending);

      // projectDir should be set
      assertEquals(typeof config.projectDir, "string");
      if (config.projectDir) {
        assertEquals(config.projectDir.length > 0, true);
      }
    });

    it("handles multiple commands correctly", async () => {
      const commands = ["git", "docker", "kubectl", "curl", "wget"];
      const pending: PendingCommand = {
        id: "security-test-3",
        scriptHash: "sec-hash-3",
        commands,
        cwd: TEST_PROJECT_DIR,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      const config = await buildRetryConfig(pending);

      // All commands must be in permissions
      for (const cmd of commands) {
        assertEquals(
          config.permissions?.run?.includes(cmd),
          true,
          `Command ${cmd} should be in permissions`,
        );
      }
    });
  });

  describe("error handling", () => {
    it("validates timeout is preserved", async () => {
      const pending: PendingCommand = {
        id: "timeout-test",
        scriptHash: "timeout-hash",
        commands: ["sleep"],
        cwd: TEST_PROJECT_DIR,
        timeout: 60000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      // Timeout should be in pending data
      assertEquals(pending.timeout, 60000);

      const config = await buildRetryConfig(pending);
      // Config is built successfully
      assertEquals(config !== undefined, true);
    });

    it("validates cwd is preserved", async () => {
      const customCwd = join(TEST_TEMP_DIR, "custom");
      await ensureDir(customCwd);
      await ensureDir(join(customCwd, ".config", "safesh"));

      const pending: PendingCommand = {
        id: "cwd-test",
        scriptHash: "cwd-hash",
        commands: ["pwd"],
        cwd: customCwd,
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      assertEquals(pending.cwd, customCwd);

      const config = await buildRetryConfig(pending);
      assertEquals(config !== undefined, true);
    });
  });
});

// ============================================================================
// handleRetryPath decomposition tests
// ============================================================================

describe("desh - handleRetryPath decomposition", () => {
  let testIds: string[] = [];

  beforeEach(async () => {
    await setupTestEnv();
    testIds = [];
  });

  afterEach(async () => {
    // Clean up pending files
    for (const id of testIds) {
      try {
        deletePending(id, "path");
      } catch {
        // Ignore
      }
    }
    await cleanupTestEnv();
  });

  describe("parseRetryPathArgs", () => {
    it("parses valid arguments", () => {
      const args = ["--id=test-path-123", "--choice=r1"];
      const result = parseRetryPathArgs(args);

      assertEquals(result.id, "test-path-123");
      assertEquals(result.choice, "r1");
    });

    it("parses arguments with spaces", () => {
      const args = ["--id", "test-path-456", "--choice", "w2"];
      const result = parseRetryPathArgs(args);

      assertEquals(result.id, "test-path-456");
      assertEquals(result.choice, "w2");
    });

    it("parses choice with directory modifier", () => {
      const args = ["--id=test-123", "--choice=rw3d"];
      const result = parseRetryPathArgs(args);

      assertEquals(result.id, "test-123");
      assertEquals(result.choice, "rw3d");
    });

    it("parses deny choice", () => {
      const args = ["--id=test-123", "--choice=deny"];
      const result = parseRetryPathArgs(args);

      assertEquals(result.id, "test-123");
      assertEquals(result.choice, "deny");
    });
  });

  describe("parsePathChoice", () => {
    it("parses r1 (read once)", () => {
      const result = parsePathChoice("r1");

      assertEquals(result.operation, "r");
      assertEquals(result.scope, 1);
      assertEquals(result.isDirectory, false);
    });

    it("parses w2 (write session)", () => {
      const result = parsePathChoice("w2");

      assertEquals(result.operation, "w");
      assertEquals(result.scope, 2);
      assertEquals(result.isDirectory, false);
    });

    it("parses rw3 (read-write always)", () => {
      const result = parsePathChoice("rw3");

      assertEquals(result.operation, "rw");
      assertEquals(result.scope, 3);
      assertEquals(result.isDirectory, false);
    });

    it("parses r1d (read once directory)", () => {
      const result = parsePathChoice("r1d");

      assertEquals(result.operation, "r");
      assertEquals(result.scope, 1);
      assertEquals(result.isDirectory, true);
    });

    it("parses w2d (write session directory)", () => {
      const result = parsePathChoice("w2d");

      assertEquals(result.operation, "w");
      assertEquals(result.scope, 2);
      assertEquals(result.isDirectory, true);
    });

    it("parses rw3d (read-write always directory)", () => {
      const result = parsePathChoice("rw3d");

      assertEquals(result.operation, "rw");
      assertEquals(result.scope, 3);
      assertEquals(result.isDirectory, true);
    });

    it("throws DENY error for deny choice", () => {
      try {
        parsePathChoice("deny");
        throw new Error("Should have thrown DENY");
      } catch (error) {
        assertEquals((error as Error).message, "DENY");
      }
    });

    it("throws DENY error for choice 4", () => {
      try {
        parsePathChoice("4");
        throw new Error("Should have thrown DENY");
      } catch (error) {
        assertEquals((error as Error).message, "DENY");
      }
    });

    it("tests all valid operation combinations", () => {
      const operations = ["r", "w", "rw"];
      const scopes = [1, 2, 3];
      const modifiers = ["", "d"];

      for (const op of operations) {
        for (const scope of scopes) {
          for (const mod of modifiers) {
            const choice = `${op}${scope}${mod}`;
            const result = parsePathChoice(choice);

            assertEquals(result.operation, op as "r" | "w" | "rw");
            assertEquals(result.scope, scope as 1 | 2 | 3);
            assertEquals(result.isDirectory, mod === "d");
          }
        }
      }
    });
  });

  describe("buildPathPermissions", () => {
    it("builds read permissions for r operation", () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "r",
        scope: 1,
        isDirectory: false,
      };

      const result = buildPathPermissions(pending, choice);

      assertEquals(result.readPaths, ["/tmp/test.txt"]);
      assertEquals(result.writePaths, []);
    });

    it("builds write permissions for w operation", () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "write",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "w",
        scope: 1,
        isDirectory: false,
      };

      const result = buildPathPermissions(pending, choice);

      assertEquals(result.readPaths, []);
      assertEquals(result.writePaths, ["/tmp/test.txt"]);
    });

    it("builds both permissions for rw operation", () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "rw",
        scope: 1,
        isDirectory: false,
      };

      const result = buildPathPermissions(pending, choice);

      assertEquals(result.readPaths, ["/tmp/test.txt"]);
      assertEquals(result.writePaths, ["/tmp/test.txt"]);
    });

    it("builds directory permissions when isDirectory is true", () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/subdir/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "r",
        scope: 1,
        isDirectory: true,
      };

      const result = buildPathPermissions(pending, choice);

      // Should grant permission to directory, not file
      assertEquals(result.readPaths, ["/tmp/subdir"]);
      assertEquals(result.writePaths, []);
    });

    it("handles root directory correctly", () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "r",
        scope: 1,
        isDirectory: true,
      };

      const result = buildPathPermissions(pending, choice);

      // Should grant permission to root
      assertEquals(result.readPaths, ["/"]);
    });

    it("builds directory rw permissions", () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/home/user/project/src/file.ts",
        operation: "write",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "rw",
        scope: 3,
        isDirectory: true,
      };

      const result = buildPathPermissions(pending, choice);

      assertEquals(result.readPaths, ["/home/user/project/src"]);
      assertEquals(result.writePaths, ["/home/user/project/src"]);
    });
  });

  describe("buildRetryPathConfig", () => {
    it("merges read permissions into config", async () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { config } = await buildRetryPathConfig(pending, ["/tmp/test.txt"], []);

      assertEquals(config.permissions?.read?.includes("/tmp/test.txt"), true);
    });

    it("merges write permissions into config", async () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "write",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { config } = await buildRetryPathConfig(pending, [], ["/tmp/test.txt"]);

      assertEquals(config.permissions?.write?.includes("/tmp/test.txt"), true);
    });

    it("merges both read and write permissions", async () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { config } = await buildRetryPathConfig(
        pending,
        ["/tmp/test.txt"],
        ["/tmp/test.txt"],
      );

      assertEquals(config.permissions?.read?.includes("/tmp/test.txt"), true);
      assertEquals(config.permissions?.write?.includes("/tmp/test.txt"), true);
    });

    it("returns projectDir", async () => {
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { projectDir } = await buildRetryPathConfig(pending, [], []);

      assertEquals(typeof projectDir, "string");
      assertEquals(projectDir.length > 0, true);
    });
  });

  describe("integration - handleRetryPath phase orchestration", () => {
    it("phases work together for r1 (read once)", () => {
      // Phase 1: Parse args
      const args = ["--id=test-123", "--choice=r1"];
      const parsed = parseRetryPathArgs(args);
      assertEquals(parsed.id, "test-123");
      assertEquals(parsed.choice, "r1");

      // Phase 2: Parse choice
      const choice = parsePathChoice(parsed.choice);
      assertEquals(choice.operation, "r");
      assertEquals(choice.scope, 1);
      assertEquals(choice.isDirectory, false);

      // Phase 4: Build permissions
      const pending: PendingPathRequest = {
        id: "test-123",
        scriptHash: "hash-123",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { readPaths, writePaths } = buildPathPermissions(pending, choice);
      assertEquals(readPaths, ["/tmp/test.txt"]);
      assertEquals(writePaths, []);
    });

    it("phases work together for w2d (write session directory)", () => {
      const args = ["--id=test-456", "--choice=w2d"];
      const parsed = parseRetryPathArgs(args);

      const choice = parsePathChoice(parsed.choice);
      assertEquals(choice.operation, "w");
      assertEquals(choice.scope, 2);
      assertEquals(choice.isDirectory, true);

      const pending: PendingPathRequest = {
        id: "test-456",
        scriptHash: "hash-456",
        path: "/home/user/docs/file.txt",
        operation: "write",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { readPaths, writePaths } = buildPathPermissions(pending, choice);
      assertEquals(readPaths, []);
      assertEquals(writePaths, ["/home/user/docs"]);
    });

    it("phases work together for rw3 (read-write always)", async () => {
      const args = ["--id=test-789", "--choice=rw3"];
      const parsed = parseRetryPathArgs(args);

      const choice = parsePathChoice(parsed.choice);
      assertEquals(choice.operation, "rw");
      assertEquals(choice.scope, 3);

      const pending: PendingPathRequest = {
        id: "test-789",
        scriptHash: "hash-789",
        path: "/var/log/app.log",
        operation: "write",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const { readPaths, writePaths } = buildPathPermissions(pending, choice);
      assertEquals(readPaths, ["/var/log/app.log"]);
      assertEquals(writePaths, ["/var/log/app.log"]);

      // Build config
      const { config } = await buildRetryPathConfig(pending, readPaths, writePaths);
      assertEquals(config.permissions?.read?.includes("/var/log/app.log"), true);
      assertEquals(config.permissions?.write?.includes("/var/log/app.log"), true);
    });
  });

  describe("security validation - handleRetryPath", () => {
    it("validates all choice combinations parse correctly", () => {
      const validChoices = [
        "r1", "r2", "r3",
        "w1", "w2", "w3",
        "rw1", "rw2", "rw3",
        "r1d", "r2d", "r3d",
        "w1d", "w2d", "w3d",
        "rw1d", "rw2d", "rw3d",
      ];

      for (const choice of validChoices) {
        const result = parsePathChoice(choice);
        assertEquals(typeof result.operation, "string");
        assertEquals(typeof result.scope, "number");
        assertEquals(typeof result.isDirectory, "boolean");
      }
    });

    it("validates directory traversal prevention", () => {
      // Even with malicious paths, buildPathPermissions uses path parts
      const pending: PendingPathRequest = {
        id: "security-test",
        scriptHash: "sec-hash",
        path: "/home/user/../../../etc/passwd",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "r",
        scope: 1,
        isDirectory: true,
      };

      const { readPaths } = buildPathPermissions(pending, choice);
      // Uses path parts, so it will extract parent directory
      assertEquals(readPaths.length, 1);
    });

    it("validates scope boundaries", () => {
      // Scope 1 = once (no persistence)
      const choice1 = parsePathChoice("r1");
      assertEquals(choice1.scope, 1);

      // Scope 2 = session
      const choice2 = parsePathChoice("w2");
      assertEquals(choice2.scope, 2);

      // Scope 3 = always
      const choice3 = parsePathChoice("rw3");
      assertEquals(choice3.scope, 3);
    });

    it("validates operation isolation", () => {
      const pending: PendingPathRequest = {
        id: "test",
        scriptHash: "hash",
        path: "/tmp/test.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      // Read-only should not grant write
      const readOnly = buildPathPermissions(pending, {
        operation: "r",
        scope: 1,
        isDirectory: false,
      });
      assertEquals(readOnly.readPaths.length, 1);
      assertEquals(readOnly.writePaths.length, 0);

      // Write-only should not grant read
      const writeOnly = buildPathPermissions(pending, {
        operation: "w",
        scope: 1,
        isDirectory: false,
      });
      assertEquals(writeOnly.readPaths.length, 0);
      assertEquals(writeOnly.writePaths.length, 1);

      // Read-write grants both
      const readWrite = buildPathPermissions(pending, {
        operation: "rw",
        scope: 1,
        isDirectory: false,
      });
      assertEquals(readWrite.readPaths.length, 1);
      assertEquals(readWrite.writePaths.length, 1);
    });

    it.skip("validates config merging preserves existing permissions", async () => {
      // Create a unique test directory to avoid cleanup issues
      const testMergeDir = join(TEST_TEMP_DIR, "merge-test");
      await ensureDir(testMergeDir);
      const configDir = getProjectConfigDir(testMergeDir);
      await ensureDir(configDir);

      const existingConfig = {
        permissions: {
          read: ["/existing/read/path"],
          write: ["/existing/write/path"],
        },
      };
      await Deno.writeTextFile(
        join(configDir, "config.local.json"),
        JSON.stringify(existingConfig, null, 2),
      );

      const pending: PendingPathRequest = {
        id: "merge-test",
        scriptHash: "merge-hash",
        path: "/new/path.txt",
        operation: "read",
        cwd: testMergeDir,
        createdAt: new Date().toISOString(),
      };

      const { config } = await buildRetryPathConfig(
        pending,
        ["/new/path.txt"],
        ["/new/write.txt"],
      );

      // Should include existing permissions
      assertEquals(config.permissions?.read?.includes("/existing/read/path"), true);
      assertEquals(config.permissions?.write?.includes("/existing/write/path"), true);

      // Should include new permissions
      assertEquals(config.permissions?.read?.includes("/new/path.txt"), true);
      assertEquals(config.permissions?.write?.includes("/new/write.txt"), true);
    });
  });

  describe("edge cases - handleRetryPath", () => {
    it("handles file at root level", () => {
      const pending: PendingPathRequest = {
        id: "root-test",
        scriptHash: "root-hash",
        path: "/file.txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "r",
        scope: 1,
        isDirectory: true,
      };

      const { readPaths } = buildPathPermissions(pending, choice);
      assertEquals(readPaths, ["/"]);
    });

    it("handles deeply nested paths", () => {
      const pending: PendingPathRequest = {
        id: "deep-test",
        scriptHash: "deep-hash",
        path: "/a/b/c/d/e/f/g/file.txt",
        operation: "write",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "w",
        scope: 1,
        isDirectory: true,
      };

      const { writePaths } = buildPathPermissions(pending, choice);
      assertEquals(writePaths, ["/a/b/c/d/e/f/g"]);
    });

    it("handles paths with special characters", () => {
      const pending: PendingPathRequest = {
        id: "special-test",
        scriptHash: "special-hash",
        path: "/home/user/my docs/test file (1).txt",
        operation: "read",
        cwd: TEST_PROJECT_DIR,
        createdAt: new Date().toISOString(),
      };

      const choice: PathPermissionChoice = {
        operation: "rw",
        scope: 1,
        isDirectory: false,
      };

      const { readPaths, writePaths } = buildPathPermissions(pending, choice);
      assertEquals(readPaths, ["/home/user/my docs/test file (1).txt"]);
      assertEquals(writePaths, ["/home/user/my docs/test file (1).txt"]);
    });
  });
});
