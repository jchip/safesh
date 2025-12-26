/**
 * Tests for xrun-style array syntax parser
 */

import { assertEquals, assertThrows } from "@std/assert";
import { isXrunSyntax, parseXrun } from "../src/runner/xrun-parser.ts";

// ============================================================================
// isXrunSyntax Tests
// ============================================================================

Deno.test("isXrunSyntax - detects xrun syntax", () => {
  assertEquals(isXrunSyntax("[a, b, c]"), true);
  assertEquals(isXrunSyntax("[-s, a, b, c]"), true);
  assertEquals(isXrunSyntax("  [a, b]  "), true);
  assertEquals(isXrunSyntax("task-name"), false);
  assertEquals(isXrunSyntax(""), false);
});

// ============================================================================
// Simple Parallel Tests
// ============================================================================

Deno.test("parseXrun - simple parallel [a, b, c]", () => {
  const result = parseXrun("[a, b, c]");

  assertEquals(result.mainTask, {
    parallel: ["a", "b", "c"],
  });
  assertEquals(result.additionalTasks, {});
});

Deno.test("parseXrun - parallel with two tasks [a, b]", () => {
  const result = parseXrun("[a, b]");

  assertEquals(result.mainTask, {
    parallel: ["a", "b"],
  });
  assertEquals(result.additionalTasks, {});
});

Deno.test("parseXrun - single task in brackets [a]", () => {
  const result = parseXrun("[a]");

  assertEquals(result.mainTask, {
    parallel: ["a"],
  });
  assertEquals(result.additionalTasks, {});
});

// ============================================================================
// Simple Serial Tests
// ============================================================================

Deno.test("parseXrun - simple serial [-s, a, b, c]", () => {
  const result = parseXrun("[-s, a, b, c]");

  assertEquals(result.mainTask, {
    serial: ["a", "b", "c"],
  });
  assertEquals(result.additionalTasks, {});
});

Deno.test("parseXrun - serial with two tasks [-s, a, b]", () => {
  const result = parseXrun("[-s, a, b]");

  assertEquals(result.mainTask, {
    serial: ["a", "b"],
  });
  assertEquals(result.additionalTasks, {});
});

// ============================================================================
// Nested Tests
// ============================================================================

Deno.test("parseXrun - nested serial in parallel [a, [-s, b, c], d]", () => {
  const result = parseXrun("[a, [-s, b, c], d]");

  assertEquals(result.mainTask, {
    parallel: ["a", "xrun-p1", "d"],
  });
  assertEquals(result.additionalTasks, {
    "xrun-p1": {
      serial: ["b", "c"],
    },
  });
});

Deno.test("parseXrun - nested parallel in serial [-s, a, [b, c], d]", () => {
  const result = parseXrun("[-s, a, [b, c], d]");

  assertEquals(result.mainTask, {
    serial: ["a", "xrun-s1", "d"],
  });
  assertEquals(result.additionalTasks, {
    "xrun-s1": {
      parallel: ["b", "c"],
    },
  });
});

Deno.test("parseXrun - multiple nested arrays [a, [-s, b, c], [d, e]]", () => {
  const result = parseXrun("[a, [-s, b, c], [d, e]]");

  assertEquals(result.mainTask, {
    parallel: ["a", "xrun-p1", "xrun-p2"],
  });
  assertEquals(result.additionalTasks, {
    "xrun-p1": {
      serial: ["b", "c"],
    },
    "xrun-p2": {
      parallel: ["d", "e"],
    },
  });
});

Deno.test("parseXrun - deeply nested [a, [-s, b, [c, d]], e]", () => {
  const result = parseXrun("[a, [-s, b, [c, d]], e]");

  assertEquals(result.mainTask, {
    parallel: ["a", "xrun-p1", "e"],
  });
  assertEquals(result.additionalTasks["xrun-p1"], {
    serial: ["b", "xrun-p1-s1"],
  });
  assertEquals(result.additionalTasks["xrun-p1-s1"], {
    parallel: ["c", "d"],
  });
});

// ============================================================================
// Whitespace Handling Tests
// ============================================================================

Deno.test("parseXrun - handles whitespace [a, b, c]", () => {
  const result = parseXrun("[ a , b , c ]");

  assertEquals(result.mainTask, {
    parallel: ["a", "b", "c"],
  });
});

Deno.test("parseXrun - handles whitespace with serial [-s, a, b]", () => {
  const result = parseXrun("[ -s , a , b ]");

  assertEquals(result.mainTask, {
    serial: ["a", "b"],
  });
});

Deno.test("parseXrun - handles newlines and tabs", () => {
  const result = parseXrun(`[
    a,
    b,
    c
  ]`);

  assertEquals(result.mainTask, {
    parallel: ["a", "b", "c"],
  });
});

// ============================================================================
// Task Name Tests
// ============================================================================

Deno.test("parseXrun - supports task names with hyphens", () => {
  const result = parseXrun("[build-dev, test-unit, lint-all]");

  assertEquals(result.mainTask, {
    parallel: ["build-dev", "test-unit", "lint-all"],
  });
});

Deno.test("parseXrun - supports task names with underscores", () => {
  const result = parseXrun("[build_dev, test_unit]");

  assertEquals(result.mainTask, {
    parallel: ["build_dev", "test_unit"],
  });
});

Deno.test("parseXrun - supports task names with colons (namespaces)", () => {
  const result = parseXrun("[watch:ts, watch:css]");

  assertEquals(result.mainTask, {
    parallel: ["watch:ts", "watch:css"],
  });
});

Deno.test("parseXrun - supports task names with numbers", () => {
  const result = parseXrun("[task1, task2, task3]");

  assertEquals(result.mainTask, {
    parallel: ["task1", "task2", "task3"],
  });
});

// ============================================================================
// Comma Handling Tests
// ============================================================================

Deno.test("parseXrun - works without commas [a b c]", () => {
  const result = parseXrun("[a b c]");

  assertEquals(result.mainTask, {
    parallel: ["a", "b", "c"],
  });
});

Deno.test("parseXrun - trailing comma [a, b, c,]", () => {
  const result = parseXrun("[a, b, c,]");

  assertEquals(result.mainTask, {
    parallel: ["a", "b", "c"],
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

Deno.test("parseXrun - empty array throws error", () => {
  assertThrows(
    () => parseXrun("[]"),
    Error,
    "Array must contain at least one task",
  );
});

Deno.test("parseXrun - serial flag only throws error", () => {
  assertThrows(
    () => parseXrun("[-s]"),
    Error,
  );
});

Deno.test("parseXrun - unclosed bracket throws error", () => {
  assertThrows(
    () => parseXrun("[a, b, c"),
    Error,
    "Expected bracket",
  );
});

Deno.test("parseXrun - unexpected closing bracket throws error", () => {
  assertThrows(
    () => parseXrun("a, b, c]"),
    Error,
    "Unexpected token",
  );
});

Deno.test("parseXrun - invalid character throws error", () => {
  assertThrows(
    () => parseXrun("[a, b, @invalid]"),
    Error,
    "Unexpected character",
  );
});

Deno.test("parseXrun - mismatched brackets throws error", () => {
  assertThrows(
    () => parseXrun("[a, [b, c]]]"),
    Error,
    "Unexpected token after end",
  );
});

// ============================================================================
// Real-world Examples
// ============================================================================

Deno.test("parseXrun - build pipeline example", () => {
  const result = parseXrun("[-s, clean, [lint, test], build]");

  assertEquals(result.mainTask, {
    serial: ["clean", "xrun-s1", "build"],
  });
  assertEquals(result.additionalTasks, {
    "xrun-s1": {
      parallel: ["lint", "test"],
    },
  });
});

Deno.test("parseXrun - dev environment example", () => {
  const result = parseXrun("[watch:ts, watch:css, serve]");

  assertEquals(result.mainTask, {
    parallel: ["watch:ts", "watch:css", "serve"],
  });
  assertEquals(result.additionalTasks, {});
});

Deno.test("parseXrun - CI pipeline example", () => {
  const result = parseXrun("[-s, install, [lint, typecheck], test, build, deploy]");

  assertEquals(result.mainTask, {
    serial: ["install", "xrun-s1", "test", "build", "deploy"],
  });
  assertEquals(result.additionalTasks, {
    "xrun-s1": {
      parallel: ["lint", "typecheck"],
    },
  });
});
