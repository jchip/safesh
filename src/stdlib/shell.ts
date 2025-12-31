/**
 * Fluent shell API ($)
 *
 * Provides shell-like ergonomics with method chaining for file-based
 * text processing. Wraps the Stream API with a simplified interface.
 *
 * @module
 */

import type { Stream } from "./stream.ts";
import { createStream } from "./stream.ts";
import { cat as catStream, type File } from "./fs-streams.ts";
import * as transforms from "./transforms.ts";
import { stdout as stdoutTransform } from "./io.ts";
import * as fs from "./fs.ts";

/**
 * Type guard to check if a value is a File object from glob()
 */
function isFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    "base" in value &&
    "contents" in value
  );
}

/**
 * FluentShell - A chainable API for file-based text processing
 *
 * Wraps Stream<string> internally and provides simplified methods
 * that delegate to existing transforms. All operations are lazy until
 * a terminal operation is called.
 *
 * @example
 * ```ts
 * // Process log file
 * await $('app.log').lines().grep(/ERROR/).head(10).print();
 *
 * // Get data
 * const errors = await $('app.log').lines().grep(/ERROR/).collect();
 *
 * // Count lines
 * const count = await $('data.txt').lines().count();
 * ```
 */
export class FluentShell {
  private _stream: Stream<string>;

  /**
   * Create a FluentShell from a file path, File object, or existing stream
   */
  constructor(source: string | File | Stream<string>) {
    if (typeof source === "string") {
      this._stream = catStream(source);
    } else if (isFile(source)) {
      // File object from glob() - use contents directly if string, otherwise read from path
      if (typeof source.contents === "string") {
        this._stream = createStream(
          (async function* () {
            yield source.contents as string;
          })(),
        );
      } else {
        // Binary contents - read as text from path
        this._stream = catStream(source.path);
      }
    } else {
      this._stream = source;
    }
  }

  // ============== Transform Methods ==============

  /**
   * Split content into lines
   *
   * @returns FluentShell for chaining
   *
   * @example
   * ```ts
   * $('log.txt').lines().head(10).print();
   * ```
   */
  lines(): FluentShell {
    return new FluentShell(this._stream.pipe(transforms.lines()));
  }

  /**
   * Filter lines matching a pattern
   *
   * @param pattern - String or RegExp pattern to match
   * @returns FluentShell for chaining
   *
   * @example
   * ```ts
   * $('app.log').lines().grep(/ERROR/).print();
   * ```
   */
  grep(pattern: RegExp | string): FluentShell {
    return new FluentShell(this._stream.pipe(transforms.grep(pattern)));
  }

  /**
   * Take first n items
   *
   * @param n - Number of items to take (default: 10)
   * @returns FluentShell for chaining
   *
   * @example
   * ```ts
   * $('data.txt').lines().head(5).print();
   * ```
   */
  head(n: number = 10): FluentShell {
    return new FluentShell(this._stream.pipe(transforms.head(n)));
  }

  /**
   * Take last n items
   *
   * Note: Buffers n items in memory.
   *
   * @param n - Number of items to keep (default: 10)
   * @returns FluentShell for chaining
   *
   * @example
   * ```ts
   * $('data.txt').lines().tail(5).print();
   * ```
   */
  tail(n: number = 10): FluentShell {
    return new FluentShell(this._stream.pipe(transforms.tail(n)));
  }

  /**
   * Filter items using a predicate
   *
   * @param predicate - Function returning true for items to keep
   * @returns FluentShell for chaining
   *
   * @example
   * ```ts
   * $('data.txt').lines().filter(line => line.length > 10).print();
   * ```
   */
  filter(
    predicate: (item: string) => boolean | Promise<boolean>,
  ): FluentShell {
    return new FluentShell(this._stream.pipe(transforms.filter(predicate)));
  }

  /**
   * Transform each item
   *
   * @param fn - Transform function
   * @returns FluentShell for chaining
   *
   * @example
   * ```ts
   * $('data.txt').lines().map(line => line.toUpperCase()).print();
   * ```
   */
  map(fn: (item: string) => string | Promise<string>): FluentShell {
    return new FluentShell(this._stream.pipe(transforms.map(fn)));
  }

  /**
   * Take first n items (alias for head)
   *
   * @param n - Number of items to take
   * @returns FluentShell for chaining
   */
  take(n: number): FluentShell {
    return this.head(n);
  }

  // ============== Terminal Operations ==============

  /**
   * Print to stdout
   *
   * Terminal operation - executes the pipeline and prints each item.
   *
   * @returns Promise that resolves when all items are printed
   *
   * @example
   * ```ts
   * await $('log.txt').lines().grep(/ERROR/).print();
   * ```
   */
  async print(): Promise<void> {
    await this._stream.pipe(stdoutTransform()).forEach(() => {});
  }

  /**
   * Save to file
   *
   * Terminal operation - collects all items and writes to file.
   *
   * @param path - Path to write to
   * @returns Promise that resolves when file is written
   *
   * @example
   * ```ts
   * await $('data.txt').lines().grep(/pattern/).save('filtered.txt');
   * ```
   */
  async save(path: string): Promise<void> {
    const items = await this._stream.collect();
    const content = items.join("\n") + (items.length > 0 ? "\n" : "");
    await fs.write(path, content);
  }

  /**
   * Collect all items into an array
   *
   * Terminal operation - executes the pipeline.
   *
   * @returns Promise resolving to array of all items
   *
   * @example
   * ```ts
   * const errors = await $('log.txt').lines().grep(/ERROR/).collect();
   * console.log(`Found ${errors.length} errors`);
   * ```
   */
  async collect(): Promise<string[]> {
    return await this._stream.collect();
  }

  /**
   * Get the first item
   *
   * Terminal operation - executes pipeline until first item.
   *
   * @returns Promise resolving to first item or undefined
   *
   * @example
   * ```ts
   * const firstError = await $('log.txt').lines().grep(/ERROR/).first();
   * ```
   */
  async first(): Promise<string | undefined> {
    return await this._stream.first();
  }

  /**
   * Count items
   *
   * Terminal operation - executes the entire pipeline.
   *
   * @returns Promise resolving to count of items
   *
   * @example
   * ```ts
   * const errorCount = await $('log.txt').lines().grep(/ERROR/).count();
   * ```
   */
  async count(): Promise<number> {
    return await this._stream.count();
  }

  /**
   * Execute a function for each item
   *
   * Terminal operation - executes the entire pipeline.
   *
   * @param fn - Function to call for each item
   * @returns Promise that resolves when all items are processed
   *
   * @example
   * ```ts
   * await $('log.txt').lines().forEach(line => {
   *   console.log(`Processing: ${line}`);
   * });
   * ```
   */
  async forEach(fn: (item: string) => void | Promise<void>): Promise<void> {
    await this._stream.forEach(fn);
  }

  // ============== Escape Hatch ==============

  /**
   * Get the underlying Stream<string>
   *
   * Escape hatch for advanced operations not covered by FluentShell.
   *
   * @returns The underlying Stream<string>
   *
   * @example
   * ```ts
   * const stream = $('data.txt').lines().stream();
   * // Now use full Stream API
   * await stream.pipe(customTransform()).collect();
   * ```
   */
  stream(): Stream<string> {
    return this._stream;
  }

  /**
   * Make FluentShell async iterable
   *
   * Allows using for-await-of directly on FluentShell.
   *
   * @example
   * ```ts
   * for await (const line of $('data.txt').lines()) {
   *   console.log(line);
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this._stream[Symbol.asyncIterator]();
  }
}

// ============== Factory Function ==============

/**
 * Shell function type with static methods
 */
interface ShellFunction {
  /**
   * Create a FluentShell from a file path or File object
   *
   * @param source - File path string or File object from glob()
   * @returns FluentShell instance
   *
   * @example
   * ```ts
   * // From file path
   * await $('app.log').lines().grep(/ERROR/).head(10).print();
   *
   * // From File object (e.g., from glob())
   * const files = await glob('*.ts').collect();
   * await $(files[0]).lines().head(5).print();
   * ```
   */
  (source: string | File): FluentShell;

  /**
   * Create FluentShell from array of strings
   *
   * @param items - Array of strings
   * @returns FluentShell instance
   *
   * @example
   * ```ts
   * const result = await $.from(['line1', 'line2', 'line3'])
   *   .grep(/1|2/)
   *   .collect();
   * ```
   */
  from(items: string[]): FluentShell;

  /**
   * Create FluentShell from a string
   *
   * @param content - String content
   * @returns FluentShell instance
   *
   * @example
   * ```ts
   * const lines = await $.text('line1\nline2\nline3').lines().collect();
   * ```
   */
  text(content: string): FluentShell;

  /**
   * Create FluentShell from an existing Stream
   *
   * @param stream - Stream<string> instance
   * @returns FluentShell instance
   *
   * @example
   * ```ts
   * const cmdOutput = cmd('ls', ['-la']).stdout();
   * const fluent = $.wrap(cmdOutput);
   * await fluent.grep(/\.ts$/).print();
   * ```
   */
  wrap(stream: Stream<string>): FluentShell;
}

/**
 * Create a FluentShell from a file path or File object
 */
function $(source: string | File): FluentShell {
  return new FluentShell(source);
}

/**
 * Create FluentShell from array of strings
 */
$.from = (items: string[]): FluentShell => {
  const stream = createStream(
    (async function* () {
      for (const item of items) {
        yield item;
      }
    })(),
  );
  return new FluentShell(stream);
};

/**
 * Create FluentShell from a string
 */
$.text = (content: string): FluentShell => {
  const stream = createStream(
    (async function* () {
      yield content;
    })(),
  );
  return new FluentShell(stream);
};

/**
 * Create FluentShell from an existing Stream
 */
$.wrap = (stream: Stream<string>): FluentShell => {
  return new FluentShell(stream);
};

export default $ as ShellFunction;
