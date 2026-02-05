/**
 * Tests for control flow handlers (SSH-375)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../parser.ts";
import { transpile } from "../mod.ts";

describe("For Loop with Command Substitution (SSH-375)", () => {
  it("should generate valid TypeScript for simple command substitution", () => {
    const script = `
      for item in $(echo one two three); do
        echo "$item"
      done
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Should use temp variable for dynamic array
    assertStringIncludes(output, "const _tmp");
    // Should await and extract text from command substitution
    assertStringIncludes(output, "await __cmdSubText");
    // Should split by whitespace
    assertStringIncludes(output, ".split(/\\s+/)");
    // Should filter empty strings
    assertStringIncludes(output, "filter(s => s.length > 0)");
    // Should iterate over the temp variable
    assertStringIncludes(output, "for (const item of _tmp");

    // Should NOT have invalid syntax like ["${await ...}"]
    assertEquals(output.includes('[`${await'), false, "Should not have template literal in array literal");
  });

  it("should handle mixed list with command substitution", () => {
    const script = `
      for x in before $(echo middle) after; do
        echo "$x"
      done
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Should have temp variable
    assertStringIncludes(output, "const _tmp");
    // Should push literal strings
    assertStringIncludes(output, '.push(`before`)');
    assertStringIncludes(output, '.push(`after`)');
    // Should push split command substitution results
    assertStringIncludes(output, ".split(/\\s+/)");
    assertStringIncludes(output, "await __cmdSubText");
  });

  it("should handle command substitution with pipeline", () => {
    const script = `
      for branch in $(git branch -r | grep -v HEAD | head -5); do
        echo "$branch"
      done
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Should use temp variable
    assertStringIncludes(output, "const _tmp");
    // Should handle pipeline in command substitution
    assertStringIncludes(output, "await __cmdSubText");
    assertStringIncludes(output, ".stdout()");
    assertStringIncludes(output, ".lines()");
    assertStringIncludes(output, ".pipe(");
    // Should split result
    assertStringIncludes(output, ".split(/\\s+/)");
  });

  it("should handle plain word list without command substitution", () => {
    const script = `
      for i in a b c; do
        echo "$i"
      done
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Should use static array (no temp variable needed)
    assertStringIncludes(output, '["a", "b", "c"]');
    // Should NOT use temp variable for static lists
    assertEquals(output.includes('const _tmp'), false, "Should not need temp variable for static list");
  });

  it("should handle for loop with parameter expansion", () => {
    const script = `
      FILES="one two three"
      for f in $FILES; do
        echo "$f"
      done
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Should use temp variable because of parameter expansion
    assertStringIncludes(output, "const _tmp");
    // SSH-484: Should push with proper variable lookup chain
    assertStringIncludes(output, "_tmp0.push(`${");
    assertStringIncludes(output, "typeof FILES");
  });

  it("should handle empty command substitution result", () => {
    const script = `
      for item in $(echo); do
        echo "$item"
      done
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Should use temp variable
    assertStringIncludes(output, "const _tmp");
    // Should filter empty strings after split
    assertStringIncludes(output, "filter(s => s.length > 0)");
    // This means the loop won't execute if command returns empty string
  });
});
