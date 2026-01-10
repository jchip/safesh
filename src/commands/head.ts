/**
 * head - Output the first part of input
 *
 * Works with AsyncIterable<string> input and yields lines.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Options for head command
 */
export interface HeadOptions {
  /** Number of lines to output (default: 10) */
  lines?: number;
  /** Number of bytes to output (overrides lines) */
  bytes?: number;
  /** Quiet mode - no headers for multiple inputs */
  quiet?: boolean;
  /** Negative count - output all but last N lines/bytes */
  negative?: boolean;
}

/**
 * Get the first N lines from an async iterable
 *
 * @param input - Async iterable of lines
 * @param n - Number of lines to take (default: 10)
 * @returns Async iterable yielding first N lines
 *
 * @example
 * ```ts
 * // Get first 5 lines
 * for await (const line of headLines(stream, 5)) {
 *   console.log(line);
 * }
 * ```
 */
export async function* headLines(
  input: AsyncIterable<string>,
  n: number = 10,
): AsyncIterable<string> {
  if (n <= 0) return;

  let count = 0;
  for await (const line of input) {
    if (count >= n) break;
    yield line;
    count++;
  }
}

/**
 * Get all but the last N lines from an async iterable
 *
 * @param input - Async iterable of lines
 * @param n - Number of lines to exclude from end
 * @returns Async iterable yielding all but last N lines
 *
 * @example
 * ```ts
 * // Get all but last 3 lines (like head -n -3)
 * for await (const line of headLinesNegative(stream, 3)) {
 *   console.log(line);
 * }
 * ```
 */
export async function* headLinesNegative(
  input: AsyncIterable<string>,
  n: number,
): AsyncIterable<string> {
  if (n <= 0) {
    // If n is 0 or negative, output all
    for await (const line of input) {
      yield line;
    }
    return;
  }

  // Buffer last N lines
  const buffer: string[] = [];
  for await (const line of input) {
    buffer.push(line);
    if (buffer.length > n) {
      yield buffer.shift()!;
    }
  }
  // Don't yield the last N lines in buffer
}

/**
 * Get the first N bytes from an async iterable
 *
 * @param input - Async iterable of strings
 * @param n - Number of bytes to take
 * @returns Async iterable yielding content up to N bytes
 *
 * @example
 * ```ts
 * // Get first 100 bytes
 * for await (const chunk of headBytes(stream, 100)) {
 *   console.log(chunk);
 * }
 * ```
 */
export async function* headBytes(
  input: AsyncIterable<string>,
  n: number,
): AsyncIterable<string> {
  if (n <= 0) return;

  let remaining = n;
  for await (const chunk of input) {
    if (remaining <= 0) break;

    if (chunk.length <= remaining) {
      yield chunk;
      remaining -= chunk.length;
    } else {
      yield chunk.slice(0, remaining);
      break;
    }
  }
}

/**
 * Get all but the last N bytes from an async iterable
 *
 * @param input - Async iterable of strings
 * @param n - Number of bytes to exclude from end
 * @returns Async iterable yielding all but last N bytes
 */
export async function* headBytesNegative(
  input: AsyncIterable<string>,
  n: number,
): AsyncIterable<string> {
  if (n <= 0) {
    for await (const chunk of input) {
      yield chunk;
    }
    return;
  }

  // Collect all input then slice
  const chunks: string[] = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }
  const content = chunks.join("");
  if (content.length > n) {
    yield content.slice(0, -n);
  }
}

/**
 * Head transform - get first N lines (default: 10)
 *
 * @param n - Number of lines to take (use negative for all but last N)
 * @returns Transform that yields first N lines
 *
 * @example
 * ```ts
 * // Get first 10 lines
 * const first10 = stream.pipe(head());
 *
 * // Get first 5 lines
 * const first5 = stream.pipe(head(5));
 *
 * // Get all but last 3 lines
 * const allButLast3 = stream.pipe(head(-3));
 * ```
 */
export function head(n: number = 10): Transform<string, string> {
  return (stream) => {
    if (n < 0) {
      return headLinesNegative(stream, -n);
    }
    return headLines(stream, n);
  };
}

/**
 * Head bytes transform - get first N bytes
 *
 * @param n - Number of bytes to take (use negative for all but last N)
 * @returns Transform that yields first N bytes
 *
 * @example
 * ```ts
 * // Get first 100 bytes
 * const first100 = stream.pipe(headBytes_(100));
 *
 * // Get all but last 50 bytes
 * const trimmed = stream.pipe(headBytes_(-50));
 * ```
 */
export function headBytes_(n: number): Transform<string, string> {
  return (stream) => {
    if (n < 0) {
      return headBytesNegative(stream, -n);
    }
    return headBytes(stream, n);
  };
}

/**
 * Process head with full options
 *
 * @param input - Async iterable of strings/lines
 * @param options - Head options
 * @returns Async iterable of output
 */
export async function* headWithOptions(
  input: AsyncIterable<string>,
  options: HeadOptions = {},
): AsyncIterable<string> {
  const { lines = 10, bytes, negative = false } = options;

  if (bytes !== undefined) {
    if (negative) {
      yield* headBytesNegative(input, bytes);
    } else {
      yield* headBytes(input, bytes);
    }
  } else {
    if (negative) {
      yield* headLinesNegative(input, lines);
    } else {
      yield* headLines(input, lines);
    }
  }
}

/**
 * Head transform with full options
 *
 * @param options - Head options
 * @returns Transform for head operation
 */
export function headTransform(options: HeadOptions = {}): Transform<string, string> {
  return (stream) => headWithOptions(stream, options);
}

// Export default as the transform factory for convenience
export default headTransform;
