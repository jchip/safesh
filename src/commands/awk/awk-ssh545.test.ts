/**
 * Tests for SSH-545 AWK medium+low fixes
 * Tests correctness fixes: executeEnd, RS wiring, ExecutionLimitError handling
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { awkExec } from "./awk.ts";
import { AwkLexer, TokenType } from "./lexer.ts";

describe("AWK SSH-545 fixes", () => {
  describe("executeEnd after exit from rule", () => {
    it("runs END blocks when exit is called from a rule", async () => {
      const result = await awkExec(
        '{ if (NR == 2) exit } END { print "done" }',
        "a\nb\nc",
      );
      assertEquals(result.output.trim(), "done");
    });

    it("stops remaining END blocks if exit called from END", async () => {
      const result = await awkExec(
        'END { print "first"; exit } END { print "second" }',
        "input",
      );
      assertEquals(result.output.trim(), "first");
    });

    it("runs END with accumulated state after rule exit", async () => {
      const result = await awkExec(
        "{ sum += $1; if (NR == 2) exit } END { print sum }",
        "10\n20\n30",
      );
      assertEquals(result.output.trim(), "30");
    });

    it("preserves exit code through END blocks", async () => {
      const result = await awkExec(
        '{ exit 42 } END { print "end" }',
        "input",
      );
      assertEquals(result.output.trim(), "end");
      assertEquals(result.exitCode, 42);
    });
  });

  describe("RS wiring", () => {
    it("uses RS option to split records", async () => {
      const result = await awkExec(
        "{ print NR, $0 }",
        "a|b|c",
        { rs: "|" },
      );
      assertEquals(result.output.trim(), "1 a\n2 b\n3 c");
    });

    it("uses RS set in BEGIN block", async () => {
      const result = await awkExec(
        'BEGIN { RS = ":" } { print NR, $0 }',
        "x:y:z",
      );
      assertEquals(result.output.trim(), "1 x\n2 y\n3 z");
    });

    it("reads RS variable correctly", async () => {
      const result = await awkExec(
        'BEGIN { RS = "," } END { print RS }',
        "a,b",
      );
      assertEquals(result.output.trim(), ",");
    });
  });

  describe("ExecutionLimitError handling", () => {
    it("returns partial output on iteration limit", async () => {
      const result = await awkExec(
        'BEGIN { while (1) { print "x" } }',
        "",
        { maxIterations: 5 },
      );
      // Should have partial output (5 lines of "x")
      const lines = result.output.trim().split("\n");
      assertEquals(lines.length, 5);
      assertEquals(lines[0], "x");
      assertEquals(result.exitCode, 2);
    });

    it("returns partial output on recursion limit", async () => {
      const result = await awkExec(
        'function f(n) { print n; return f(n+1) } BEGIN { f(1) }',
        "",
        { maxRecursionDepth: 3 },
      );
      const lines = result.output.trim().split("\n");
      // Should have partial output up to recursion depth
      assertEquals(lines[0], "1");
      assertEquals(result.exitCode, 2);
    });
  });

  describe("lexer bare & token", () => {
    it("returns UNKNOWN for bare &", () => {
      const lexer = new AwkLexer("a & b");
      const tokens = lexer.tokenize();
      const ampToken = tokens.find(t => t.value === "&");
      assertEquals(ampToken?.type, TokenType.UNKNOWN);
    });

    it("returns AND for &&", () => {
      const lexer = new AwkLexer("a && b");
      const tokens = lexer.tokenize();
      const andToken = tokens.find(t => t.value === "&&");
      assertEquals(andToken?.type, TokenType.AND);
    });
  });

  describe("awkTransform empty lines", () => {
    it("preserves internal empty lines", async () => {
      const result = await awkExec(
        '{ print; print "" }',
        "a\nb",
      );
      // Each line prints the line and then an empty line
      const output = result.output;
      assertEquals(output, "a\n\nb\n\n");
    });
  });
});
