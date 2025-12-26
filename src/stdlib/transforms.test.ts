/**
 * Tests for Common Transform Functions
 */

import { assertEquals } from "@std/assert";
import { fromArray } from "./stream.ts";
import { filter, flatMap, grep, lines, map, take } from "./transforms.ts";

Deno.test("filter() - filters items based on predicate", async () => {
  const stream = fromArray([1, 2, 3, 4, 5, 6]);
  const evens = stream.pipe(filter((x) => x % 2 === 0));
  const result = await evens.collect();
  assertEquals(result, [2, 4, 6]);
});

Deno.test("filter() - works with async predicate", async () => {
  const stream = fromArray([1, 2, 3, 4, 5]);
  const filtered = stream.pipe(
    filter(async (x) => {
      // Simulate async operation
      await Promise.resolve();
      return x > 2;
    }),
  );
  const result = await filtered.collect();
  assertEquals(result, [3, 4, 5]);
});

Deno.test("filter() - empty stream when no items match", async () => {
  const stream = fromArray([1, 3, 5, 7]);
  const evens = stream.pipe(filter((x) => x % 2 === 0));
  const result = await evens.collect();
  assertEquals(result, []);
});

Deno.test("filter() - all items when all match", async () => {
  const stream = fromArray([2, 4, 6, 8]);
  const evens = stream.pipe(filter((x) => x % 2 === 0));
  const result = await evens.collect();
  assertEquals(result, [2, 4, 6, 8]);
});

Deno.test("map() - transforms each item", async () => {
  const stream = fromArray([1, 2, 3, 4, 5]);
  const doubled = stream.pipe(map((x) => x * 2));
  const result = await doubled.collect();
  assertEquals(result, [2, 4, 6, 8, 10]);
});

Deno.test("map() - works with async function", async () => {
  const stream = fromArray([1, 2, 3]);
  const mapped = stream.pipe(
    map(async (x) => {
      // Simulate async operation
      await Promise.resolve();
      return x * 3;
    }),
  );
  const result = await mapped.collect();
  assertEquals(result, [3, 6, 9]);
});

Deno.test("map() - can change types", async () => {
  const stream = fromArray([1, 2, 3]);
  const strings = stream.pipe(map((x) => `number: ${x}`));
  const result = await strings.collect();
  assertEquals(result, ["number: 1", "number: 2", "number: 3"]);
});

Deno.test("map() - composes with other transforms", async () => {
  const stream = fromArray([1, 2, 3, 4, 5]);
  const result = await stream
    .pipe(filter((x) => x % 2 === 0))
    .pipe(map((x) => x * 2))
    .collect();
  assertEquals(result, [4, 8]);
});

Deno.test("flatMap() - flattens nested iterables", async () => {
  const stream = fromArray([[1, 2], [3, 4], [5]]);
  const flattened = stream.pipe(
    flatMap(async function* (arr) {
      for (const item of arr) {
        yield item;
      }
    }),
  );
  const result = await flattened.collect();
  assertEquals(result, [1, 2, 3, 4, 5]);
});

Deno.test("flatMap() - expands single items to multiple", async () => {
  const stream = fromArray(["ab", "cd", "ef"]);
  const chars = stream.pipe(
    flatMap(async function* (str) {
      for (const char of str) {
        yield char;
      }
    }),
  );
  const result = await chars.collect();
  assertEquals(result, ["a", "b", "c", "d", "e", "f"]);
});

Deno.test("flatMap() - can yield nothing for some items", async () => {
  const stream = fromArray([1, 2, 3]);
  const expanded = stream.pipe(
    flatMap(async function* (x) {
      if (x % 2 === 0) {
        yield x;
        yield x * 2;
      }
      // Odd numbers yield nothing
    }),
  );
  const result = await expanded.collect();
  assertEquals(result, [2, 4]);
});

Deno.test("flatMap() - can yield many items per input", async () => {
  const stream = fromArray([2, 3]);
  const repeated = stream.pipe(
    flatMap(async function* (x) {
      for (let i = 0; i < x; i++) {
        yield x;
      }
    }),
  );
  const result = await repeated.collect();
  assertEquals(result, [2, 2, 3, 3, 3]);
});

Deno.test("take() - takes first n items", async () => {
  const stream = fromArray([1, 2, 3, 4, 5]);
  const first3 = stream.pipe(take(3));
  const result = await first3.collect();
  assertEquals(result, [1, 2, 3]);
});

Deno.test("take() - takes all items if n is greater than length", async () => {
  const stream = fromArray([1, 2, 3]);
  const first10 = stream.pipe(take(10));
  const result = await first10.collect();
  assertEquals(result, [1, 2, 3]);
});

Deno.test("take() - returns empty for take(0)", async () => {
  const stream = fromArray([1, 2, 3]);
  const none = stream.pipe(take(0));
  const result = await none.collect();
  assertEquals(result, []);
});

Deno.test("take() - works with infinite streams", async () => {
  // Create an infinite stream
  const infiniteStream = (async function* () {
    let i = 0;
    while (true) {
      yield i++;
    }
  })();

  const stream = fromArray([]).pipe(() => infiniteStream);
  const first5 = stream.pipe(take(5));
  const result = await first5.collect();
  assertEquals(result, [0, 1, 2, 3, 4]);
});

Deno.test("lines() - splits text on newlines", async () => {
  const stream = fromArray(["line1\nline2\nline3"]);
  const lineStream = stream.pipe(lines());
  const result = await lineStream.collect();
  assertEquals(result, ["line1", "line2", "line3"]);
});

Deno.test("lines() - filters out empty lines", async () => {
  const stream = fromArray(["line1\n\nline2\n"]);
  const lineStream = stream.pipe(lines());
  const result = await lineStream.collect();
  assertEquals(result, ["line1", "line2"]);
});

Deno.test("lines() - handles multiple text chunks", async () => {
  const stream = fromArray(["chunk1\nchunk2", "chunk3\nchunk4"]);
  const lineStream = stream.pipe(lines());
  const result = await lineStream.collect();
  assertEquals(result, ["chunk1", "chunk2", "chunk3", "chunk4"]);
});

Deno.test("lines() - handles single line text", async () => {
  const stream = fromArray(["single line"]);
  const lineStream = stream.pipe(lines());
  const result = await lineStream.collect();
  assertEquals(result, ["single line"]);
});

Deno.test("lines() - handles text with trailing newline", async () => {
  const stream = fromArray(["line1\nline2\n"]);
  const lineStream = stream.pipe(lines());
  const result = await lineStream.collect();
  assertEquals(result, ["line1", "line2"]);
});

Deno.test("grep() - filters lines matching regex", async () => {
  const stream = fromArray(["ERROR: failed", "INFO: success", "ERROR: timeout"]);
  const errors = stream.pipe(grep(/ERROR/));
  const result = await errors.collect();
  assertEquals(result, ["ERROR: failed", "ERROR: timeout"]);
});

Deno.test("grep() - works with string pattern", async () => {
  const stream = fromArray(["hello world", "goodbye world", "hello there"]);
  const hellos = stream.pipe(grep("hello"));
  const result = await hellos.collect();
  assertEquals(result, ["hello world", "hello there"]);
});

Deno.test("grep() - case sensitive by default", async () => {
  const stream = fromArray(["ERROR: failed", "error: failed", "Error: failed"]);
  const uppercase = stream.pipe(grep("ERROR"));
  const result = await uppercase.collect();
  assertEquals(result, ["ERROR: failed"]);
});

Deno.test("grep() - supports case insensitive with regex flags", async () => {
  const stream = fromArray(["ERROR: failed", "error: failed", "Error: failed"]);
  const allErrors = stream.pipe(grep(/error/i));
  const result = await allErrors.collect();
  assertEquals(result, ["ERROR: failed", "error: failed", "Error: failed"]);
});

Deno.test("grep() - returns empty for no matches", async () => {
  const stream = fromArray(["line1", "line2", "line3"]);
  const noMatch = stream.pipe(grep("notfound"));
  const result = await noMatch.collect();
  assertEquals(result, []);
});

Deno.test("grep() - works with complex patterns", async () => {
  const stream = fromArray([
    "user@example.com",
    "not an email",
    "admin@test.org",
    "invalid",
  ]);
  const emails = stream.pipe(grep(/\w+@\w+\.\w+/));
  const result = await emails.collect();
  assertEquals(result, ["user@example.com", "admin@test.org"]);
});

Deno.test("integration - multiple transforms composed", async () => {
  const stream = fromArray([
    "log: ERROR user not found\n",
    "log: INFO request processed\n",
    "log: ERROR timeout occurred\n",
    "log: DEBUG variable x = 5\n",
  ]);

  const result = await stream
    .pipe(lines())
    .pipe(grep(/ERROR/))
    .pipe(map((line) => line.replace("log: ERROR ", "")))
    .pipe(take(1))
    .collect();

  assertEquals(result, ["user not found"]);
});

Deno.test("integration - filter, map, flatMap chain", async () => {
  const stream = fromArray([1, 2, 3, 4, 5]);

  const result = await stream
    .pipe(filter((x) => x % 2 === 0)) // [2, 4]
    .pipe(
      flatMap(async function* (x) {
        yield x;
        yield x * 10;
      }),
    ) // [2, 20, 4, 40]
    .pipe(map((x) => `num:${x}`)) // ["num:2", "num:20", "num:4", "num:40"]
    .collect();

  assertEquals(result, ["num:2", "num:20", "num:4", "num:40"]);
});

Deno.test("integration - simulated log processing", async () => {
  const logData = [
    "2024-01-01 ERROR: Database connection failed\n",
    "2024-01-01 INFO: Server started\n",
    "2024-01-01 ERROR: API timeout\n",
    "2024-01-02 ERROR: Invalid request\n",
  ];

  const stream = fromArray(logData);
  const errorCount = await stream
    .pipe(lines())
    .pipe(grep(/ERROR/))
    .count();

  assertEquals(errorCount, 3);
});
