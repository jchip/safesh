/**
 * Tests for diagnostics.ts
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  createNote,
  DiagnosticCode,
  type DiagnosticCodeType,
  type DiagnosticSeverity,
  formatDiagnostic,
  type ParseNote,
} from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";

// Helper to create a test location
function createLocation(
  line: number,
  column: number,
  offset: number,
): SourceLocation {
  return {
    start: { line, column, offset },
    end: { line, column: column + 5, offset: offset + 5 },
  };
}

Deno.test("DiagnosticCode - all codes are unique", () => {
  const codes = Object.values(DiagnosticCode);
  const uniqueCodes = new Set(codes);
  assertEquals(
    codes.length,
    uniqueCodes.size,
    "All diagnostic codes should be unique",
  );
});

Deno.test("DiagnosticCode - codes follow SSH_XXXX format", () => {
  const codes = Object.values(DiagnosticCode);
  const pattern = /^SSH_\d{4}$/;
  for (const code of codes) {
    assertEquals(
      pattern.test(code),
      true,
      `Code ${code} should match SSH_XXXX format`,
    );
  }
});

Deno.test("DiagnosticCode - codes are in correct ranges", () => {
  // Syntax errors (1xxx)
  assertEquals(DiagnosticCode.UNEXPECTED_TOKEN.startsWith("SSH_1"), true);
  assertEquals(DiagnosticCode.UNEXPECTED_EOF.startsWith("SSH_1"), true);
  assertEquals(DiagnosticCode.MISSING_KEYWORD.startsWith("SSH_1"), true);
  assertEquals(DiagnosticCode.UNCLOSED_QUOTE.startsWith("SSH_1"), true);
  assertEquals(DiagnosticCode.UNCLOSED_BRACE.startsWith("SSH_1"), true);
  assertEquals(DiagnosticCode.INVALID_REDIRECT.startsWith("SSH_1"), true);

  // Semantic warnings (2xxx)
  assertEquals(DiagnosticCode.UNQUOTED_VARIABLE.startsWith("SSH_2"), true);
  assertEquals(DiagnosticCode.MISSING_SHEBANG.startsWith("SSH_2"), true);
  assertEquals(DiagnosticCode.UNUSED_VARIABLE.startsWith("SSH_2"), true);

  // Compatibility warnings (3xxx)
  assertEquals(DiagnosticCode.BASH_ONLY_FEATURE.startsWith("SSH_3"), true);
  assertEquals(DiagnosticCode.NON_POSIX_FEATURE.startsWith("SSH_3"), true);

  // Style hints (4xxx)
  assertEquals(DiagnosticCode.PREFER_DOUBLE_BRACKET.startsWith("SSH_4"), true);
  assertEquals(DiagnosticCode.PREFER_PRINTF.startsWith("SSH_4"), true);
});

Deno.test("createNote - creates valid ParseNote with minimal options", () => {
  const loc = createLocation(10, 5, 100);
  const note = createNote(
    "error",
    DiagnosticCode.UNEXPECTED_TOKEN,
    "Unexpected token",
    loc,
  );

  assertEquals(note.severity, "error");
  assertEquals(note.code, DiagnosticCode.UNEXPECTED_TOKEN);
  assertEquals(note.message, "Unexpected token");
  assertEquals(note.loc, loc);
  assertEquals(note.context, undefined);
  assertEquals(note.fixHint, undefined);
});

Deno.test("createNote - creates valid ParseNote with all options", () => {
  const loc = createLocation(10, 5, 100);
  const note = createNote(
    "warning",
    DiagnosticCode.UNQUOTED_VARIABLE,
    "Variable should be quoted",
    loc,
    {
      context: "in 'if' statement",
      fixHint: 'Use "$variable" instead of $variable',
    },
  );

  assertEquals(note.severity, "warning");
  assertEquals(note.code, DiagnosticCode.UNQUOTED_VARIABLE);
  assertEquals(note.message, "Variable should be quoted");
  assertEquals(note.loc, loc);
  assertEquals(note.context, "in 'if' statement");
  assertEquals(note.fixHint, 'Use "$variable" instead of $variable');
});

Deno.test("createNote - works with all severity levels", () => {
  const loc = createLocation(1, 1, 0);
  const severities: DiagnosticSeverity[] = ["error", "warning", "info", "hint"];

  for (const severity of severities) {
    const note = createNote(
      severity,
      DiagnosticCode.UNEXPECTED_TOKEN,
      "Test message",
      loc,
    );
    assertEquals(note.severity, severity);
    assertExists(note);
  }
});

Deno.test("formatDiagnostic - formats error without context or hint", () => {
  const loc = createLocation(10, 5, 100);
  const note: ParseNote = {
    severity: "error",
    code: DiagnosticCode.UNEXPECTED_TOKEN,
    message: "Unexpected token ';'",
    loc,
  };

  const formatted = formatDiagnostic(note);
  assertEquals(formatted, "ERROR [SSH_1001] 10:5: Unexpected token ';'");
});

Deno.test("formatDiagnostic - formats warning with context", () => {
  const loc = createLocation(15, 10, 200);
  const note: ParseNote = {
    severity: "warning",
    code: DiagnosticCode.UNQUOTED_VARIABLE,
    message: "Variable should be quoted",
    loc,
    context: "in 'if' statement",
  };

  const formatted = formatDiagnostic(note);
  const expected =
    "WARNING [SSH_2001] 15:10: Variable should be quoted\n  Context: in 'if' statement";
  assertEquals(formatted, expected);
});

Deno.test("formatDiagnostic - formats hint with context and fixHint", () => {
  const loc = createLocation(20, 15, 300);
  const note: ParseNote = {
    severity: "hint",
    code: DiagnosticCode.PREFER_DOUBLE_BRACKET,
    message: "Prefer [[ ]] over [ ]",
    loc,
    context: "in test expression",
    fixHint: "Replace [ ... ] with [[ ... ]]",
  };

  const formatted = formatDiagnostic(note);
  const expected =
    "HINT [SSH_4001] 20:15: Prefer [[ ]] over [ ]\n  Context: in test expression\n  Hint: Replace [ ... ] with [[ ... ]]";
  assertEquals(formatted, expected);
});

Deno.test("formatDiagnostic - formats info diagnostic", () => {
  const loc = createLocation(5, 1, 50);
  const note: ParseNote = {
    severity: "info",
    code: DiagnosticCode.MISSING_SHEBANG,
    message: "Consider adding a shebang",
    loc,
    fixHint: "Add #!/bin/bash at the top",
  };

  const formatted = formatDiagnostic(note);
  const expected =
    "INFO [SSH_2002] 5:1: Consider adding a shebang\n  Hint: Add #!/bin/bash at the top";
  assertEquals(formatted, expected);
});

Deno.test("ParseNote - type validation for DiagnosticCodeType", () => {
  const loc = createLocation(1, 1, 0);

  // All valid diagnostic codes should be accepted
  const codes: DiagnosticCodeType[] = [
    DiagnosticCode.UNEXPECTED_TOKEN,
    DiagnosticCode.UNEXPECTED_EOF,
    DiagnosticCode.MISSING_KEYWORD,
    DiagnosticCode.UNCLOSED_QUOTE,
    DiagnosticCode.UNCLOSED_BRACE,
    DiagnosticCode.INVALID_REDIRECT,
    DiagnosticCode.UNQUOTED_VARIABLE,
    DiagnosticCode.MISSING_SHEBANG,
    DiagnosticCode.UNUSED_VARIABLE,
    DiagnosticCode.BASH_ONLY_FEATURE,
    DiagnosticCode.NON_POSIX_FEATURE,
    DiagnosticCode.PREFER_DOUBLE_BRACKET,
    DiagnosticCode.PREFER_PRINTF,
  ];

  for (const code of codes) {
    const note = createNote("error", code, "Test", loc);
    assertExists(note);
    assertEquals(note.code, code);
  }
});
