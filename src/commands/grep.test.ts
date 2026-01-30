/**
 * Tests for Grep Command
 *
 * Tests for the refactored grep implementation, focusing on:
 * - Pure functions (buildRegex, testLine, getMatches)
 * - Core grep transform
 * - Stream transforms (grepTransform, grepLines)
 * - Formatting functions
 * - Multi-file support
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  buildRegex,
  formatGrepMatch,
  getMatches,
  grep,
  grepFormat,
  grepLines,
  grepMultiple,
  grepStream,
  grepTransform,
  testLine,
  type GrepMatch,
} from "./grep.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create an async iterable from an array of strings
 */
async function* arrayToAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/**
 * Collect all items from an async iterable into an array
 */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

// =============================================================================
// Tests for Pure Functions (buildRegex, testLine, getMatches)
// =============================================================================

Deno.test("buildRegex() - creates regex from string pattern", () => {
  const regex = buildRegex("test");
  assertEquals(regex instanceof RegExp, true);
  assertEquals(regex.test("test"), true);
  assertEquals(regex.test("TEST"), false);
});

Deno.test("buildRegex() - handles case insensitive flag", () => {
  const regex = buildRegex("test", { ignoreCase: true });
  regex.lastIndex = 0;
  assertEquals(regex.test("test"), true);
  regex.lastIndex = 0;
  assertEquals(regex.test("TEST"), true);
  regex.lastIndex = 0;
  assertEquals(regex.test("TeSt"), true);
});

Deno.test("buildRegex() - handles fixed strings (literal matching)", () => {
  const regex = buildRegex(".*test", { fixedStrings: true });
  regex.lastIndex = 0;
  assertEquals(regex.test(".*test"), true);
  regex.lastIndex = 0;
  assertEquals(regex.test("any text test"), false); // Should NOT match as regex
});

Deno.test("buildRegex() - handles whole word matching", () => {
  const regex = buildRegex("word", { wholeWord: true });
  regex.lastIndex = 0;
  assertEquals(regex.test("word"), true);
  regex.lastIndex = 0;
  assertEquals(regex.test("a word here"), true);
  regex.lastIndex = 0;
  assertEquals(regex.test("keyword"), false);
  regex.lastIndex = 0;
  assertEquals(regex.test("words"), false);
});

Deno.test("buildRegex() - handles whole line matching", () => {
  const regex = buildRegex("exact", { wholeLine: true });
  assertEquals(regex.test("exact"), true);
  assertEquals(regex.test("exact match"), false);
  assertEquals(regex.test("not exact"), false);
});

Deno.test("buildRegex() - adds global flag to existing RegExp", () => {
  const original = /test/i;
  const result = buildRegex(original);
  // Should add global flag for getMatches()
  assertEquals(result.source, original.source);
  assertEquals(result.flags.includes("i"), true);
  assertEquals(result.flags.includes("g"), true);
});

Deno.test("buildRegex() - adds case insensitive flag to existing RegExp", () => {
  const original = /test/;
  const result = buildRegex(original, { ignoreCase: true });
  assertEquals(result.test("TEST"), true);
  assertEquals(result.flags.includes("i"), true);
});

Deno.test("testLine() - matches line against regex", () => {
  const regex = /error/;
  assertEquals(testLine("error occurred", regex, false), true);
  assertEquals(testLine("success", regex, false), false);
});

Deno.test("testLine() - handles inverted matching", () => {
  const regex = /error/;
  assertEquals(testLine("error occurred", regex, true), false);
  assertEquals(testLine("success", regex, true), true);
});

Deno.test("getMatches() - extracts all matches from a line", () => {
  const regex = /\d+/g;
  const matches = getMatches("Port 8080 and 9090", regex);
  assertEquals(matches, ["8080", "9090"]);
});

Deno.test("getMatches() - handles no matches", () => {
  const regex = /\d+/g;
  const matches = getMatches("no numbers here", regex);
  assertEquals(matches, []);
});

Deno.test("getMatches() - handles multiple word matches", () => {
  const regex = /\w+/g;
  const matches = getMatches("hello world test", regex);
  assertEquals(matches, ["hello", "world", "test"]);
});

// =============================================================================
// Tests for Core grep() Function
// =============================================================================

Deno.test("grep() - basic pattern matching", async () => {
  const input = arrayToAsyncIterable(["error", "success", "error again", "done"]);
  const results = await collect(grep(/error/, input));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "error");
  assertEquals(results[1]!.line, "error again");
});

Deno.test("grep() - includes line numbers", async () => {
  const input = arrayToAsyncIterable(["line1", "error", "line3"]);
  const results = await collect(grep(/error/, input));

  assertEquals(results.length, 1);
  assertEquals(results[0]!.lineNumber, 2);
});

Deno.test("grep() - case insensitive matching", async () => {
  const input = arrayToAsyncIterable(["ERROR", "error", "ErRoR", "success"]);
  const results = await collect(grep("error", input, { ignoreCase: true }));

  assertEquals(results.length, 3);
});

Deno.test("grep() - inverted matching", async () => {
  const input = arrayToAsyncIterable(["error", "success", "warning"]);
  const results = await collect(grep(/error/, input, { invertMatch: true }));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "success");
  assertEquals(results[1]!.line, "warning");
});

Deno.test("grep() - count only mode", async () => {
  const input = arrayToAsyncIterable(["error", "success", "error", "warning"]);
  const results = await collect(grep(/error/, input, { countOnly: true }));

  assertEquals(results.length, 1);
  assertEquals(results[0]!.line, "2");
  assertEquals(results[0]!.lineNumber, 0);
});

Deno.test("grep() - max count limit", async () => {
  const input = arrayToAsyncIterable([
    "error1",
    "error2",
    "error3",
    "error4",
  ]);
  const results = await collect(grep(/error/, input, { maxCount: 2 }));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "error1");
  assertEquals(results[1]!.line, "error2");
});

Deno.test("grep() - only matching parts", async () => {
  const input = arrayToAsyncIterable(["error: 123", "warning: 456"]);
  const results = await collect(grep(/\d+/, input, { onlyMatching: true }));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "123");
  assertEquals(results[1]!.line, "456");
});

Deno.test("grep() - files with matches mode", async () => {
  const input = arrayToAsyncIterable(["success", "error", "done"]);
  const results = await collect(
    grep(/error/, input, { filesWithMatches: true, filename: "test.log" }),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0]!.line, "test.log");
  assertEquals(results[0]!.lineNumber, 0);
});

Deno.test("grep() - files without match mode", async () => {
  const input = arrayToAsyncIterable(["success", "done"]);
  const results = await collect(
    grep(/error/, input, { filesWithoutMatch: true, filename: "test.log" }),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0]!.line, "test.log");
});

Deno.test("grep() - context after matches", async () => {
  const input = arrayToAsyncIterable([
    "line1",
    "error",
    "context1",
    "context2",
    "line5",
  ]);
  const results = await collect(grep(/error/, input, { afterContext: 2 }));

  assertEquals(results.length, 3);
  assertEquals(results[0]!.line, "error");
  assertEquals(results[0]!.isContext, undefined);
  assertEquals(results[1]!.line, "context1");
  assertEquals(results[1]!.isContext, true);
  assertEquals(results[2]!.line, "context2");
  assertEquals(results[2]!.isContext, true);
});

Deno.test("grep() - context before matches", async () => {
  const input = arrayToAsyncIterable([
    "line1",
    "context1",
    "context2",
    "error",
    "line5",
  ]);
  const results = await collect(grep(/error/, input, { beforeContext: 2 }));

  assertEquals(results.length, 3);
  assertEquals(results[0]!.line, "context1");
  assertEquals(results[0]!.isContext, true);
  assertEquals(results[1]!.line, "context2");
  assertEquals(results[1]!.isContext, true);
  assertEquals(results[2]!.line, "error");
  assertEquals(results[2]!.isContext, undefined);
});

Deno.test("grep() - combined context (before and after)", async () => {
  const input = arrayToAsyncIterable([
    "before1",
    "before2",
    "error",
    "after1",
    "after2",
  ]);
  const results = await collect(grep(/error/, input, { context: 2 }));

  assertEquals(results.length, 5);
  assertEquals(results[0]!.line, "before1");
  assertEquals(results[2]!.line, "error");
  assertEquals(results[4]!.line, "after2");
});

// =============================================================================
// Tests for Stream Transforms
// =============================================================================

Deno.test("grepTransform() - works as a transform function", async () => {
  const input = arrayToAsyncIterable(["error", "success", "error again"]);
  const transform = grepTransform(/error/);
  const results = await collect(transform(input));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "error");
  assertEquals(results[1]!.line, "error again");
});

Deno.test("grepTransform() - passes options correctly", async () => {
  const input = arrayToAsyncIterable(["ERROR", "success", "error"]);
  const transform = grepTransform("error", { ignoreCase: true });
  const results = await collect(transform(input));

  assertEquals(results.length, 2);
});

Deno.test("grepLines() - returns matching lines as strings", async () => {
  const input = arrayToAsyncIterable(["error", "success", "error again"]);
  const transform = grepLines(/error/);
  const results = await collect(transform(input));

  assertEquals(results.length, 2);
  assertEquals(results[0], "error");
  assertEquals(results[1], "error again");
});

Deno.test("grepLines() - handles case insensitive option", async () => {
  const input = arrayToAsyncIterable(["ERROR", "success", "error"]);
  const transform = grepLines("error", { ignoreCase: true });
  const results = await collect(transform(input));

  assertEquals(results.length, 2);
  assertEquals(results[0], "ERROR");
  assertEquals(results[1], "error");
});

// =============================================================================
// Tests for Formatting Functions
// =============================================================================

Deno.test("formatGrepMatch() - formats basic match", () => {
  const match: GrepMatch = { line: "error occurred", lineNumber: 42 };
  const formatted = formatGrepMatch(match);
  assertEquals(formatted, "error occurred");
});

Deno.test("formatGrepMatch() - includes line numbers", () => {
  const match: GrepMatch = { line: "error occurred", lineNumber: 42 };
  const formatted = formatGrepMatch(match, { showLineNumbers: true });
  assertEquals(formatted, "42:error occurred");
});

Deno.test("formatGrepMatch() - includes filename and line number", () => {
  const match: GrepMatch = {
    line: "error occurred",
    lineNumber: 42,
    filename: "app.ts",
  };
  const formatted = formatGrepMatch(match, {
    showLineNumbers: true,
    showFilename: true,
  });
  assertEquals(formatted, "app.ts:42:error occurred");
});

Deno.test("formatGrepMatch() - handles context lines with dash separator", () => {
  const match: GrepMatch = {
    line: "context line",
    lineNumber: 41,
    isContext: true,
    filename: "app.ts",
  };
  const formatted = formatGrepMatch(match, {
    showLineNumbers: true,
    showFilename: true,
  });
  assertEquals(formatted, "app.ts:41-context line");
});

Deno.test("formatGrepMatch() - handles separator lines", () => {
  const match: GrepMatch = { line: "--", lineNumber: 0, isSeparator: true };
  const formatted = formatGrepMatch(match);
  assertEquals(formatted, "--");
});

Deno.test("grepFormat() - transforms GrepMatch to formatted strings", async () => {
  const input = arrayToAsyncIterable<GrepMatch>([
    { line: "error1", lineNumber: 1 },
    { line: "error2", lineNumber: 5 },
  ]);
  const transform = grepFormat({ showLineNumbers: true });
  const results = await collect(transform(input));

  assertEquals(results.length, 2);
  assertEquals(results[0], "1:error1");
  assertEquals(results[1], "5:error2");
});

// =============================================================================
// Tests for Convenience Functions
// =============================================================================

Deno.test("grepStream() - creates a Stream from grep results", async () => {
  const input = arrayToAsyncIterable(["error", "success", "error again"]);
  const stream = grepStream(/error/, input);

  assertExists(stream);
  assertExists(stream.pipe);

  const results = await stream.collect();
  assertEquals(results.length, 2);
});

Deno.test("grepMultiple() - processes multiple sources", async () => {
  const sources: Array<[string, AsyncIterable<string>]> = [
    ["file1.txt", arrayToAsyncIterable(["error in file1", "success"])],
    ["file2.txt", arrayToAsyncIterable(["success", "error in file2"])],
  ];

  const results = await collect(grepMultiple(/error/, sources));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.filename, "file1.txt");
  assertEquals(results[0]!.line, "error in file1");
  assertEquals(results[1]!.filename, "file2.txt");
  assertEquals(results[1]!.line, "error in file2");
});

Deno.test("grepMultiple() - preserves line numbers per file", async () => {
  const sources: Array<[string, AsyncIterable<string>]> = [
    ["file1.txt", arrayToAsyncIterable(["line1", "error", "line3"])],
    ["file2.txt", arrayToAsyncIterable(["line1", "line2", "error"])],
  ];

  const results = await collect(grepMultiple(/error/, sources));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.lineNumber, 2);
  assertEquals(results[1]!.lineNumber, 3);
});

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test("grep() - complex pattern with multiple options", async () => {
  const input = arrayToAsyncIterable([
    "TODO: fix this",
    "todo: review",
    "FIXME: urgent",
    "done",
    "TODO: later",
  ]);

  const results = await collect(
    grep("todo", input, {
      ignoreCase: true,
      maxCount: 2,
    }),
  );

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "TODO: fix this");
  assertEquals(results[1]!.line, "todo: review");
});

Deno.test("grep() - whole word matching works correctly", async () => {
  const input = arrayToAsyncIterable([
    "test",
    "testing",
    "a test here",
    "contest",
  ]);

  const results = await collect(grep("test", input, { wholeWord: true }));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "test");
  assertEquals(results[1]!.line, "a test here");
});

Deno.test("grep() - fixed strings escapes regex special chars", async () => {
  const input = arrayToAsyncIterable([
    "cost is $100",
    "price is 100",
    "$100 total",
  ]);

  const results = await collect(grep("$100", input, { fixedStrings: true }));

  assertEquals(results.length, 2);
  assertEquals(results[0]!.line, "cost is $100");
  assertEquals(results[1]!.line, "$100 total");
});
