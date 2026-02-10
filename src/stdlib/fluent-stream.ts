/**
 * FluentStream - Generic chainable API for any stream type
 *
 * Provides a fluent interface for stream operations with method chaining.
 * Works with any stream type T, making it reusable for File streams, string streams, etc.
 *
 * @module
 */

import type { Stream, Transform } from "./stream.ts";
import * as transforms from "./transforms.ts";
import { type CommandFn, CMD_NAME_SYMBOL } from "./command-init.ts";
import { toCmdLines } from "./command-transforms.ts";
import { Command, type CommandOptions } from "./command.ts";

/**
 * FluentStream<T> - A chainable API for stream processing
 *
 * Wraps Stream<T> internally and provides simplified methods
 * that delegate to existing transforms. All operations are lazy until
 * a terminal operation is called.
 *
 * Implements AsyncIterable so it can be used in for-await-of loops.
 *
 * @example
 * ```ts
 * // Process glob results
 * await glob('*.txt')
 *   .filter(f => f.path.includes('test'))
 *   .map(f => f.contents)
 *   .collect();
 *
 * // Use in for-await-of loop
 * for await (const file of glob('*.txt')) {
 *   console.log(file.path);
 * }
 * ```
 */
export class FluentStream<T> implements AsyncIterable<T> {
  protected _stream: Stream<T>;

  /**
   * Create a FluentStream from an existing stream
   */
  constructor(stream: Stream<T>) {
    this._stream = stream;
  }

  /**
   * Implement AsyncIterable interface
   * Allows using FluentStream in for-await-of loops
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this._stream[Symbol.asyncIterator]();
  }

  // ============== Transform Methods ==============

  /**
   * Filter items using a predicate
   *
   * @param predicate - Function returning true for items to keep (receives item and index)
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * stream.filter(item => item.value > 10);
   * stream.filter((line, idx) => idx > 0); // skip first item
   * ```
   */
  filter(
    predicate: (item: T, index: number) => boolean | Promise<boolean>,
  ): FluentStream<T> {
    return new FluentStream(this._stream.pipe(transforms.filter(predicate)));
  }

  /**
   * Transform each item
   *
   * @param fn - Transform function (receives item and index)
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * stream.map(item => item.toUpperCase());
   * stream.map((line, idx) => `${idx}: ${line}`); // add line numbers
   * ```
   */
  map<U>(fn: (item: T, index: number) => U | Promise<U>): FluentStream<U> {
    return new FluentStream(this._stream.pipe(transforms.map(fn)));
  }

  /**
   * Transform each item into multiple items and flatten
   *
   * @param fn - Function that returns an async iterable for each item
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * stream.flatMap(async function*(item) {
   *   yield item;
   *   yield item * 2;
   * });
   * ```
   */
  flatMap<U>(
    fn: (item: T) => AsyncIterable<U>,
  ): FluentStream<U> {
    return new FluentStream(this._stream.pipe(transforms.flatMap(fn)));
  }

  /**
   * Take first n items
   *
   * @param n - Number of items to take
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * stream.head(5);
   * ```
   */
  head(n: number): FluentStream<T> {
    return new FluentStream(this._stream.pipe(transforms.head(n)));
  }

  /**
   * Alias for head()
   */
  take(n: number): FluentStream<T> {
    return this.head(n);
  }

  /**
   * Take last n items
   *
   * Note: Buffers n items in memory.
   *
   * @param n - Number of items to keep
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * stream.tail(5);
   * ```
   */
  tail(n: number): FluentStream<T> {
    return new FluentStream(this._stream.pipe(transforms.tail(n)));
  }

  /**
   * Filter string items by a regex pattern (grep-like)
   *
   * Only works on FluentStream<string>. Returns lines matching the pattern.
   *
   * @param pattern - RegExp or string pattern to match
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * stream.grep(/ERROR/).collect();
   * stream.grep('warning').collect();
   * ```
   */
  grep(this: FluentStream<string>, pattern: RegExp | string): FluentStream<string> {
    return new FluentStream(
      this._stream.pipe(transforms.grep(pattern))
    );
  }

  /**
   * Split string stream into lines
   *
   * Only works on FluentStream<string>. Splits on newlines.
   *
   * @returns FluentStream of individual lines
   *
   * @example
   * ```ts
   * stream.lines().collect();
   * ```
   */
  lines(this: FluentStream<string>): FluentStream<string> {
    return new FluentStream(
      this._stream.pipe(transforms.lines())
    );
  }

  /**
   * Pipe stream through a transform or external command
   *
   * Overloaded to accept either:
   * - Transform function: applies transform to stream
   * - CommandFn: pipes stream through external command (yields output lines)
   * - Command object: pipes stream through command directly (SSH-557)
   *
   * @example
   * ```ts
   * // With transform
   * stream.pipe(filter(x => x > 5));
   *
   * // With CommandFn
   * const [sort] = await initCmds(['sort']);
   * stream.pipe(sort, ['-r']);
   *
   * // With Command object (transpiler-generated)
   * stream.pipe($.cmd('sed', ['s/foo/bar/']));
   * ```
   */
  pipe<U>(transform: Transform<T, U>): FluentStream<U>;
  pipe(commandFn: CommandFn, args?: string[], options?: CommandOptions): FluentStream<string>;
  pipe(command: Command): FluentStream<string>;
  pipe<U>(
    transformOrCmd: Transform<T, U> | CommandFn | Command,
    args: string[] = [],
    options?: CommandOptions,
  ): FluentStream<U> | FluentStream<string> {
    // SSH-557: Check if it's a Command object (from transpiler-generated $.cmd(...))
    if (transformOrCmd instanceof Command) {
      return new FluentStream(
        (this._stream as unknown as Stream<string>).pipe(toCmdLines(transformOrCmd))
      );
    }
    // Check if it's a CommandFn by looking for the symbol
    if (typeof transformOrCmd === "function" && CMD_NAME_SYMBOL in transformOrCmd) {
      return new FluentStream(
        (this._stream as unknown as Stream<string>).pipe(toCmdLines(transformOrCmd as CommandFn, args, options))
      );
    }
    // Otherwise treat as transform
    return new FluentStream(this._stream.pipe(transformOrCmd as Transform<T, U>));
  }

  /**
   * Alias for pipe(transform) - apply a transform function
   *
   * @param transform - A transform function
   * @returns FluentStream for chaining
   */
  trans<U>(transform: Transform<T, U>): FluentStream<U> {
    return new FluentStream(this._stream.pipe(transform));
  }

  // ============== Terminal Operations ==============

  /**
   * Collect all values from the stream into an array
   *
   * Terminal operation - executes the entire pipeline.
   *
   * @returns Promise resolving to array of all values
   *
   * @example
   * ```ts
   * const values = await stream.collect();
   * ```
   */
  async collect(): Promise<T[]> {
    return await this._stream.collect();
  }

  /**
   * Execute a function for each value in the stream
   *
   * Terminal operation - executes the entire pipeline.
   *
   * @param fn - Function to call for each value
   * @returns Promise that resolves when all values have been processed
   *
   * @example
   * ```ts
   * await stream.forEach(value => console.log(value));
   * ```
   */
  async forEach(fn: (item: T) => void | Promise<void>): Promise<void> {
    return await this._stream.forEach(fn);
  }

  /**
   * Get the first value from the stream
   *
   * Terminal operation - executes pipeline until first value.
   *
   * @returns Promise resolving to first value, or undefined if stream is empty
   *
   * @example
   * ```ts
   * const first = await stream.first();
   * ```
   */
  async first(): Promise<T | undefined> {
    return await this._stream.first();
  }

  /**
   * Count the total number of values in the stream
   *
   * Terminal operation - executes the entire pipeline.
   *
   * @returns Promise resolving to count of values
   *
   * @example
   * ```ts
   * const count = await stream.count();
   * ```
   */
  async count(): Promise<number> {
    return await this._stream.count();
  }

  /**
   * Get the underlying stream
   *
   * Useful for interoperability with other stream-based APIs.
   *
   * @returns The underlying Stream<T>
   */
  getStream(): Stream<T> {
    return this._stream;
  }
}

export default FluentStream;
