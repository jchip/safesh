/**
 * I/O Stream Transforms and Utilities
 *
 * Provides transforms for writing to stdout/stderr while passing data through,
 * tee operations for side effects, and low-level stdin writing utilities.
 *
 * Key design: Streams are lazy and silent by default. These transforms
 * provide explicit output while maintaining stream composability.
 *
 * @module
 */

import type { Transform } from "./stream.ts";

/**
 * Write data to a writable stream and close it
 *
 * Handles three input types:
 * - string: Encodes as UTF-8 bytes
 * - Uint8Array: Writes directly
 * - ReadableStream: Pipes to the writable stream
 *
 * @param stream - The writable stream to write to
 * @param data - Data to write (string, bytes, or readable stream)
 *
 * @example
 * ```ts
 * // Write string to process stdin
 * await writeStdin(process.stdin, "hello world");
 *
 * // Write binary data
 * await writeStdin(process.stdin, new Uint8Array([0x48, 0x69]));
 *
 * // Pipe from another stream
 * await writeStdin(process.stdin, file.readable);
 * ```
 */
export async function writeStdin(
  stream: WritableStream<Uint8Array>,
  data: string | Uint8Array | ReadableStream<Uint8Array>,
): Promise<void> {
  try {
    if (data instanceof ReadableStream) {
      // Pipe the readable stream to stdin
      await data.pipeTo(stream);
    } else {
      const writer = stream.getWriter();
      try {
        const bytes =
          typeof data === "string" ? new TextEncoder().encode(data) : data;
        await writer.write(bytes);
      } finally {
        await writer.close();
      }
    }
  } catch (e) {
    // Ignore broken pipe errors - downstream closed early (e.g., head -5)
    // This is normal behavior for pipelines
    if (e instanceof Error && (
      e.message.includes("stream is closed") ||
      e.message.includes("Broken pipe") ||
      e.message.includes("EPIPE")
    )) {
      return;
    }
    throw e;
  }
}

/**
 * Write each item to stdout and pass through
 *
 * This is a transform (not a terminal operation) - it writes to stdout
 * AND yields the item for further processing.
 *
 * @returns Transform that writes strings to stdout with newlines
 *
 * @example
 * ```ts
 * // Print and collect
 * const errors = await cat("app.log")
 *   .pipe(lines())
 *   .pipe(grep(/ERROR/))
 *   .pipe(stdout())
 *   .collect();
 *
 * // Just print (terminal operation needed to execute)
 * await cat("app.log")
 *   .pipe(lines())
 *   .pipe(stdout())
 *   .forEach(() => {});
 * ```
 */
export function stdout(): Transform<string, string> {
  return async function* (stream) {
    const encoder = new TextEncoder();
    for await (const item of stream) {
      await Deno.stdout.write(encoder.encode(item + "\n"));
      yield item;
    }
  };
}

/**
 * Write each item to stderr and pass through
 *
 * This is a transform (not a terminal operation) - it writes to stderr
 * AND yields the item for further processing.
 *
 * @returns Transform that writes strings to stderr with newlines
 *
 * @example
 * ```ts
 * // Log errors to stderr while collecting
 * const errors = await processData()
 *   .pipe(filter(isError))
 *   .pipe(stderr())
 *   .collect();
 *
 * // Just log to stderr (terminal operation needed to execute)
 * await diagnostics()
 *   .pipe(stderr())
 *   .forEach(() => {});
 * ```
 */
export function stderr(): Transform<string, string> {
  return async function* (stream) {
    const encoder = new TextEncoder();
    for await (const item of stream) {
      await Deno.stderr.write(encoder.encode(item + "\n"));
      yield item;
    }
  };
}

/**
 * Apply a side effect while passing through data
 *
 * Like the Unix tee command - allows simultaneous processing of data.
 * Each item is passed to the side effect function AND yielded for further processing.
 *
 * @param sideEffect - Function to call for each item (for side effects only)
 * @returns Transform that applies side effect and passes through
 *
 * @example
 * ```ts
 * // Print while collecting
 * const errors = await cat("app.log")
 *   .pipe(lines())
 *   .pipe(grep(/ERROR/))
 *   .pipe(tee(line => console.log(line)))
 *   .collect();
 *
 * // Log to file while processing
 * const results = await processData()
 *   .pipe(tee(async item => await logToFile(item)))
 *   .pipe(map(transform))
 *   .collect();
 *
 * // Multiple side effects can be chained
 * await data
 *   .pipe(tee(console.log))
 *   .pipe(tee(sendToMetrics))
 *   .collect();
 * ```
 */
export function tee<T>(sideEffect: (item: T) => void | Promise<void>): Transform<T, T> {
  return async function* (stream) {
    for await (const item of stream) {
      await sideEffect(item);
      yield item;
    }
  };
}
