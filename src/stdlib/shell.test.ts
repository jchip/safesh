/**
 * Tests for Fluent Shell API ($)
 */

import { assertEquals, assertExists } from "@std/assert";
import $, { FluentShell } from "./shell.ts";
import { fromArray } from "./stream.ts";

// ============== Construction Tests ==============

Deno.test("$() - creates FluentShell from file path", () => {
  const shell = $("nonexistent.txt");
  assertExists(shell);
});

Deno.test("$.from() - creates from array", async () => {
  const result = await $.from(["a", "b", "c"]).collect();
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("$.text() - creates from string", async () => {
  const result = await $.text("hello\nworld").lines().collect();
  assertEquals(result, ["hello", "world"]);
});

Deno.test("$.wrap() - wraps existing stream", async () => {
  const stream = fromArray(["x", "y", "z"]);
  const result = await $.wrap(stream).map((s) => s + "!").collect();
  assertEquals(result, ["x!", "y!", "z!"]);
});

// ============== Transform Tests ==============

Deno.test("lines() - splits text into lines", async () => {
  const result = await $.text("line1\nline2\nline3").lines().collect();
  assertEquals(result, ["line1", "line2", "line3"]);
});

Deno.test("lines() - handles empty lines", async () => {
  const result = await $.text("a\n\nb").lines().collect();
  // Empty lines are filtered out by transforms.lines()
  assertEquals(result, ["a", "b"]);
});

Deno.test("grep() - filters by regex pattern", async () => {
  const result = await $.from(["error: failed", "info: ok", "error: timeout"])
    .grep(/error/)
    .collect();
  assertEquals(result, ["error: failed", "error: timeout"]);
});

Deno.test("grep() - filters by string pattern", async () => {
  const result = await $.from(["hello world", "goodbye", "hello there"])
    .grep("hello")
    .collect();
  assertEquals(result, ["hello world", "hello there"]);
});

Deno.test("grep() - case insensitive with regex flag", async () => {
  const result = await $.from(["ERROR: fail", "info: ok", "Error: warn"])
    .grep(/error/i)
    .collect();
  assertEquals(result, ["ERROR: fail", "Error: warn"]);
});

Deno.test("head() - takes first n items", async () => {
  const result = await $.from(["a", "b", "c", "d", "e"]).head(3).collect();
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("head() - defaults to 10", async () => {
  const items = Array.from({ length: 20 }, (_, i) => String(i));
  const result = await $.from(items).head().collect();
  assertEquals(result.length, 10);
  assertEquals(result[0], "0");
  assertEquals(result[9], "9");
});

Deno.test("tail() - takes last n items", async () => {
  const result = await $.from(["a", "b", "c", "d", "e"]).tail(2).collect();
  assertEquals(result, ["d", "e"]);
});

Deno.test("tail() - defaults to 10", async () => {
  const items = Array.from({ length: 20 }, (_, i) => String(i));
  const result = await $.from(items).tail().collect();
  assertEquals(result.length, 10);
  assertEquals(result[0], "10");
  assertEquals(result[9], "19");
});

Deno.test("filter() - filters with predicate", async () => {
  const result = await $.from(["short", "a very long line", "medium"])
    .filter((line) => line.length > 6)
    .collect();
  assertEquals(result, ["a very long line"]);
});

Deno.test("filter() - async predicate", async () => {
  const result = await $.from(["a", "bb", "ccc"])
    .filter(async (s) => {
      await Promise.resolve();
      return s.length > 1;
    })
    .collect();
  assertEquals(result, ["bb", "ccc"]);
});

Deno.test("map() - transforms items", async () => {
  const result = await $.from(["hello", "world"])
    .map((s) => s.toUpperCase())
    .collect();
  assertEquals(result, ["HELLO", "WORLD"]);
});

Deno.test("map() - async transform", async () => {
  const result = await $.from(["a", "b"])
    .map(async (s) => {
      await Promise.resolve();
      return s + "!";
    })
    .collect();
  assertEquals(result, ["a!", "b!"]);
});

Deno.test("take() - alias for head()", async () => {
  const result = await $.from(["a", "b", "c"]).take(2).collect();
  assertEquals(result, ["a", "b"]);
});

// ============== Terminal Operation Tests ==============

Deno.test("collect() - returns array", async () => {
  const result = await $.from(["a", "b", "c"]).collect();
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("first() - returns first item", async () => {
  const result = await $.from(["a", "b", "c"]).first();
  assertEquals(result, "a");
});

Deno.test("first() - returns undefined for empty", async () => {
  const result = await $.from([]).first();
  assertEquals(result, undefined);
});

Deno.test("count() - returns count", async () => {
  const result = await $.from(["a", "b", "c"]).count();
  assertEquals(result, 3);
});

Deno.test("count() - returns 0 for empty", async () => {
  const result = await $.from([]).count();
  assertEquals(result, 0);
});

Deno.test("forEach() - calls function for each item", async () => {
  const items: string[] = [];
  await $.from(["a", "b", "c"]).forEach((item) => {
    items.push(item);
  });
  assertEquals(items, ["a", "b", "c"]);
});

Deno.test("forEach() - async function", async () => {
  const items: string[] = [];
  await $.from(["a", "b", "c"]).forEach(async (item) => {
    await Promise.resolve();
    items.push(item);
  });
  assertEquals(items, ["a", "b", "c"]);
});

// ============== Escape Hatch Tests ==============

Deno.test("stream() - returns underlying Stream", async () => {
  const stream = $.from(["a", "b", "c"]).stream();
  assertExists(stream);
  const result = await stream.collect();
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("async iteration - works with for-await-of", async () => {
  const items: string[] = [];
  for await (const item of $.from(["a", "b", "c"])) {
    items.push(item);
  }
  assertEquals(items, ["a", "b", "c"]);
});

// ============== Pipe Method Tests ==============

Deno.test("pipe() - applies transform function", async () => {
  // Create a simple transform that adds prefix
  const addPrefix = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      yield `prefix:${item}`;
    }
  };

  const result = await $.from(["a", "b", "c"]).pipe(addPrefix).collect();
  assertEquals(result, ["prefix:a", "prefix:b", "prefix:c"]);
});

Deno.test("pipe() - chains multiple transforms", async () => {
  // Two transforms: one filters, one uppercases
  const filterLong = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      if (item.length > 2) yield item;
    }
  };
  const uppercase = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      yield item.toUpperCase();
    }
  };

  const result = await $.from(["a", "bb", "ccc", "dddd"])
    .pipe(filterLong)
    .pipe(uppercase)
    .collect();
  assertEquals(result, ["CCC", "DDDD"]);
});

Deno.test("pipe() - mixes with fluent methods", async () => {
  const addSuffix = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      yield `${item}!`;
    }
  };

  const result = await $.from(["error: fail", "info: ok", "error: timeout"])
    .grep(/error/)
    .pipe(addSuffix)
    .map((line) => line.toUpperCase())
    .collect();
  assertEquals(result, ["ERROR: FAIL!", "ERROR: TIMEOUT!"]);
});

// ============== Chaining Integration Tests ==============

Deno.test("chaining - multiple transforms", async () => {
  const result = await $.text("ERROR: fail\nINFO: ok\nERROR: timeout\nDEBUG: test")
    .lines()
    .grep(/ERROR/)
    .map((line) => line.replace("ERROR: ", ""))
    .collect();
  assertEquals(result, ["fail", "timeout"]);
});

Deno.test("chaining - grep + head", async () => {
  const result = await $.from([
    "error1",
    "info1",
    "error2",
    "error3",
    "info2",
  ])
    .grep(/error/)
    .head(2)
    .collect();
  assertEquals(result, ["error1", "error2"]);
});

Deno.test("chaining - filter + map + count", async () => {
  const result = await $.from(["a", "bb", "ccc", "dddd"])
    .filter((s) => s.length > 1)
    .map((s) => s.toUpperCase())
    .count();
  assertEquals(result, 3);
});

Deno.test("chaining - lines + grep + tail", async () => {
  const result = await $.text("a\nb\nc\nd\ne")
    .lines()
    .tail(3)
    .collect();
  assertEquals(result, ["c", "d", "e"]);
});

Deno.test("chaining - complex pipeline", async () => {
  const logContent = `
2024-01-01 INFO: Starting
2024-01-01 ERROR: Failed to connect
2024-01-01 INFO: Retrying
2024-01-01 ERROR: Connection timeout
2024-01-01 ERROR: Max retries exceeded
2024-01-01 INFO: Shutting down
`.trim();

  const errors = await $.text(logContent)
    .lines()
    .grep(/ERROR/)
    .map((line) => line.split("ERROR: ")[1] ?? line)
    .head(2)
    .collect();

  assertEquals(errors, ["Failed to connect", "Connection timeout"]);
});

// ============== Immutability Tests ==============

Deno.test("immutability - transforms return new instances", async () => {
  // Each FluentShell wraps a new stream, so they are independent
  const filtered = $.from(["a", "b", "c"]).grep(/a|b/);
  const mapped = $.from(["a", "b", "c"]).map((s) => s.toUpperCase());

  // Both work independently
  const filteredResult = await filtered.collect();
  const mappedResult = await mapped.collect();

  assertEquals(filteredResult, ["a", "b"]);
  assertEquals(mappedResult, ["A", "B", "C"]);
});

Deno.test("immutability - chained transforms create new instances", async () => {
  const source = $.from(["hello", "world"]);
  const upper = source.map((s) => s.toUpperCase());

  // upper is a new FluentShell, source is unchanged conceptually
  // (though the underlying stream is consumed on first terminal op)
  const result = await upper.collect();
  assertEquals(result, ["HELLO", "WORLD"]);
});

// ============== File System Tests ==============
// These tests use the project's .temp directory to stay within sandbox

const TEMP_DIR = ".temp/shell-test";

async function setupTempDir(): Promise<void> {
  try {
    await Deno.mkdir(TEMP_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

async function cleanupTempDir(): Promise<void> {
  try {
    await Deno.remove(TEMP_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

Deno.test("$() - reads file and processes", async (t) => {
  const testFile = `${TEMP_DIR}/test.txt`;

  await t.step("setup", async () => {
    await setupTempDir();
    await Deno.writeTextFile(testFile, "line1\nline2\nline3\n");
  });

  await t.step("reads and processes file", async () => {
    const result = await $(testFile).lines().head(2).collect();
    assertEquals(result, ["line1", "line2"]);
  });

  await t.step("cleanup", async () => {
    await cleanupTempDir();
  });
});

Deno.test("save() - writes to file", async (t) => {
  const testFile = `${TEMP_DIR}/test.txt`;
  const outputFile = `${TEMP_DIR}/output.txt`;

  await t.step("setup", async () => {
    await setupTempDir();
    await Deno.writeTextFile(testFile, "a\nb\nc\nd\ne\n");
  });

  await t.step("saves filtered content", async () => {
    await $(testFile).lines().head(3).save(outputFile);
    const content = await Deno.readTextFile(outputFile);
    assertEquals(content, "a\nb\nc\n");
  });

  await t.step("cleanup", async () => {
    await cleanupTempDir();
  });
});

Deno.test("save() - handles empty result", async (t) => {
  const outputFile = `${TEMP_DIR}/empty.txt`;

  await t.step("setup", async () => {
    await setupTempDir();
  });

  await t.step("saves empty content", async () => {
    await $.from([]).save(outputFile);
    const content = await Deno.readTextFile(outputFile);
    assertEquals(content, "");
  });

  await t.step("cleanup", async () => {
    await cleanupTempDir();
  });
});

// ============== Extensibility Tests ==============

Deno.test("extensibility - pipe() with custom transform", async () => {
  // Custom transform that adds prefix to each line
  const addPrefix = async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      yield `[PREFIX] ${line}`;
    }
  };

  const result = await $.from(["line1", "line2", "line3"])
    .pipe(addPrefix)
    .collect();

  assertEquals(result, [
    "[PREFIX] line1",
    "[PREFIX] line2",
    "[PREFIX] line3",
  ]);
});

Deno.test("extensibility - pipe() with multiple custom transforms", async () => {
  // Transform 1: Filter long lines
  const filterLong = async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      if (line.length > 3) {
        yield line;
      }
    }
  };

  // Transform 2: Add line numbers
  const addLineNumbers = async function* (stream: AsyncIterable<string>) {
    let lineNum = 1;
    for await (const line of stream) {
      yield `${lineNum++}. ${line}`;
    }
  };

  const result = await $.from(["a", "bb", "ccc", "dddd", "eeeee"])
    .pipe(filterLong)
    .pipe(addLineNumbers)
    .collect();

  assertEquals(result, ["1. dddd", "2. eeeee"]);
});

Deno.test("extensibility - pipe() mixed with built-in methods", async () => {
  // Custom transform
  const wrapInBrackets = async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      yield `[${line}]`;
    }
  };

  const result = await $.from([
    "ERROR: fail",
    "INFO: ok",
    "ERROR: timeout",
    "DEBUG: test",
  ])
    .grep(/ERROR/)
    .pipe(wrapInBrackets)
    .map(line => line.toUpperCase())
    .collect();

  assertEquals(result, ["[ERROR: FAIL]", "[ERROR: TIMEOUT]"]);
});

Deno.test("extensibility - pipe() with async transforms", async () => {
  // Async transform that delays each item
  const delayedUppercase = async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 1));
      yield line.toUpperCase();
    }
  };

  const result = await $.from(["hello", "world"])
    .pipe(delayedUppercase)
    .collect();

  assertEquals(result, ["HELLO", "WORLD"]);
});

Deno.test("extensibility - pipe() with stateful transforms", async () => {
  // Stateful transform that numbers lines
  const numberLines = async function* (stream: AsyncIterable<string>) {
    let counter = 0;
    for await (const line of stream) {
      yield `${++counter}: ${line}`;
    }
  };

  const result = await $.from(["first", "second", "third"])
    .pipe(numberLines)
    .collect();

  assertEquals(result, ["1: first", "2: second", "3: third"]);
});

Deno.test("extensibility - pipe() with transform composition", async () => {
  // Helper to compose transforms
  const compose = <T>(...transforms: Array<(s: AsyncIterable<T>) => AsyncIterable<T>>) => {
    return async function* (stream: AsyncIterable<T>) {
      let current = stream;
      for (const transform of transforms) {
        current = transform(current);
      }
      yield* current;
    };
  };

  const uppercase = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      yield item.toUpperCase();
    }
  };

  const exclaim = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      yield `${item}!`;
    }
  };

  const result = await $.from(["hello", "world"])
    .pipe(compose(uppercase, exclaim))
    .collect();

  assertEquals(result, ["HELLO!", "WORLD!"]);
});

Deno.test("extensibility - pipe() preserves stream laziness", async () => {
  let processedCount = 0;

  const countingTransform = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      processedCount++;
      yield item;
    }
  };

  // Create pipeline but don't execute
  const pipeline = $.from(["a", "b", "c", "d", "e"])
    .pipe(countingTransform)
    .head(2);

  // No items should be processed yet
  assertEquals(processedCount, 0);

  // Execute and check only 2-3 items were processed (due to head(2))
  // Note: head() may pull one extra item to check if stream is exhausted
  const result = await pipeline.collect();
  assertEquals(result, ["a", "b"]);
  // Allow for implementation details - should be 2 or 3 max
  assertEquals(processedCount <= 3, true, `Expected at most 3 items processed, got ${processedCount}`);
});

Deno.test("extensibility - custom transform with error handling", async () => {
  // Transform that filters out invalid JSON
  const parseValidJson = async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      try {
        const parsed = JSON.parse(line);
        yield JSON.stringify(parsed);
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }
  };

  const result = await $.from([
    '{"valid": true}',
    'invalid json',
    '{"another": "valid"}',
    'also invalid',
  ])
    .pipe(parseValidJson)
    .collect();

  assertEquals(result, ['{"valid":true}', '{"another":"valid"}']);
});

Deno.test("extensibility - pipe() can access items multiple times with buffering", async () => {
  // Transform that yields each item twice
  const duplicate = async function* (stream: AsyncIterable<string>) {
    for await (const item of stream) {
      yield item;
      yield item;
    }
  };

  const result = await $.from(["a", "b"])
    .pipe(duplicate)
    .collect();

  assertEquals(result, ["a", "a", "b", "b"]);
});

Deno.test("extensibility - pipe() with complex data transformation", async () => {
  // Transform CSV line into fields and rejoin
  const processCsv = async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      const fields = line.split(",");
      // Reverse fields
      yield fields.reverse().join(",");
    }
  };

  const result = await $.from(["a,b,c", "1,2,3"])
    .pipe(processCsv)
    .collect();

  assertEquals(result, ["c,b,a", "3,2,1"]);
});
