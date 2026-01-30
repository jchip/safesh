/**
 * Tests for AST node id field (SSH-456)
 */

import { assertEquals, assertExists } from "@std/assert";
import type {
  BaseNode,
  Command,
  IfStatement,
  ParameterExpansion,
  Program,
  VariableAssignment,
  Word,
} from "./ast.ts";
import { createTokenId, IdGenerator, type TokenId } from "./token-id.ts";

Deno.test("BaseNode - can have optional id field", () => {
  const node: BaseNode = {
    type: "TestNode",
  };

  // Node without id is valid
  assertEquals(node.id, undefined);

  // Node with id is valid
  const nodeWithId: BaseNode = {
    type: "TestNode",
    id: createTokenId(1),
  };
  assertExists(nodeWithId.id);
  assertEquals(nodeWithId.id, 1 as TokenId);
});

Deno.test("Command node - can have optional id field", () => {
  const word: Word = {
    type: "Word",
    value: "echo",
    quoted: false,
    singleQuoted: false,
    parts: [],
  };

  const command: Command = {
    type: "Command",
    name: word,
    args: [],
    redirects: [],
    assignments: [],
  };

  // Command without id is valid
  assertEquals(command.id, undefined);

  // Command with id is valid
  const commandWithId: Command = {
    type: "Command",
    name: word,
    args: [],
    redirects: [],
    assignments: [],
    id: createTokenId(42),
  };
  assertExists(commandWithId.id);
  assertEquals(commandWithId.id, 42 as TokenId);
});

Deno.test("Word node - can have optional id field", () => {
  const word: Word = {
    type: "Word",
    value: "test",
    quoted: false,
    singleQuoted: false,
    parts: [],
  };

  // Word without id is valid
  assertEquals(word.id, undefined);

  // Word with id is valid
  const wordWithId: Word = {
    type: "Word",
    value: "test",
    quoted: false,
    singleQuoted: false,
    parts: [],
    id: createTokenId(10),
  };
  assertExists(wordWithId.id);
  assertEquals(wordWithId.id, 10 as TokenId);
});

Deno.test("VariableAssignment node - can have optional id field", () => {
  const value: Word = {
    type: "Word",
    value: "value",
    quoted: false,
    singleQuoted: false,
    parts: [],
  };

  const assignment: VariableAssignment = {
    type: "VariableAssignment",
    name: "VAR",
    value,
  };

  // Assignment without id is valid
  assertEquals(assignment.id, undefined);

  // Assignment with id is valid
  const assignmentWithId: VariableAssignment = {
    type: "VariableAssignment",
    name: "VAR",
    value,
    id: createTokenId(5),
  };
  assertExists(assignmentWithId.id);
  assertEquals(assignmentWithId.id, 5 as TokenId);
});

Deno.test("IfStatement node - can have optional id field", () => {
  const testCommand: Command = {
    type: "Command",
    name: {
      type: "Word",
      value: "test",
      quoted: false,
      singleQuoted: false,
      parts: [],
    },
    args: [],
    redirects: [],
    assignments: [],
  };

  const ifStmt: IfStatement = {
    type: "IfStatement",
    test: testCommand,
    consequent: [],
    alternate: null,
  };

  // IfStatement without id is valid
  assertEquals(ifStmt.id, undefined);

  // IfStatement with id is valid
  const ifStmtWithId: IfStatement = {
    type: "IfStatement",
    test: testCommand,
    consequent: [],
    alternate: null,
    id: createTokenId(100),
  };
  assertExists(ifStmtWithId.id);
  assertEquals(ifStmtWithId.id, 100 as TokenId);
});

Deno.test("ParameterExpansion node - can have optional id field", () => {
  const param: ParameterExpansion = {
    type: "ParameterExpansion",
    parameter: "HOME",
  };

  // ParameterExpansion without id is valid
  assertEquals(param.id, undefined);

  // ParameterExpansion with id is valid
  const paramWithId: ParameterExpansion = {
    type: "ParameterExpansion",
    parameter: "HOME",
    id: createTokenId(7),
  };
  assertExists(paramWithId.id);
  assertEquals(paramWithId.id, 7 as TokenId);
});

Deno.test("Program node - can have optional id field", () => {
  const program: Program = {
    type: "Program",
    body: [],
  };

  // Program without id is valid
  assertEquals(program.id, undefined);

  // Program with id is valid
  const programWithId: Program = {
    type: "Program",
    body: [],
    id: createTokenId(1),
  };
  assertExists(programWithId.id);
  assertEquals(programWithId.id, 1 as TokenId);
});

Deno.test("Multiple nodes - can use IdGenerator", () => {
  const idGen = new IdGenerator();

  const word: Word = {
    type: "Word",
    value: "echo",
    quoted: false,
    singleQuoted: false,
    parts: [],
    id: idGen.next(),
  };

  const command: Command = {
    type: "Command",
    name: word,
    args: [],
    redirects: [],
    assignments: [],
    id: idGen.next(),
  };

  const program: Program = {
    type: "Program",
    body: [command],
    id: idGen.next(),
  };

  // All nodes have unique sequential IDs
  assertEquals(word.id, 0 as TokenId);
  assertEquals(command.id, 1 as TokenId);
  assertEquals(program.id, 2 as TokenId);
  assertEquals(idGen.count, 3);
});

Deno.test("Type checking - id must be TokenId type", () => {
  // This test verifies compile-time type checking
  // If these assignments compile, the type system is working correctly

  const validNode: BaseNode = {
    type: "Test",
    id: createTokenId(1), // Valid: TokenId type
  };

  assertEquals(validNode.id, 1 as TokenId);

  // The following would cause a compile error (commented out):
  // const invalidNode: BaseNode = {
  //   type: "Test",
  //   id: 1, // Invalid: plain number, not TokenId
  // };

  // The following would cause a compile error (commented out):
  // const invalidNode2: BaseNode = {
  //   type: "Test",
  //   id: "not-a-number", // Invalid: string, not TokenId
  // };
});

Deno.test("Backwards compatibility - nodes without id still work", () => {
  // All existing code that doesn't use id should continue to work

  const word: Word = {
    type: "Word",
    value: "test",
    quoted: false,
    singleQuoted: false,
    parts: [],
  };

  const command: Command = {
    type: "Command",
    name: word,
    args: [word],
    redirects: [],
    assignments: [],
  };

  const program: Program = {
    type: "Program",
    body: [command],
  };

  // All nodes are valid without id fields
  assertEquals(word.id, undefined);
  assertEquals(command.id, undefined);
  assertEquals(program.id, undefined);

  // All required fields are present and correct
  assertEquals(word.type, "Word");
  assertEquals(command.type, "Command");
  assertEquals(program.type, "Program");
  assertEquals(program.body.length, 1);
  assertEquals(command.args.length, 1);
});
