/**
 * Tests for I/O Utilities
 *
 * Note: These tests verify the logic structure but cannot fully test
 * readStdinFully() in a unit test environment as it requires actual stdin.
 * Integration tests should be used to verify stdin reading behavior.
 */

import {
  assertEquals,
  assertRejects,
  assertExists,
} from "jsr:@std/assert@1";
import {
  readJsonFile,
  writeJsonFile,
  ensureDir,
  ensureDirSync,
  readStdinFully,
} from "./io-utils.ts";
import { join } from "jsr:@std/path@1";

// Test utilities
const TEST_DIR = "/tmp/safesh-io-utils-test";

async function setupTestDir() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
  await Deno.mkdir(TEST_DIR, { recursive: true });
}

async function cleanupTestDir() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore errors
  }
}

// Basic smoke test to ensure the module loads
Deno.test("io-utils module exports readStdinFully", () => {
  assertEquals(typeof readStdinFully, "function");
});

// JSON file I/O tests
Deno.test("readJsonFile - reads valid JSON file", async () => {
  await setupTestDir();
  try {
    const testFile = join(TEST_DIR, "valid.json");
    const testData = { name: "test", value: 42, nested: { key: "value" } };
    await Deno.writeTextFile(testFile, JSON.stringify(testData));

    const result = await readJsonFile(testFile);
    assertEquals(result, testData);
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("readJsonFile - throws on invalid JSON", async () => {
  await setupTestDir();
  try {
    const testFile = join(TEST_DIR, "invalid.json");
    await Deno.writeTextFile(testFile, "{not valid json}");

    await assertRejects(
      async () => await readJsonFile(testFile),
      SyntaxError,
      "Invalid JSON in file"
    );
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("readJsonFile - throws on missing file", async () => {
  await setupTestDir();
  try {
    const testFile = join(TEST_DIR, "nonexistent.json");

    await assertRejects(
      async () => await readJsonFile(testFile),
      Deno.errors.NotFound,
      "JSON file not found"
    );
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("readJsonFile - handles typed responses", async () => {
  await setupTestDir();
  try {
    const testFile = join(TEST_DIR, "typed.json");
    interface TestType {
      id: number;
      name: string;
    }
    const testData: TestType = { id: 123, name: "test" };
    await Deno.writeTextFile(testFile, JSON.stringify(testData));

    const result = await readJsonFile<TestType>(testFile);
    assertEquals(result.id, 123);
    assertEquals(result.name, "test");
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("writeJsonFile - writes JSON with formatting", async () => {
  await setupTestDir();
  try {
    const testFile = join(TEST_DIR, "output.json");
    const testData = { name: "test", value: 42 };

    await writeJsonFile(testFile, testData);

    const content = await Deno.readTextFile(testFile);
    assertEquals(content, '{\n  "name": "test",\n  "value": 42\n}\n');
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("writeJsonFile - round-trip preserves data", async () => {
  await setupTestDir();
  try {
    const testFile = join(TEST_DIR, "roundtrip.json");
    const testData = {
      string: "hello",
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      nested: { key: "value" },
    };

    await writeJsonFile(testFile, testData);
    const result = await readJsonFile(testFile);
    assertEquals(result, testData);
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("writeJsonFile - creates parent directories", async () => {
  await setupTestDir();
  try {
    const nestedFile = join(TEST_DIR, "nested", "deep", "output.json");
    const testData = { test: "data" };

    await writeJsonFile(nestedFile, testData);

    const stat = await Deno.stat(nestedFile);
    assertExists(stat);
    const result = await readJsonFile(nestedFile);
    assertEquals(result, testData);
  } finally {
    await cleanupTestDir();
  }
});

// Directory creation tests
Deno.test("ensureDir - creates new directory", async () => {
  await setupTestDir();
  try {
    const newDir = join(TEST_DIR, "newdir");

    await ensureDir(newDir);

    const stat = await Deno.stat(newDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("ensureDir - creates nested directories", async () => {
  await setupTestDir();
  try {
    const nestedDir = join(TEST_DIR, "level1", "level2", "level3");

    await ensureDir(nestedDir);

    const stat = await Deno.stat(nestedDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("ensureDir - succeeds if directory already exists", async () => {
  await setupTestDir();
  try {
    const existingDir = join(TEST_DIR, "existing");
    await Deno.mkdir(existingDir);

    // Should not throw
    await ensureDir(existingDir);

    const stat = await Deno.stat(existingDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("ensureDirSync - creates new directory", async () => {
  await setupTestDir();
  try {
    const newDir = join(TEST_DIR, "newdir-sync");

    ensureDirSync(newDir);

    const stat = await Deno.stat(newDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestDir();
  }
});

Deno.test("ensureDirSync - succeeds if directory already exists", async () => {
  await setupTestDir();
  try {
    const existingDir = join(TEST_DIR, "existing-sync");
    await Deno.mkdir(existingDir);

    // Should not throw
    ensureDirSync(existingDir);

    const stat = await Deno.stat(existingDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestDir();
  }
});
