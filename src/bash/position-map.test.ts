import { assertEquals, assertExists } from "@std/assert";
import { PositionMap } from "./position-map.ts";
import { createTokenId } from "./token-id.ts";
import type { SourceLocation } from "./ast.ts";

Deno.test("PositionMap - set and get work correctly", () => {
  const map = new PositionMap();
  const id = createTokenId(1);
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  map.set(id, loc);
  const result = map.get(id);

  assertExists(result);
  assertEquals(result.start.line, 1);
  assertEquals(result.start.column, 0);
  assertEquals(result.start.offset, 0);
  assertEquals(result.end.line, 1);
  assertEquals(result.end.column, 5);
  assertEquals(result.end.offset, 5);
});

Deno.test("PositionMap - get returns undefined for non-existent ID", () => {
  const map = new PositionMap();
  const id = createTokenId(999);

  const result = map.get(id);

  assertEquals(result, undefined);
});

Deno.test("PositionMap - has returns correct values", () => {
  const map = new PositionMap();
  const id1 = createTokenId(1);
  const id2 = createTokenId(2);
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  map.set(id1, loc);

  assertEquals(map.has(id1), true);
  assertEquals(map.has(id2), false);
});

Deno.test("PositionMap - span combines locations correctly", () => {
  const map = new PositionMap();
  const id1 = createTokenId(1);
  const id2 = createTokenId(2);
  const loc1: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };
  const loc2: SourceLocation = {
    start: { line: 1, column: 10, offset: 10 },
    end: { line: 2, column: 3, offset: 20 },
  };

  map.set(id1, loc1);
  map.set(id2, loc2);

  const result = map.span(id1, id2);

  assertExists(result);
  assertEquals(result.start.line, 1);
  assertEquals(result.start.column, 0);
  assertEquals(result.start.offset, 0);
  assertEquals(result.end.line, 2);
  assertEquals(result.end.column, 3);
  assertEquals(result.end.offset, 20);
});

Deno.test("PositionMap - span returns undefined if start ID not found", () => {
  const map = new PositionMap();
  const id1 = createTokenId(1);
  const id2 = createTokenId(2);
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  map.set(id2, loc);

  const result = map.span(id1, id2);

  assertEquals(result, undefined);
});

Deno.test("PositionMap - span returns undefined if end ID not found", () => {
  const map = new PositionMap();
  const id1 = createTokenId(1);
  const id2 = createTokenId(2);
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  map.set(id1, loc);

  const result = map.span(id1, id2);

  assertEquals(result, undefined);
});

Deno.test("PositionMap - span works with same ID", () => {
  const map = new PositionMap();
  const id = createTokenId(1);
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  map.set(id, loc);

  const result = map.span(id, id);

  assertExists(result);
  assertEquals(result.start.line, 1);
  assertEquals(result.start.column, 0);
  assertEquals(result.start.offset, 0);
  assertEquals(result.end.line, 1);
  assertEquals(result.end.column, 5);
  assertEquals(result.end.offset, 5);
});

Deno.test("PositionMap - size tracks entries", () => {
  const map = new PositionMap();
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  assertEquals(map.size, 0);

  map.set(createTokenId(1), loc);
  assertEquals(map.size, 1);

  map.set(createTokenId(2), loc);
  assertEquals(map.size, 2);

  map.set(createTokenId(3), loc);
  assertEquals(map.size, 3);
});

Deno.test("PositionMap - size doesn't increase when updating existing entry", () => {
  const map = new PositionMap();
  const id = createTokenId(1);
  const loc1: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };
  const loc2: SourceLocation = {
    start: { line: 2, column: 0, offset: 10 },
    end: { line: 2, column: 5, offset: 15 },
  };

  map.set(id, loc1);
  assertEquals(map.size, 1);

  map.set(id, loc2);
  assertEquals(map.size, 1);

  const result = map.get(id);
  assertExists(result);
  assertEquals(result.start.line, 2);
});

Deno.test("PositionMap - clear removes all entries", () => {
  const map = new PositionMap();
  const loc: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };

  map.set(createTokenId(1), loc);
  map.set(createTokenId(2), loc);
  map.set(createTokenId(3), loc);

  assertEquals(map.size, 3);

  map.clear();

  assertEquals(map.size, 0);
  assertEquals(map.has(createTokenId(1)), false);
  assertEquals(map.has(createTokenId(2)), false);
  assertEquals(map.has(createTokenId(3)), false);
});

Deno.test("PositionMap - entries iterates correctly", () => {
  const map = new PositionMap();
  const id1 = createTokenId(1);
  const id2 = createTokenId(2);
  const id3 = createTokenId(3);
  const loc1: SourceLocation = {
    start: { line: 1, column: 0, offset: 0 },
    end: { line: 1, column: 5, offset: 5 },
  };
  const loc2: SourceLocation = {
    start: { line: 2, column: 0, offset: 10 },
    end: { line: 2, column: 5, offset: 15 },
  };
  const loc3: SourceLocation = {
    start: { line: 3, column: 0, offset: 20 },
    end: { line: 3, column: 5, offset: 25 },
  };

  map.set(id1, loc1);
  map.set(id2, loc2);
  map.set(id3, loc3);

  const entries = Array.from(map.entries());

  assertEquals(entries.length, 3);

  // Verify all entries are present
  const ids = entries.map(([id]) => id);
  assertEquals(ids.includes(id1), true);
  assertEquals(ids.includes(id2), true);
  assertEquals(ids.includes(id3), true);

  // Verify locations are correct
  const entry1 = entries.find(([id]) => id === id1);
  assertExists(entry1);
  assertEquals(entry1[1].start.line, 1);

  const entry2 = entries.find(([id]) => id === id2);
  assertExists(entry2);
  assertEquals(entry2[1].start.line, 2);

  const entry3 = entries.find(([id]) => id === id3);
  assertExists(entry3);
  assertEquals(entry3[1].start.line, 3);
});

Deno.test("PositionMap - entries returns empty iterator for empty map", () => {
  const map = new PositionMap();
  const entries = Array.from(map.entries());

  assertEquals(entries.length, 0);
});
