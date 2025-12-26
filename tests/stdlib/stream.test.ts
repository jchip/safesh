/**
 * Tests for core Stream implementation
 */

import { assertEquals, assertExists } from "@std/assert";
import { createStream, fromArray, empty, type Stream } from "../../src/stdlib/stream.ts";

Deno.test({
  name: "createStream - creates a stream from async generator",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
      yield 3;
    })());

    assertExists(stream);
    assertEquals(typeof stream.pipe, "function");
    assertEquals(typeof stream.collect, "function");
  },
});

Deno.test({
  name: "createStream - is async iterable",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
      yield 3;
    })());

    const results: number[] = [];
    for await (const value of stream) {
      results.push(value);
    }

    assertEquals(results, [1, 2, 3]);
  },
});

Deno.test({
  name: "collect - returns all values as array",
  async fn() {
    const stream = createStream((async function* () {
      yield "a";
      yield "b";
      yield "c";
    })());

    const result = await stream.collect();
    assertEquals(result, ["a", "b", "c"]);
  },
});

Deno.test({
  name: "collect - handles empty stream",
  async fn() {
    const stream = createStream((async function* () {
      // Empty
    })());

    const result = await stream.collect();
    assertEquals(result, []);
  },
});

Deno.test({
  name: "forEach - executes function for each value",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
      yield 3;
    })());

    const results: number[] = [];
    await stream.forEach((value) => {
      results.push(value * 2);
    });

    assertEquals(results, [2, 4, 6]);
  },
});

Deno.test({
  name: "forEach - supports async functions",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
    })());

    const results: number[] = [];
    await stream.forEach(async (value) => {
      await Promise.resolve(); // Simulate async work
      results.push(value);
    });

    assertEquals(results, [1, 2]);
  },
});

Deno.test({
  name: "first - returns first value",
  async fn() {
    const stream = createStream((async function* () {
      yield 10;
      yield 20;
      yield 30;
    })());

    const result = await stream.first();
    assertEquals(result, 10);
  },
});

Deno.test({
  name: "first - returns undefined for empty stream",
  async fn() {
    const stream = createStream((async function* () {
      // Empty
    })());

    const result = await stream.first();
    assertEquals(result, undefined);
  },
});

Deno.test({
  name: "first - stops iteration after first value",
  async fn() {
    let iterations = 0;
    const stream = createStream((async function* () {
      yield iterations++;
      yield iterations++;
      yield iterations++;
    })());

    await stream.first();

    // Should only have iterated once
    assertEquals(iterations, 1);
  },
});

Deno.test({
  name: "count - returns total number of values",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    })());

    const result = await stream.count();
    assertEquals(result, 5);
  },
});

Deno.test({
  name: "count - returns 0 for empty stream",
  async fn() {
    const stream = createStream((async function* () {
      // Empty
    })());

    const result = await stream.count();
    assertEquals(result, 0);
  },
});

Deno.test({
  name: "pipe - applies transform and returns new stream",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
      yield 3;
    })());

    // Simple map transform
    const doubled = stream.pipe(async function* (source) {
      for await (const value of source) {
        yield value * 2;
      }
    });

    const result = await doubled.collect();
    assertEquals(result, [2, 4, 6]);
  },
});

Deno.test({
  name: "pipe - can be chained multiple times",
  async fn() {
    const stream = createStream((async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
    })());

    const result = await stream
      .pipe(async function* (source) {
        for await (const value of source) {
          yield value * 2; // Double
        }
      })
      .pipe(async function* (source) {
        for await (const value of source) {
          if (value > 4) yield value; // Filter > 4
        }
      })
      .collect();

    assertEquals(result, [6, 8]); // 3*2=6, 4*2=8
  },
});

Deno.test({
  name: "pipe - is lazy (doesn't execute until terminal operation)",
  async fn() {
    let executed = false;

    const stream = createStream((async function* () {
      executed = true;
      yield 1;
    })());

    const piped = stream.pipe(async function* (source) {
      for await (const value of source) {
        yield value;
      }
    });

    // Should not have executed yet
    assertEquals(executed, false);

    // Now execute
    await piped.collect();
    assertEquals(executed, true);
  },
});

Deno.test({
  name: "fromArray - creates stream from array",
  async fn() {
    const stream = fromArray([10, 20, 30]);
    const result = await stream.collect();
    assertEquals(result, [10, 20, 30]);
  },
});

Deno.test({
  name: "fromArray - handles empty array",
  async fn() {
    const stream = fromArray([]);
    const result = await stream.collect();
    assertEquals(result, []);
  },
});

Deno.test({
  name: "fromArray - can be piped",
  async fn() {
    const stream = fromArray([1, 2, 3]);

    const doubled = stream.pipe(async function* (source) {
      for await (const value of source) {
        yield value * 2;
      }
    });

    const result = await doubled.collect();
    assertEquals(result, [2, 4, 6]);
  },
});

Deno.test({
  name: "empty - creates empty stream",
  async fn() {
    const stream = empty<number>();

    const result = await stream.collect();
    assertEquals(result, []);

    const first = await empty<number>().first();
    assertEquals(first, undefined);

    const count = await empty<number>().count();
    assertEquals(count, 0);
  },
});

Deno.test({
  name: "Stream - preserves type information through pipes",
  async fn() {
    const numbers: Stream<number> = fromArray([1, 2, 3]);

    // Type should change from number to string
    const strings: Stream<string> = numbers.pipe(async function* (source) {
      for await (const value of source) {
        yield String(value);
      }
    });

    const result = await strings.collect();
    assertEquals(result, ["1", "2", "3"]);
  },
});
