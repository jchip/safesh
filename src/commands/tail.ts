/**
 * tail - Output the last part of input
 *
 * Works with AsyncIterable<string> input and yields lines.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Options for tail command
 */
export interface TailOptions {
  /** Number of lines to output (default: 10) */
  lines?: number;
  /** Number of bytes to output (overrides lines) */
  bytes?: number;
  /** Start from line N (like +N in tail) */
  fromLine?: number;
  /** Quiet mode - no headers for multiple inputs */
  quiet?: boolean;
  /** Follow mode - not implemented for streams */
  follow?: boolean;
}

/**
 * Get the last N lines from an async iterable
 *
 * Note: Must buffer the last N items, so memory usage is O(n).
 *
 * @param input - Async iterable of lines
 * @param n - Number of lines to keep (default: 10)
 * @returns Async iterable yielding last N lines
 *
 * @example
 * ```ts
 * // Get last 5 lines
 * for await (const line of tailLines(stream, 5)) {
 *   console.log(line);
 * }
 * ```
 */
export async function* tailLines(
  input: AsyncIterable<string>,
  n: number = 10,
): AsyncIterable<string> {
  if (n <= 0) return;

  const buffer: string[] = [];
  for await (const line of input) {
    buffer.push(line);
    if (buffer.length > n) {
      buffer.shift();
    }
  }

  for (const line of buffer) {
    yield line;
  }
}

/**
 * Get lines starting from line N
 *
 * @param input - Async iterable of lines
 * @param n - Line number to start from (1-indexed)
 * @returns Async iterable yielding lines from N onwards
 *
 * @example
 * ```ts
 * // Get lines starting from line 5 (like tail -n +5)
 * for await (const line of tailFromLine(stream, 5)) {
 *   console.log(line);
 * }
 * ```
 */
export async function* tailFromLine(
  input: AsyncIterable<string>,
  n: number,
): AsyncIterable<string> {
  let lineNum = 1;
  for await (const line of input) {
    if (lineNum >= n) {
      yield line;
    }
    lineNum++;
  }
}

/**
 * Get the last N bytes from an async iterable
 *
 * @param input - Async iterable of strings
 * @param n - Number of bytes to keep
 * @returns Async iterable yielding last N bytes
 *
 * @example
 * ```ts
 * // Get last 100 bytes
 * for await (const chunk of tailBytes(stream, 100)) {
 *   console.log(chunk);
 * }
 * ```
 */
export async function* tailBytes(
  input: AsyncIterable<string>,
  n: number,
): AsyncIterable<string> {
  if (n <= 0) return;

  // Collect all input
  const chunks: string[] = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }
  const content = chunks.join("");

  if (content.length <= n) {
    yield content;
  } else {
    yield content.slice(-n);
  }
}

/**
 * Get bytes starting from byte N
 *
 * @param input - Async iterable of strings
 * @param n - Byte position to start from (1-indexed)
 * @returns Async iterable yielding bytes from N onwards
 */
export async function* tailFromByte(
  input: AsyncIterable<string>,
  n: number,
): AsyncIterable<string> {
  // Collect all input
  const chunks: string[] = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }
  const content = chunks.join("");

  if (n <= 1) {
    yield content;
  } else if (n <= content.length) {
    yield content.slice(n - 1);
  }
}

/**
 * Tail transform - get last N lines (default: 10)
 *
 * @param n - Number of lines to keep
 * @returns Transform that yields last N lines
 *
 * @example
 * ```ts
 * // Get last 10 lines
 * const last10 = stream.pipe(tail());
 *
 * // Get last 5 lines
 * const last5 = stream.pipe(tail(5));
 * ```
 */
export function tail(n: number = 10): Transform<string, string> {
  return (stream) => tailLines(stream, n);
}

/**
 * Tail from line transform - get lines starting from line N
 *
 * @param n - Line number to start from (1-indexed)
 * @returns Transform that yields lines from N onwards
 *
 * @example
 * ```ts
 * // Skip header row (like tail -n +2)
 * const dataRows = stream.pipe(tailFrom(2));
 * ```
 */
export function tailFrom(n: number): Transform<string, string> {
  return (stream) => tailFromLine(stream, n);
}

/**
 * Tail bytes transform - get last N bytes
 *
 * @param n - Number of bytes to keep
 * @returns Transform that yields last N bytes
 *
 * @example
 * ```ts
 * // Get last 100 bytes
 * const last100 = stream.pipe(tailBytes_(100));
 * ```
 */
export function tailBytes_(n: number): Transform<string, string> {
  return (stream) => tailBytes(stream, n);
}

/**
 * Process tail with full options
 *
 * @param input - Async iterable of strings/lines
 * @param options - Tail options
 * @returns Async iterable of output
 */
export async function* tailWithOptions(
  input: AsyncIterable<string>,
  options: TailOptions = {},
): AsyncIterable<string> {
  const { lines = 10, bytes, fromLine } = options;

  if (fromLine !== undefined) {
    yield* tailFromLine(input, fromLine);
  } else if (bytes !== undefined) {
    yield* tailBytes(input, bytes);
  } else {
    yield* tailLines(input, lines);
  }
}

/**
 * Tail transform with full options
 *
 * @param options - Tail options
 * @returns Transform for tail operation
 */
export function tailTransform(options: TailOptions = {}): Transform<string, string> {
  return (stream) => tailWithOptions(stream, options);
}

// Export default as the transform factory for convenience
export default tailTransform;
