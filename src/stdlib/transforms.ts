/**
 * Common Transform Functions for Stream API
 *
 * Provides composable transform functions for filtering, mapping, and
 * manipulating streams. All transforms are pure functions that return
 * async generators for lazy evaluation.
 *
 * @module
 */

import type { Transform } from "./stream.ts";

/**
 * Filter items in a stream based on a predicate
 *
 * Only items that pass the predicate test are yielded to the output stream.
 * The predicate can be synchronous or asynchronous.
 *
 * @param predicate - Function that returns true for items to keep (receives item and index)
 * @returns Transform that filters items
 *
 * @example
 * ```ts
 * // Filter even numbers
 * const evens = stream.pipe(filter(x => x % 2 === 0));
 *
 * // Skip header row
 * const data = stream.pipe(filter((line, idx) => idx > 0));
 *
 * // Async predicate
 * const valid = stream.pipe(filter(async x => await validate(x)));
 * ```
 */
export function filter<T>(
  predicate: (item: T, index: number) => boolean | Promise<boolean>,
): Transform<T, T> {
  return async function* (stream) {
    let index = 0;
    for await (const item of stream) {
      if (await predicate(item, index++)) {
        yield item;
      }
    }
  };
}

/**
 * Transform each item in a stream
 *
 * Applies a function to each item, yielding the transformed result.
 * The function can be synchronous or asynchronous.
 *
 * @param fn - Function to transform each item (receives item and index)
 * @returns Transform that maps items from T to U
 *
 * @example
 * ```ts
 * // Double each number
 * const doubled = stream.pipe(map(x => x * 2));
 *
 * // Add line numbers
 * const numbered = stream.pipe(map((line, idx) => `${idx}: ${line}`));
 *
 * // Parse JSON
 * const objects = stream.pipe(map(line => JSON.parse(line)));
 *
 * // Async transformation
 * const processed = stream.pipe(map(async x => await process(x)));
 * ```
 */
export function map<T, U>(
  fn: (item: T, index: number) => U | Promise<U>,
): Transform<T, U> {
  return async function* (stream) {
    let index = 0;
    for await (const item of stream) {
      yield await fn(item, index++);
    }
  };
}

/**
 * Transform each item into multiple items and flatten the result
 *
 * Each item is transformed into an async iterable or array, and all items from
 * each iterable are yielded in sequence. Useful for expanding streams
 * or performing one-to-many transformations.
 *
 * @param fn - Function that returns an async iterable or array for each item
 * @returns Transform that flattens nested iterables
 *
 * @example
 * ```ts
 * // Split each string into characters
 * const chars = stream.pipe(flatMap(async function* (str) {
 *   for (const char of str) {
 *     yield char;
 *   }
 * }));
 *
 * // Expand each file into its lines
 * const allLines = files.pipe(flatMap(file =>
 *   readLines(file.path)
 * ));
 *
 * // Expand using arrays
 * const items = data.pipe(flatMap(item => [item.a, item.b, item.c]));
 * ```
 */
export function flatMap<T, U>(
  fn: (item: T) => AsyncIterable<U> | U[] | Promise<U[] | AsyncIterable<U>>,
): Transform<T, U> {
  return async function* (stream) {
    for await (const item of stream) {
      const result = await fn(item);

      // Handle arrays
      if (Array.isArray(result)) {
        for (const subItem of result) {
          yield subItem;
        }
      } else {
        // Handle async iterables
        for await (const subItem of result) {
          yield subItem;
        }
      }
    }
  };
}

/**
 * Take only the first n items from a stream
 *
 * Stops iteration after n items have been yielded. If the stream
 * has fewer than n items, all items are yielded.
 *
 * @param n - Number of items to take
 * @returns Transform that limits stream to n items
 *
 * @example
 * ```ts
 * // Get first 10 items
 * const first10 = stream.pipe(take(10));
 *
 * // Get first item (alternative to .first())
 * const firstArray = await stream.pipe(take(1)).collect();
 * ```
 */
export function take<T>(n: number): Transform<T, T> {
  return async function* (stream) {
    let count = 0;
    for await (const item of stream) {
      if (count++ >= n) break;
      yield item;
    }
  };
}

/**
 * Split text chunks into individual lines
 *
 * Each text chunk is split on newline characters, yielding each
 * non-empty line. Useful for processing text files or command output.
 *
 * @returns Transform that splits text into lines
 *
 * @example
 * ```ts
 * // Process log file line by line
 * const logLines = cat("app.log")
 *   .pipe(lines())
 *   .pipe(filter(line => line.includes("ERROR")));
 *
 * // Process command output
 * const gitFiles = cmd("git", ["ls-files"])
 *   .stdout()
 *   .pipe(lines())
 *   .collect();
 * ```
 */
export function lines(): Transform<string, string> {
  return async function* (stream) {
    for await (const text of stream) {
      for (const line of text.split("\n")) {
        if (line) {
          yield line;
        }
      }
    }
  };
}

/**
 * Filter lines matching a pattern
 *
 * Only lines that match the pattern (string or RegExp) are yielded.
 * String patterns are converted to RegExp for testing.
 *
 * @param pattern - String or RegExp pattern to match
 * @returns Transform that filters lines by pattern
 *
 * @example
 * ```ts
 * // Find error lines
 * const errors = cat("app.log")
 *   .pipe(lines())
 *   .pipe(grep(/ERROR/));
 *
 * // String pattern
 * const todos = cat("README.md")
 *   .pipe(lines())
 *   .pipe(grep("TODO"));
 *
 * // Case insensitive
 * const matches = stream
 *   .pipe(lines())
 *   .pipe(grep(/error/i));
 * ```
 */
export function grep(pattern: RegExp | string): Transform<string, string> {
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  return filter((line) => regex.test(line));
}

/**
 * Get first n items from stream (alias for take)
 *
 * Shell-friendly name matching Unix `head` command.
 *
 * @param n - Number of items to take (default: 10)
 * @returns Transform that limits stream to first n items
 *
 * @example
 * ```ts
 * // Get first 3 lines (like head -3)
 * await cmd('lsof', ['-i']).stdout().pipe(lines()).pipe(head(3)).forEach(console.log);
 * ```
 */
export function head<T>(n: number = 10): Transform<T, T> {
  return take(n);
}

/**
 * Get last n items from stream
 *
 * Shell-friendly name matching Unix `tail` command.
 * Note: Must buffer the last n items, so memory usage is O(n).
 *
 * @param n - Number of items to keep (default: 10)
 * @returns Transform that yields only last n items
 *
 * @example
 * ```ts
 * // Get last 5 lines (like tail -5)
 * await cat('log.txt').pipe(lines()).pipe(tail(5)).forEach(console.log);
 * ```
 */
export function tail<T>(n: number = 10): Transform<T, T> {
  return async function* (stream) {
    const buffer: T[] = [];
    for await (const item of stream) {
      buffer.push(item);
      if (buffer.length > n) {
        buffer.shift();
      }
    }
    for (const item of buffer) {
      yield item;
    }
  };
}

/**
 * Process JSON with jq-like queries
 *
 * Apply jq query expressions to JSON data in the stream.
 * Each line is processed as JSON and the query result is yielded.
 *
 * @param query - jq query expression (e.g., ".name", ".items[]", "select(.age > 18)")
 * @param options - Optional jq options
 * @returns Transform that processes JSON with queries
 *
 * @example
 * ```ts
 * import { jq as jqCommand } from "../commands/jq/jq.ts";
 *
 * // Extract field from JSON
 * await cat('data.json')
 *   .pipe(lines())
 *   .pipe(jq('.name'))
 *   .collect();
 *
 * // Filter and transform
 * await cat('users.json')
 *   .pipe(lines())
 *   .pipe(jq('select(.age > 18) | .email'))
 *   .collect();
 *
 * // Array operations
 * await cat('api-response.json')
 *   .pipe(jq('.items[] | .id'))
 *   .collect();
 * ```
 */
export function jq(
  query: string,
  options?: { raw?: boolean; compact?: boolean; exitOnError?: boolean },
): Transform<string, string> {
  // Dynamic import to avoid circular dependencies
  return async function* (stream: AsyncIterable<string>) {
    const { jq: jqCommand } = await import("../commands/jq/jq.ts");
    const transform = jqCommand(query, options);
    yield* transform(stream);
  };
}
