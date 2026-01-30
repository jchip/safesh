/**
 * Tests for stdlib/fs.ts
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import * as fs from "../src/stdlib/fs.ts";
import { SafeShellError } from "../src/core/errors.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { REAL_TMP } from "./helpers.ts";

const testDir = `${REAL_TMP}/safesh-fs-test`;

describe("fs", () => {
  beforeEach(async () => {
    await Deno.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("read", () => {
    it("reads file contents", async () => {
      const content = "Hello, World!";
      await Deno.writeTextFile(`${testDir}/test.txt`, content);

      const result = await fs.read(`${testDir}/test.txt`);
      assertEquals(result, content);
    });

    it("throws on non-existent file", async () => {
      await assertRejects(
        async () => await fs.read(`${testDir}/nonexistent.txt`),
      );
    });
  });

  describe("readBytes", () => {
    it("reads file as bytes", async () => {
      const content = "Binary content";
      await Deno.writeTextFile(`${testDir}/binary.txt`, content);

      const bytes = await fs.readBytes(`${testDir}/binary.txt`);
      assertEquals(new TextDecoder().decode(bytes), content);
    });
  });

  describe("readJson", () => {
    it("reads and parses JSON", async () => {
      const data = { name: "test", value: 42 };
      await Deno.writeTextFile(`${testDir}/data.json`, JSON.stringify(data));

      const result = await fs.readJson<typeof data>(`${testDir}/data.json`);
      assertEquals(result, data);
    });

    it("throws on invalid JSON", async () => {
      await Deno.writeTextFile(`${testDir}/invalid.json`, "not json");

      await assertRejects(
        async () => await fs.readJson(`${testDir}/invalid.json`),
        SafeShellError,
      );
    });
  });

  describe("write", () => {
    it("writes content to file", async () => {
      const content = "New content";
      await fs.write(`${testDir}/new.txt`, content);

      const result = await Deno.readTextFile(`${testDir}/new.txt`);
      assertEquals(result, content);
    });

    it("creates parent directories", async () => {
      const content = "Nested content";
      await fs.write(`${testDir}/nested/deep/file.txt`, content);

      const result = await Deno.readTextFile(`${testDir}/nested/deep/file.txt`);
      assertEquals(result, content);
    });
  });

  describe("writeJson", () => {
    it("writes JSON with formatting", async () => {
      const data = { name: "test" };
      await fs.writeJson(`${testDir}/output.json`, data);

      const content = await Deno.readTextFile(`${testDir}/output.json`);
      assertStringIncludes(content, '"name": "test"');
    });
  });

  describe("append", () => {
    it("appends to file", async () => {
      await Deno.writeTextFile(`${testDir}/log.txt`, "line1\n");
      await fs.append(`${testDir}/log.txt`, "line2\n");

      const content = await Deno.readTextFile(`${testDir}/log.txt`);
      assertEquals(content, "line1\nline2\n");
    });

    it("creates file if not exists", async () => {
      await fs.append(`${testDir}/newlog.txt`, "first line");

      const content = await Deno.readTextFile(`${testDir}/newlog.txt`);
      assertEquals(content, "first line");
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await Deno.writeTextFile(`${testDir}/exists.txt`, "content");

      const result = await fs.exists(`${testDir}/exists.txt`);
      assertEquals(result, true);
    });

    it("returns false for non-existent file", async () => {
      const result = await fs.exists(`${testDir}/nonexistent.txt`);
      assertEquals(result, false);
    });

    it("returns true for directories", async () => {
      await Deno.mkdir(`${testDir}/subdir`);

      const result = await fs.exists(`${testDir}/subdir`);
      assertEquals(result, true);
    });
  });

  describe("stat", () => {
    it("returns file info", async () => {
      await Deno.writeTextFile(`${testDir}/info.txt`, "content");

      const info = await fs.stat(`${testDir}/info.txt`);
      assertEquals(info.isFile, true);
      assertEquals(info.isDirectory, false);
    });
  });

  describe("remove", () => {
    it("removes file", async () => {
      await Deno.writeTextFile(`${testDir}/todelete.txt`, "content");
      await fs.remove(`${testDir}/todelete.txt`);

      const exists = await fs.exists(`${testDir}/todelete.txt`);
      assertEquals(exists, false);
    });

    it("removes directory recursively", async () => {
      await Deno.mkdir(`${testDir}/toremove/nested`, { recursive: true });
      await Deno.writeTextFile(`${testDir}/toremove/nested/file.txt`, "content");

      await fs.remove(`${testDir}/toremove`, { recursive: true });

      const exists = await fs.exists(`${testDir}/toremove`);
      assertEquals(exists, false);
    });
  });

  describe("mkdir", () => {
    it("creates directory", async () => {
      await fs.mkdir(`${testDir}/newdir`);

      const info = await Deno.stat(`${testDir}/newdir`);
      assertEquals(info.isDirectory, true);
    });

    it("creates nested directories", async () => {
      await fs.mkdir(`${testDir}/a/b/c`, { recursive: true });

      const info = await Deno.stat(`${testDir}/a/b/c`);
      assertEquals(info.isDirectory, true);
    });
  });

  describe("copy", () => {
    it("copies file", async () => {
      await Deno.writeTextFile(`${testDir}/source.txt`, "content");
      await fs.copy(`${testDir}/source.txt`, `${testDir}/dest.txt`);

      const content = await Deno.readTextFile(`${testDir}/dest.txt`);
      assertEquals(content, "content");
    });
  });

  describe("move", () => {
    it("moves file", async () => {
      await Deno.writeTextFile(`${testDir}/old.txt`, "content");
      await fs.move(`${testDir}/old.txt`, `${testDir}/new.txt`);

      const exists = await fs.exists(`${testDir}/old.txt`);
      assertEquals(exists, false);

      const content = await Deno.readTextFile(`${testDir}/new.txt`);
      assertEquals(content, "content");
    });
  });

  describe("touch", () => {
    it("creates empty file", async () => {
      await fs.touch(`${testDir}/touched.txt`);

      const content = await Deno.readTextFile(`${testDir}/touched.txt`);
      assertEquals(content, "");
    });

    it("updates mtime of existing file", async () => {
      await Deno.writeTextFile(`${testDir}/existing.txt`, "content");
      const before = (await Deno.stat(`${testDir}/existing.txt`)).mtime;

      // Small delay to ensure mtime changes
      await new Promise((r) => setTimeout(r, 10));
      await fs.touch(`${testDir}/existing.txt`);

      const after = (await Deno.stat(`${testDir}/existing.txt`)).mtime;
      assertEquals(after! >= before!, true);
    });
  });

  describe("readDir", () => {
    it("lists directory contents", async () => {
      await Deno.writeTextFile(`${testDir}/a.txt`, "a");
      await Deno.writeTextFile(`${testDir}/b.txt`, "b");
      await Deno.mkdir(`${testDir}/subdir`);

      const entries = await fs.readDir(testDir);
      const names = entries.map((e) => e.name).sort();

      assertEquals(names.includes("a.txt"), true);
      assertEquals(names.includes("b.txt"), true);
      assertEquals(names.includes("subdir"), true);
    });
  });

  describe("walk", () => {
    beforeEach(async () => {
      await Deno.mkdir(`${testDir}/walk/nested`, { recursive: true });
      await Deno.writeTextFile(`${testDir}/walk/a.ts`, "a");
      await Deno.writeTextFile(`${testDir}/walk/b.ts`, "b");
      await Deno.writeTextFile(`${testDir}/walk/nested/c.ts`, "c");
      await Deno.writeTextFile(`${testDir}/walk/nested/d.js`, "d");
    });

    it("walks directory tree", async () => {
      const entries: string[] = [];
      for await (const entry of fs.walk(`${testDir}/walk`)) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 4);
    });

    it("filters by extension", async () => {
      const entries: string[] = [];
      for await (const entry of fs.walk(`${testDir}/walk`, { exts: [".ts"] })) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 3);
      assertEquals(entries.every((n) => n.endsWith(".ts")), true);
    });

    it("limits depth", async () => {
      const entries: string[] = [];
      for await (const entry of fs.walk(`${testDir}/walk`, { maxDepth: 1 })) {
        entries.push(entry.name);
      }

      assertEquals(entries.length, 2);
      assertEquals(entries.includes("c.ts"), false);
    });
  });

  describe("find", () => {
    beforeEach(async () => {
      await Deno.mkdir(`${testDir}/find`, { recursive: true });
      await Deno.writeTextFile(`${testDir}/find/small.txt`, "x");
      await Deno.writeTextFile(`${testDir}/find/big.txt`, "x".repeat(100));
    });

    it("finds files matching predicate", async () => {
      const bigFiles = await fs.find(
        `${testDir}/find`,
        async (entry) => {
          const info = await Deno.stat(entry.path);
          return info.size > 50;
        },
      );

      assertEquals(bigFiles.length, 1);
      assertEquals(bigFiles[0]!.name, "big.txt");
    });
  });

  describe("sandbox validation", () => {
    it("validates read operations against sandbox", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: [`${REAL_TMP}/allowed-only`],
          write: [],
        },
      };

      await assertRejects(
        async () => await fs.read(`${testDir}/test.txt`, { config }),
        SafeShellError,
        "outside allowed directories",
      );
    });

    it("validates write operations against sandbox", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: [testDir],
          write: [`${REAL_TMP}/write-only`],
        },
      };

      await assertRejects(
        async () => await fs.write(`${testDir}/new.txt`, "content", { config }),
        SafeShellError,
        "outside allowed directories",
      );
    });

    it("allows operations within sandbox", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: [testDir],
          write: [testDir],
        },
      };

      await fs.write(`${testDir}/allowed.txt`, "content", { config });
      const content = await fs.read(`${testDir}/allowed.txt`, { config });
      assertEquals(content, "content");
    });
  });
});
