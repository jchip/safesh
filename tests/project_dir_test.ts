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
