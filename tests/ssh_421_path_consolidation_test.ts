/**
 * SSH-421: Security tests for consolidated path validation
 *
 * Tests edge cases and security scenarios to ensure the consolidation
 * doesn't introduce any security gaps.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { validatePath, getEffectivePermissions } from "../src/core/permissions.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { read, write } from "../src/stdlib/fs.ts";
import { REAL_TMP } from "./helpers.ts";

// ============================================================================
// Core Consolidation Tests
// ============================================================================

Deno.test({
  name: "validatePath - always resolves symlinks even without explicit permissions",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-symlink`;
    const allowedDir = `${testDir}/allowed`;
    const outsideFile = `${testDir}/outside/secret.txt`;
    const symlinkPath = `${allowedDir}/link.txt`;

    try {
      await Deno.mkdir(`${testDir}/allowed`, { recursive: true });
      await Deno.mkdir(`${testDir}/outside`, { recursive: true });
      await Deno.writeTextFile(outsideFile, "secret data");
      await Deno.symlink(outsideFile, symlinkPath);

      // Config with NO explicit permissions - should still catch symlink attack
      const config: SafeShellConfig = {
        projectDir: allowedDir,
      };

      // Should reject because symlink points outside projectDir
      await assertRejects(
        () => validatePath(symlinkPath, config, allowedDir, "read"),
        SafeShellError,
        "outside allowed directories",
      );
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
  name: "getEffectivePermissions - always includes default paths",
  fn() {
    const config: SafeShellConfig = {};
    const cwd = "/test/project";

    const perms = getEffectivePermissions(config, cwd);

    // Should always include cwd and /tmp for read
    assertEquals(perms.read?.includes(cwd), true);
    assertEquals(perms.read?.includes("/tmp"), true);

    // Should only include /tmp for write by default
    assertEquals(perms.write?.includes("/tmp"), true);
    assertEquals(perms.write?.includes(cwd), false);
  },
});

Deno.test({
  name: "getEffectivePermissions - includes HOME by default for read",
  fn() {
    const home = Deno.env.get("HOME");
    if (!home) return; // Skip if HOME not set

    const config: SafeShellConfig = {};
    const cwd = "/test/project";

    const perms = getEffectivePermissions(config, cwd);

    assertEquals(perms.read?.includes(home), true);
  },
});

Deno.test({
  name: "getEffectivePermissions - can disable HOME in default read",
  fn() {
    const home = Deno.env.get("HOME");
    if (!home) return; // Skip if HOME not set

    const config: SafeShellConfig = {
      includeHomeInDefaultRead: false,
    };
    const cwd = "/test/project";

    const perms = getEffectivePermissions(config, cwd);

    assertEquals(perms.read?.includes(home), false);
  },
});

// ============================================================================
// projectDir Interaction Tests
// ============================================================================

Deno.test({
  name: "validatePath - projectDir with blockProjectDirWrite prevents writes",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-block`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        projectDir: testDir,
        blockProjectDirWrite: true,
      };

      // Read should succeed
      const readPath = await validatePath(`${testDir}/read.txt`, config, testDir, "read");
      assertEquals(readPath, `${testDir}/read.txt`);

      // Write should fail
      await assertRejects(
        () => validatePath(`${testDir}/write.txt`, config, testDir, "write"),
        SafeShellError,
        "outside allowed directories",
      );
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
  name: "validatePath - projectDir without blockProjectDirWrite allows writes",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-noblock`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        projectDir: testDir,
        blockProjectDirWrite: false,
      };

      // Both read and write should succeed
      const readPath = await validatePath(`${testDir}/read.txt`, config, testDir, "read");
      assertEquals(readPath, `${testDir}/read.txt`);

      const writePath = await validatePath(`${testDir}/write.txt`, config, testDir, "write");
      assertEquals(writePath, `${testDir}/write.txt`);
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

// ============================================================================
// Path Traversal Attack Tests
// ============================================================================

Deno.test({
  name: "validatePath - blocks path traversal with multiple ../",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-traversal`;

    try {
      await Deno.mkdir(`${testDir}/allowed/deep/nested`, { recursive: true });

      const config: SafeShellConfig = {
        permissions: {
          read: [`${testDir}/allowed`],
        },
      };

      // Try to escape with ../../../
      await assertRejects(
        () => validatePath(
          `${testDir}/allowed/deep/nested/../../../../etc/passwd`,
          config,
          testDir,
          "read"
        ),
        SafeShellError,
        "outside allowed directories",
      );
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
  name: "validatePath - blocks path traversal with mixed / and ..",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-mixed`;

    try {
      await Deno.mkdir(`${testDir}/allowed`, { recursive: true });

      const config: SafeShellConfig = {
        permissions: {
          read: [`${testDir}/allowed`],
        },
      };

      // Try to escape with ./../../
      await assertRejects(
        () => validatePath(
          `${testDir}/allowed/./../../etc/passwd`,
          config,
          testDir,
          "read"
        ),
        SafeShellError,
        "outside allowed directories",
      );
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

// ============================================================================
// Symlink Chain Tests
// ============================================================================

Deno.test({
  name: "validatePath - detects symlink chains pointing outside sandbox",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-chain`;
    const allowedDir = `${testDir}/allowed`;
    const outsideFile = `${testDir}/outside/secret.txt`;
    const link1 = `${allowedDir}/link1.txt`;
    const link2 = `${allowedDir}/link2.txt`;

    try {
      await Deno.mkdir(`${testDir}/allowed`, { recursive: true });
      await Deno.mkdir(`${testDir}/outside`, { recursive: true });
      await Deno.writeTextFile(outsideFile, "secret data");

      // Create chain: link2 -> link1 -> outsideFile
      await Deno.symlink(outsideFile, link1);
      await Deno.symlink(link1, link2);

      const config: SafeShellConfig = {
        permissions: {
          read: [allowedDir],
        },
      };

      // Should detect that the chain resolves outside sandbox
      await assertRejects(
        () => validatePath(link2, config, "/", "read"),
        SafeShellError,
        "outside allowed directories",
      );
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

// ============================================================================
// stdlib/fs Integration Test
// ============================================================================

Deno.test({
  name: "fs operations - use consolidated validatePath from permissions.ts",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-test-ssh421-fs-integration`;
    const testFile = `${testDir}/test.txt`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      // Test that fs operations work with projectDir
      const config: SafeShellConfig = {
        projectDir: testDir,
      };

      // Write should work with projectDir
      await write(testFile, "test content", { config, cwd: REAL_TMP });

      // Read should work with projectDir
      const content = await read(testFile, { config, cwd: REAL_TMP });
      assertEquals(content, "test content");
    } finally {
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});
