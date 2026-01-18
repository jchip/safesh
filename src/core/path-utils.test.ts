/**
 * Unit tests for path-utils.ts
 *
 * Tests consolidated path checking utilities.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import {
  isPathWithin,
  isPathWithinAny,
  isPathWithinAllowed,
  checkPathPermission
} from "./path-utils.ts";
import { join } from "@std/path";

describe("path-utils", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = Deno.makeTempDirSync({ prefix: "safesh-test-path-utils-" });
  });

  afterEach(() => {
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("isPathWithin", () => {
    it("returns true when paths are equal", () => {
      assertEquals(isPathWithin("/foo/bar", "/foo/bar"), true);
    });

    it("returns true when path is within parent", () => {
      assertEquals(isPathWithin("/foo/bar/baz", "/foo/bar"), true);
    });

    it("returns false when path is not within parent", () => {
      assertEquals(isPathWithin("/foo/other", "/foo/bar"), false);
    });

    it("returns false when path is a prefix but not a directory", () => {
      // /foo/barbaz should NOT be within /foo/bar
      assertEquals(isPathWithin("/foo/barbaz", "/foo/bar"), false);
    });

    it("returns true for nested paths", () => {
      assertEquals(isPathWithin("/a/b/c/d/e", "/a/b"), true);
    });
  });

  describe("isPathWithinAny", () => {
    it("returns true when path is within any allowed path", () => {
      const allowed = ["/foo", "/bar", "/baz"];
      assertEquals(isPathWithinAny("/bar/subdir", allowed), true);
    });

    it("returns false when path is not within any allowed path", () => {
      const allowed = ["/foo", "/bar", "/baz"];
      assertEquals(isPathWithinAny("/other/path", allowed), false);
    });

    it("returns true when path equals one of the allowed paths", () => {
      const allowed = ["/foo", "/bar", "/baz"];
      assertEquals(isPathWithinAny("/bar", allowed), true);
    });

    it("handles empty allowed paths array", () => {
      assertEquals(isPathWithinAny("/any/path", []), false);
    });
  });

  describe("isPathWithinAllowed", () => {
    it("resolves relative paths correctly", () => {
      const result = isPathWithinAllowed("subdir/file.txt", {
        allowedPaths: [tempDir],
        cwd: tempDir,
      });
      assertEquals(result, true);
    });

    it("handles absolute paths", () => {
      const testPath = join(tempDir, "test");
      const result = isPathWithinAllowed(testPath, {
        allowedPaths: [tempDir],
      });
      assertEquals(result, true);
    });

    it("rejects paths outside allowed directories", () => {
      const result = isPathWithinAllowed("/outside/path", {
        allowedPaths: [tempDir],
      });
      assertEquals(result, false);
    });
  });

  describe("checkPathPermission", () => {
    it("allows read access to project directory", () => {
      const config = {
        projectDir: tempDir,
      };
      const testPath = join(tempDir, "file.txt");
      const result = checkPathPermission(testPath, "read", config, tempDir);

      assertEquals(result.allowed, true);
      assertEquals(typeof result.resolvedPath, "string");
    });

    it("blocks write access when blockProjectDirWrite is enabled", () => {
      const config = {
        projectDir: tempDir,
        blockProjectDirWrite: true,
      };
      const testPath = join(tempDir, "file.txt");
      const result = checkPathPermission(testPath, "write", config, tempDir);

      assertEquals(result.allowed, false);
      assertEquals(result.reason?.includes("blocked"), true);
    });

    it("allows write access when blockProjectDirWrite is false", () => {
      const config = {
        projectDir: tempDir,
        blockProjectDirWrite: false,
      };
      const testPath = join(tempDir, "file.txt");
      const result = checkPathPermission(testPath, "write", config, tempDir);

      assertEquals(result.allowed, true);
    });

    it("checks explicit read permissions", () => {
      const config = {
        permissions: {
          read: [tempDir],
        },
      };
      const testPath = join(tempDir, "file.txt");
      const result = checkPathPermission(testPath, "read", config, tempDir);

      assertEquals(result.allowed, true);
    });

    it("rejects paths not in permissions", () => {
      const config = {
        permissions: {
          read: ["/some/other/path"],
        },
      };
      const testPath = join(tempDir, "file.txt");
      const result = checkPathPermission(testPath, "read", config, tempDir);

      assertEquals(result.allowed, false);
      assertEquals(result.reason !== undefined, true);
    });

    it("provides detailed reason for denial", () => {
      const config = {};
      const result = checkPathPermission("/any/path", "read", config, tempDir);

      assertEquals(result.allowed, false);
      assertEquals(typeof result.reason, "string");
      assertEquals(result.reason!.length > 0, true);
    });
  });
});
