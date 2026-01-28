/**
 * Tests for path validation and symlink security
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  expandPath,
  isPathAllowed,
  validatePath,
} from "../src/core/permissions.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { REAL_TMP } from "./helpers.ts";

const testConfig: SafeShellConfig = {
  permissions: {
    read: ["/tmp/safesh-test", "/home/user/project"],
    write: ["/tmp/safesh-test"],
  },
};

// ============================================================================
// Path Expansion Tests
// ============================================================================

Deno.test("expandPath - expands ${CWD} variable", () => {
  const result = expandPath("${CWD}/src", "/my/project");
  assertEquals(result, "/my/project/src");
});

Deno.test("expandPath - expands $CWD without braces", () => {
  const result = expandPath("$CWD/src", "/my/project");
  assertEquals(result, "/my/project/src");
});

Deno.test("expandPath - expands ${HOME} variable", () => {
  const home = Deno.env.get("HOME") ?? "";
  const result = expandPath("${HOME}/.config", "/cwd");
  assertEquals(result, `${home}/.config`);
});

Deno.test("expandPath - handles multiple variables", () => {
  const home = Deno.env.get("HOME") ?? "";
  const result = expandPath("${HOME}/projects/${CWD}/file", "/myproj");
  assertEquals(result, `${home}/projects//myproj/file`);
});

// ============================================================================
// Path Allowed Tests
// ============================================================================

Deno.test("isPathAllowed - allows exact match", () => {
  const allowed = isPathAllowed("/tmp/safesh-test", ["/tmp/safesh-test"], "/");
  assertEquals(allowed, true);
});

Deno.test("isPathAllowed - allows subdirectory", () => {
  const allowed = isPathAllowed(
    "/tmp/safesh-test/subdir/file.txt",
    ["/tmp/safesh-test"],
    "/",
  );
  assertEquals(allowed, true);
});

Deno.test("isPathAllowed - denies parent directory", () => {
  const allowed = isPathAllowed("/tmp", ["/tmp/safesh-test"], "/");
  assertEquals(allowed, false);
});

Deno.test("isPathAllowed - denies sibling directory", () => {
  const allowed = isPathAllowed("/tmp/other", ["/tmp/safesh-test"], "/");
  assertEquals(allowed, false);
});

Deno.test("isPathAllowed - denies path traversal attempt", () => {
  // Even though this resolves to /tmp, the resolve happens first
  const allowed = isPathAllowed(
    "/tmp/safesh-test/../other",
    ["/tmp/safesh-test"],
    "/",
  );
  assertEquals(allowed, false);
});

Deno.test("isPathAllowed - handles relative paths", () => {
  const allowed = isPathAllowed("src/file.ts", ["/project"], "/project");
  assertEquals(allowed, true);
});

// ============================================================================
// Symlink Validation Tests
// ============================================================================

Deno.test({
  name: "validatePath - rejects symlink pointing outside sandbox",
  async fn() {
    // Setup: create a symlink in allowed dir pointing to disallowed location
    const testDir = "/tmp/safesh-test-symlink";
    const allowedDir = `${testDir}/allowed`;
    const outsideFile = `${testDir}/outside/secret.txt`;
    const symlinkPath = `${allowedDir}/link.txt`;

    try {
      await Deno.mkdir(`${testDir}/allowed`, { recursive: true });
      await Deno.mkdir(`${testDir}/outside`, { recursive: true });
      await Deno.writeTextFile(outsideFile, "secret data");
      await Deno.symlink(outsideFile, symlinkPath);

      const config: SafeShellConfig = {
        permissions: {
          read: [allowedDir],
        },
      };

      await assertRejects(
        () => validatePath(symlinkPath, config, "/"),
        SafeShellError,
        "outside allowed directories",
      );
    } finally {
      // Cleanup
      try {
        await Deno.remove(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "validatePath - allows symlink within sandbox",
  async fn() {
    // Use realPath of /tmp to handle macOS symlink (/tmp -> /private/tmp)
    const testDir = `${REAL_TMP}/safesh-test-symlink2`;
    const targetFile = `${testDir}/target.txt`;
    const symlinkPath = `${testDir}/link.txt`;

    try {
      await Deno.mkdir(testDir, { recursive: true });
      await Deno.writeTextFile(targetFile, "allowed data");
      await Deno.symlink(targetFile, symlinkPath);

      const config: SafeShellConfig = {
        permissions: {
          read: [testDir],
        },
      };

      const result = await validatePath(symlinkPath, config, "/");
      assertEquals(result, targetFile);
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
  name: "validatePath - handles non-existent files",
  async fn() {
    const testDir = "/tmp/safesh-test-nonexist";

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        permissions: {
          read: [testDir],
        },
      };

      // Non-existent file within allowed dir should be allowed
      const result = await validatePath(`${testDir}/newfile.txt`, config, "/");
      assertEquals(result, `${testDir}/newfile.txt`);
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
  name: "validatePath - rejects path outside sandbox",
  async fn() {
    const config: SafeShellConfig = {
      permissions: {
        read: ["/tmp/allowed"],
      },
    };

    await assertRejects(
      () => validatePath("/etc/passwd", config, "/"),
      SafeShellError,
      "outside allowed directories",
    );
  },
});

Deno.test({
  name: "validatePath - rejects path traversal",
  async fn() {
    const testDir = "/tmp/safesh-test-traversal";

    try {
      await Deno.mkdir(testDir, { recursive: true });

      const config: SafeShellConfig = {
        permissions: {
          read: [testDir],
        },
      };

      await assertRejects(
        () => validatePath(`${testDir}/../../../etc/passwd`, config, "/"),
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
  name: "validatePath - respects operation type (read vs write)",
  async fn() {
    // Use paths outside /tmp to avoid default permissions
    const config: SafeShellConfig = {
      permissions: {
        read: ["/custom/readable"],
        write: ["/custom/writable"],
      },
    };

    // Read operation on write-only path should fail
    await assertRejects(
      () => validatePath("/custom/writable/file.txt", config, "/", "read"),
      SafeShellError,
    );

    // Write operation on read-only path should fail
    await assertRejects(
      () => validatePath("/custom/readable/file.txt", config, "/", "write"),
      SafeShellError,
    );
  },
});
