/**
 * I/O Stream Transforms - stdout, stderr, and tee operations
 *
 * Provides transforms for writing to stdout/stderr while passing data through,
 * and for applying side effects with tee().
 *
 * Key design: Streams are lazy and silent by default. These transforms
 * provide explicit output while maintaining stream composability.
 *
 * @module
 */

import type { Transform } from "./stream.ts";

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
 * The side effect transform is applied, and all items are passed through.
 *
 * @param sideEffect - Transform to apply as side effect
 * @returns Transform that applies side effect and passes through
 *
 * @example
 * ```ts
 * // Print while collecting (using tee + stdout)
 * const errors = await cat("app.log")
 *   .pipe(lines())
 *   .pipe(grep(/ERROR/))
 *   .pipe(tee(stdout()))
 *   .collect();
 *
 * // Log to file while processing
 * const results = await processData()
 *   .pipe(tee(writeToFile("debug.log")))
 *   .pipe(map(transform))
 *   .collect();
 *
 * // Multiple side effects can be chained
 * await data
 *   .pipe(tee(stdout()))
 *   .pipe(tee(logToFile))
 *   .pipe(tee(sendToMetrics))
 *   .collect();
 * ```
 */
export function tee<T>(sideEffect: Transform<T, T>): Transform<T, T> {
  return async function* (stream) {
    const sideStream = sideEffect(stream);
    for await (const item of sideStream) {
      yield item;
    }
  };
}
