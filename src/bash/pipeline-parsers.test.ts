/**
 * Tests for Pipeline Parsers using Combinator Approach
 *
 * Comprehensive test suite verifying:
 * - Basic command parsing
 * - Pipeline parsing
 * - Logical operators (&&, ||)
 * - Background execution (&)
 * - Left-associativity of operators
 */

import { assertEquals } from "@std/assert";
import { tokenize } from "./lexer.ts";
import {
  simpleCommand,
  pipeline,
  andOrList,
  completeCommand,
  parsePipeline,
  wrapInPipeline,
} from "./pipeline-parsers.ts";
import { createState } from "./combinators.ts";
import type * as AST from "./ast.ts";

Deno.test("simpleCommand - parses single word command", () => {
  const tokens = tokenize("echo");
  const state = createState(tokens);
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Command");
  assertEquals((result.value.name as AST.Word).value, "echo");
  assertEquals(result.value.args.length, 0);
});

Deno.test("simpleCommand - parses command with arguments", () => {
  const tokens = tokenize("echo hello world");
  const state = createState(tokens);
  const result = simpleCommand(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Command");
  assertEquals((result.value.name as AST.Word).value, "echo");
  assertEquals(result.value.args.length, 2);
  assertEquals((result.value.args[0] as AST.Word)?.value, "hello");
  assertEquals((result.value.args[1] as AST.Word)?.value, "world");
});

Deno.test("pipeline - parses single command", () => {
  const tokens = tokenize("echo test");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  // Single command should remain as Command
  assertEquals(result.value.type, "Command");
});

Deno.test("pipeline - parses cmd1 | cmd2", () => {
  const tokens = tokenize("echo test | grep test");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.operator, "|");
  assertEquals(pipe.commands.length, 2);

  const cmd1 = pipe.commands[0] as AST.Command;
  const cmd2 = pipe.commands[1] as AST.Command;
  assertEquals((cmd1.name as AST.Word).value, "echo");
  assertEquals((cmd2.name as AST.Word).value, "grep");
});

Deno.test("pipeline - parses cmd1 | cmd2 | cmd3 (left-associative)", () => {
  const tokens = tokenize("cat file | grep test | sort");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.operator, "|");
  assertEquals(pipe.commands.length, 3);

  // Verify all commands are at the same level (flat structure)
  const cmd1 = pipe.commands[0] as AST.Command;
  const cmd2 = pipe.commands[1] as AST.Command;
  const cmd3 = pipe.commands[2] as AST.Command;
  assertEquals((cmd1.name as AST.Word).value, "cat");
  assertEquals((cmd2.name as AST.Word).value, "grep");
  assertEquals((cmd3.name as AST.Word).value, "sort");

  // This verifies left-associativity:
  // ((cat | grep) | sort) is represented as flat [cat, grep, sort]
  // NOT as nested structure
});

Deno.test("andOrList - parses cmd1 && cmd2", () => {
  const tokens = tokenize("test -f file && cat file");
  const state = createState(tokens);
  const result = andOrList(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.operator, "&&");
  assertEquals(pipe.commands.length, 2);
});

Deno.test("andOrList - parses cmd1 || cmd2", () => {
  const tokens = tokenize("command1 || command2");
  const state = createState(tokens);
  const result = andOrList(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.operator, "||");
  assertEquals(pipe.commands.length, 2);
});

Deno.test("andOrList - parses mixed: cmd1 && cmd2 || cmd3", () => {
  const tokens = tokenize("cmd1 && cmd2 || cmd3");
  const state = createState(tokens);
  const result = andOrList(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  // Due to left-associativity and operator precedence:
  // (cmd1 && cmd2) || cmd3
  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;

  // The result should be a || pipeline with two commands
  assertEquals(pipe.operator, "||");
  assertEquals(pipe.commands.length, 2);

  // First command should be the && pipeline
  const first = pipe.commands[0];
  assertEquals(first?.type, "Pipeline");
  const firstPipe = first as AST.Pipeline;
  assertEquals(firstPipe.operator, "&&");
});

Deno.test("completeCommand - handles trailing &", () => {
  const tokens = tokenize("sleep 10 &");
  const state = createState(tokens);
  const result = completeCommand(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.background, true);
  assertEquals(pipe.operator, "&");
});

Deno.test("completeCommand - no trailing & means synchronous", () => {
  const tokens = tokenize("echo test");
  const state = createState(tokens);
  const result = completeCommand(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  // Single command without & should remain as Command
  if (result.value.type === "Pipeline") {
    assertEquals(result.value.background, false);
  }
});

Deno.test("parsePipeline - convenience function works", () => {
  const tokens = tokenize("ls | grep txt");
  const result = parsePipeline(tokens);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.commands.length, 2);
});

Deno.test("wrapInPipeline - wraps command in pipeline", () => {
  const cmd: AST.Command = {
    type: "Command",
    name: { type: "Word", value: "echo", quoted: false, singleQuoted: false, parts: [] },
    args: [],
    redirects: [],
    assignments: [],
  };

  const pipe = wrapInPipeline(cmd);
  assertEquals(pipe.type, "Pipeline");
  assertEquals(pipe.commands.length, 1);
  assertEquals(pipe.operator, null);
  assertEquals(pipe.background, false);
});

Deno.test("Left-associativity - verify ((a | b) | c) not (a | (b | c))", () => {
  const tokens = tokenize("a | b | c");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;

  // Left-associativity means flat structure [a, b, c]
  // NOT nested structure with b|c as second element
  assertEquals(pipe.commands.length, 3);

  // All commands should be at top level
  assertEquals(pipe.commands[0]?.type, "Command");
  assertEquals(pipe.commands[1]?.type, "Command");
  assertEquals(pipe.commands[2]?.type, "Command");

  // NOT: pipe.commands[1].type === "Pipeline"
  // which would indicate right-associative: a | (b | c)
});

Deno.test("Left-associativity - verify &&/|| chaining", () => {
  const tokens = tokenize("a && b && c");
  const state = createState(tokens);
  const result = andOrList(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;

  // Left-associativity: ((a && b) && c) represented as flat [a, b, c]
  assertEquals(pipe.operator, "&&");
  assertEquals(pipe.commands.length, 3);
});

Deno.test("Pipeline with whitespace variations", () => {
  const tokens = tokenize("echo   test  |  grep   pattern");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.commands.length, 2);
});

Deno.test("Complex pipeline - cmd1 | cmd2 && cmd3 || cmd4", () => {
  const tokens = tokenize("cat file | grep test && echo found || echo missing");
  const state = createState(tokens);
  const result = completeCommand(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  // The structure should respect left-associativity and operator parsing:
  // ((cat file | grep test) && echo found) || echo missing
  assertEquals(result.value.type, "Pipeline");
});

Deno.test("Pipeline with newlines between operators", () => {
  const tokens = tokenize("echo test |\ngrep test");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;
  assertEquals(pipe.commands.length, 2);
});

Deno.test("Single command with no operators", () => {
  const tokens = tokenize("pwd");
  const result = parsePipeline(tokens);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Command");
});

Deno.test("Four-command pipeline - verify flat structure", () => {
  const tokens = tokenize("a | b | c | d");
  const state = createState(tokens);
  const result = pipeline(state);

  assertEquals(result.success, true);
  if (!result.success) return;

  assertEquals(result.value.type, "Pipeline");
  const pipe = result.value as AST.Pipeline;

  // Left-associativity: (((a | b) | c) | d) = flat [a, b, c, d]
  assertEquals(pipe.commands.length, 4);
  assertEquals(pipe.commands.every(cmd => cmd.type === "Command"), true);
});
