/**
 * Tests for DiagnosticCollector
 */

import { assertEquals, assertStrictEquals } from "jsr:@std/assert";
import { DiagnosticCollector } from "./diagnostic-collector.ts";
import { DiagnosticCode, createNote } from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";

const mockLocation: SourceLocation = {
  start: { line: 1, column: 5, offset: 5 },
  end: { line: 1, column: 10, offset: 10 },
};

Deno.test("DiagnosticCollector - initial state", () => {
  const collector = new DiagnosticCollector();

  assertEquals(collector.errors.length, 0);
  assertEquals(collector.warnings.length, 0);
  assertEquals(collector.infos.length, 0);
  assertEquals(collector.hints.length, 0);
  assertEquals(collector.count, 0);
  assertEquals(collector.hasErrors(), false);
  assertEquals(collector.hasWarnings(), false);
});

Deno.test("DiagnosticCollector - add error via add()", () => {
  const collector = new DiagnosticCollector();
  const note = createNote(
    "error",
    DiagnosticCode.UNEXPECTED_TOKEN,
    "Unexpected token",
    mockLocation,
  );

  collector.add(note);

  assertEquals(collector.errors.length, 1);
  assertEquals(collector.errors[0], note);
  assertEquals(collector.hasErrors(), true);
  assertEquals(collector.count, 1);
});

Deno.test("DiagnosticCollector - add error via error()", () => {
  const collector = new DiagnosticCollector();

  collector.error(
    DiagnosticCode.UNEXPECTED_TOKEN,
    "Unexpected token",
    mockLocation,
  );

  assertEquals(collector.errors.length, 1);
  assertEquals(collector.errors[0]?.severity, "error");
  assertEquals(collector.errors[0]?.code, DiagnosticCode.UNEXPECTED_TOKEN);
  assertEquals(collector.errors[0]?.message, "Unexpected token");
  assertEquals(collector.hasErrors(), true);
});

Deno.test("DiagnosticCollector - add error with options", () => {
  const collector = new DiagnosticCollector();

  collector.error(
    DiagnosticCode.UNCLOSED_QUOTE,
    "Unclosed string quote",
    mockLocation,
    {
      context: "in function definition",
      fixHint: "Add closing quote",
    },
  );

  assertEquals(collector.errors.length, 1);
  assertEquals(collector.errors[0]?.context, "in function definition");
  assertEquals(collector.errors[0]?.fixHint, "Add closing quote");
});

Deno.test("DiagnosticCollector - add warning via warning()", () => {
  const collector = new DiagnosticCollector();

  collector.warning(
    DiagnosticCode.UNQUOTED_VARIABLE,
    "Variable should be quoted",
    mockLocation,
  );

  assertEquals(collector.warnings.length, 1);
  assertEquals(collector.warnings[0]?.severity, "warning");
  assertEquals(collector.warnings[0]?.code, DiagnosticCode.UNQUOTED_VARIABLE);
  assertEquals(collector.hasWarnings(), true);
  assertEquals(collector.count, 1);
});

Deno.test("DiagnosticCollector - add info via info()", () => {
  const collector = new DiagnosticCollector();

  collector.info(
    DiagnosticCode.BASH_ONLY_FEATURE,
    "This feature is bash-only",
    mockLocation,
  );

  assertEquals(collector.infos.length, 1);
  assertEquals(collector.infos[0]?.severity, "info");
  assertEquals(collector.infos[0]?.code, DiagnosticCode.BASH_ONLY_FEATURE);
  assertEquals(collector.count, 1);
});

Deno.test("DiagnosticCollector - add hint via hint()", () => {
  const collector = new DiagnosticCollector();

  collector.hint(
    DiagnosticCode.PREFER_DOUBLE_BRACKET,
    "Consider using [[ ]] instead of [ ]",
    mockLocation,
  );

  assertEquals(collector.hints.length, 1);
  assertEquals(collector.hints[0]?.severity, "hint");
  assertEquals(collector.hints[0]?.code, DiagnosticCode.PREFER_DOUBLE_BRACKET);
  assertEquals(collector.count, 1);
});

Deno.test("DiagnosticCollector - multiple diagnostics of same severity", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error 1", mockLocation);
  collector.error(DiagnosticCode.UNEXPECTED_EOF, "Error 2", mockLocation);

  assertEquals(collector.errors.length, 2);
  assertEquals(collector.count, 2);
});

Deno.test("DiagnosticCollector - multiple diagnostics of different severities", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);
  collector.warning(DiagnosticCode.UNQUOTED_VARIABLE, "Warning", mockLocation);
  collector.info(DiagnosticCode.BASH_ONLY_FEATURE, "Info", mockLocation);
  collector.hint(DiagnosticCode.PREFER_DOUBLE_BRACKET, "Hint", mockLocation);

  assertEquals(collector.errors.length, 1);
  assertEquals(collector.warnings.length, 1);
  assertEquals(collector.infos.length, 1);
  assertEquals(collector.hints.length, 1);
  assertEquals(collector.count, 4);
  assertEquals(collector.hasErrors(), true);
  assertEquals(collector.hasWarnings(), true);
});

Deno.test("DiagnosticCollector - all() returns combined diagnostics", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);
  collector.warning(DiagnosticCode.UNQUOTED_VARIABLE, "Warning", mockLocation);
  collector.info(DiagnosticCode.BASH_ONLY_FEATURE, "Info", mockLocation);
  collector.hint(DiagnosticCode.PREFER_DOUBLE_BRACKET, "Hint", mockLocation);

  const all = collector.all();
  assertEquals(all.length, 4);
  assertEquals(all[0]?.severity, "error");
  assertEquals(all[1]?.severity, "warning");
  assertEquals(all[2]?.severity, "info");
  assertEquals(all[3]?.severity, "hint");
});

Deno.test("DiagnosticCollector - clear() removes all diagnostics", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);
  collector.warning(DiagnosticCode.UNQUOTED_VARIABLE, "Warning", mockLocation);
  collector.info(DiagnosticCode.BASH_ONLY_FEATURE, "Info", mockLocation);
  collector.hint(DiagnosticCode.PREFER_DOUBLE_BRACKET, "Hint", mockLocation);

  assertEquals(collector.count, 4);

  collector.clear();

  assertEquals(collector.errors.length, 0);
  assertEquals(collector.warnings.length, 0);
  assertEquals(collector.infos.length, 0);
  assertEquals(collector.hints.length, 0);
  assertEquals(collector.count, 0);
  assertEquals(collector.hasErrors(), false);
  assertEquals(collector.hasWarnings(), false);
});

Deno.test("DiagnosticCollector - getters return readonly arrays", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);

  const errors = collector.errors;
  // TypeScript enforces readonly, but we can verify it's the same instance
  assertStrictEquals(errors, collector.errors);
});

Deno.test("DiagnosticCollector - preserves diagnostic order", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error 1", mockLocation);
  collector.error(DiagnosticCode.UNEXPECTED_EOF, "Error 2", mockLocation);
  collector.error(DiagnosticCode.MISSING_KEYWORD, "Error 3", mockLocation);

  assertEquals(collector.errors[0]?.message, "Error 1");
  assertEquals(collector.errors[1]?.message, "Error 2");
  assertEquals(collector.errors[2]?.message, "Error 3");
});

Deno.test("DiagnosticCollector - different locations", () => {
  const collector = new DiagnosticCollector();

  const loc1: SourceLocation = {
    start: { line: 1, column: 5, offset: 5 },
    end: { line: 1, column: 10, offset: 10 },
  };

  const loc2: SourceLocation = {
    start: { line: 2, column: 1, offset: 15 },
    end: { line: 2, column: 5, offset: 19 },
  };

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error at line 1", loc1);
  collector.error(DiagnosticCode.UNEXPECTED_EOF, "Error at line 2", loc2);

  assertEquals(collector.errors[0]?.loc.start.line, 1);
  assertEquals(collector.errors[1]?.loc.start.line, 2);
});

Deno.test("DiagnosticCollector - count property is accurate", () => {
  const collector = new DiagnosticCollector();

  assertEquals(collector.count, 0);

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);
  assertEquals(collector.count, 1);

  collector.warning(DiagnosticCode.UNQUOTED_VARIABLE, "Warning", mockLocation);
  assertEquals(collector.count, 2);

  collector.info(DiagnosticCode.BASH_ONLY_FEATURE, "Info", mockLocation);
  assertEquals(collector.count, 3);

  collector.hint(DiagnosticCode.PREFER_DOUBLE_BRACKET, "Hint", mockLocation);
  assertEquals(collector.count, 4);

  collector.clear();
  assertEquals(collector.count, 0);
});

Deno.test("DiagnosticCollector - hasErrors() only checks errors", () => {
  const collector = new DiagnosticCollector();

  collector.warning(DiagnosticCode.UNQUOTED_VARIABLE, "Warning", mockLocation);
  collector.info(DiagnosticCode.BASH_ONLY_FEATURE, "Info", mockLocation);
  collector.hint(DiagnosticCode.PREFER_DOUBLE_BRACKET, "Hint", mockLocation);

  assertEquals(collector.hasErrors(), false);

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);

  assertEquals(collector.hasErrors(), true);
});

Deno.test("DiagnosticCollector - hasWarnings() only checks warnings", () => {
  const collector = new DiagnosticCollector();

  collector.error(DiagnosticCode.UNEXPECTED_TOKEN, "Error", mockLocation);
  collector.info(DiagnosticCode.BASH_ONLY_FEATURE, "Info", mockLocation);
  collector.hint(DiagnosticCode.PREFER_DOUBLE_BRACKET, "Hint", mockLocation);

  assertEquals(collector.hasWarnings(), false);

  collector.warning(DiagnosticCode.UNQUOTED_VARIABLE, "Warning", mockLocation);

  assertEquals(collector.hasWarnings(), true);
});
