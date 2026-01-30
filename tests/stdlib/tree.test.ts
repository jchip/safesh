/**
 * Tests for tree command
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { tree, treeLines } from "../../src/stdlib/fs.ts";
import { REAL_TMP } from "../helpers.ts";

const testDir = `${REAL_TMP}/safesh-tree-test-${Date.now()}`;

Deno.test("tree", async (t) => {
  // Create test directory
  await Deno.mkdir(testDir, { recursive: true });
  const tempDir = testDir;

  try {
    // Create test directory structure:
    // tempDir/
    // ├── dir1/
    // │   ├── file1.ts
    // │   └── file2.ts
    // ├── dir2/
    // │   └── nested/
    // │       └── deep.txt
    // ├── .hidden/
    // │   └── secret.txt
    // └── root.txt
    await Deno.mkdir(`${tempDir}/dir1`);
    await Deno.mkdir(`${tempDir}/dir2`);
    await Deno.mkdir(`${tempDir}/dir2/nested`);
    await Deno.mkdir(`${tempDir}/.hidden`);
    await Deno.writeTextFile(`${tempDir}/dir1/file1.ts`, "");
    await Deno.writeTextFile(`${tempDir}/dir1/file2.ts`, "");
    await Deno.writeTextFile(`${tempDir}/dir2/nested/deep.txt`, "");
    await Deno.writeTextFile(`${tempDir}/.hidden/secret.txt`, "");
    await Deno.writeTextFile(`${tempDir}/root.txt`, "");

    await t.step("should yield tree entries with correct structure", async () => {
      const entries = [];
      for await (const entry of tree(tempDir)) {
        entries.push(entry);
      }

      // Should have root + dir1 + 2 files + dir2 + nested + 1 file + root.txt
      // (hidden files excluded by default)
      assertEquals(entries.length, 8);

      // First entry is root
      assertEquals(entries[0]?.depth, 0);
      assertEquals(entries[0]?.isDirectory, true);
    });

    await t.step("should format lines with ASCII tree characters", async () => {
      const lines = await treeLines(tempDir);

      // Check for tree formatting characters
      const hasTreeChars = lines.some(
        (line) => line.includes("├──") || line.includes("└──")
      );
      assertEquals(hasTreeChars, true);
    });

    await t.step("should respect maxDepth option", async () => {
      const entries = [];
      for await (const entry of tree(tempDir, { maxDepth: 1 })) {
        entries.push(entry);
      }

      // Should only have root + immediate children (dir1, dir2, root.txt)
      // Not including files inside dir1 or nested dirs
      assertEquals(entries.length, 4);
    });

    await t.step("should filter with dirsOnly option", async () => {
      const entries = [];
      for await (const entry of tree(tempDir, { dirsOnly: true })) {
        entries.push(entry);
      }

      // All entries should be directories
      for (const entry of entries) {
        assertEquals(entry.isDirectory, true);
      }
    });

    await t.step("should show hidden files when showHidden is true", async () => {
      const entriesWithHidden = [];
      for await (const entry of tree(tempDir, { showHidden: true })) {
        entriesWithHidden.push(entry);
      }

      const entriesWithoutHidden = [];
      for await (const entry of tree(tempDir, { showHidden: false })) {
        entriesWithoutHidden.push(entry);
      }

      // Should have more entries with hidden files
      assertEquals(entriesWithHidden.length > entriesWithoutHidden.length, true);

      // Should include .hidden directory
      const hasHidden = entriesWithHidden.some((e) => e.name === ".hidden");
      assertEquals(hasHidden, true);
    });

    await t.step("should filter by pattern", async () => {
      const entries = [];
      for await (const entry of tree(tempDir, { pattern: /\.ts$/ })) {
        entries.push(entry);
      }

      // Should include directories and only .ts files
      const files = entries.filter((e) => !e.isDirectory);
      for (const file of files) {
        assertStringIncludes(file.name, ".ts");
      }
    });

    await t.step("treeLines should return formatted lines", async () => {
      const lines = await treeLines(tempDir, { maxDepth: 1 });

      assertEquals(Array.isArray(lines), true);
      assertEquals(lines.length, 4); // root + 3 children
    });

    await t.step("entries should have correct paths", async () => {
      const entries = [];
      for await (const entry of tree(tempDir)) {
        entries.push(entry);
      }

      // All paths should be absolute and start with tempDir
      for (const entry of entries) {
        assertStringIncludes(entry.path, tempDir);
      }
    });

  } finally {
    // Cleanup
    await Deno.remove(tempDir, { recursive: true });
  }
});
