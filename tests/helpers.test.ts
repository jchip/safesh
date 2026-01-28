/**
 * Tests for test helpers module
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@1.0.12";
import {
  cleanupTestDir,
  createTestDir,
  REAL_TMP,
  withTestDir,
} from "./helpers.ts";

Deno.test("REAL_TMP constant is resolved", () => {
  assertExists(REAL_TMP);
  assertEquals(typeof REAL_TMP, "string");
  // Should be an absolute path
  assertEquals(REAL_TMP.startsWith("/"), true);
});

Deno.test("createTestDir creates unique directories", () => {
  const dir1 = createTestDir("test");
  const dir2 = createTestDir("test");

  // Both should start with REAL_TMP
  assertEquals(dir1.startsWith(REAL_TMP), true);
  assertEquals(dir2.startsWith(REAL_TMP), true);

  // Both should contain the prefix
  assertEquals(dir1.includes("test-"), true);
  assertEquals(dir2.includes("test-"), true);

  // Should be unique
  assertEquals(dir1 === dir2, false);
});

Deno.test("cleanupTestDir removes directory", async () => {
  const dir = createTestDir("cleanup-test");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/test.txt`, "content");

  // Verify directory exists
  const stat = await Deno.stat(dir);
  assertEquals(stat.isDirectory, true);

  // Cleanup
  cleanupTestDir(dir);

  // Verify directory is removed
  await assertRejects(
    async () => await Deno.stat(dir),
    Deno.errors.NotFound,
  );
});

Deno.test("cleanupTestDir ignores errors", () => {
  const nonExistentDir = createTestDir("nonexistent");

  // Should not throw even though directory doesn't exist
  cleanupTestDir(nonExistentDir);
});

Deno.test("cleanupTestDir refuses to clean paths outside REAL_TMP", () => {
  const consoleSpy: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => consoleSpy.push(msg);

  try {
    cleanupTestDir("/etc/passwd");
    assertEquals(consoleSpy.length, 1);
    assertEquals(consoleSpy[0]?.includes("Refusing to cleanup"), true);
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("withTestDir creates and cleans up directory on success", async () => {
  let capturedDir = "";

  await withTestDir("withtest", async (dir) => {
    capturedDir = dir;

    // Directory should exist during function execution
    const stat = await Deno.stat(dir);
    assertEquals(stat.isDirectory, true);

    // Can write to it
    await Deno.writeTextFile(`${dir}/test.txt`, "content");
  });

  // Directory should be cleaned up after
  await assertRejects(
    async () => await Deno.stat(capturedDir),
    Deno.errors.NotFound,
  );
});

Deno.test("withTestDir cleans up directory on error", async () => {
  let capturedDir = "";

  await assertRejects(async () => {
    await withTestDir("withtesterr", async (dir) => {
      capturedDir = dir;

      // Directory should exist
      const stat = await Deno.stat(dir);
      assertEquals(stat.isDirectory, true);

      // Throw error
      throw new Error("Test error");
    });
  }, Error);

  // Directory should still be cleaned up
  await assertRejects(
    async () => await Deno.stat(capturedDir),
    Deno.errors.NotFound,
  );
});

Deno.test("withTestDir returns function result", async () => {
  const result = await withTestDir("withret", async () => {
    return 42;
  });

  assertEquals(result, 42);
});

Deno.test("withTestDir works with synchronous functions", async () => {
  const result = await withTestDir("withsync", (dir) => {
    // Sync function
    Deno.writeTextFileSync(`${dir}/sync.txt`, "sync");
    return "done";
  });

  assertEquals(result, "done");
});
