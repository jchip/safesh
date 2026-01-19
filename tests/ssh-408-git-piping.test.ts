/**
 * SSH-408: Test git command piping with && chains
 *
 * This test verifies that git commands with && chains followed by pipes
 * transpile correctly without duplicate .lines() calls.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "../src/bash/parser.ts";
import { transpile } from "../src/bash/transpiler2/mod.ts";

Deno.test({
  name: "SSH-408: git log with pipe does not duplicate .lines()",
  fn() {
    const code = `git log --oneline | head -5`;
    const ast = parse(code);
    const result = transpile(ast);

    // Should have .stdout().lines() once
    assertStringIncludes(result, ".stdout().lines()");
    // Should NOT have .lines().lines()
    assertEquals(result.includes(".lines().lines()"), false, "Should not have duplicate .lines() calls");
  },
});

Deno.test({
  name: "SSH-408: git with && and pipe does not duplicate .lines()",
  fn() {
    const code = `git log --oneline && echo "---" && git log --date=short | sort`;
    const ast = parse(code);
    const result = transpile(ast);

    // Should have .stdout().lines().pipe($.sort())
    assertStringIncludes(result, ".stdout().lines().pipe($.sort())");
    // Should NOT have .lines().lines()
    assertEquals(result.includes(".lines().lines()"), false, "Should not have duplicate .lines() calls");
  },
});

Deno.test({
  name: "SSH-408: complex git pipeline with multiple transforms",
  fn() {
    const code = `git log --date=short | sort | uniq -c | sort -rn`;
    const ast = parse(code);
    const result = transpile(ast);

    // Should have .stdout().lines().pipe(transform).pipe(transform).pipe(transform)
    assertStringIncludes(result, ".stdout().lines()");
    assertStringIncludes(result, ".pipe($.sort())");
    assertStringIncludes(result, ".pipe($.uniq(");
    // Should NOT have .lines().lines()
    assertEquals(result.includes(".lines().lines()"), false, "Should not have duplicate .lines() calls");
    // Should NOT have .lines().pipe() after the first one
    const linesCount = (result.match(/\.lines\(\)/g) || []).length;
    assertEquals(linesCount, 1, "Should have exactly one .lines() call");
  },
});

Deno.test({
  name: "SSH-408: exact command from bug report",
  fn() {
    const code = `git shortlog -sn --since="1 month ago" && echo -e "\\n--- Commit activity by day ---" && git log --since="1 month ago" --date=short --pretty=format:"%ad" | sort | uniq -c | sort -rn`;
    const ast = parse(code);
    const result = transpile(ast);

    // Should have the pattern: .stdout().lines().pipe($.sort()).pipe($.uniq({ count: true })).pipe($.sort())
    assertStringIncludes(result, ".stdout().lines()");
    assertStringIncludes(result, ".pipe($.sort())");
    assertStringIncludes(result, ".pipe($.uniq({ count: true }))");

    // Should NOT have .lines().lines() or .lines().pipe() after first .lines()
    assertEquals(result.includes(".lines().lines()"), false, "Should not have .lines().lines()");
    assertEquals(result.includes(".pipe($.sort()).lines()"), false, "Should not have .lines() after .pipe(transform)");
    assertEquals(result.includes(".pipe($.uniq({ count: true })).lines()"), false, "Should not have .lines() after .pipe(transform)");

    // Count .lines() calls - should be exactly 1
    const linesCount = (result.match(/\.lines\(\)/g) || []).length;
    assertEquals(linesCount, 1, "Should have exactly one .lines() call for the entire pipeline");
  },
});

Deno.test({
  name: "SSH-408: cat with multiple transforms",
  fn() {
    const code = `cat file.txt | grep pattern | sort | uniq`;
    const ast = parse(code);
    const result = transpile(ast);

    // cat produces a stream, so should start with $.cat().lines()
    assertStringIncludes(result, "$.cat(");
    assertStringIncludes(result, ".lines()");
    assertStringIncludes(result, ".pipe($.grep(");
    assertStringIncludes(result, ".pipe($.sort())");
    assertStringIncludes(result, ".pipe($.uniq())");

    // Should NOT have duplicate .lines() calls
    assertEquals(result.includes(".lines().lines()"), false, "Should not have duplicate .lines() calls");
    const linesCount = (result.match(/\.lines\(\)/g) || []).length;
    assertEquals(linesCount, 1, "Should have exactly one .lines() call");
  },
});

Deno.test({
  name: "SSH-408: mixed commands and transforms",
  fn() {
    const code = `echo "hello" | grep h | cat | sort`;
    const ast = parse(code);
    const result = transpile(ast);

    // Should not have .lines().lines() anywhere
    assertEquals(result.includes(".lines().lines()"), false, "Should not have duplicate .lines() calls");
  },
});
