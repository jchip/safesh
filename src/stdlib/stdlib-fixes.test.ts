/**
 * Tests for SSH-556 stdlib fixes
 */

import { assertEquals } from "@std/assert";
import { count } from "./text.ts";

// ============== echo interpretEscapes tests ==============

// We can't easily test the private interpretEscapes directly, but we can
// test through echo. Import the echo function:
import { echo } from "./shelljs/echo.ts";

Deno.test("echo escapes - basic sequences", () => {
  const result = echo({ escapes: true, noNewline: true }, "hello\\tworld");
  assertEquals(result.toString(), "hello\tworld");
});

Deno.test("echo escapes - backslash followed by n", () => {
  // \\n should become a literal backslash followed by 'n' -> but in source code
  // the input "\\\\n" represents the string \\n which should become \n (literal backslash + n)
  // Wait - let's think about this more carefully:
  // Input to echo: "hello\\\\nworld" (user typed literal \\n)
  // The string contains: hello\\nworld
  // interpretEscapes sees: \\ then n - the \\\\ should match first producing \, leaving "n"
  // Result: hello\nworld (literal backslash + n, NOT a newline)
  const result = echo({ escapes: true, noNewline: true }, "hello\\\\nworld");
  assertEquals(result.toString(), "hello\\nworld");
});

Deno.test("echo escapes - newline", () => {
  const result = echo({ escapes: true, noNewline: true }, "line1\\nline2");
  assertEquals(result.toString(), "line1\nline2");
});

Deno.test("echo escapes - multiple escape types", () => {
  const result = echo({ escapes: true, noNewline: true }, "a\\tb\\nc");
  assertEquals(result.toString(), "a\tb\nc");
});

Deno.test("echo escapes - hex escape", () => {
  const result = echo({ escapes: true, noNewline: true }, "\\x41");
  assertEquals(result.toString(), "A"); // 0x41 = 'A'
});

Deno.test("echo escapes - octal escape", () => {
  const result = echo({ escapes: true, noNewline: true }, "\\0101");
  assertEquals(result.toString(), "A"); // octal 101 = 65 = 'A'
});

// ============== text.count() line count tests (wc -l compatible) ==============

Deno.test("count() - empty string has 0 lines", () => {
  const result = count("");
  assertEquals(result.lines, 0);
});

Deno.test("count() - single line no trailing newline has 0 lines (wc -l compat)", () => {
  const result = count("hello");
  assertEquals(result.lines, 0);
});

Deno.test("count() - single line with trailing newline has 1 line", () => {
  const result = count("hello\n");
  assertEquals(result.lines, 1);
});

Deno.test("count() - two lines with trailing newline", () => {
  const result = count("hello\nworld\n");
  assertEquals(result.lines, 2);
});

Deno.test("count() - two lines without trailing newline", () => {
  const result = count("hello\nworld");
  assertEquals(result.lines, 1);
});

Deno.test("count() - word count", () => {
  const result = count("hello world foo");
  assertEquals(result.words, 3);
});

Deno.test("count() - char and byte count for ASCII", () => {
  const result = count("abc");
  assertEquals(result.chars, 3);
  assertEquals(result.bytes, 3);
});

// ============== text.grep() capture groups test (g flag removal) ==============

import { grep } from "./text.ts";

Deno.test("grep - returns capture groups correctly", () => {
  const result = grep(/(\w+)=(\w+)/, "name=value\nfoo=bar");
  assertEquals(result.length, 2);
  assertEquals(result[0]!.groups, ["name", "value"]);
  assertEquals(result[1]!.groups, ["foo", "bar"]);
});

Deno.test("grep - user-provided regex with g flag still works correctly", () => {
  const result = grep(/(\w+)=(\w+)/g, "name=value");
  assertEquals(result.length, 1);
  // Should still capture groups despite user passing g flag
  assertEquals(result[0]!.groups, ["name", "value"]);
});

// ============== getGlobBase tests ==============

import { getGlobBase } from "./glob.ts";

Deno.test("getGlobBase - returns base before wildcards", () => {
  assertEquals(getGlobBase("src/**/*.ts"), "src");
});

Deno.test("getGlobBase - returns . for wildcard-only pattern", () => {
  assertEquals(getGlobBase("*.ts"), ".");
});

Deno.test("getGlobBase - returns full path for no wildcards", () => {
  assertEquals(getGlobBase("src/lib/foo.ts"), "src/lib/foo.ts");
});

// ============== command-init resolvePath normalization test ==============
// We can't easily test the private resolvePath, but we verified it in the code.

// ============== dirs resetDirStack test ==============
import { resetDirStack, dirs } from "./shelljs/dirs.ts";

Deno.test("resetDirStack - clears the directory stack", () => {
  resetDirStack();
  const stack = dirs();
  // Should only contain cwd
  assertEquals(stack.length, 1);
  assertEquals(stack[0], Deno.cwd());
});
