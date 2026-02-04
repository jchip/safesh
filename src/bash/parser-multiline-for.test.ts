/**
 * Test for SSH-473: Parser fails on multi-line for loop with newline before 'done'
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "./parser.ts";
import type * as AST from "./ast.ts";

describe("SSH-473: Multi-line for loop with newline before done", () => {
  it("should parse for loop with body on same line as do and done on next line", () => {
    // This is the failing case from the bug report
    const input = `for i in 1 2 3 4 5 6 7 8 9 10; do if grep -q "BUILD_DONE" .temp/build-mocks.txt 2>/dev/null; then break; fi; sleep 5;
done && tail -50 .temp/build-mocks.txt`;

    const ast = parse(input);

    assertEquals(ast.type, "Program");
    assertEquals(ast.body.length, 1);

    // The top level should be a Pipeline with && operator
    const pipeline = ast.body[0] as AST.Pipeline;
    assertEquals(pipeline.type, "Pipeline");
    assertEquals(pipeline.operator, "&&");
    assertEquals(pipeline.commands.length, 2);

    // First command should be a ForStatement (wrapped in Pipeline)
    const forPipeline = pipeline.commands[0] as AST.Pipeline;
    const forStmt = forPipeline.commands[0] as AST.ForStatement;
    assertEquals(forStmt.type, "ForStatement");
    assertEquals(forStmt.variable, "i");
    assertEquals(forStmt.iterable.length, 10);

    // Second command should be the tail command
    const tailPipeline = pipeline.commands[1] as AST.Pipeline;
    const tailCmd = tailPipeline.commands[0] as AST.Command;
    assertEquals((tailCmd.name as AST.Word).value, "tail");
  });

  it("should parse simple for loop with newline before done", () => {
    // Simpler case to isolate the issue
    const input = `for i in 1 2 3; do echo $i;
done`;

    const ast = parse(input);

    assertEquals(ast.type, "Program");
    assertEquals(ast.body.length, 1);

    const pipeline = ast.body[0] as AST.Pipeline;
    const forStmt = pipeline.commands[0] as AST.ForStatement;
    assertEquals(forStmt.type, "ForStatement");
    assertEquals(forStmt.variable, "i");
    assertEquals(forStmt.body.length, 1);
  });

  it("should parse for loop followed by && on same line as done", () => {
    const input = `for i in 1 2 3; do echo $i; done && echo finished`;

    const ast = parse(input);

    assertEquals(ast.type, "Program");
    assertEquals(ast.body.length, 1);

    const pipeline = ast.body[0] as AST.Pipeline;
    assertEquals(pipeline.operator, "&&");
    assertEquals(pipeline.commands.length, 2);
  });

  it("should parse for loop with semicolon at end of body and newline before done", () => {
    const input = `for x in a b c; do cmd1; cmd2;
done`;

    const ast = parse(input);

    assertEquals(ast.type, "Program");
    const pipeline = ast.body[0] as AST.Pipeline;
    const forStmt = pipeline.commands[0] as AST.ForStatement;
    assertEquals(forStmt.type, "ForStatement");
    // Body should have 2 commands
    assertEquals(forStmt.body.length, 2);
  });

  it("should parse while loop with newline before done", () => {
    const input = `while true; do echo loop;
done`;

    const ast = parse(input);

    const pipeline = ast.body[0] as AST.Pipeline;
    const whileStmt = pipeline.commands[0] as AST.WhileStatement;
    assertEquals(whileStmt.type, "WhileStatement");
  });
});
