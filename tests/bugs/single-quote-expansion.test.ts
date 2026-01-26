/**
 * Bug test: Single-quoted strings should not expand variables
 *
 * In bash, single quotes preserve everything literally - no variable expansion,
 * no command substitution, no escape sequences (except for closing the quote).
 *
 * This test demonstrates a bug where awk '{print $2}' incorrectly expands $2.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

describe("Bug: Single-Quoted Strings", () => {
  it("should NOT expand variables in single-quoted strings", () => {
    const code = transpileBash("echo '$HOME'");

    // $HOME should be literal, not expanded
    assertStringIncludes(code, '"$HOME"');

    // Should NOT contain variable expansion
    assertEquals(code.includes("Deno.env.get"), false);
    assertEquals(code.includes("HOME"), true); // But as a literal string
  });

  it("should NOT expand positional params in single-quoted awk scripts", () => {
    const code = transpileBash("awk '{print $2}'");

    // $2 should be literal in the awk script, not expanded
    assertStringIncludes(code, '"awk"');

    // Should NOT reference __POSITIONAL_PARAMS__
    assertEquals(code.includes("__POSITIONAL_PARAMS__"), false);

    // Should contain literal $2
    assertStringIncludes(code, "$2");
  });

  it("should NOT expand command substitution in single quotes", () => {
    const code = transpileBash("echo '$(date)'");

    // $(date) should be literal
    assertStringIncludes(code, '"$(date)"');

    // Should NOT contain actual command substitution
    assertEquals(code.includes("$.cmd("), false);
  });

  it("should handle complex awk script with multiple $ references", () => {
    const code = transpileBash("awk '{print $1, $2, $3}'");

    // All $1, $2, $3 should be literal
    assertStringIncludes(code, "$1");
    assertStringIncludes(code, "$2");
    assertStringIncludes(code, "$3");

    // Should NOT expand as bash variables
    assertEquals(code.includes("__POSITIONAL_PARAMS__"), false);
  });

  it("should handle awk field references with operations", () => {
    const code = transpileBash("awk '{sum += $1} END {print sum}'");

    // $1 should be literal
    assertStringIncludes(code, "$1");
    assertEquals(code.includes("__POSITIONAL_PARAMS__"), false);
  });

  it("SHOULD expand variables in double-quoted strings", () => {
    const code = transpileBash('echo "$HOME"');

    // Double quotes should expand
    // Note: SafeShell exposes env vars as globals in preamble,
    // so $HOME becomes ${HOME} (JavaScript variable reference)
    assertStringIncludes(code, "${HOME}");

    // Should NOT treat as literal
    assertEquals(code.includes('"$HOME"'), false);
  });

  it("should handle mixed quotes - single inside double", () => {
    const code = transpileBash(`echo "It's working"`);

    // The apostrophe is inside double quotes, not a single-quote delimiter
    assertStringIncludes(code, "It's");
  });

  it("should handle the original failing command", () => {
    const code = transpileBash("ps aux | grep relay_cli | grep -v grep | awk '{print $2}'");

    // $2 should be literal in awk script
    assertEquals(code.includes("__POSITIONAL_PARAMS__"), false);
    assertStringIncludes(code, "$2");
  });
});
