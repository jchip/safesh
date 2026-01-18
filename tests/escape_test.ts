/**
 * Tests for string escaping utilities
 */

import { assertEquals } from "@std/assert";
import {
  escapeString,
  escapeForTemplate,
  escapeForQuotes,
  escapeForSingleQuotes,
  escapeRegex,
  type EscapeOptions,
} from "../src/bash/transpiler2/utils/escape.ts";

// ============================================================================
// Base escapeString() Function Tests
// ============================================================================

Deno.test("escapeString - no options returns unchanged string", () => {
  assertEquals(escapeString("hello world"), "hello world");
});

Deno.test("escapeString - escapes backslashes by default", () => {
  assertEquals(escapeString("C:\\path\\to\\file"), "C:\\\\path\\\\to\\\\file");
});

Deno.test("escapeString - can disable backslash escaping", () => {
  const options: EscapeOptions = { escapeBackslashes: false };
  assertEquals(escapeString("C:\\path\\to\\file", options), "C:\\path\\to\\file");
});

Deno.test("escapeString - escapes single quotes", () => {
  const options: EscapeOptions = { quotes: "single" };
  assertEquals(escapeString("it's a test", options), "it\\'s a test");
});

Deno.test("escapeString - escapes double quotes", () => {
  const options: EscapeOptions = { quotes: "double" };
  assertEquals(escapeString('say "hello"', options), 'say \\"hello\\"');
});

Deno.test("escapeString - escapes template literal syntax", () => {
  const options: EscapeOptions = { quotes: "template" };
  assertEquals(
    escapeString("use `backticks` and ${vars}", options),
    "use \\`backticks\\` and \\${vars}",
  );
});

Deno.test("escapeString - escapes newlines when requested", () => {
  const options: EscapeOptions = { escapeNewlines: true };
  assertEquals(escapeString("line1\nline2\rline3\ttab", options), "line1\\nline2\\rline3\\ttab");
});

Deno.test("escapeString - combines backslash and quote escaping", () => {
  const options: EscapeOptions = { quotes: "single" };
  assertEquals(escapeString("path\\to\\'file'", options), "path\\\\to\\\\\\'file\\'");
});

Deno.test("escapeString - combines all options", () => {
  const options: EscapeOptions = {
    quotes: "double",
    escapeNewlines: true,
    escapeBackslashes: true,
  };
  assertEquals(
    escapeString('C:\\path\n"quoted"', options),
    'C:\\\\path\\n\\"quoted\\"',
  );
});

// ============================================================================
// Convenience Function Tests
// ============================================================================

Deno.test("escapeForTemplate - escapes backticks and dollar signs", () => {
  assertEquals(
    escapeForTemplate("use `backticks` and ${vars} plus $dollar"),
    "use \\`backticks\\` and \\${vars} plus \\$dollar",
  );
});

Deno.test("escapeForTemplate - escapes backslashes", () => {
  assertEquals(
    escapeForTemplate("C:\\path\\to\\file"),
    "C:\\\\path\\\\to\\\\file",
  );
});

Deno.test("escapeForTemplate - does not escape newlines", () => {
  assertEquals(escapeForTemplate("line1\nline2"), "line1\nline2");
});

Deno.test("escapeForQuotes - escapes double quotes and newlines", () => {
  assertEquals(
    escapeForQuotes('say "hello"\nworld'),
    'say \\"hello\\"\\nworld',
  );
});

Deno.test("escapeForQuotes - escapes backslashes", () => {
  assertEquals(
    escapeForQuotes("C:\\path\\to\\file"),
    "C:\\\\path\\\\to\\\\file",
  );
});

Deno.test("escapeForQuotes - escapes tabs and carriage returns", () => {
  assertEquals(
    escapeForQuotes("tab\there\rcarriage"),
    "tab\\there\\rcarriage",
  );
});

Deno.test("escapeForSingleQuotes - escapes single quotes", () => {
  assertEquals(
    escapeForSingleQuotes("it's a test with 'quotes'"),
    "it\\'s a test with \\'quotes\\'",
  );
});

Deno.test("escapeForSingleQuotes - escapes backslashes", () => {
  assertEquals(
    escapeForSingleQuotes("C:\\path\\to\\file"),
    "C:\\\\path\\\\to\\\\file",
  );
});

Deno.test("escapeForSingleQuotes - does not escape newlines", () => {
  assertEquals(escapeForSingleQuotes("line1\nline2"), "line1\nline2");
});

// ============================================================================
// escapeRegex Tests (unchanged function)
// ============================================================================

Deno.test("escapeRegex - escapes special regex characters", () => {
  assertEquals(escapeRegex(".*+?^${}()|[]\\"), "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
});

Deno.test("escapeRegex - preserves regular characters", () => {
  assertEquals(escapeRegex("abc123"), "abc123");
});

// ============================================================================
// Edge Cases
// ============================================================================

Deno.test("escapeString - handles empty string", () => {
  assertEquals(escapeString(""), "");
});

Deno.test("escapeString - handles string with no special characters", () => {
  assertEquals(
    escapeString("simple text", { quotes: "double", escapeNewlines: true }),
    "simple text",
  );
});

Deno.test("escapeForTemplate - complex real-world example", () => {
  const input = 'Run `ls -la` in ${HOME}\\Desktop with $PATH';
  const expected = 'Run \\`ls -la\\` in \\${HOME}\\\\Desktop with \\$PATH';
  assertEquals(escapeForTemplate(input), expected);
});

Deno.test("escapeForQuotes - complex real-world example", () => {
  const input = 'File: "C:\\Users\\test.txt"\nWith newline';
  const expected = 'File: \\"C:\\\\Users\\\\test.txt\\"\\nWith newline';
  assertEquals(escapeForQuotes(input), expected);
});
