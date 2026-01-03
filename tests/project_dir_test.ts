/**
 * Tests for projectDir and allowProjectCommands functionality (SSH-112)
 * Note: projectDir automatically gets full read/write access (no flag needed)
 */

import { assertEquals } from "@std/assert";
import {
  isWithinProjectDir,
  isCommandWithinProjectDir,
  validatePath,
} from "../src/core/permissions.ts";
import { loadConfigWithArgs, mergeConfigs, type McpInitArgs } from "../src/core/config.ts";
import { createRegistry } from "../src/external/registry.ts";
import { validateCommand } from "../src/external/validator.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

// ============================================================================
// isWithinProjectDir Tests
// ============================================================================

Deno.test("isWithinProjectDir - returns true for path within projectDir", () => {
  const result = isWithinProjectDir("/project/src/file.ts", "/project");
  assertEquals(result, true);
});

Deno.test("isWithinProjectDir - returns true for exact match", () => {
  const result = isWithinProjectDir("/project", "/project");
  assertEquals(result, true);
});

Deno.test("isWithinProjectDir - returns false for path outside projectDir", () => {
  const result = isWithinProjectDir("/other/file.ts", "/project");
  assertEquals(result, false);
});

Deno.test("isWithinProjectDir - returns false for parent directory", () => {
  const result = isWithinProjectDir("/proj", "/project");
  assertEquals(result, false);
});

Deno.test("isWithinProjectDir - resolves relative paths from cwd", () => {
  const result = isWithinProjectDir("./src/file.ts", "/project", "/project");
  assertEquals(result, true);
});

Deno.test("isWithinProjectDir - relative path outside project returns false", () => {
  const result = isWithinProjectDir("../other/file.ts", "/project", "/project");
  assertEquals(result, false);
});

// ============================================================================
// isCommandWithinProjectDir Tests
// ============================================================================

Deno.test("isCommandWithinProjectDir - returns true for relative path command", () => {
  const result = isCommandWithinProjectDir("./scripts/build.sh", "/project", "/project");
  assertEquals(result, true);
});

Deno.test("isCommandWithinProjectDir - returns true for absolute path command", () => {
  const result = isCommandWithinProjectDir("/project/scripts/build.sh", "/project");
  assertEquals(result, true);
});

Deno.test("isCommandWithinProjectDir - returns false for command name only", () => {
  // git, npm, etc. are not paths
  const result = isCommandWithinProjectDir("git", "/project");
  assertEquals(result, false);
});

Deno.test("isCommandWithinProjectDir - returns false for command outside project", () => {
  const result = isCommandWithinProjectDir("/other/scripts/build.sh", "/project");
  assertEquals(result, false);
});

// ============================================================================
// projectDir auto-access Tests (projectDir always gets full read/write)
// ============================================================================

Deno.test({
  name: "validatePath - allows paths within projectDir automatically",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const testDir = `${realTmp}/safesh-project-test`;
    const projectDir = testDir;
    const filePath = `${testDir}/src/file.ts`;

    try {
      await Deno.mkdir(`${testDir}/src`, { recursive: true });
      await Deno.writeTextFile(filePath, "test content");

      const config: SafeShellConfig = {
        projectDir,
        permissions: {
          read: [], // No explicit read permissions
          write: [], // No explicit write permissions
        },
      };

      // Read should work
      const readResult = await validatePath(filePath, config, "/", "read");
      assertEquals(readResult, filePath);

      // Write should also work
      const writeResult = await validatePath(filePath, config, "/", "write");
      assertEquals(writeResult, filePath);
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "validatePath - rejects paths outside projectDir",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-project-test`;
    const outsidePath = `${realTmp}/other/file.ts`;

    try {
      await Deno.mkdir(projectDir, { recursive: true });

      const config: SafeShellConfig = {
        projectDir,
        permissions: {
          read: [],
          write: [],
        },
      };

      // Should still be rejected - it's outside projectDir
      let rejected = false;
      try {
        await validatePath(outsidePath, config, "/", "read");
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

// ============================================================================
// allowProjectCommands Tests
// ============================================================================

Deno.test("CommandRegistry - allows project commands when allowProjectCommands=true", () => {
  const projectDir = "/project";
  const config: SafeShellConfig = {
    projectDir,
    allowProjectCommands: true,
    permissions: {
      run: ["git"], // Minimal permissions
    },
  };

  const registry = createRegistry(config, "/project");

  // Project command should be allowed
  assertEquals(registry.isWhitelisted("./scripts/build.sh"), true);
  assertEquals(registry.get("./scripts/build.sh")?.allow, true);

  // Absolute path within project should be allowed
  assertEquals(registry.isWhitelisted("/project/scripts/build.sh"), true);

  // Built-in commands should still work via explicit config
  assertEquals(registry.isWhitelisted("git"), true);

  // Command outside project should not be auto-allowed
  assertEquals(registry.isWhitelisted("/other/build.sh"), false);
});

Deno.test("CommandRegistry - does not allow project commands when allowProjectCommands=false", () => {
  const projectDir = "/project";
  const config: SafeShellConfig = {
    projectDir,
    allowProjectCommands: false, // Explicitly false
    permissions: {
      run: ["git"],
    },
  };

  const registry = createRegistry(config, "/project");

  // Project command should not be auto-allowed
  assertEquals(registry.isWhitelisted("./scripts/build.sh"), false);

  // Built-in commands should still work
  assertEquals(registry.isWhitelisted("git"), true);
});

Deno.test("validateCommand - validates project commands", () => {
  const projectDir = "/project";
  const config: SafeShellConfig = {
    projectDir,
    allowProjectCommands: true,
    permissions: {
      run: [],
    },
  };

  const registry = createRegistry(config, "/project");

  // Project command should validate successfully
  const result = validateCommand("./scripts/build.sh", ["--release"], registry);
  assertEquals(result.valid, true);
  assertEquals(result.command, "./scripts/build.sh");
});

// ============================================================================
// loadConfigWithArgs Tests
// ============================================================================

Deno.test("loadConfigWithArgs - applies projectDir from mcpArgs", async () => {
  const mcpArgs: McpInitArgs = {
    projectDir: "/test/project",
    allowProjectCommands: true,
  };

  const { config, effectiveCwd } = await loadConfigWithArgs("/tmp", mcpArgs);

  assertEquals(config.projectDir, "/test/project");
  assertEquals(config.allowProjectCommands, true);
  assertEquals(effectiveCwd, "/test/project"); // Uses projectDir as cwd when not specified
});

Deno.test("loadConfigWithArgs - cwd takes precedence over projectDir", async () => {
  const mcpArgs: McpInitArgs = {
    projectDir: "/test/project",
    cwd: "/test/project/subdir",
  };

  const { effectiveCwd } = await loadConfigWithArgs("/tmp", mcpArgs);

  assertEquals(effectiveCwd, "/test/project/subdir");
});

Deno.test("loadConfigWithArgs - falls back to baseCwd when no args", async () => {
  const { effectiveCwd } = await loadConfigWithArgs("/default/cwd", undefined);

  assertEquals(effectiveCwd, "/default/cwd");
});

// ============================================================================
// mergeConfigs Tests
// ============================================================================

Deno.test("mergeConfigs - merges projectDir settings", () => {
  const base: SafeShellConfig = {
    projectDir: "/base",
    allowProjectCommands: false,
  };

  const override: SafeShellConfig = {
    projectDir: "/override",
    allowProjectCommands: true,
  };

  const merged = mergeConfigs(base, override);

  assertEquals(merged.projectDir, "/override");
  assertEquals(merged.allowProjectCommands, true);
});

Deno.test("mergeConfigs - keeps base values when override is undefined", () => {
  const base: SafeShellConfig = {
    projectDir: "/base",
    allowProjectCommands: true,
  };

  const override: SafeShellConfig = {
    // No projectDir or allowProjectCommands
  };

  const merged = mergeConfigs(base, override);

  assertEquals(merged.projectDir, "/base");
  assertEquals(merged.allowProjectCommands, true);
});

Deno.test("mergeConfigs - merges denoFlags with union strategy", () => {
  const base: SafeShellConfig = {
    denoFlags: ["--unsafely-ignore-certificate-errors=localhost"],
  };

  const override: SafeShellConfig = {
    denoFlags: ["--v8-flags=--max-heap-size=4096", "--unsafely-ignore-certificate-errors=localhost"],
  };

  const merged = mergeConfigs(base, override);

  assertEquals(merged.denoFlags?.length, 2);
  assertEquals(merged.denoFlags?.includes("--unsafely-ignore-certificate-errors=localhost"), true);
  assertEquals(merged.denoFlags?.includes("--v8-flags=--max-heap-size=4096"), true);
});

// ============================================================================
// blockProjectDirWrite Tests
// ============================================================================

Deno.test({
  name: "validatePath - allows read but blocks write when blockProjectDirWrite=true",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const testDir = `${realTmp}/safesh-blockwrite-test`;
    const projectDir = testDir;
    const filePath = `${testDir}/src/file.ts`;

    try {
      await Deno.mkdir(`${testDir}/src`, { recursive: true });
      await Deno.writeTextFile(filePath, "test content");

      const config: SafeShellConfig = {
        projectDir,
        blockProjectDirWrite: true,
        permissions: {
          read: [],
          write: [], // No explicit write permissions
        },
      };

      // Read should work (projectDir still gets read access)
      const readResult = await validatePath(filePath, config, "/", "read");
      assertEquals(readResult, filePath);

      // Write should be rejected (blockProjectDirWrite=true)
      let rejected = false;
      try {
        await validatePath(filePath, config, "/", "write");
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "validatePath - allows both read and write when blockProjectDirWrite=false",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const testDir = `${realTmp}/safesh-allowwrite-test`;
    const projectDir = testDir;
    const filePath = `${testDir}/src/file.ts`;

    try {
      await Deno.mkdir(`${testDir}/src`, { recursive: true });
      await Deno.writeTextFile(filePath, "test content");

      const config: SafeShellConfig = {
        projectDir,
        blockProjectDirWrite: false, // Explicitly false
        permissions: {
          read: [],
          write: [],
        },
      };

      // Read should work
      const readResult = await validatePath(filePath, config, "/", "read");
      assertEquals(readResult, filePath);

      // Write should also work
      const writeResult = await validatePath(filePath, config, "/", "write");
      assertEquals(writeResult, filePath);
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "validatePath - allows both read and write when blockProjectDirWrite is undefined (default)",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const testDir = `${realTmp}/safesh-defaultwrite-test`;
    const projectDir = testDir;
    const filePath = `${testDir}/src/file.ts`;

    try {
      await Deno.mkdir(`${testDir}/src`, { recursive: true });
      await Deno.writeTextFile(filePath, "test content");

      const config: SafeShellConfig = {
        projectDir,
        // blockProjectDirWrite not set - defaults to allowing writes
        permissions: {
          read: [],
          write: [],
        },
      };

      // Read should work
      const readResult = await validatePath(filePath, config, "/", "read");
      assertEquals(readResult, filePath);

      // Write should also work (default behavior)
      const writeResult = await validatePath(filePath, config, "/", "write");
      assertEquals(writeResult, filePath);
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test("mergeConfigs - merges blockProjectDirWrite with override strategy", () => {
  const base: SafeShellConfig = {
    projectDir: "/base",
    blockProjectDirWrite: false,
  };

  const override: SafeShellConfig = {
    blockProjectDirWrite: true,
  };

  const merged = mergeConfigs(base, override);

  assertEquals(merged.blockProjectDirWrite, true);
});

Deno.test("mergeConfigs - keeps base blockProjectDirWrite when override is undefined", () => {
  const base: SafeShellConfig = {
    projectDir: "/base",
    blockProjectDirWrite: true,
  };

  const override: SafeShellConfig = {
    // blockProjectDirWrite not set
  };

  const merged = mergeConfigs(base, override);

  assertEquals(merged.blockProjectDirWrite, true);
});

// ============================================================================
// getEffectivePermissions Tests - blockProjectDirWrite adds denyWrite
// ============================================================================

import { getEffectivePermissions } from "../src/core/permissions.ts";

Deno.test("getEffectivePermissions - adds projectDir to denyWrite when blockProjectDirWrite=true", () => {
  const config: SafeShellConfig = {
    projectDir: "/project",
    blockProjectDirWrite: true,
    permissions: {},
  };

  const perms = getEffectivePermissions(config, "/tmp");

  // projectDir should be in denyWrite
  assertEquals(perms.denyWrite?.includes("/project"), true);
  // projectDir should NOT be in write
  assertEquals(perms.write?.includes("/project"), false);
  // projectDir should still be in read
  assertEquals(perms.read?.includes("/project"), true);
});

Deno.test("getEffectivePermissions - projectDir in write when blockProjectDirWrite=false", () => {
  const config: SafeShellConfig = {
    projectDir: "/project",
    blockProjectDirWrite: false,
    permissions: {},
  };

  const perms = getEffectivePermissions(config, "/tmp");

  // projectDir should be in write
  assertEquals(perms.write?.includes("/project"), true);
  // projectDir should NOT be in denyWrite
  assertEquals(perms.denyWrite?.includes("/project") ?? false, false);
  // projectDir should still be in read
  assertEquals(perms.read?.includes("/project"), true);
});

Deno.test("getEffectivePermissions - projectDir in write when blockProjectDirWrite is undefined", () => {
  const config: SafeShellConfig = {
    projectDir: "/project",
    // blockProjectDirWrite not set
    permissions: {},
  };

  const perms = getEffectivePermissions(config, "/tmp");

  // projectDir should be in write (default behavior)
  assertEquals(perms.write?.includes("/project"), true);
  // projectDir should NOT be in denyWrite
  assertEquals(perms.denyWrite?.includes("/project") ?? false, false);
});

// ============================================================================
// Executor Integration Tests - projectDir read/write permissions
// ============================================================================

import { executeCode } from "../src/runtime/executor.ts";
import { assertStringIncludes, assertMatch } from "@std/assert";

Deno.test({
  name: "executor - reads file within projectDir successfully",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-exec-read-test`;
    const testFile = `${projectDir}/data/test.txt`;
    const testContent = "projectDir read content";

    try {
      await Deno.mkdir(`${projectDir}/data`, { recursive: true });
      await Deno.writeTextFile(testFile, testContent);

      const config: SafeShellConfig = {
        projectDir,
        permissions: {
          read: [], // No explicit read - only projectDir should grant access
          write: ["/tmp"],
        },
      };

      const code = `
        const content = await Deno.readTextFile("${testFile}");
        console.log(content);
      `;

      const result = await executeCode(code, config);

      assertEquals(result.success, true);
      assertStringIncludes(result.stdout, testContent);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "executor - writes file within projectDir successfully",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-exec-write-test`;
    const testFile = `${projectDir}/output/result.txt`;
    const testContent = "projectDir write content";

    try {
      await Deno.mkdir(`${projectDir}/output`, { recursive: true });

      const config: SafeShellConfig = {
        projectDir,
        permissions: {
          read: [],
          write: [], // No explicit write - only projectDir should grant access
        },
      };

      const code = `
        await Deno.writeTextFile("${testFile}", "${testContent}");
        const content = await Deno.readTextFile("${testFile}");
        console.log(content);
      `;

      const result = await executeCode(code, config);

      assertEquals(result.success, true);
      assertStringIncludes(result.stdout, testContent);

      // Verify file was actually written
      const written = await Deno.readTextFile(testFile);
      assertEquals(written, testContent);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "executor - blocks read outside projectDir when explicitly denied",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-exec-block-read-test`;
    const outsideDir = `${realTmp}/safesh-outside-read-test`;
    const outsideFile = `${outsideDir}/secret.txt`;

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.mkdir(outsideDir, { recursive: true });
      await Deno.writeTextFile(outsideFile, "secret data");

      const config: SafeShellConfig = {
        projectDir,
        permissions: {
          read: [],
          write: [],
          denyRead: [outsideDir], // Explicitly deny read access
        },
      };

      const code = `
        const content = await Deno.readTextFile("${outsideFile}");
        console.log(content);
      `;

      const result = await executeCode(code, config);

      // Should fail because denyRead blocks the outside directory
      assertEquals(result.success, false);
      // Should have permission error in stderr
      assertMatch(result.stderr, /Requires read access|permission|denied|not permitted/i);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outsideDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "executor - blocks write outside projectDir when explicitly denied",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-exec-block-write-test`;
    const outsideDir = `${realTmp}/safesh-outside-write-test`;
    const outsideFile = `${outsideDir}/output.txt`;

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.mkdir(outsideDir, { recursive: true });

      const config: SafeShellConfig = {
        projectDir,
        permissions: {
          read: [outsideDir],
          write: [],
          denyWrite: [outsideDir], // Explicitly deny write access
        },
      };

      const code = `
        await Deno.writeTextFile("${outsideFile}", "hacked!");
        console.log("written");
      `;

      const result = await executeCode(code, config);

      // Should fail because denyWrite blocks the outside directory
      assertEquals(result.success, false);
      // Should have permission error in stderr
      assertMatch(result.stderr, /Requires write access|permission|denied|not permitted/i);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(outsideDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "executor - blockProjectDirWrite blocks writes to projectDir",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-exec-blocked-write-test`;
    const testFile = `${projectDir}/blocked.txt`;

    try {
      await Deno.mkdir(projectDir, { recursive: true });

      const config: SafeShellConfig = {
        projectDir,
        blockProjectDirWrite: true, // Block writes
        permissions: {
          read: [],
          write: [], // No explicit write
        },
      };

      const code = `
        await Deno.writeTextFile("${testFile}", "blocked write attempt");
        console.log("written");
      `;

      const result = await executeCode(code, config);

      // Should fail because blockProjectDirWrite is true
      assertEquals(result.success, false);
      // Should have permission error in stderr
      assertMatch(result.stderr, /Requires write access|permission|denied|not permitted/i);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "executor - blockProjectDirWrite allows reads from projectDir",
  async fn() {
    const realTmp = await Deno.realPath("/tmp");
    const projectDir = `${realTmp}/safesh-exec-readonly-test`;
    const testFile = `${projectDir}/readable.txt`;
    const testContent = "readonly content";

    try {
      await Deno.mkdir(projectDir, { recursive: true });
      await Deno.writeTextFile(testFile, testContent);

      const config: SafeShellConfig = {
        projectDir,
        blockProjectDirWrite: true, // Block writes, but reads should work
        permissions: {
          read: [],
          write: [],
        },
      };

      const code = `
        const content = await Deno.readTextFile("${testFile}");
        console.log(content);
      `;

      const result = await executeCode(code, config);

      // Should succeed - reads are still allowed
      assertEquals(result.success, true);
      assertStringIncludes(result.stdout, testContent);
    } finally {
      try {
        await Deno.remove(projectDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});
