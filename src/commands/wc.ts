/**
 * wc - Word, line, and character count
 *
 * Works with AsyncIterable<string> input.
 * Returns counts or yields formatted output.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

const textEncoder = new TextEncoder();

/**
 * Options for wc command
 */
export interface WcOptions {
  /** Count lines only */
  lines?: boolean;
  /** Count words only */
  words?: boolean;
  /** Count bytes */
  bytes?: boolean;
  /** Count characters (UTF-8 aware) */
  chars?: boolean;
}

/**
 * Word count statistics
 */
export interface WcStats {
  /** Number of lines (newline count) */
  lines: number;
  /** Number of words (whitespace-separated) */
  words: number;
  /** Number of bytes */
  bytes: number;
  /** Number of characters (may differ from bytes for UTF-8) */
  chars: number;
}

/**
 * Count statistics from an async iterable
 *
 * @param input - Async iterable of strings
 * @returns Promise resolving to WcStats
 *
 * @example
 * ```ts
 * const stats = await wcCount(stream);
 * console.log(`Lines: ${stats.lines}, Words: ${stats.words}`);
 * ```
 */
export async function wcCount(input: AsyncIterable<string>): Promise<WcStats> {
  let lines = 0;
  let words = 0;
  let bytes = 0;
  let chars = 0;
  let inWord = false;

  for await (const chunk of input) {
    bytes += new TextEncoder().encode(chunk).length;
    chars += chunk.length;

    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];

      if (c === "\n") {
        lines++;
        if (inWord) {
          words++;
          inWord = false;
        }
      } else if (c === " " || c === "\t" || c === "\r") {
        if (inWord) {
          words++;
          inWord = false;
        }
      } else {
        inWord = true;
      }
    }
  }

  // Count final word if content doesn't end with whitespace
  if (inWord) {
    words++;
  }

  return { lines, words, bytes, chars };
}

/**
 * Format wc statistics according to options
 *
 * @param stats - Word count statistics
 * @param options - Which counts to include
 * @returns Formatted string
 */
export function formatWcStats(stats: WcStats, options: WcOptions = {}): string {
  const { lines: showLines, words: showWords, bytes: showBytes, chars: showChars } = options;

  // If no flags specified, show lines, words, and bytes
  const showAll = !showLines && !showWords && !showBytes && !showChars;

  const values: string[] = [];
  if (showAll || showLines) {
    values.push(String(stats.lines));
  }
  if (showAll || showWords) {
    values.push(String(stats.words));
  }
  if (showAll || showBytes) {
    values.push(String(stats.bytes));
  }
  if (showChars && !showBytes) {
    // -m is only shown if -c is not specified
    values.push(String(stats.chars));
  }

  return values.join("\t");
}

/**
 * Count lines in an async iterable
 *
 * @param input - Async iterable of strings
 * @returns Promise resolving to line count
 *
 * @example
 * ```ts
 * const count = await wcLines(stream);
 * console.log(`${count} lines`);
 * ```
 */
export async function wcLines(input: AsyncIterable<string>): Promise<number> {
  let lines = 0;
  for await (const chunk of input) {
    for (const c of chunk) {
      if (c === "\n") lines++;
    }
  }
  return lines;
}

/**
 * Count words in an async iterable
 *
 * @param input - Async iterable of strings
 * @returns Promise resolving to word count
 *
 * @example
 * ```ts
 * const count = await wcWords(stream);
 * console.log(`${count} words`);
 * ```
 */
export async function wcWords(input: AsyncIterable<string>): Promise<number> {
  let words = 0;
  let inWord = false;

  for await (const chunk of input) {
    for (const c of chunk) {
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        if (inWord) {
          words++;
          inWord = false;
        }
      } else {
        inWord = true;
      }
    }
  }

  if (inWord) words++;
  return words;
}

/**
 * Count bytes in an async iterable
 *
 * @param input - Async iterable of strings
 * @returns Promise resolving to byte count
 *
 * @example
 * ```ts
 * const count = await wcBytes(stream);
 * console.log(`${count} bytes`);
 * ```
 */
export async function wcBytes(input: AsyncIterable<string>): Promise<number> {
  let bytes = 0;
  for await (const chunk of input) {
    bytes += new TextEncoder().encode(chunk).length;
  }
  return bytes;
}

/**
 * Count characters in an async iterable
 *
 * @param input - Async iterable of strings
 * @returns Promise resolving to character count
 *
 * @example
 * ```ts
 * const count = await wcChars(stream);
 * console.log(`${count} characters`);
 * ```
 */
export async function wcChars(input: AsyncIterable<string>): Promise<number> {
  let chars = 0;
  for await (const chunk of input) {
    chars += chunk.length;
  }
  return chars;
}

/**
 * Wc transform - yields formatted count string
 *
 * @param options - Which counts to include
 * @returns Transform that yields a single formatted count string
 *
 * @example
 * ```ts
 * // Get all counts
 * const counts = await stream.pipe(wc()).first();
 *
 * // Get only line count
 * const lineCount = await stream.pipe(wc({ lines: true })).first();
 * ```
 */
export function wc(options: WcOptions = {}): Transform<string, string> {
  return async function* (stream) {
    const stats = await wcCount(stream);
    yield formatWcStats(stats, options);
  };
}

/**
 * Wc line count transform - yields line count as string
 *
 * @returns Transform that yields line count
 *
 * @example
 * ```ts
 * const count = await stream.pipe(wcL()).first();
 * console.log(`${count} lines`);
 * ```
 */
export function wcL(): Transform<string, string> {
  return async function* (stream) {
    const count = await wcLines(stream);
    yield String(count);
  };
}

/**
 * Wc word count transform - yields word count as string
 *
 * @returns Transform that yields word count
 */
export function wcW(): Transform<string, string> {
  return async function* (stream) {
    const count = await wcWords(stream);
    yield String(count);
  };
}

/**
 * Wc byte count transform - yields byte count as string
 *
 * @returns Transform that yields byte count
 */
export function wcC(): Transform<string, string> {
  return async function* (stream) {
    const count = await wcBytes(stream);
    yield String(count);
  };
}

/**
 * Wc character count transform - yields character count as string
 *
 * @returns Transform that yields character count
 */
export function wcM(): Transform<string, string> {
  return async function* (stream) {
    const count = await wcChars(stream);
    yield String(count);
  };
}

/**
 * Process wc with full options and return stats
 *
 * @param input - Async iterable of strings
 * @param options - Wc options
 * @returns Promise resolving to WcStats
 */
export async function wcWithOptions(
  input: AsyncIterable<string>,
  options: WcOptions = {},
): Promise<WcStats> {
  return wcCount(input);
}

/**
 * Wc transform with full options
 *
 * @param options - Wc options
 * @returns Transform for wc operation
 */
export function wcTransform(options: WcOptions = {}): Transform<string, string> {
  return wc(options);
}

// Export default as the transform factory for convenience
export default wcTransform;
