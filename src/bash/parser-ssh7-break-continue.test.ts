/**
 * Test for SSH-7: Parser fails on break/continue after && or || operators
 */

import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse, transpile } from "./mod.ts";
import type * as AST from "./ast.ts";

describe("SSH-7: break/continue after && and || operators", () => {
  describe("Parser: break in pipeline positions", () => {
    it("should parse: cmd && break", () => {
      const ast = parse("curl https://example.com && break");
      assertEquals(ast.type, "Program");
      assertEquals(ast.body.length, 1);

      const pipeline = ast.body[0] as AST.Pipeline;
      assertEquals(pipeline.type, "Pipeline");
      assertEquals(pipeline.operator, "&&");
      assertEquals(pipeline.commands.length, 2);

      const breakStmt = pipeline.commands[1] as AST.BreakStatement;
      assertEquals(breakStmt.type, "BreakStatement");
    });

    it("should parse: cmd || continue", () => {
      const ast = parse("false || continue");
      const pipeline = ast.body[0] as AST.Pipeline;
      assertEquals(pipeline.operator, "||");
      const continueStmt = pipeline.commands[1] as AST.ContinueStatement;
      assertEquals(continueStmt.type, "ContinueStatement");
    });

    it("should parse: cmd && break || sleep 2 (the reported failing case)", () => {
      const ast = parse(
        `for i in 1 2 3 4 5; do curl -sk -o /dev/null -w "%{http_code}" https://military.idme.test/actuator/health && break || sleep 2; done`
      );
      assertEquals(ast.type, "Program");
      assertEquals(ast.body.length, 1);

      const outerPipeline = ast.body[0] as AST.Pipeline;
      // Top-level is a Pipeline([ForStatement], null)
      const forStmt = outerPipeline.commands[0] as AST.ForStatement;
      assertEquals(forStmt.type, "ForStatement");
      assertEquals(forStmt.variable, "i");

      // Body should contain one statement (the && || pipeline)
      assertEquals(forStmt.body.length, 1);
      const bodyPipeline = forStmt.body[0] as AST.Pipeline;
      assertEquals(bodyPipeline.type, "Pipeline");

      // curl && break || sleep 2 parses left-to-right as (curl && break) || sleep 2
      // Outer pipeline has || operator with 2 commands
      assertEquals(bodyPipeline.operator, "||");
      assertEquals(bodyPipeline.commands.length, 2);

      // Inner pipeline is (curl && break)
      const innerPipeline = bodyPipeline.commands[0] as AST.Pipeline;
      assertEquals(innerPipeline.type, "Pipeline");
      assertEquals(innerPipeline.operator, "&&");
      assertEquals(innerPipeline.commands.length, 2);
      const innerBreak = innerPipeline.commands[1] as AST.BreakStatement;
      assertEquals(innerBreak.type, "BreakStatement");
    });

    it("should parse: cmd && return in a function body", () => {
      const ast = parse("grep -q pattern file && return 0");
      const pipeline = ast.body[0] as AST.Pipeline;
      assertEquals(pipeline.operator, "&&");
      const retStmt = pipeline.commands[1] as AST.ReturnStatement;
      assertEquals(retStmt.type, "ReturnStatement");
    });

    it("should parse break with count after &&", () => {
      const ast = parse("true && break 2");
      const pipeline = ast.body[0] as AST.Pipeline;
      const breakStmt = pipeline.commands[1] as AST.BreakStatement;
      assertEquals(breakStmt.type, "BreakStatement");
      assertEquals(breakStmt.count, 2);
    });
  });

  describe("Transpiler: break/continue in for loop with &&/||", () => {
    it("should transpile for loop with && break || sleep pattern", () => {
      const code = parse(
        `for i in 1 2 3 4 5; do curl -sk https://example.com && break || sleep 2; done`
      );
      const result = transpile(code);
      // Should contain a break statement
      const hasBreak = result.includes("break;");
      assertEquals(hasBreak, true, "Transpiled code should contain break;");
      // Should contain a for loop
      const hasFor = result.includes("for ");
      assertEquals(hasFor, true, "Transpiled code should contain for loop");
    });
  });
});
