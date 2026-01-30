/**
 * Tests for Parser ID generation and PositionMap integration.
 * SSH-457: Refactor Parser to use IdGenerator and PositionMap
 */

import { assertEquals, assertExists } from "@std/assert";
import { Parser } from "./parser.ts";
import type { Word, Pipeline, Command } from "./ast.ts";

Deno.test("Parser creates IdGenerator", () => {
  const parser = new Parser("echo hello");
  const posMap = parser.getPositionMap();

  // Position map should exist
  assertExists(posMap);

  // Initially empty (no nodes created yet)
  assertEquals(posMap.size, 0);
});

Deno.test("Parser creates PositionMap", () => {
  const parser = new Parser("echo hello");
  const posMap = parser.getPositionMap();

  assertExists(posMap);
  assertEquals(typeof posMap.set, "function");
  assertEquals(typeof posMap.get, "function");
  assertEquals(typeof posMap.has, "function");
});

Deno.test("Parsed Word nodes have id field", () => {
  const parser = new Parser("echo hello");
  const ast = parser.parse();

  // Get the pipeline
  const pipeline = ast.body[0] as Pipeline;
  assertExists(pipeline);
  assertEquals(pipeline.type, "Pipeline");

  // Get the command
  const command = pipeline.commands[0] as Command;
  assertExists(command);
  assertEquals(command.type, "Command");

  // Check command args have IDs
  const word = command.args[0] as Word;
  assertExists(word);
  assertEquals(word.type, "Word");
  assertEquals(word.value, "hello");

  // Word should have an id field
  assertExists(word.id);
  assertEquals(typeof word.id, "number");
});

Deno.test("PositionMap contains Word locations", () => {
  const parser = new Parser("echo hello");
  const ast = parser.parse();
  const posMap = parser.getPositionMap();

  // Get the word
  const pipeline = ast.body[0] as Pipeline;
  const command = pipeline.commands[0] as Command;
  const word = command.args[0] as Word;

  assertExists(word.id);

  // PositionMap should have the word's location
  assertEquals(posMap.has(word.id), true);

  const loc = posMap.get(word.id);
  assertExists(loc);
  assertExists(loc.start);
  assertExists(loc.end);

  // Verify location properties
  assertEquals(typeof loc.start.line, "number");
  assertEquals(typeof loc.start.column, "number");
  assertEquals(typeof loc.start.offset, "number");
  assertEquals(typeof loc.end.line, "number");
  assertEquals(typeof loc.end.column, "number");
  assertEquals(typeof loc.end.offset, "number");
});

Deno.test("IDs are sequential", () => {
  const parser = new Parser("echo hello world");
  const ast = parser.parse();

  const pipeline = ast.body[0] as Pipeline;
  const command = pipeline.commands[0] as Command;
  const word1 = command.args[0] as Word;
  const word2 = command.args[1] as Word;

  assertExists(word1.id);
  assertExists(word2.id);

  // IDs should be sequential (word2 ID > word1 ID)
  assertEquals(word2.id > word1.id, true);
});

Deno.test("getPositionMap() returns the map", () => {
  const parser = new Parser("echo test");
  const ast = parser.parse();
  const posMap = parser.getPositionMap();

  // Should be the same instance
  const posMap2 = parser.getPositionMap();
  assertEquals(posMap, posMap2);

  // Should contain entries after parsing
  assertEquals(posMap.size > 0, true);
});

Deno.test("Multiple words get unique IDs", () => {
  const parser = new Parser("echo one two three");
  const ast = parser.parse();

  const pipeline = ast.body[0] as Pipeline;
  const command = pipeline.commands[0] as Command;
  const ids = new Set();

  for (const arg of command.args) {
    const word = arg as Word;
    assertExists(word.id);

    // Each ID should be unique
    assertEquals(ids.has(word.id), false);
    ids.add(word.id);
  }

  // Should have 3 unique IDs
  assertEquals(ids.size, 3);
});

Deno.test("Word locations are accurate", () => {
  const input = "echo hello";
  const parser = new Parser(input);
  const ast = parser.parse();
  const posMap = parser.getPositionMap();

  const pipeline = ast.body[0] as Pipeline;
  const command = pipeline.commands[0] as Command;
  const word = command.args[0] as Word;

  assertExists(word.id);
  const loc = posMap.get(word.id);
  assertExists(loc);

  // "hello" starts at offset 5 (after "echo ")
  // Line and column are 0-indexed in tokens
  assertEquals(loc.start.offset, 5);
  assertEquals(loc.end.offset, 10); // "hello" is 5 chars long
});

Deno.test("Word node has loc field matching PositionMap", () => {
  const parser = new Parser("echo test");
  const ast = parser.parse();
  const posMap = parser.getPositionMap();

  const pipeline = ast.body[0] as Pipeline;
  const command = pipeline.commands[0] as Command;
  const word = command.args[0] as Word;

  assertExists(word.id);
  assertExists(word.loc);

  // The loc on the node should match what's in the position map
  const mapLoc = posMap.get(word.id);
  assertExists(mapLoc);

  assertEquals(word.loc.start.line, mapLoc.start.line);
  assertEquals(word.loc.start.column, mapLoc.start.column);
  assertEquals(word.loc.start.offset, mapLoc.start.offset);
  assertEquals(word.loc.end.line, mapLoc.end.line);
  assertEquals(word.loc.end.column, mapLoc.end.column);
  assertEquals(word.loc.end.offset, mapLoc.end.offset);
});
