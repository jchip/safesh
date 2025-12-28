/**
 * Tests for I/O Stream Transforms (stdout, stderr, tee)
 */

import { assertEquals } from "@std/assert";
import { fromArray } from "../../src/stdlib/stream.ts";
import { stdout, stderr, tee } from "../../src/stdlib/io.ts";

/**
 * Capture stdout output during a function execution
 */
async function captureStdout(
  fn: () => Promise<void>,
): Promise<string> {
  const original = Deno.stdout;
  const chunks: Uint8Array[] = [];

  // Mock stdout
  const mockStdout = {
    write(chunk: Uint8Array): Promise<number> {
      chunks.push(chunk);
      return Promise.resolve(chunk.length);
    },
    writeSync(chunk: Uint8Array): number {
      chunks.push(chunk);
      return chunk.length;
    },
  };

  try {
    // @ts-ignore - Replace stdout for testing
    Deno.stdout = mockStdout;
    await fn();

    // Decode all chunks
    const decoder = new TextDecoder();
    return chunks.map((c) => decoder.decode(c)).join("");
  } finally {
    // @ts-ignore - Restore stdout
    Deno.stdout = original;
  }
}

/**
 * Capture stderr output during a function execution
 */
async function captureStderr(
  fn: () => Promise<void>,
): Promise<string> {
  const original = Deno.stderr;
  const chunks: Uint8Array[] = [];

  // Mock stderr
  const mockStderr = {
    write(chunk: Uint8Array): Promise<number> {
      chunks.push(chunk);
      return Promise.resolve(chunk.length);
    },
    writeSync(chunk: Uint8Array): number {
      chunks.push(chunk);
      return chunk.length;
    },
  };

  try {
    // @ts-ignore - Replace stderr for testing
    Deno.stderr = mockStderr;
    await fn();

    // Decode all chunks
    const decoder = new TextDecoder();
    return chunks.map((c) => decoder.decode(c)).join("");
  } finally {
    // @ts-ignore - Restore stderr
    Deno.stderr = original;
  }
}

Deno.test({
  name: "stdout - writes to stdout and passes through",
  async fn() {
    const input = ["line1", "line2", "line3"];

    const output = await captureStdout(async () => {
      const result = await fromArray(input)
        .pipe(stdout())
        .collect();

      // Verify pass-through
      assertEquals(result, input);
    });

    // Verify stdout output (with newlines)
    assertEquals(output, "line1\nline2\nline3\n");
  },
});

Deno.test({
  name: "stdout - handles empty stream",
  async fn() {
    const output = await captureStdout(async () => {
      const result = await fromArray([])
        .pipe(stdout())
        .collect();

      assertEquals(result, []);
    });

    assertEquals(output, "");
  },
});

Deno.test({
  name: "stdout - can be chained with other transforms",
  async fn() {
    const output = await captureStdout(async () => {
      const result = await fromArray([1, 2, 3])
        .pipe(async function* (stream) {
          for await (const n of stream) {
            yield `num${n}`;
          }
        })
        .pipe(stdout())
        .pipe(async function* (stream) {
          for await (const s of stream) {
            yield s.toUpperCase();
          }
        })
        .collect();

      assertEquals(result, ["NUM1", "NUM2", "NUM3"]);
    });

    assertEquals(output, "num1\nnum2\nnum3\n");
  },
});

Deno.test({
  name: "stdout - is lazy (doesn't execute until terminal operation)",
  async fn() {
    let executed = false;

    const stream = fromArray(["test"]).pipe(async function* (source) {
      for await (const item of source) {
        executed = true;
        yield item;
      }
    }).pipe(stdout());

    // Should not have executed yet
    assertEquals(executed, false);

    // Execute with terminal operation
    await captureStdout(async () => {
      await stream.forEach(() => {});
    });

    assertEquals(executed, true);
  },
});

Deno.test({
  name: "stderr - writes to stderr and passes through",
  async fn() {
    const input = ["error1", "error2", "error3"];

    const output = await captureStderr(async () => {
      const result = await fromArray(input)
        .pipe(stderr())
        .collect();

      // Verify pass-through
      assertEquals(result, input);
    });

    // Verify stderr output (with newlines)
    assertEquals(output, "error1\nerror2\nerror3\n");
  },
});

Deno.test({
  name: "stderr - handles empty stream",
  async fn() {
    const output = await captureStderr(async () => {
      const result = await fromArray([])
        .pipe(stderr())
        .collect();

      assertEquals(result, []);
    });

    assertEquals(output, "");
  },
});

Deno.test({
  name: "stderr - can be chained with other transforms",
  async fn() {
    const output = await captureStderr(async () => {
      const result = await fromArray(["warn", "error"])
        .pipe(async function* (stream) {
          for await (const s of stream) {
            yield `[${s.toUpperCase()}]`;
          }
        })
        .pipe(stderr())
        .collect();

      assertEquals(result, ["[WARN]", "[ERROR]"]);
    });

    assertEquals(output, "[WARN]\n[ERROR]\n");
  },
});

Deno.test({
  name: "tee - applies side effect and passes through",
  async fn() {
    const sideEffectResults: number[] = [];

    const result = await fromArray([1, 2, 3])
      .pipe(tee((item) => {
        sideEffectResults.push(item * 10);
      }))
      .collect();

    // Main stream passes through unchanged
    assertEquals(result, [1, 2, 3]);

    // Side effect was executed
    assertEquals(sideEffectResults, [10, 20, 30]);
  },
});

Deno.test({
  name: "tee - works with custom stdout writing",
  async fn() {
    const encoder = new TextEncoder();
    const output = await captureStdout(async () => {
      const result = await fromArray(["a", "b", "c"])
        .pipe(tee(async (item) => {
          await Deno.stdout.write(encoder.encode(item + "\n"));
        }))
        .collect();

      // Data passes through
      assertEquals(result, ["a", "b", "c"]);
    });

    // Output was written
    assertEquals(output, "a\nb\nc\n");
  },
});

Deno.test({
  name: "tee - works with custom stderr writing",
  async fn() {
    const encoder = new TextEncoder();
    const output = await captureStderr(async () => {
      const result = await fromArray(["x", "y", "z"])
        .pipe(tee(async (item) => {
          await Deno.stderr.write(encoder.encode(item + "\n"));
        }))
        .collect();

      // Data passes through
      assertEquals(result, ["x", "y", "z"]);
    });

    // Output was written to stderr
    assertEquals(output, "x\ny\nz\n");
  },
});

Deno.test({
  name: "tee - can be chained multiple times",
  async fn() {
    const log1: string[] = [];
    const log2: string[] = [];

    const result = await fromArray(["item1", "item2"])
      .pipe(tee((item) => {
        log1.push(`log1: ${item}`);
      }))
      .pipe(tee((item) => {
        log2.push(`log2: ${item}`);
      }))
      .collect();

    assertEquals(result, ["item1", "item2"]);
    assertEquals(log1, ["log1: item1", "log1: item2"]);
    assertEquals(log2, ["log2: item1", "log2: item2"]);
  },
});

Deno.test({
  name: "tee - handles empty stream",
  async fn() {
    let sideEffectCalled = false;

    const result = await fromArray<string>([])
      .pipe(tee(() => {
        sideEffectCalled = true;
      }))
      .collect();

    assertEquals(result, []);
    assertEquals(sideEffectCalled, false);
  },
});

Deno.test({
  name: "tee - side effect can compute from data",
  async fn() {
    const lengths: number[] = [];

    const result = await fromArray(["a", "bb", "ccc"])
      .pipe(tee((item) => {
        lengths.push(item.length);
      }))
      .collect();

    // Original data passes through
    assertEquals(result, ["a", "bb", "ccc"]);

    // Side effect processed the data
    assertEquals(lengths, [1, 2, 3]);
  },
});

Deno.test({
  name: "tee - is lazy (doesn't execute until terminal operation)",
  async fn() {
    let executed = false;

    const stream = fromArray([1, 2, 3])
      .pipe(tee(() => {
        executed = true;
      }));

    // Should not have executed yet
    assertEquals(executed, false);

    // Now execute
    await stream.collect();
    assertEquals(executed, true);
  },
});

Deno.test({
  name: "Integration - complex pipeline with stdout, stderr, and tee",
  async fn() {
    const debugLog: string[] = [];
    const encoder = new TextEncoder();

    const stdoutOutput = await captureStdout(async () => {
      const stderrOutput = await captureStderr(async () => {
        const result = await fromArray([1, 2, 3, 4, 5])
          // Double each number
          .pipe(async function* (stream) {
            for await (const n of stream) {
              yield n * 2;
            }
          })
          // Log to debug
          .pipe(tee((n) => {
            debugLog.push(`debug: ${n}`);
          }))
          // Write even numbers to stdout
          .pipe(async function* (stream) {
            for await (const n of stream) {
              if (n % 4 === 0) {
                yield `even: ${n}`;
              } else {
                yield `odd: ${n}`;
              }
            }
          })
          .pipe(tee(async (s) => {
            if (s.startsWith("even")) {
              await Deno.stdout.write(encoder.encode(s + "\n"));
            }
          }))
          // Write odd numbers to stderr
          .pipe(tee(async (s) => {
            if (s.startsWith("odd")) {
              await Deno.stderr.write(encoder.encode(s + "\n"));
            }
          }))
          .collect();

        // All items collected
        assertEquals(result, [
          "even: 2",
          "even: 4",
          "even: 6",
          "even: 8",
          "even: 10",
        ].map((_, i) => {
          const n = (i + 1) * 2;
          return n % 4 === 0 ? `even: ${n}` : `odd: ${n}`;
        }));
      });

      // Check stderr got odd numbers
      assertEquals(
        stderrOutput,
        "odd: 2\nodd: 6\nodd: 10\n",
      );
    });

    // Check stdout got even numbers
    assertEquals(
      stdoutOutput,
      "even: 4\neven: 8\n",
    );

    // Check debug log
    assertEquals(debugLog, [
      "debug: 2",
      "debug: 4",
      "debug: 6",
      "debug: 8",
      "debug: 10",
    ]);
  },
});
