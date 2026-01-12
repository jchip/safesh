/**
 * SSH-200: Test advanced patterns and pipelines
 *
 * Tests complex stream pipelines and real-world use cases including:
 * - Basic pipelines (cmd1 | cmd2 | cmd3)
 * - Stream operations (.pipe(), .map(), .filter(), .reduce())
 * - Complex patterns (tee, process substitution, conditionals)
 * - Real-world use cases (log analysis, file processing, git analysis)
 */

import { assertEquals, assert, assertArrayIncludes } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";

// Import stream APIs
import { createStream, fromArray, empty } from "safesh:stream";
import { filter, map, lines, grep, head, tail, flatMap } from "safesh:transforms";
import { stdout, stderr, tee } from "safesh:io";
import { cat, src, dest } from "safesh:fs-streams";
import { cmd, git } from "safesh:command";

const TEST_DIR = join(Deno.cwd(), ".temp", "pipeline-test");

// ==============================================================================
// Setup and Teardown
// ==============================================================================

async function setup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
  await ensureDir(TEST_DIR);

  // Create test files
  await Deno.writeTextFile(
    join(TEST_DIR, "numbers.txt"),
    "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n",
  );
  await Deno.writeTextFile(
    join(TEST_DIR, "mixed.txt"),
    "apple\nbanana\ncherry\ndate\neggplant\n",
  );
  await Deno.writeTextFile(
    join(TEST_DIR, "log.txt"),
    "[2024-01-01 10:00:00] INFO: Application started\n" +
      "[2024-01-01 10:01:00] ERROR: Database connection failed\n" +
      "[2024-01-01 10:02:00] WARN: Retry attempt 1\n" +
      "[2024-01-01 10:03:00] ERROR: Database connection failed\n" +
      "[2024-01-01 10:04:00] INFO: Connection restored\n" +
      "[2024-01-01 10:05:00] ERROR: Invalid user input\n",
  );
}

async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ==============================================================================
// 1. Basic Pipelines
// ==============================================================================

Deno.test({
  name: "Pipelines - basic three-stage pipeline",
  async fn() {
    // cmd1 | cmd2 | cmd3 pattern
    const result = await fromArray([1, 2, 3, 4, 5, 6])
      .pipe(filter((x) => x % 2 === 0)) // Filter evens
      .pipe(map((x) => x * 2)) // Double them
      .pipe(filter((x) => x > 5)) // Only keep > 5
      .collect();

    assertEquals(result, [8, 12]);
  },
});

Deno.test({
  name: "Pipelines - data flow through multiple transforms",
  async fn() {
    await setup();
    try {
      const result = await cat(join(TEST_DIR, "numbers.txt"))
        .pipe(lines())
        .pipe(map((line) => parseInt(line)))
        .pipe(filter((n) => n > 5))
        .collect();

      assertEquals(result, [6, 7, 8, 9, 10]);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Pipelines - error propagation through pipeline",
  async fn() {
    let errorCaught = false;

    try {
      await fromArray([1, 2, 3])
        .pipe(map((x) => {
          if (x === 2) throw new Error("Test error");
          return x;
        }))
        .collect();
    } catch (e) {
      errorCaught = true;
      assert(e instanceof Error);
      assertEquals(e.message, "Test error");
    }

    assertEquals(errorCaught, true, "Error should propagate through pipeline");
  },
});

Deno.test({
  name: "Pipelines - empty stream handling",
  async fn() {
    const result = await empty<number>()
      .pipe(map((x) => x * 2))
      .pipe(filter((x) => x > 0))
      .collect();

    assertEquals(result, []);

    const first = await empty<string>().first();
    assertEquals(first, undefined);

    const count = await empty<number>().count();
    assertEquals(count, 0);
  },
});

// ==============================================================================
// 2. Stream Operations
// ==============================================================================

Deno.test({
  name: "Stream Operations - chained pipe() calls",
  async fn() {
    const result = await fromArray(["hello", "world", "foo", "bar"])
      .pipe(filter((s) => s.length > 3))
      .pipe(map((s) => s.toUpperCase()))
      .pipe(filter((s) => s.includes("O")))
      .collect();

    assertEquals(result, ["HELLO", "WORLD"]);
  },
});

Deno.test({
  name: "Stream Operations - map() with index",
  async fn() {
    const result = await fromArray(["a", "b", "c"])
      .pipe(map((item, idx) => `${idx}: ${item}`))
      .collect();

    assertEquals(result, ["0: a", "1: b", "2: c"]);
  },
});

Deno.test({
  name: "Stream Operations - filter() with index",
  async fn() {
    const result = await fromArray([10, 20, 30, 40, 50])
      .pipe(filter((item, idx) => idx % 2 === 0)) // Even indices
      .collect();

    assertEquals(result, [10, 30, 50]);
  },
});

Deno.test({
  name: "Stream Operations - flatMap() for expansion",
  async fn() {
    const result = await fromArray(["a", "b", "c"])
      .pipe(
        flatMap(async function* (letter) {
          yield letter;
          yield letter.toUpperCase();
        }),
      )
      .collect();

    assertEquals(result, ["a", "A", "b", "B", "c", "C"]);
  },
});

Deno.test({
  name: "Stream Operations - lines() splits text",
  async fn() {
    await setup();
    try {
      const result = await cat(join(TEST_DIR, "numbers.txt"))
        .pipe(lines())
        .collect();

      assertEquals(result.length, 10);
      assertEquals(result[0], "1");
      assertEquals(result[9], "10");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Stream Operations - grep() filters by pattern",
  async fn() {
    await setup();
    try {
      const result = await cat(join(TEST_DIR, "mixed.txt"))
        .pipe(lines())
        .pipe(grep(/^[a-c]/)) // Lines starting with a, b, or c
        .collect();

      assertEquals(result, ["apple", "banana", "cherry"]);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Stream Operations - head() limits output",
  async fn() {
    const result = await fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      .pipe(head(3))
      .collect();

    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Stream Operations - tail() gets last items",
  async fn() {
    const result = await fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      .pipe(tail(3))
      .collect();

    assertEquals(result, [8, 9, 10]);
  },
});

Deno.test({
  name: "Stream Operations - async map() transformation",
  async fn() {
    const asyncDouble = async (x: number): Promise<number> => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return x * 2;
    };

    const result = await fromArray([1, 2, 3])
      .pipe(map(asyncDouble))
      .collect();

    assertEquals(result, [2, 4, 6]);
  },
});

Deno.test({
  name: "Stream Operations - async filter() predicate",
  async fn() {
    const asyncIsEven = async (x: number): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return x % 2 === 0;
    };

    const result = await fromArray([1, 2, 3, 4, 5])
      .pipe(filter(asyncIsEven))
      .collect();

    assertEquals(result, [2, 4]);
  },
});

// ==============================================================================
// 3. Complex Patterns
// ==============================================================================

Deno.test({
  name: "Complex Patterns - tee for side effects",
  async fn() {
    const sideEffects: number[] = [];

    const result = await fromArray([1, 2, 3, 4, 5])
      .pipe(
        tee((x) => {
          sideEffects.push(x);
        }),
      )
      .pipe(filter((x) => x % 2 === 0))
      .collect();

    // Side effects should capture all input
    assertEquals(sideEffects, [1, 2, 3, 4, 5]);
    // Result should only have filtered items
    assertEquals(result, [2, 4]);
  },
});

Deno.test({
  name: "Complex Patterns - multiple tee operations",
  async fn() {
    const log1: string[] = [];
    const log2: string[] = [];

    const result = await fromArray(["a", "b", "c"])
      .pipe(
        tee((x) => {
          log1.push(`before: ${x}`);
        }),
      )
      .pipe(map((x) => x.toUpperCase()))
      .pipe(
        tee((x) => {
          log2.push(`after: ${x}`);
        }),
      )
      .collect();

    assertEquals(log1, ["before: a", "before: b", "before: c"]);
    assertEquals(log2, ["after: A", "after: B", "after: C"]);
    assertEquals(result, ["A", "B", "C"]);
  },
});

Deno.test({
  name: "Complex Patterns - async tee side effect",
  async fn() {
    const logged: number[] = [];

    const result = await fromArray([1, 2, 3])
      .pipe(
        tee(async (x) => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          logged.push(x * 10);
        }),
      )
      .collect();

    assertEquals(logged, [10, 20, 30]);
    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Complex Patterns - conditional pipeline with filter",
  async fn() {
    // Simulate conditional: process items differently based on condition
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    // Path 1: Even numbers doubled
    const evens = await fromArray(items)
      .pipe(filter((x) => x % 2 === 0))
      .pipe(map((x) => x * 2))
      .collect();

    // Path 2: Odd numbers tripled
    const odds = await fromArray(items)
      .pipe(filter((x) => x % 2 !== 0))
      .pipe(map((x) => x * 3))
      .collect();

    assertEquals(evens, [4, 8, 12, 16, 20]);
    assertEquals(odds, [3, 9, 15, 21, 27]);
  },
});

Deno.test({
  name: "Complex Patterns - branching with tee to multiple destinations",
  async fn() {
    await setup();
    try {
      const errors: string[] = [];
      const warnings: string[] = [];

      await cat(join(TEST_DIR, "log.txt"))
        .pipe(lines())
        .pipe(
          tee((line) => {
            if (line.includes("ERROR")) {
              errors.push(line);
            }
            if (line.includes("WARN")) {
              warnings.push(line);
            }
          }),
        )
        .forEach(() => {}); // Consume stream

      assertEquals(errors.length, 3);
      assertEquals(warnings.length, 1);
      assert(errors[0]?.includes("Database connection failed"));
      assert(warnings[0]?.includes("Retry attempt"));
    } finally {
      await cleanup();
    }
  },
});

// ==============================================================================
// 4. Real-world Use Cases
// ==============================================================================

Deno.test({
  name: "Real-world - log analysis pipeline",
  async fn() {
    await setup();
    try {
      // Extract ERROR lines with timestamp and message
      const errors = await cat(join(TEST_DIR, "log.txt"))
        .pipe(lines())
        .pipe(grep(/ERROR/))
        .pipe(
          map((line) => {
            const match = line.match(
              /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] ERROR: (.+)/,
            );
            return match
              ? { time: match[1], message: match[2] }
              : { time: "unknown", message: line };
          }),
        )
        .collect();

      assertEquals(errors.length, 3);
      assertEquals(errors[0]?.message, "Database connection failed");
      assertEquals(errors[2]?.message, "Invalid user input");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Real-world - file processing pipeline",
  async fn() {
    await setup();
    try {
      // Process file: filter, transform, collect
      const result = await cat(join(TEST_DIR, "mixed.txt"))
        .pipe(lines())
        .pipe(filter((line) => line.length > 5)) // Only longer words
        .pipe(map((word) => word.charAt(0).toUpperCase() + word.slice(1))) // Capitalize
        .pipe(map((word, idx) => `${idx + 1}. ${word}`)) // Number them
        .collect();

      assertEquals(result, ["1. Banana", "2. Cherry", "3. Eggplant"]);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Real-world - git analysis simulation",
  async fn() {
    // Simulate git log output
    const gitLogOutput = [
      "abc123 Fix bug in login",
      "def456 Update documentation",
      "ghi789 Fix typo in README",
      "jkl012 Add new feature",
      "mno345 Fix security issue",
    ];

    // Extract fix commits
    const fixes = await fromArray(gitLogOutput)
      .pipe(grep(/fix/i))
      .pipe(
        map((line) => {
          const [hash, ...message] = line.split(" ");
          return { hash, message: message.join(" ") };
        }),
      )
      .collect();

    assertEquals(fixes.length, 3);
    assertEquals(fixes[0]?.hash, "abc123");
    assertEquals(fixes[0]?.message, "Fix bug in login");
  },
});

Deno.test({
  name: "Real-world - data transformation pipeline",
  async fn() {
    // Simulate CSV-like data processing
    const csvData = [
      "name,age,city",
      "Alice,30,NYC",
      "Bob,25,LA",
      "Charlie,35,NYC",
      "Diana,28,LA",
    ];

    const nycResidents = await fromArray(csvData)
      .pipe(filter((line, idx) => idx > 0)) // Skip header
      .pipe(
        map((line) => {
          const [name, age, city] = line.split(",");
          return { name, age: parseInt(age ?? "0"), city };
        }),
      )
      .pipe(filter((person) => person.city === "NYC"))
      .pipe(map((person) => person.name))
      .collect();

    assertEquals(nycResidents, ["Alice", "Charlie"]);
  },
});

Deno.test({
  name: "Real-world - multi-stage data aggregation",
  async fn() {
    await setup();
    try {
      // Count different log levels
      const logData = await cat(join(TEST_DIR, "log.txt"))
        .pipe(lines())
        .pipe(
          map((line) => {
            if (line.includes("ERROR")) return "error";
            if (line.includes("WARN")) return "warn";
            if (line.includes("INFO")) return "info";
            return "unknown";
          }),
        )
        .collect();

      // Manual aggregation
      const counts = logData.reduce(
        (acc, level) => {
          acc[level] = (acc[level] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      assertEquals(counts.error, 3);
      assertEquals(counts.warn, 1);
      assertEquals(counts.info, 2);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "Real-world - complex filtering and transformation",
  async fn() {
    await setup();
    try {
      // Get only ERROR and WARN lines, extract messages, number them
      const importantLogs = await cat(join(TEST_DIR, "log.txt"))
        .pipe(lines())
        .pipe(grep(/ERROR|WARN/))
        .pipe(
          map((line) => {
            const match = line.match(/\] (ERROR|WARN): (.+)/);
            return match ? { level: match[1], msg: match[2] } : null;
          }),
        )
        .pipe(filter((item) => item !== null))
        .pipe(map((item, idx) => `${idx + 1}. [${item!.level}] ${item!.msg}`))
        .collect();

      assertEquals(importantLogs.length, 4);
      assert(importantLogs[0]?.includes("[ERROR] Database connection failed"));
      assert(importantLogs[1]?.includes("[WARN] Retry attempt"));
    } finally {
      await cleanup();
    }
  },
});

// ==============================================================================
// 5. Terminal Operations
// ==============================================================================

Deno.test({
  name: "Terminal Operations - collect() gathers all values",
  async fn() {
    const result = await fromArray([1, 2, 3]).collect();
    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Terminal Operations - first() gets first value",
  async fn() {
    const result = await fromArray([1, 2, 3]).first();
    assertEquals(result, 1);

    const empty_result = await empty<number>().first();
    assertEquals(empty_result, undefined);
  },
});

Deno.test({
  name: "Terminal Operations - count() counts values",
  async fn() {
    const result = await fromArray([1, 2, 3, 4, 5]).count();
    assertEquals(result, 5);

    const filtered = await fromArray([1, 2, 3, 4, 5])
      .pipe(filter((x) => x > 3))
      .count();
    assertEquals(filtered, 2);
  },
});

Deno.test({
  name: "Terminal Operations - forEach() processes each item",
  async fn() {
    const items: number[] = [];
    await fromArray([1, 2, 3]).forEach((x) => {
      items.push(x * 2);
    });
    assertEquals(items, [2, 4, 6]);
  },
});

Deno.test({
  name: "Terminal Operations - text() joins with newlines",
  async fn() {
    const result = await fromArray(["hello", "world"]).text();
    assertEquals(result, "hello\nworld");

    const custom = await fromArray(["a", "b", "c"]).text(", ");
    assertEquals(custom, "a, b, c");
  },
});

// ==============================================================================
// 6. Edge Cases and Error Handling
// ==============================================================================

Deno.test({
  name: "Edge Cases - very long pipeline",
  async fn() {
    let stream = fromArray([1, 2, 3, 4, 5]);

    // Chain many operations
    for (let i = 0; i < 10; i++) {
      stream = stream.pipe(map((x) => x + 1));
    }

    const result = await stream.collect();
    assertEquals(result, [11, 12, 13, 14, 15]);
  },
});

Deno.test({
  name: "Edge Cases - pipeline with no-op transforms",
  async fn() {
    const result = await fromArray([1, 2, 3])
      .pipe(map((x) => x)) // Identity
      .pipe(filter(() => true)) // Pass all
      .collect();

    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Edge Cases - head with count larger than stream",
  async fn() {
    const result = await fromArray([1, 2, 3])
      .pipe(head(100))
      .collect();

    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Edge Cases - tail with count larger than stream",
  async fn() {
    const result = await fromArray([1, 2, 3])
      .pipe(tail(100))
      .collect();

    assertEquals(result, [1, 2, 3]);
  },
});

Deno.test({
  name: "Edge Cases - filter removes all items",
  async fn() {
    const result = await fromArray([1, 2, 3, 4, 5])
      .pipe(filter(() => false))
      .collect();

    assertEquals(result, []);
  },
});

Deno.test({
  name: "Edge Cases - map with type transformation",
  async fn() {
    const result = await fromArray([1, 2, 3])
      .pipe(map((n) => `number: ${n}`))
      .collect();

    assertEquals(result, ["number: 1", "number: 2", "number: 3"]);
  },
});

Deno.test({
  name: "Error Handling - stream with exception in map",
  async fn() {
    let errorCaught = false;

    try {
      await fromArray([1, 2, 3, 4, 5])
        .pipe(
          map((x) => {
            if (x === 3) throw new Error("Map error");
            return x * 2;
          }),
        )
        .collect();
    } catch (e) {
      errorCaught = true;
      assert(e instanceof Error);
      assertEquals(e.message, "Map error");
    }

    assertEquals(errorCaught, true);
  },
});

Deno.test({
  name: "Error Handling - stream with exception in filter",
  async fn() {
    let errorCaught = false;

    try {
      await fromArray([1, 2, 3, 4, 5])
        .pipe(
          filter((x) => {
            if (x === 3) throw new Error("Filter error");
            return x % 2 === 0;
          }),
        )
        .collect();
    } catch (e) {
      errorCaught = true;
      assert(e instanceof Error);
      assertEquals(e.message, "Filter error");
    }

    assertEquals(errorCaught, true);
  },
});

Deno.test({
  name: "Error Handling - async operation error propagation",
  async fn() {
    let errorCaught = false;

    try {
      await fromArray([1, 2, 3])
        .pipe(
          map(async (x) => {
            if (x === 2) throw new Error("Async error");
            return x;
          }),
        )
        .collect();
    } catch (e) {
      errorCaught = true;
      assert(e instanceof Error);
      assertEquals(e.message, "Async error");
    }

    assertEquals(errorCaught, true);
  },
});
