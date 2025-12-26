/**
 * Integration tests for Streaming Shell API
 *
 * Tests end-to-end usage of the streaming shell including:
 * - Import map resolution
 * - Stream composition
 * - File system operations
 * - Command execution
 */

import { assertEquals, assert } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";

// Test import map resolution
import { createStream, fromArray } from "safesh:stream";
import { filter, map, lines, grep } from "safesh:transforms";
import { stdout, stderr, tee } from "safesh:io";
import { glob, src, cat, dest, type File } from "safesh:fs-streams";
import { cmd, git } from "safesh:command";

const TEST_DIR = join(Deno.cwd(), ".temp", "integration-test");

async function setup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
  await ensureDir(TEST_DIR);

  // Create test files
  await Deno.writeTextFile(join(TEST_DIR, "test1.txt"), "hello\nworld\n");
  await Deno.writeTextFile(join(TEST_DIR, "test2.txt"), "foo\nbar\n");
}

async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

Deno.test({
  name: "Integration - import map resolution",
  async fn() {
    // Just verify all imports work
    assert(createStream);
    assert(filter);
    assert(stdout);
    assert(glob);
    assert(cmd);
  },
});

Deno.test({
  name: "Integration - stream composition",
  async fn() {
    const result = await fromArray([1, 2, 3, 4, 5])
      .pipe(filter((x) => x % 2 === 0))
      .pipe(map((x) => x * 2))
      .collect();

    assertEquals(result, [4, 8]);
  },
});

Deno.test({
  name: "Integration - file processing pipeline",
  async fn() {
    await setup();
    try {
      const lines_array = await cat(join(TEST_DIR, "test1.txt"))
        .pipe(lines())
        .collect();

      assertEquals(lines_array, ["hello", "world"]);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Integration - command with transforms",
  async fn() {
    const result = await cmd("echo", ["apple\nbanana\ncherry"])
      .stdout()
      .pipe(lines())
      .pipe(filter((line) => line.includes("a")))
      .collect();

    assertEquals(result.length, 2);
    assert(result.includes("apple"));
    assert(result.includes("banana"));
  },
});

Deno.test({
  name: "Integration - glob and dest",
  async fn() {
    await setup();
    try {
      const outDir = join(TEST_DIR, "output");

      // Copy all txt files
      await src(join(TEST_DIR, "*.txt"))
        .pipe(dest(outDir))
        .collect();

      // Verify files were copied
      const copied1 = await Deno.readTextFile(join(outDir, "test1.txt"));
      const copied2 = await Deno.readTextFile(join(outDir, "test2.txt"));

      assertEquals(copied1, "hello\nworld\n");
      assertEquals(copied2, "foo\nbar\n");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Integration - complex pipeline",
  async fn() {
    await setup();
    try {
      // Create a log-like file
      await Deno.writeTextFile(
        join(TEST_DIR, "app.log"),
        "INFO: Starting\nERROR: Failed\nWARN: Slow\nERROR: Crashed\n",
      );

      // Process log file
      const errors = await cat(join(TEST_DIR, "app.log"))
        .pipe(lines())
        .pipe(grep(/ERROR/))
        .pipe(map((line) => line.replace("ERROR: ", "")))
        .collect();

      assertEquals(errors, ["Failed", "Crashed"]);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Integration - git command",
  async fn() {
    const result = await git("--version").exec();

    assertEquals(result.success, true);
    assert(result.stdout.includes("git version"));
  },
});
