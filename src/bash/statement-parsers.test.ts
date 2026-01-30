/**
 * Tests for Bash Statement Parsers
 *
 * Tests the combinator-based statement parsers to ensure they correctly
 * parse bash statements and produce valid AST nodes.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { tokenize } from "./lexer.ts";
import { createState } from "./combinators.ts";
import {
  wordNode,
  simpleCommand,
  ifStatement,
  forStatement,
  whileStatement,
  statementParser,
} from "./statement-parsers.ts";
import type * as AST from "./ast.ts";

// ============================================================================
// Helper Functions
// ============================================================================

function parseTokens(input: string) {
  const tokens = tokenize(input);
  return createState(tokens);
}

// ============================================================================
// Word Node Tests
// ============================================================================

Deno.test("wordNode - parses simple word", () => {
  const state = parseTokens("hello");
  const result = wordNode(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "Word");
    assertEquals(result.value.value, "hello");
    assertEquals(result.value.quoted, false);
    assertEquals(result.value.singleQuoted, false);
  }
});

Deno.test("wordNode - parses quoted word", () => {
  const state = parseTokens('"hello"');
  const result = wordNode(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "Word");
    assertEquals(result.value.value, "hello");
    assertEquals(result.value.quoted, true);
  }
});

Deno.test("wordNode - parses single-quoted word", () => {
  const state = parseTokens("'hello'");
  const result = wordNode(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "Word");
    assertEquals(result.value.value, "hello");
    assertEquals(result.value.singleQuoted, true);
  }
});

// ============================================================================
// Simple Command Tests
// ============================================================================

Deno.test("simpleCommand - parses command without args", () => {
  const state = parseTokens("ls");
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "Command");
    assertEquals(result.value.name.type, "Word");
    const name = result.value.name as AST.Word;
    assertEquals(name.value, "ls");
    assertEquals(result.value.args.length, 0);
  }
});

Deno.test("simpleCommand - parses command with args", () => {
  const state = parseTokens("echo hello world");
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "Command");
    const name = result.value.name as AST.Word;
    assertEquals(name.value, "echo");
    assertEquals(result.value.args.length, 2);
    const arg0 = result.value.args[0] as AST.Word;
    const arg1 = result.value.args[1] as AST.Word;
    assertEquals(arg0?.value, "hello");
    assertEquals(arg1?.value, "world");
  }
});

Deno.test("simpleCommand - stops at semicolon", () => {
  const state = parseTokens("echo hello;");
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (result.success) {
    const name = result.value.name as AST.Word;
    assertEquals(name.value, "echo");
    assertEquals(result.value.args.length, 1);
    const arg0 = result.value.args[0] as AST.Word;
    assertEquals(arg0?.value, "hello");
  }
});

Deno.test("simpleCommand - stops at newline", () => {
  const state = parseTokens("echo hello\n");
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (result.success) {
    const name = result.value.name as AST.Word;
    assertEquals(name.value, "echo");
    assertEquals(result.value.args.length, 1);
  }
});

Deno.test("simpleCommand - stops at pipe", () => {
  const state = parseTokens("echo hello | grep h");
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (result.success) {
    const name = result.value.name as AST.Word;
    assertEquals(name.value, "echo");
    assertEquals(result.value.args.length, 1);
    const arg0 = result.value.args[0] as AST.Word;
    assertEquals(arg0?.value, "hello");
  }
});

// ============================================================================
// If Statement Tests
// ============================================================================

Deno.test("ifStatement - parses if-then-fi", () => {
  const state = parseTokens("if test -f file; then echo yes; fi");
  const result = ifStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
    assertExists(result.value.test);
    assertEquals(result.value.test.type, "Pipeline");
    assertEquals(result.value.consequent.length, 1);
    assertEquals(result.value.alternate, null);

    // Check condition
    const pipeline = result.value.test as AST.Pipeline;
    const cmd = pipeline.commands[0] as AST.Command;
    assertEquals(cmd?.type, "Command");
    const cmdName = cmd?.name as AST.Word;
    assertEquals(cmdName.value, "test");

    // Check consequent
    const conseqCmd = result.value.consequent[0] as AST.Command;
    assertEquals(conseqCmd?.type, "Command");
    const conseqName = conseqCmd?.name as AST.Word;
    assertEquals(conseqName.value, "echo");
  }
});

Deno.test("ifStatement - parses if-then-else-fi", () => {
  const state = parseTokens("if test -f file; then echo yes; else echo no; fi");
  const result = ifStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
    assertEquals(result.value.consequent.length, 1);
    assertExists(result.value.alternate);
    assertEquals(Array.isArray(result.value.alternate), true);

    if (Array.isArray(result.value.alternate)) {
      assertEquals(result.value.alternate.length, 1);
      const altCmd = result.value.alternate[0] as AST.Command;
      const altName = altCmd?.name as AST.Word;
      assertEquals(altName.value, "echo");
      const altArg = altCmd?.args[0] as AST.Word;
      assertEquals(altArg?.value, "no");
    }
  }
});

Deno.test("ifStatement - parses if-elif-fi", () => {
  const state = parseTokens("if test -f file1; then echo one; elif test -f file2; then echo two; fi");
  const result = ifStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
    assertExists(result.value.alternate);
    assertEquals(typeof result.value.alternate, "object");

    if (!Array.isArray(result.value.alternate)) {
      assertEquals(result.value.alternate.type, "IfStatement");
      const elifCmd = result.value.alternate.consequent[0] as AST.Command;
      const elifName = elifCmd?.name as AST.Word;
      assertEquals(elifName.value, "echo");
      const elifArg = elifCmd?.args[0] as AST.Word;
      assertEquals(elifArg?.value, "two");
    }
  }
});

Deno.test("ifStatement - parses if-elif-else-fi", () => {
  const state = parseTokens(
    "if test -f file1; then echo one; elif test -f file2; then echo two; else echo three; fi"
  );
  const result = ifStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
    assertExists(result.value.alternate);

    if (!Array.isArray(result.value.alternate)) {
      assertEquals(result.value.alternate.type, "IfStatement");
      assertExists(result.value.alternate.alternate);
      if (Array.isArray(result.value.alternate.alternate)) {
        const elseCmd = result.value.alternate.alternate[0] as AST.Command;
        const elseName = elseCmd?.name as AST.Word;
        assertEquals(elseName.value, "echo");
        const elseArg = elseCmd?.args[0] as AST.Word;
        assertEquals(elseArg?.value, "three");
      }
    }
  }
});

Deno.test("ifStatement - parses multi-line if", () => {
  const state = parseTokens(`if test -f file
then
  echo yes
fi`);
  const result = ifStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
    assertEquals(result.value.consequent.length, 1);
  }
});

// ============================================================================
// For Statement Tests
// ============================================================================

Deno.test("forStatement - parses for-in-do-done", () => {
  const state = parseTokens("for i in 1 2 3; do echo $i; done");
  const result = forStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "ForStatement");
    assertEquals(result.value.variable, "i");
    assertEquals(result.value.iterable.length, 3);
    const item0 = result.value.iterable[0] as AST.Word;
    const item1 = result.value.iterable[1] as AST.Word;
    const item2 = result.value.iterable[2] as AST.Word;
    assertEquals(item0?.value, "1");
    assertEquals(item1?.value, "2");
    assertEquals(item2?.value, "3");
    assertEquals(result.value.body.length, 1);

    const bodyCmd = result.value.body[0] as AST.Command;
    const bodyName = bodyCmd?.name as AST.Word;
    assertEquals(bodyName.value, "echo");
  }
});

Deno.test("forStatement - parses for-do-done (no in)", () => {
  const state = parseTokens("for i; do echo $i; done");
  const result = forStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "ForStatement");
    assertEquals(result.value.variable, "i");
    assertEquals(result.value.iterable.length, 0);
    assertEquals(result.value.body.length, 1);
  }
});

Deno.test("forStatement - parses for with multiple commands in body", () => {
  const state = parseTokens("for x in a b; do echo start; echo $x; echo end; done");
  const result = forStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "ForStatement");
    assertEquals(result.value.variable, "x");
    assertEquals(result.value.body.length, 3);
  }
});

Deno.test("forStatement - parses multi-line for", () => {
  const state = parseTokens(`for item in one two three
do
  echo $item
done`);
  const result = forStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "ForStatement");
    assertEquals(result.value.variable, "item");
    assertEquals(result.value.iterable.length, 3);
  }
});

// ============================================================================
// While Statement Tests
// ============================================================================

Deno.test("whileStatement - parses while-do-done", () => {
  const state = parseTokens("while test -f file; do echo waiting; done");
  const result = whileStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "WhileStatement");
    assertExists(result.value.test);
    assertEquals(result.value.test.type, "Pipeline");
    assertEquals(result.value.body.length, 1);

    const pipeline = result.value.test as AST.Pipeline;
    const testCmd = pipeline.commands[0] as AST.Command;
    const testName = testCmd?.name as AST.Word;
    assertEquals(testName.value, "test");

    const bodyCmd = result.value.body[0] as AST.Command;
    const bodyName = bodyCmd?.name as AST.Word;
    assertEquals(bodyName.value, "echo");
  }
});

Deno.test("whileStatement - parses while with multiple body commands", () => {
  const state = parseTokens("while true; do echo running; sleep 1; done");
  const result = whileStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "WhileStatement");
    assertEquals(result.value.body.length, 2);

    const cmd1 = result.value.body[0] as AST.Command;
    const cmd2 = result.value.body[1] as AST.Command;
    const cmd1Name = cmd1?.name as AST.Word;
    const cmd2Name = cmd2?.name as AST.Word;
    assertEquals(cmd1Name.value, "echo");
    assertEquals(cmd2Name.value, "sleep");
  }
});

Deno.test("whileStatement - parses multi-line while", () => {
  const state = parseTokens(`while test -n "$var"
do
  echo loop
done`);
  const result = whileStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "WhileStatement");
    assertEquals(result.value.body.length, 1);
  }
});

// ============================================================================
// Statement Parser Tests
// ============================================================================

Deno.test("statementParser - dispatches to ifStatement", () => {
  const state = parseTokens("if test -f file; then echo yes; fi");
  const result = statementParser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
  }
});

Deno.test("statementParser - dispatches to forStatement", () => {
  const state = parseTokens("for i in 1 2; do echo $i; done");
  const result = statementParser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "ForStatement");
  }
});

Deno.test("statementParser - dispatches to whileStatement", () => {
  const state = parseTokens("while true; do echo loop; done");
  const result = statementParser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "WhileStatement");
  }
});

Deno.test("statementParser - dispatches to simpleCommand", () => {
  const state = parseTokens("echo hello");
  const result = statementParser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "Command");
  }
});

Deno.test("statementParser - fails on invalid input", () => {
  const state = parseTokens(";");
  const result = statementParser(state);

  assertEquals(result.success, false);
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test("integration - nested if statements", () => {
  const state = parseTokens(
    "if test -f file1; then if test -f file2; then echo both; fi; fi"
  );
  const result = ifStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "IfStatement");
    assertEquals(result.value.consequent.length, 1);
    const nestedIf = result.value.consequent[0] as AST.IfStatement;
    assertEquals(nestedIf?.type, "IfStatement");
  }
});

Deno.test("integration - for loop with if statement", () => {
  const state = parseTokens("for i in 1 2; do if test $i; then echo $i; fi; done");
  const result = forStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "ForStatement");
    assertEquals(result.value.body.length, 1);
    const ifStmt = result.value.body[0] as AST.IfStatement;
    assertEquals(ifStmt?.type, "IfStatement");
  }
});

Deno.test("integration - while loop with multiple statements", () => {
  const state = parseTokens(
    "while test -f file; do echo start; echo processing; echo end; done"
  );
  const result = whileStatement(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, "WhileStatement");
    assertEquals(result.value.body.length, 3);
  }
});
