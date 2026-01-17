/**
 * Tests for stdlib/glob.ts
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  glob,
  globArray,
  globPaths,
  hasMatch,
  countMatches,
  findFirst,
  getGlobBase,
} from "../src/stdlib/glob.ts";
import { SafeShellError } from "../src/core/errors.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

// Resolve /tmp to real path (on macOS, /tmp is a symlink to /private/tmp)
const realTmp = Deno.realPathSync("/tmp");
const testDir = `${realTmp}/safesh-glob-test`;

describe("glob", () => {
  beforeEach(async () => {
    // Create test directory structure
    await Deno.mkdir(`${testDir}/src`, { recursive: true });
    await Deno.mkdir(`${testDir}/src/components`, { recursive: true });
    await Deno.mkdir(`${testDir}/tests`, { recursive: true });

    await Deno.writeTextFile(`${testDir}/src/main.ts`, "// main");
    await Deno.writeTextFile(`${testDir}/src/utils.ts`, "// utils");
    await Deno.writeTextFile(`${testDir}/src/components/Button.tsx`, "// button");
    await Deno.writeTextFile(`${testDir}/src/components/Input.tsx`, "// input");
    await Deno.writeTextFile(`${testDir}/tests/main_test.ts`, "// test");
    await Deno.writeTextFile(`${testDir}/README.md`, "# README");
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getGlobBase", () => {
    it("extracts base from simple patterns", () => {
      assertEquals(getGlobBase("src/*.ts"), "src");
      assertEquals(getGlobBase("src/components/*.tsx"), "src/components");
      assertEquals(getGlobBase("*.ts"), ".");
      assertEquals(getGlobBase("**/*.ts"), ".");
    });

    it("handles absolute paths", () => {
      assertEquals(getGlobBase("/home/user/src/*.ts"), "/home/user/src");
      assertEquals(getGlobBase("/tmp/**/*.log"), "/tmp");
    });

    it("throws TypeError for undefined pattern", () => {
      assertThrows(
        () => getGlobBase(undefined as any),
        TypeError,
        "pattern cannot be undefined or null"
      );
    });

    it("throws TypeError for null pattern", () => {
      assertThrows(
        () => getGlobBase(null as any),
        TypeError,
        "pattern cannot be undefined or null"
      );
    });

    it("throws TypeError for non-string pattern", () => {
      assertThrows(
        () => getGlobBase(123 as any),
        TypeError,
        "pattern must be a string"
      );
    });
  });

  describe("glob generator", () => {
    it("finds files matching pattern", async () => {
      const entries: string[] = [];
      for await (const entry of glob("**/*.ts", { root: testDir })) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 3);
      assertEquals(entries.includes("main.ts"), true);
      assertEquals(entries.includes("utils.ts"), true);
      assertEquals(entries.includes("main_test.ts"), true);
    });

    it("finds files in specific directory", async () => {
      const entries: string[] = [];
      for await (const entry of glob("src/*.ts", { root: testDir })) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 2);
      assertEquals(entries.includes("main.ts"), true);
      assertEquals(entries.includes("utils.ts"), true);
    });

    it("finds tsx files", async () => {
      const entries: string[] = [];
      for await (const entry of glob("**/*.tsx", { root: testDir })) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 2);
      assertEquals(entries.includes("Button.tsx"), true);
      assertEquals(entries.includes("Input.tsx"), true);
    });

    it("respects exclude patterns", async () => {
      const entries: string[] = [];
      for await (const entry of glob("**/*.ts", { root: testDir, exclude: ["**/tests/**"] })) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 2);
      assertEquals(entries.includes("main_test.ts"), false);
    });

    it("includes directories when requested", async () => {
      const entries: { name: string; isDir: boolean }[] = [];
      for await (const entry of glob("src/*", { root: testDir, includeDirs: true })) {
        entries.push({ name: entry.name, isDir: entry.isDirectory });
      }

      // Should include components directory and files
      const componentDir = entries.find((e) => e.name === "components");
      assertEquals(componentDir?.isDir, true);
    });
  });

  describe("globArray", () => {
    it("returns array of entries", async () => {
      const entries = await globArray("**/*.ts", { root: testDir });

      assertEquals(entries.length, 3);
      assertEquals(entries.every((e) => e.isFile), true);
    });
  });

  describe("globPaths", () => {
    it("returns array of paths", async () => {
      const paths = await globPaths("src/*.ts", { root: testDir });

      assertEquals(paths.length, 2);
      assertEquals(paths.every((p) => p.endsWith(".ts")), true);
    });
  });

  describe("hasMatch", () => {
    it("returns true when matches exist", async () => {
      const result = await hasMatch("**/*.ts", { root: testDir });
      assertEquals(result, true);
    });

    it("returns false when no matches", async () => {
      const result = await hasMatch("**/*.rs", { root: testDir });
      assertEquals(result, false);
    });
  });

  describe("countMatches", () => {
    it("counts matching files", async () => {
      const count = await countMatches("**/*.ts", { root: testDir });
      assertEquals(count, 3);
    });

    it("returns 0 for no matches", async () => {
      const count = await countMatches("**/*.py", { root: testDir });
      assertEquals(count, 0);
    });
  });

  describe("findFirst", () => {
    it("returns first matching entry", async () => {
      const entry = await findFirst("**/*.md", { root: testDir });

      assertEquals(entry?.name, "README.md");
    });

    it("returns undefined for no matches", async () => {
      const entry = await findFirst("**/*.java", { root: testDir });
      assertEquals(entry, undefined);
    });
  });

  describe("sandbox validation", () => {
    it("respects sandbox config", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: [testDir],
          write: [],
        },
      };

      const entries = await globArray("**/*.ts", { root: testDir }, config);
      assertEquals(entries.length, 3);
    });

    it("skips files outside sandbox silently", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: [`${testDir}/src`],
          write: [],
        },
      };

      const entries = await globArray("**/*.ts", { root: testDir }, config);

      // Should only find files in src, not in tests
      assertEquals(entries.length, 2);
      assertEquals(entries.some((e) => e.path.includes("tests")), false);
    });
  });
});
