/**
 * Tests for fluent streams with glob - SSH-197: Test Fluent Streams - Glob and File Processing
 * Tests $.glob and $.src with file filtering and transformation
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { glob, src, type File } from "../../src/stdlib/fs-streams.ts";
import { REAL_TMP } from "../helpers.ts";

const testDir = `${REAL_TMP}/safesh-fluent-glob-test`;

describe("fluent streams - glob and file processing (SSH-197)", () => {
  beforeEach(async () => {
    await Deno.mkdir(`${testDir}/src`, { recursive: true });
    await Deno.mkdir(`${testDir}/tests`, { recursive: true });
    await Deno.mkdir(`${testDir}/docs`, { recursive: true });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("glob - file discovery", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/main.ts`, "// main");
      await Deno.writeTextFile(`${testDir}/src/utils.ts`, "// utils");
      await Deno.writeTextFile(`${testDir}/src/types.ts`, "// types");
      await Deno.writeTextFile(`${testDir}/tests/main.test.ts`, "// test");
      await Deno.writeTextFile(`${testDir}/README.md`, "# README");
    });

    it("finds files matching pattern", async () => {
      const files = await glob("**/*.ts", { cwd: testDir }).collect();

      assertEquals(files.length, 4); // main, utils, types, main.test
      assertEquals(files.every(f => f.path.endsWith(".ts")), true);
    });

    it("finds files in specific directory", async () => {
      const files = await glob("src/*.ts", { cwd: testDir }).collect();

      assertEquals(files.length, 3);
      assertEquals(files.every(f => f.path.includes("/src/")), true);
    });

    it("returns File objects with metadata", async () => {
      const files = await glob("*.md", { cwd: testDir }).collect();

      assertEquals(files.length, 1);
      const file = files[0]!;
      assertEquals(typeof file.path, "string");
      assertEquals(typeof file.base, "string");
      assertEquals(typeof file.contents, "string");
      assertEquals(file.stat !== undefined, true);
    });
  });

  describe("glob with filter - file filtering", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/small.ts`, "x");
      await Deno.writeTextFile(`${testDir}/src/medium.ts`, "x".repeat(100));
      await Deno.writeTextFile(`${testDir}/src/large.ts`, "x".repeat(1000));
    });

    it("filters files by size", async () => {
      const largeFiles = await glob("src/*.ts", { cwd: testDir })
        .filter(file => {
          return file.stat ? file.stat.size > 500 : false;
        })
        .collect();

      assertEquals(largeFiles.length, 1);
      assertStringIncludes(largeFiles[0]!.path, "large.ts");
    });

    it("filters files by name pattern", async () => {
      const files = await glob("src/*.ts", { cwd: testDir })
        .filter(file => file.path.includes("medium"))
        .collect();

      assertEquals(files.length, 1);
      assertStringIncludes(files[0]!.path, "medium.ts");
    });

    it("filters files by content", async () => {
      await Deno.writeTextFile(`${testDir}/src/hasError.ts`, "throw new Error()");
      await Deno.writeTextFile(`${testDir}/src/noError.ts`, "console.log('ok')");

      const filesWithError = await glob("src/*.ts", { cwd: testDir })
        .filter(file => {
          const content = typeof file.contents === "string"
            ? file.contents
            : new TextDecoder().decode(file.contents);
          return content.includes("Error");
        })
        .collect();

      assertEquals(filesWithError.length >= 1, true);
      const hasErrorFile = filesWithError.find(f => f.path.includes("hasError"));
      assertEquals(hasErrorFile !== undefined, true);
    });

    it("supports async filter predicates", async () => {
      const files = await glob("src/*.ts", { cwd: testDir })
        .filter(async (file) => {
          await Promise.resolve(); // Simulate async check
          return file.path.includes("small");
        })
        .collect();

      assertEquals(files.length, 1);
    });
  });

  describe("glob with map - file transformation", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/a.ts`, "content a");
      await Deno.writeTextFile(`${testDir}/src/b.ts`, "content b");
    });

    it("extracts file paths", async () => {
      const paths = await glob("src/*.ts", { cwd: testDir })
        .map(file => file.path)
        .collect();

      assertEquals(paths.length, 2);
      assertEquals(paths.every(p => typeof p === "string"), true);
      assertEquals(paths.every(p => p.endsWith(".ts")), true);
    });

    it("extracts file names", async () => {
      const names = await glob("src/*.ts", { cwd: testDir })
        .map(file => file.path.split("/").pop()!)
        .collect();

      assertEquals(names.length, 2);
      assertEquals(names.includes("a.ts"), true);
      assertEquals(names.includes("b.ts"), true);
    });

    it("transforms file contents", async () => {
      const upperContents = await glob("src/*.ts", { cwd: testDir })
        .map(file => {
          const content = typeof file.contents === "string"
            ? file.contents
            : new TextDecoder().decode(file.contents);
          return content.toUpperCase();
        })
        .collect();

      assertEquals(upperContents.length, 2);
      assertEquals(upperContents.every(c => c === c.toUpperCase()), true);
    });

    it("creates new File objects with modified contents", async () => {
      const modified = await glob("src/*.ts", { cwd: testDir })
        .map(file => {
          const content = typeof file.contents === "string"
            ? file.contents
            : new TextDecoder().decode(file.contents);
          return {
            ...file,
            contents: content.toUpperCase(),
          };
        })
        .collect();

      assertEquals(modified.length, 2);
      assertEquals(typeof modified[0]!.contents, "string");
      assertStringIncludes(modified[0]!.contents as string, "CONTENT");
    });

    it("supports async transformations", async () => {
      const transformed = await glob("src/*.ts", { cwd: testDir })
        .map(async (file) => {
          await Promise.resolve(); // Simulate async work
          return file.path;
        })
        .collect();

      assertEquals(transformed.length, 2);
    });
  });

  describe("glob with head/tail", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 10; i++) {
        await Deno.writeTextFile(`${testDir}/src/file${i}.ts`, `// file ${i}`);
      }
    });

    it("takes first n files", async () => {
      const first3 = await glob("src/*.ts", { cwd: testDir })
        .head(3)
        .collect();

      assertEquals(first3.length, 3);
    });

    it("takes last n files", async () => {
      const last2 = await glob("src/*.ts", { cwd: testDir })
        .tail(2)
        .collect();

      assertEquals(last2.length, 2);
    });

    it("chains head with map", async () => {
      const paths = await glob("src/*.ts", { cwd: testDir })
        .head(5)
        .map(f => f.path.split("/").pop()!)
        .collect();

      assertEquals(paths.length, 5);
    });
  });

  describe("glob with grep - content search", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/component.ts`, "export class Component");
      await Deno.writeTextFile(`${testDir}/src/service.ts`, "export class Service");
      await Deno.writeTextFile(`${testDir}/src/util.ts`, "export function helper()");
    });

    it("filters by file content using grep", async () => {
      const classes = await glob("src/*.ts", { cwd: testDir })
        .filter(file => {
          const content = typeof file.contents === "string"
            ? file.contents
            : new TextDecoder().decode(file.contents);
          return /class/.test(content);
        })
        .collect();

      assertEquals(classes.length, 2);
      assertEquals(
        classes.every(f => {
          const content = typeof f.contents === "string"
            ? f.contents
            : new TextDecoder().decode(f.contents);
          return content.includes("class");
        }),
        true
      );
    });

    it("searches for specific patterns", async () => {
      const exports = await glob("src/*.ts", { cwd: testDir })
        .filter(file => {
          const content = typeof file.contents === "string"
            ? file.contents
            : new TextDecoder().decode(file.contents);
          return content.startsWith("export");
        })
        .collect();

      assertEquals(exports.length, 3); // All files export something
    });
  });

  describe("src - multiple patterns", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/main.ts`, "ts");
      await Deno.writeTextFile(`${testDir}/src/main.js`, "js");
      await Deno.writeTextFile(`${testDir}/docs/guide.md`, "md");
    });

    it("combines multiple glob patterns", async () => {
      const files = await src(
        { cwd: testDir },
        "src/*.ts",
        "src/*.js"
      ).collect();

      assertEquals(files.length, 2);
    });

    it("finds files across different directories", async () => {
      const files = await src(
        { cwd: testDir },
        "src/*",
        "docs/*"
      ).collect();

      assertEquals(files.length, 3);
    });

    it("applies transformations to all matched files", async () => {
      const paths = await src(
        { cwd: testDir },
        "src/*.ts",
        "docs/*.md"
      )
        .map(f => f.path.split("/").pop()!)
        .collect();

      assertEquals(paths.length, 2);
      assertEquals(paths.includes("main.ts"), true);
      assertEquals(paths.includes("guide.md"), true);
    });
  });

  describe("chaining complex operations", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/large1.ts`, "x".repeat(500));
      await Deno.writeTextFile(`${testDir}/src/large2.ts`, "y".repeat(600));
      await Deno.writeTextFile(`${testDir}/src/small.ts`, "z");
      await Deno.writeTextFile(`${testDir}/src/component.tsx`, "tsx content");
    });

    it("chains filter, map, and head", async () => {
      const result = await glob("src/*.ts", { cwd: testDir })
        .filter(f => f.stat ? f.stat.size > 100 : false)
        .map(f => f.path.split("/").pop()!)
        .head(1)
        .collect();

      assertEquals(result.length, 1);
      assertEquals(typeof result[0], "string");
    });

    it("processes and transforms file contents", async () => {
      const processed = await glob("src/*.ts", { cwd: testDir })
        .filter(f => {
          const content = typeof f.contents === "string"
            ? f.contents
            : "";
          return content.length < 100;
        })
        .map(f => {
          const content = typeof f.contents === "string"
            ? f.contents
            : new TextDecoder().decode(f.contents);
          return {
            name: f.path.split("/").pop()!,
            size: content.length,
          };
        })
        .collect();

      assertEquals(processed.length, 1);
      assertEquals(processed[0]!.name, "small.ts");
    });

    it("finds and extracts specific files", async () => {
      const tsxFiles = await glob("src/**/*.tsx", { cwd: testDir })
        .map(f => ({
          path: f.path,
          content: typeof f.contents === "string"
            ? f.contents
            : new TextDecoder().decode(f.contents),
        }))
        .collect();

      assertEquals(tsxFiles.length, 1);
      assertEquals(tsxFiles[0]!.content, "tsx content");
    });
  });

  describe("terminal operations", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/a.ts`, "a");
      await Deno.writeTextFile(`${testDir}/src/b.ts`, "b");
      await Deno.writeTextFile(`${testDir}/src/c.ts`, "c");
    });

    it("collect() returns all files", async () => {
      const files = await glob("src/*.ts", { cwd: testDir }).collect();

      assertEquals(Array.isArray(files), true);
      assertEquals(files.length, 3);
    });

    it("first() returns first file", async () => {
      const first = await glob("src/*.ts", { cwd: testDir }).first();

      assertEquals(first !== undefined, true);
      assertEquals(typeof first!.path, "string");
    });

    it("count() returns file count", async () => {
      const count = await glob("src/*.ts", { cwd: testDir }).count();

      assertEquals(count, 3);
    });

    it("forEach() processes each file", async () => {
      const paths: string[] = [];

      await glob("src/*.ts", { cwd: testDir }).forEach(file => {
        paths.push(file.path);
      });

      assertEquals(paths.length, 3);
    });
  });

  describe("working with binary files", () => {
    beforeEach(async () => {
      // Create binary files
      await Deno.writeFile(`${testDir}/src/image1.png`, new Uint8Array([0x89, 0x50, 0x4E, 0x47]));
      await Deno.writeFile(`${testDir}/src/image2.png`, new Uint8Array([0x89, 0x50, 0x4E, 0x47]));
    });

    it("handles binary files", async () => {
      const images = await glob("src/*.png", { cwd: testDir }).collect();

      assertEquals(images.length, 2);
      assertEquals(images.every(f => f.contents instanceof Uint8Array), true);
    });

    it("filters binary files by size", async () => {
      const small = await glob("src/*.png", { cwd: testDir })
        .filter(f => {
          const size = f.contents instanceof Uint8Array
            ? f.contents.length
            : f.contents.length;
          return size < 100;
        })
        .collect();

      assertEquals(small.length, 2);
    });
  });

  describe("exclude patterns", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/main.ts`, "main");
      await Deno.writeTextFile(`${testDir}/src/main.test.ts`, "test");
      await Deno.writeTextFile(`${testDir}/src/utils.ts`, "utils");
      await Deno.writeTextFile(`${testDir}/src/utils.test.ts`, "test");
    });

    it("excludes test files", async () => {
      const nonTests = await glob("src/**/*.ts", {
        cwd: testDir,
        exclude: ["**/*.test.ts"],
      }).collect();

      assertEquals(nonTests.length, 2);
      assertEquals(nonTests.every(f => !f.path.includes(".test.")), true);
    });

    it("combines exclude with filter", async () => {
      const filtered = await glob("src/**/*.ts", {
        cwd: testDir,
        exclude: ["**/*.test.ts"],
      })
        .filter(f => f.path.includes("main"))
        .collect();

      assertEquals(filtered.length, 1);
      assertStringIncludes(filtered[0]!.path, "main.ts");
    });
  });

  describe("async iteration", () => {
    beforeEach(async () => {
      await Deno.writeTextFile(`${testDir}/src/a.ts`, "a");
      await Deno.writeTextFile(`${testDir}/src/b.ts`, "b");
    });

    it("supports for-await-of", async () => {
      const paths: string[] = [];

      for await (const file of glob("src/*.ts", { cwd: testDir })) {
        paths.push(file.path);
      }

      assertEquals(paths.length, 2);
    });

    it("supports manual iteration", async () => {
      const stream = glob("src/*.ts", { cwd: testDir });
      const iterator = stream[Symbol.asyncIterator]();

      const first = await iterator.next();
      assertEquals(first.done, false);
      assertEquals(typeof first.value.path, "string");
    });
  });
});
