/**
 * Tests for stdlib/text.ts
 */

import { assertEquals, assertArrayIncludes } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import * as text from "../src/stdlib/text.ts";
import { REAL_TMP } from "./helpers.ts";

const testDir = `${REAL_TMP}/safesh-text-test`;

describe("text", () => {
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

  describe("grep", () => {
    const content = `line 1: hello
line 2: world
line 3: hello world
line 4: foo
line 5: HELLO`;

    it("finds matching lines", () => {
      const matches = text.grep(/hello/, content);

      assertEquals(matches.length, 2);
      assertEquals(matches[0]!.line, 1);
      assertEquals(matches[0]!.content, "line 1: hello");
      assertEquals(matches[0]!.match, "hello");
    });

    it("supports case insensitive matching", () => {
      const matches = text.grep(/hello/, content, { ignoreCase: true });

      assertEquals(matches.length, 3);
    });

    it("supports string patterns", () => {
      const matches = text.grep("world", content);

      assertEquals(matches.length, 2);
    });

    it("respects limit option", () => {
      const matches = text.grep(/hello/, content, { limit: 1 });

      assertEquals(matches.length, 1);
    });

    it("supports invert option", () => {
      const matches = text.grep(/hello/i, content, { invert: true });

      assertEquals(matches.length, 2);
      assertEquals(matches[0]!.content, "line 2: world");
    });

    it("captures groups", () => {
      const matches = text.grep(/line (\d+): (.+)/, content);

      assertEquals(matches[0]!.groups, ["1", "hello"]);
    });

    it("supports unique option", () => {
      const dupes = "error\nerror\nwarning\nerror";
      const matches = text.grep(/error/, dupes, { unique: true });

      assertEquals(matches.length, 1);
    });
  });

  describe("grepFiles", () => {
    beforeEach(async () => {
      await Deno.mkdir(`${testDir}/src`, { recursive: true });
      await Deno.writeTextFile(`${testDir}/src/a.ts`, "// TODO: fix this\nconst x = 1;");
      await Deno.writeTextFile(`${testDir}/src/b.ts`, "// normal code\n// TODO: refactor");
    });

    it("greps across multiple files", async () => {
      const matches = await text.grepFiles(/TODO/, `${testDir}/src/*.ts`);

      assertEquals(matches.length, 2);
      assertEquals(matches.every((m) => m.path !== undefined), true);
    });

    it("respects limit across files", async () => {
      const matches = await text.grepFiles(/TODO/, `${testDir}/src/*.ts`, { limit: 1 });

      assertEquals(matches.length, 1);
    });
  });

  describe("head", () => {
    const lines = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12";

    it("returns first 10 lines by default", () => {
      const result = text.head(lines);
      assertEquals(result.length, 10);
      assertEquals(result[0], "1");
      assertEquals(result[9], "10");
    });

    it("returns first N lines", () => {
      const result = text.head(lines, 3);
      assertEquals(result, ["1", "2", "3"]);
    });
  });

  describe("headFile", () => {
    it("reads first N lines from file", async () => {
      await Deno.writeTextFile(`${testDir}/lines.txt`, "a\nb\nc\nd\ne");

      const result = await text.headFile(`${testDir}/lines.txt`, 3);
      assertEquals(result, ["a", "b", "c"]);
    });
  });

  describe("tail", () => {
    const lines = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12";

    it("returns last 10 lines by default", () => {
      const result = text.tail(lines);
      assertEquals(result.length, 10);
      assertEquals(result[0], "3");
      assertEquals(result[9], "12");
    });

    it("returns last N lines", () => {
      const result = text.tail(lines, 3);
      assertEquals(result, ["10", "11", "12"]);
    });
  });

  describe("replace", () => {
    it("replaces single occurrence", () => {
      const result = text.replace("hello world", "world", "universe");
      assertEquals(result, "hello universe");
    });

    it("replaces with regex", () => {
      const result = text.replace("hello world", /world/g, "universe");
      assertEquals(result, "hello universe");
    });

    it("supports capture groups", () => {
      const result = text.replace("hello world", /(\w+) (\w+)/, "$2 $1");
      assertEquals(result, "world hello");
    });
  });

  describe("replaceFile", () => {
    it("replaces in file", async () => {
      await Deno.writeTextFile(`${testDir}/replace.txt`, "old value");
      await text.replaceFile(`${testDir}/replace.txt`, "old", "new");

      const content = await Deno.readTextFile(`${testDir}/replace.txt`);
      assertEquals(content, "new value");
    });
  });

  describe("replaceInFiles", () => {
    beforeEach(async () => {
      await Deno.mkdir(`${testDir}/replace`, { recursive: true });
      await Deno.writeTextFile(`${testDir}/replace/a.txt`, "foo bar");
      await Deno.writeTextFile(`${testDir}/replace/b.txt`, "bar baz");
    });

    it("replaces across multiple files", async () => {
      const count = await text.replaceInFiles(`${testDir}/replace/*.txt`, /bar/g, "qux");

      assertEquals(count, 2);

      const a = await Deno.readTextFile(`${testDir}/replace/a.txt`);
      const b = await Deno.readTextFile(`${testDir}/replace/b.txt`);
      assertEquals(a, "foo qux");
      assertEquals(b, "qux baz");
    });

    it("returns count of modified files", async () => {
      const count = await text.replaceInFiles(`${testDir}/replace/*.txt`, "foo", "xyz");

      assertEquals(count, 1);
    });
  });

  describe("lines", () => {
    it("splits text into lines", () => {
      const result = text.lines("a\nb\nc");
      assertEquals(result, ["a", "b", "c"]);
    });
  });

  describe("joinLines", () => {
    it("joins lines with newline", () => {
      const result = text.joinLines(["a", "b", "c"]);
      assertEquals(result, "a\nb\nc");
    });

    it("uses custom separator", () => {
      const result = text.joinLines(["a", "b", "c"], ", ");
      assertEquals(result, "a, b, c");
    });
  });

  describe("count", () => {
    it("counts lines, words, chars", () => {
      const result = text.count("hello world\nfoo bar\nbaz");

      assertEquals(result.lines, 3);
      assertEquals(result.words, 5);
      assertEquals(result.chars, 23);
    });

    it("counts bytes for UTF-8", () => {
      const result = text.count("héllo");

      assertEquals(result.chars, 5);
      assertEquals(result.bytes, 6); // é is 2 bytes in UTF-8
    });
  });

  describe("sort", () => {
    it("sorts lines alphabetically", () => {
      const result = text.sort("c\na\nb");
      assertEquals(result, ["a", "b", "c"]);
    });

    it("sorts numerically", () => {
      const result = text.sort("10\n2\n1\n20", { numeric: true });
      assertEquals(result, ["1", "2", "10", "20"]);
    });

    it("sorts in reverse", () => {
      const result = text.sort("a\nb\nc", { reverse: true });
      assertEquals(result, ["c", "b", "a"]);
    });

    it("removes duplicates", () => {
      const result = text.sort("a\nb\na\nc\nb", { unique: true });
      assertEquals(result, ["a", "b", "c"]);
    });

    it("supports case insensitive", () => {
      const result = text.sort("B\na\nA\nb", { ignoreCase: true, unique: true });
      assertEquals(result.length, 2);
    });
  });

  describe("uniq", () => {
    it("removes duplicates preserving order", () => {
      const result = text.uniq("a\nb\na\nc\nb");
      assertEquals(result, ["a", "b", "c"]);
    });

    it("counts occurrences", () => {
      const result = text.uniq("a\nb\na\nc\nb\nb", { count: true }) as { line: string; count: number }[];

      assertEquals(result.find((r) => r.line === "a")?.count, 2);
      assertEquals(result.find((r) => r.line === "b")?.count, 3);
      assertEquals(result.find((r) => r.line === "c")?.count, 1);
    });

    it("supports case insensitive", () => {
      const result = text.uniq("A\na\nB\nb", { ignoreCase: true });
      assertEquals(result.length, 2);
    });
  });

  describe("cut", () => {
    const csv = "name,age,city\nalice,30,paris\nbob,25,london";

    it("extracts fields by delimiter", () => {
      const result = text.cut(csv, { delimiter: ",", fields: [1, 3] });

      assertEquals(result[0], "name,city");
      assertEquals(result[1], "alice,paris");
      assertEquals(result[2], "bob,london");
    });

    it("extracts characters", () => {
      const result = text.cut("hello\nworld", { characters: [1, 2, 3] });

      assertEquals(result[0], "hel");
      assertEquals(result[1], "wor");
    });
  });

  describe("diff", () => {
    it("detects additions", () => {
      const result = text.diff("a\nb", "a\nb\nc");

      const added = result.filter((r) => r.type === "added");
      assertEquals(added.length, 1);
      assertEquals(added[0]!.content, "c");
    });

    it("detects removals", () => {
      const result = text.diff("a\nb\nc", "a\nc");

      const removed = result.filter((r) => r.type === "removed");
      assertEquals(removed.length, 1);
      assertEquals(removed[0]!.content, "b");
    });

    it("detects unchanged lines", () => {
      const result = text.diff("a\nb\nc", "a\nb\nd");

      const unchanged = result.filter((r) => r.type === "unchanged");
      assertEquals(unchanged.length, 2);
    });
  });

  describe("diffFiles", () => {
    it("diffs two files", async () => {
      await Deno.writeTextFile(`${testDir}/old.txt`, "a\nb\nc");
      await Deno.writeTextFile(`${testDir}/new.txt`, "a\nx\nc");

      const result = await text.diffFiles(`${testDir}/old.txt`, `${testDir}/new.txt`);

      const removed = result.filter((r) => r.type === "removed");
      const added = result.filter((r) => r.type === "added");

      assertEquals(removed.length, 1);
      assertEquals(removed[0]!.content, "b");
      assertEquals(added.length, 1);
      assertEquals(added[0]!.content, "x");
    });
  });

  describe("trim", () => {
    it("trims both sides by default", () => {
      const result = text.trim("  hello  \n  world  ");
      assertEquals(result, ["hello", "world"]);
    });

    it("trims left only", () => {
      const result = text.trim("  hello  ", "left");
      assertEquals(result, "hello  ");
    });

    it("trims right only", () => {
      const result = text.trim("  hello  ", "right");
      assertEquals(result, "  hello");
    });

    it("returns string for single-line input", () => {
      const result = text.trim("  hello  ");
      assertEquals(result, "hello");
    });

    it("returns array for array input", () => {
      const result = text.trim(["  a  ", "  b  "]);
      assertEquals(result, ["a", "b"]);
    });
  });

  describe("filter", () => {
    it("filters lines by predicate", () => {
      const result = text.filter("a\nbb\nccc", (line) => line.length > 1);
      assertEquals(result, ["bb", "ccc"]);
    });

    it("provides index", () => {
      const result = text.filter("a\nb\nc\nd", (_, i) => i % 2 === 0);
      assertEquals(result, ["a", "c"]);
    });
  });

  describe("map", () => {
    it("transforms lines", () => {
      const result = text.map("a\nb\nc", (line) => line.toUpperCase());
      assertEquals(result, ["A", "B", "C"]);
    });

    it("provides index", () => {
      const result = text.map("a\nb\nc", (line, i) => `${i + 1}: ${line}`);
      assertEquals(result, ["1: a", "2: b", "3: c"]);
    });
  });
});
