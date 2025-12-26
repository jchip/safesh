/**
 * Stream - Composable async iterables with pipe support
 *
 * Provides a Gulp-inspired streaming API with lazy evaluation,
 * type-safe transforms, and terminal operations.
 *
 * @module
 */

/**
 * Transform function - converts one stream type to another
 */
export type Transform<T, U> = (stream: AsyncIterable<T>) => AsyncIterable<U>;

/**
 * Stream interface - extends AsyncIterable with pipe() and terminal operations
 *
 * Streams are lazy - they don't execute until consumed by a terminal operation
 * like collect(), forEach(), first(), or count().
 *
 * @example
 * ```ts
 * const numbers = createStream((async function* () {
 *   yield 1; yield 2; yield 3;
 * })());
 *
 * const doubled = numbers.pipe(map(x => x * 2));
 * const result = await doubled.collect(); // [2, 4, 6]
 * ```
 */
export interface Stream<T> extends AsyncIterable<T> {
  /**
   * Apply a transform to this stream, returning a new stream
   *
   * @param transform - Function that transforms AsyncIterable<T> to AsyncIterable<U>
   * @returns New stream with transformed values
   *
   * @example
   * ```ts
   * const doubled = stream.pipe(map(x => x * 2));
   * const filtered = doubled.pipe(filter(x => x > 5));
   * ```
   */
  pipe<U>(transform: Transform<T, U>): Stream<U>;

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
   * console.log(values); // [1, 2, 3, ...]
   * ```
   */
  collect(): Promise<T[]>;

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
   * await stream.forEach(value => {
   *   console.log(value);
   * });
   * ```
   */
  forEach(fn: (item: T) => void | Promise<void>): Promise<void>;

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
   * if (first !== undefined) {
   *   console.log('First value:', first);
   * }
   * ```
   */
  first(): Promise<T | undefined>;

  /**
   * Count the total number of values in the stream
   *
   * Terminal operation - executes the entire pipeline.
   *
   * @returns Promise resolving to count of values
   *
   * @example
   * ```ts
   * const total = await stream.count();
   * console.log(`Stream has ${total} values`);
   * ```
   */
  count(): Promise<number>;
}

/**
 * Implementation of Stream interface
 *
 * Wraps an AsyncIterable with pipe() method and terminal operations.
 */
class StreamImpl<T> implements Stream<T> {
  constructor(private iterable: AsyncIterable<T>) {}

  /**
   * Make this class async iterable
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.iterable[Symbol.asyncIterator]();
  }

  /**
   * Apply a transform to create a new stream
   */
  pipe<U>(transform: Transform<T, U>): Stream<U> {
    return new StreamImpl(transform(this.iterable));
  }

  /**
   * Collect all values into an array
   */
  async collect(): Promise<T[]> {
    const results: T[] = [];
    for await (const item of this) {
      results.push(item);
    }
    return results;
  }

  /**
   * Execute function for each value
   */
  async forEach(fn: (item: T) => void | Promise<void>): Promise<void> {
    for await (const item of this) {
      await fn(item);
    }
  }

  /**
   * Get first value or undefined
   */
  async first(): Promise<T | undefined> {
    for await (const item of this) {
      return item; // Return first value and stop iterating
    }
    return undefined;
  }

  /**
   * Count total values
   */
  async count(): Promise<number> {
    let count = 0;
    for await (const _ of this) {
      count++;
    }
    return count;
  }
}

/**
 * Create a new Stream from an AsyncIterable
 *
 * @param iterable - Any async iterable (async generator, async iterator, etc.)
 * @returns Stream with pipe() and terminal operations
 *
 * @example
 * ```ts
 * // From async generator
 * const stream = createStream((async function* () {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 * })());
 *
 * // From array
 * const stream2 = createStream((async function* () {
 *   for (const item of [1, 2, 3]) {
 *     yield item;
 *   }
 * })());
 *
 * // Use it
 * const result = await stream.collect(); // [1, 2, 3]
 * ```
 */
export function createStream<T>(iterable: AsyncIterable<T>): Stream<T> {
  return new StreamImpl(iterable);
}

/**
 * Create a Stream from a synchronous array
 *
 * Convenience helper for testing and simple cases.
 *
 * @param items - Array of items
 * @returns Stream of items
 *
 * @example
 * ```ts
 * const stream = fromArray([1, 2, 3, 4, 5]);
 * const doubled = stream.pipe(map(x => x * 2));
 * const result = await doubled.collect(); // [2, 4, 6, 8, 10]
 * ```
 */
export function fromArray<T>(items: T[]): Stream<T> {
  return createStream((async function* () {
    for (const item of items) {
      yield item;
    }
  })());
}

/**
 * Create an empty Stream
 *
 * @returns Empty stream
 *
 * @example
 * ```ts
 * const stream = empty<number>();
 * const result = await stream.collect(); // []
 * const first = await stream.first(); // undefined
 * const count = await stream.count(); // 0
 * ```
 */
export function empty<T>(): Stream<T> {
  return createStream((async function* () {
    // Yield nothing
  })());
}
