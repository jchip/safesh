import { assertEquals, assertStrictEquals } from "@std/assert";
import { createTokenId, IdGenerator, type TokenId } from "./token-id.ts";

Deno.test("TokenId - is a number at runtime", () => {
  const id: TokenId = createTokenId(42);
  assertEquals(typeof id, "number");
  assertEquals(id, 42);
});

Deno.test("IdGenerator - next() returns sequential IDs", () => {
  const gen = new IdGenerator();
  const id1 = gen.next();
  const id2 = gen.next();
  const id3 = gen.next();

  assertEquals(id1, 0);
  assertEquals(id2, 1);
  assertEquals(id3, 2);
});

Deno.test("IdGenerator - each call returns unique ID", () => {
  const gen = new IdGenerator();
  const ids = new Set<number>();

  for (let i = 0; i < 100; i++) {
    const id = gen.next();
    assertEquals(ids.has(id), false, `ID ${id} was already generated`);
    ids.add(id);
  }

  assertEquals(ids.size, 100);
});

Deno.test("IdGenerator - reset works correctly", () => {
  const gen = new IdGenerator();

  const id1 = gen.next();
  const id2 = gen.next();
  assertEquals(id1, 0);
  assertEquals(id2, 1);
  assertEquals(gen.count, 2);

  gen.reset();
  assertEquals(gen.count, 0);

  const id3 = gen.next();
  const id4 = gen.next();
  assertEquals(id3, 0);
  assertEquals(id4, 1);
});

Deno.test("IdGenerator - count tracks number of IDs generated", () => {
  const gen = new IdGenerator();
  assertEquals(gen.count, 0);

  gen.next();
  assertEquals(gen.count, 1);

  gen.next();
  gen.next();
  assertEquals(gen.count, 3);

  gen.reset();
  assertEquals(gen.count, 0);
});

Deno.test("createTokenId - creates TokenId from number", () => {
  const id = createTokenId(123);
  assertEquals(id, 123);
  assertEquals(typeof id, "number");
});

Deno.test("IdGenerator - multiple instances are independent", () => {
  const gen1 = new IdGenerator();
  const gen2 = new IdGenerator();

  const id1a = gen1.next();
  const id2a = gen2.next();
  const id1b = gen1.next();
  const id2b = gen2.next();

  assertEquals(id1a, 0);
  assertEquals(id2a, 0);
  assertEquals(id1b, 1);
  assertEquals(id2b, 1);

  assertEquals(gen1.count, 2);
  assertEquals(gen2.count, 2);
});
