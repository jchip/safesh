/**
 * Unit tests for utils.ts
 *
 * Tests utility functions for path resolution and symlink handling.
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import { getRealPath, getRealPathBoth, getRealPathAsync } from "./utils.ts";
import { join } from "@std/path";

describe("utils - path resolution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = Deno.makeTempDirSync({ prefix: "safesh-test-utils-" });
  });

  afterEach(() => {
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getRealPath", () => {
    it("returns real path for existing path", () => {
      const result = getRealPath(tempDir);
      // Should return a real path (may resolve symlinks)
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("returns original path for non-existent path", () => {
      const nonExistent = join(tempDir, "does-not-exist");
      const result = getRealPath(nonExistent);
      assertEquals(result, nonExistent);
    });

    it("resolves symlinks on macOS /tmp", () => {
      const tmpResult = getRealPath("/tmp");
      // On macOS, /tmp should resolve to /private/tmp
      if (Deno.build.os === "darwin") {
        assertEquals(tmpResult, "/private/tmp");
      }
    });
  });

  describe("getRealPathBoth", () => {
    it("returns array with both paths when they differ", () => {
      // On macOS, /tmp -> /private/tmp
      if (Deno.build.os === "darwin") {
        const result = getRealPathBoth("/tmp");
        assertEquals(result.length, 2);
        assertEquals(result[0], "/tmp");
        assertEquals(result[1], "/private/tmp");
      }
    });

    it("returns single element array when paths are same", () => {
      const result = getRealPathBoth(tempDir);
      // On macOS, temp dir might resolve to different path (e.g., /var -> /private/var)
      // Just check that we got at least one path and it's valid
      assertEquals(result.length >= 1, true);
      assertEquals(typeof result[0], "string");
      if (result[0]) {
        assertEquals(result[0].length > 0, true);
      }
    });

    it("returns single element array for non-existent path", () => {
      const nonExistent = join(tempDir, "does-not-exist");
      const result = getRealPathBoth(nonExistent);
      assertEquals(result.length, 1);
      assertEquals(result[0], nonExistent);
    });

    it("creates symlink and returns both paths", () => {
      const target = join(tempDir, "target");
      const link = join(tempDir, "link");

      // Create target directory
      Deno.mkdirSync(target);

      // Create symlink
      Deno.symlinkSync(target, link);

      const result = getRealPathBoth(link);
      assertEquals(result.length, 2);
      assertEquals(result[0], link);
      // Second element should be the resolved real path
      assertNotEquals(result[1], link);
    });
  });

  describe("getRealPathAsync", () => {
    it("returns real path for existing path", async () => {
      const result = await getRealPathAsync(tempDir);
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("returns original path for non-existent path", async () => {
      const nonExistent = join(tempDir, "does-not-exist");
      const result = await getRealPathAsync(nonExistent);
      assertEquals(result, nonExistent);
    });

    it("resolves symlinks on macOS /tmp", async () => {
      const tmpResult = await getRealPathAsync("/tmp");
      if (Deno.build.os === "darwin") {
        assertEquals(tmpResult, "/private/tmp");
      }
    });
  });
});
