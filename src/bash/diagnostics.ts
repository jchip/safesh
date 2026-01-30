/**
 * Bash Parser Diagnostics for SafeShell
 *
 * Comprehensive diagnostic system for parser errors, warnings, and hints.
 */

import type { SourceLocation } from "./ast.ts";

/**
 * Severity levels for parser diagnostics.
 * - error: Parse cannot continue, fatal issue
 * - warning: Parse continues but code may be problematic
 * - info: Informational message, code is valid
 * - hint: Style suggestion or improvement
 */
export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/**
 * Error codes for parser diagnostics.
 * Format: SSH_XXXX where XXXX is a 4-digit number.
 *
 * Ranges:
 * - 1xxx: Syntax errors
 * - 2xxx: Semantic warnings
 * - 3xxx: Compatibility warnings
 * - 4xxx: Style hints
 */
export const DiagnosticCode = {
  // Syntax errors (1xxx)
  UNEXPECTED_TOKEN: "SSH_1001",
  UNEXPECTED_EOF: "SSH_1002",
  MISSING_KEYWORD: "SSH_1003",
  UNCLOSED_QUOTE: "SSH_1004",
  UNCLOSED_BRACE: "SSH_1005",
  INVALID_REDIRECT: "SSH_1006",

  // Semantic warnings (2xxx)
  UNQUOTED_VARIABLE: "SSH_2001",
  MISSING_SHEBANG: "SSH_2002",
  UNUSED_VARIABLE: "SSH_2003",

  // Compatibility warnings (3xxx)
  BASH_ONLY_FEATURE: "SSH_3001",
  NON_POSIX_FEATURE: "SSH_3002",

  // Style hints (4xxx)
  PREFER_DOUBLE_BRACKET: "SSH_4001",
  PREFER_PRINTF: "SSH_4002",
} as const;

export type DiagnosticCodeType = typeof DiagnosticCode[keyof typeof DiagnosticCode];

/**
 * A parser diagnostic/note.
 */
export interface ParseNote {
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Error code for programmatic handling */
  code: DiagnosticCodeType;
  /** Human-readable message */
  message: string;
  /** Location in source */
  loc: SourceLocation;
  /** Optional context (e.g., "in 'if' statement") */
  context?: string;
  /** Optional fix hint */
  fixHint?: string;
}

/**
 * Create a diagnostic note.
 */
export function createNote(
  severity: DiagnosticSeverity,
  code: DiagnosticCodeType,
  message: string,
  loc: SourceLocation,
  options?: { context?: string; fixHint?: string },
): ParseNote {
  return {
    severity,
    code,
    message,
    loc,
    ...options,
  };
}

/**
 * Format a diagnostic for display.
 */
export function formatDiagnostic(note: ParseNote): string {
  const prefix = note.severity.toUpperCase();
  const location = `${note.loc.start.line}:${note.loc.start.column}`;
  let result = `${prefix} [${note.code}] ${location}: ${note.message}`;
  if (note.context) {
    result += `\n  Context: ${note.context}`;
  }
  if (note.fixHint) {
    result += `\n  Hint: ${note.fixHint}`;
  }
  return result;
}
