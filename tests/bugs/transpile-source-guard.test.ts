/**
 * SSH-688: `transpile` takes a parsed AST.Program, but `deno run` does not
 * type-check, so passing bash source used to fail deep inside the emitter with
 * "program.body is not iterable" — an error that names neither the argument nor
 * the fix. It now fails at the boundary and names `parse()`, and
 * `transpileSource` exists for the parse+transpile shape the test files kept
 * hand-rolling.
 */
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile, transpileSource } from "../../src/bash/transpiler2/mod.ts";

const opts = { imports: false, strict: false } as const;

describe("SSH-688: transpile() argument guard", () => {
  it("names parse() when handed bash source", () => {
    const err = assertThrows(
      // deno-lint-ignore no-explicit-any
      () => (transpile as any)("ls /nonexistent | cat"),
      TypeError,
    );
    assertStringIncludes(err.message, "expects a parsed AST.Program");
    assertStringIncludes(err.message, "got a string");
    assertStringIncludes(err.message, "call parse(bash) first");
  });

  it("reports the actual type for other non-AST arguments", () => {
    for (const bad of [null, undefined, 42, [], { notBody: true }]) {
      const err = assertThrows(
        // deno-lint-ignore no-explicit-any
        () => (transpile as any)(bad),
        TypeError,
      );
      assertStringIncludes(err.message, "expects a parsed AST.Program");
    }
  });

  it("still accepts a parsed program", () => {
    assertStringIncludes(transpile(parse("echo hi"), opts), "$.echo");
  });

  it("transpileSource parses and transpiles in one call", () => {
    assertEquals(transpileSource("echo hi", opts), transpile(parse("echo hi"), opts));
  });
});
