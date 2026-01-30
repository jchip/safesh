/**
 * Tests for workspace directory support
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  expandPath,
  isPathAllowed,
  isWithinWorkspace,
  resolveWorkspace,
} from "../src/core/permissions.ts";
import { validatePath } from "../src/core/permissions.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { validatePathArgs } from "../src/external/path_validator.ts";
import { REAL_TMP } from "./helpers.ts";

// ============================================================================
// Workspace Path Resolution Tests
// ============================================================================

Deno.test("resolveWorkspace - expands ~ to HOME", () => {
  const home = Deno.env.get("HOME") ?? "";
  const result = resolveWorkspace("~/dev");
  assertEquals(result, `${home}/dev`);
});

Deno.test("resolveWorkspace - handles absolute paths", () => {
  const result = resolveWorkspace("/Users/test/dev");
  assertEquals(result, "/Users/test/dev");
});

Deno.test("resolveWorkspace - resolves relative paths to absolute", () => {
  const result = resolveWorkspace("dev/project");
  // Should resolve relative to cwd
  assertEquals(result.startsWith("/"), true);
});

// ============================================================================
// isWithinWorkspace Tests
// ============================================================================

Deno.test("isWithinWorkspace - returns true for exact match", () => {
  const result = isWithinWorkspace("/Users/test/dev", "/Users/test/dev");
  assertEquals(result, true);
});

Deno.test("isWithinWorkspace - returns true for subdirectory", () => {
  const result = isWithinWorkspace("/Users/test/dev/project/file.ts", "/Users/test/dev");
  assertEquals(result, true);
});

Deno.test("isWithinWorkspace - returns false for parent directory", () => {
  const result = isWithinWorkspace("/Users/test", "/Users/test/dev");
  assertEquals(result, false);
});

Deno.test("isWithinWorkspace - returns false for sibling directory", () => {
  const result = isWithinWorkspace("/Users/test/other", "/Users/test/dev");
  assertEquals(result, false);
});

Deno.test("isWithinWorkspace - handles trailing slashes", () => {
  const result = isWithinWorkspace("/Users/test/dev/project/", "/Users/test/dev");
  assertEquals(result, true);
});

// ============================================================================
// expandPath with WORKSPACE Tests
// ============================================================================

Deno.test("expandPath - expands ${WORKSPACE} variable", () => {
  const result = expandPath("${WORKSPACE}/project", "/cwd", "/Users/test/dev");
  assertEquals(result, "/Users/test/dev/project");
});

Deno.test("expandPath - expands $WORKSPACE without braces", () => {
  const result = expandPath("$WORKSPACE/project", "/cwd", "/Users/test/dev");
  assertEquals(result, "/Users/test/dev/project");
});

Deno.test("expandPath - handles multiple variables including WORKSPACE", () => {
  const home = Deno.env.get("HOME") ?? "";
  const result = expandPath("${HOME}/.config/${WORKSPACE}/file", "/cwd", "/workspace");
  assertEquals(result, `${home}/.config//workspace/file`);
});

Deno.test("expandPath - handles no workspace provided", () => {
  const result = expandPath("${WORKSPACE}/file", "/cwd");
  assertEquals(result, "/file");
});

// ============================================================================
// Path Validation with Workspace Tests
// ============================================================================

Deno.test({
  name: "isPathAllowed - allows paths within workspace when using ${WORKSPACE}",
  fn() {
    const allowed = isPathAllowed(
      "/Users/test/dev/project/file.ts",
      ["${WORKSPACE}"],
      "/cwd",
      "/Users/test/dev",
    );
    assertEquals(allowed, true);
  },
});

Deno.test({
  name: "isPathAllowed - denies paths outside workspace",
  fn() {
    const allowed = isPathAllowed(
      "/Users/test/other/file.ts",
      ["${WORKSPACE}"],
      "/cwd",
      "/Users/test/dev",
    );
    assertEquals(allowed, false);
  },
});

// ============================================================================
// validatePath with Workspace Tests
// ============================================================================

Deno.test({
  name: "validatePath - allows reading within workspace",
  async fn() {
    // Use realPath of /tmp to handle macOS symlink
    const testDir = `${REAL_TMP}/safesh-workspace-test`;
    const testFile = `${testDir}/file.txt`;

    try {
      await Deno.mkdir(testDir, { recursive: true });
      await Deno.writeTextFile(testFile, "test data");

      const config: SafeShellConfig = {
        workspace: testDir,
        permissions: {
          read: ["${WORKSPACE}"],
        },
      };

      const result = await validatePath(testFile, config, "/");
      assertEquals(result, testFile);
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
  name: "validatePath - rejects reading outside workspace",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-workspace-test2`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        workspace: testDir,
        permissions: {
          read: ["${WORKSPACE}"],
        },
      };

      await assertRejects(
        () => validatePath("/etc/passwd", config, "/"),
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
  name: "validatePath - allows writing within workspace",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-workspace-test3`;
    const testFile = `${testDir}/newfile.txt`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        workspace: testDir,
        permissions: {
          write: ["${WORKSPACE}"],
        },
      };

      const result = await validatePath(testFile, config, "/", "write");
      assertEquals(result, testFile);
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
// Path Validator with Workspace Tests
// ============================================================================

Deno.test({
  name: "validatePathArgs - allows paths within workspace",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-workspace-test4`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        workspace: testDir,
        permissions: {
          read: [],
          write: [],
        },
      };

      // Should not throw - path is within workspace
      await validatePathArgs(
        [testDir + "/file.txt"],
        "cat",
        config,
        "/",
        { allow: true, pathArgs: { autoDetect: true, validateSandbox: true } },
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
  name: "validatePathArgs - rejects paths outside workspace",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-workspace-test5`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        workspace: testDir,
        permissions: {
          read: [],
          write: [],
        },
      };

      // Should throw - path is outside workspace
      await assertRejects(
        () =>
          validatePathArgs(
            ["/etc/passwd"],
            "cat",
            config,
            "/",
            { allow: true, pathArgs: { autoDetect: true, validateSandbox: true } },
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
  name: "validatePathArgs - workspace overrides explicit permissions",
  async fn() {
    const testDir = `${REAL_TMP}/safesh-workspace-test6`;

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        workspace: testDir,
        permissions: {
          read: ["/tmp/other"], // Different path allowed explicitly
          write: [],
        },
      };

      // Should not throw - path is within workspace even though not in read permissions
      await validatePathArgs(
        [testDir + "/file.txt"],
        "cat",
        config,
        "/",
        { allow: true, pathArgs: { autoDetect: true, validateSandbox: true } },
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
