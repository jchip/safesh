/**
 * uniq - Report or filter out repeated lines
 *
 * Provides unique/duplicate line filtering with counting and field skipping.
 * Supports both function and transform versions for stream pipelines.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Options for uniq command
 */
export interface UniqOptions {
  /** Prefix lines with occurrence count */
  count?: boolean;
  /** Only print duplicate lines (lines that appear more than once) */
  duplicatesOnly?: boolean;
  /** Only print unique lines (lines that appear exactly once) */
  uniqueOnly?: boolean;
  /** Ignore case when comparing */
  ignoreCase?: boolean;
  /** Skip N fields before comparing */
  skipFields?: number;
  /** Skip N characters before comparing */
  skipChars?: number;
  /** Compare only first N characters (after skipping) */
  checkChars?: number;
}

/**
 * Result of counting adjacent duplicates
 */
interface UniqResult {
  line: string;
  count: number;
}

/**
 * Extract comparison key from a line based on options
 */
function getCompareKey(line: string, options: UniqOptions): string {
  let key = line;

  // Skip fields
  if (options.skipFields && options.skipFields > 0) {
    const parts = key.split(/\s+/);
    key = parts.slice(options.skipFields).join(" ");
  }

  // Skip characters
  if (options.skipChars && options.skipChars > 0) {
    key = key.slice(options.skipChars);
  }

  // Check only first N characters
  if (options.checkChars && options.checkChars > 0) {
    key = key.slice(0, options.checkChars);
  }

  // Apply case insensitivity
  if (options.ignoreCase) {
    key = key.toLowerCase();
  }

  return key;
}

/**
 * Compare two lines for equality based on options
 */
function linesEqual(a: string, b: string, options: UniqOptions): boolean {
  return getCompareKey(a, options) === getCompareKey(b, options);
}

/**
 * Format output line with optional count prefix
 */
function formatLine(result: UniqResult, showCount: boolean): string {
  if (showCount) {
    // Real uniq right-justifies count in a 4+ char field followed by space
    return `${String(result.count).padStart(4)} ${result.line}`;
  }
  return result.line;
}

/**
 * Filter repeated lines from an async iterable stream
 *
 * Note: Operates on adjacent lines only, like the real uniq command.
 * Input should typically be sorted first for global uniqueness.
 *
 * @param input - Input stream of lines
 * @param options - Uniq options
 * @returns Async iterable of filtered/counted lines
 *
 * @example
 * ```ts
 * // Remove adjacent duplicates
 * for await (const line of uniq(inputStream)) {
 *   console.log(line);
 * }
 *
 * // Count occurrences
 * for await (const line of uniq(inputStream, { count: true })) {
 *   console.log(line); // "   3 some line"
 * }
 *
 * // Show only duplicates
 * for await (const line of uniq(inputStream, { duplicatesOnly: true })) {
 *   console.log(line);
 * }
 * ```
 */
export async function* uniq(
  input: AsyncIterable<string>,
  options: UniqOptions = {},
): AsyncIterable<string> {
  const {
    count = false,
    duplicatesOnly = false,
    uniqueOnly = false,
  } = options;

  let currentLine: string | null = null;
  let currentCount = 0;

  for await (const line of input) {
    if (currentLine === null) {
      // First line
      currentLine = line;
      currentCount = 1;
    } else if (linesEqual(line, currentLine, options)) {
      // Same as previous - increment count
      currentCount++;
    } else {
      // Different line - output previous and start new group
      const result = { line: currentLine, count: currentCount };

      // Apply filters
      const shouldOutput =
        (!duplicatesOnly && !uniqueOnly) ||
        (duplicatesOnly && result.count > 1) ||
        (uniqueOnly && result.count === 1);

      if (shouldOutput) {
        yield formatLine(result, count);
      }

      currentLine = line;
      currentCount = 1;
    }
  }

  // Output final group
  if (currentLine !== null) {
    const result = { line: currentLine, count: currentCount };

    const shouldOutput =
      (!duplicatesOnly && !uniqueOnly) ||
      (duplicatesOnly && result.count > 1) ||
      (uniqueOnly && result.count === 1);

    if (shouldOutput) {
      yield formatLine(result, count);
    }
  }
}

/**
 * Create a uniq transform for stream pipelines
 *
 * @param options - Uniq options
 * @returns Transform function for use with Stream.pipe()
 *
 * @example
 * ```ts
 * // Remove adjacent duplicates after sorting
 * const unique = await cat("data.txt")
 *   .pipe(lines())
 *   .pipe(sortTransform())
 *   .pipe(uniqTransform())
 *   .collect();
 *
 * // Count occurrences, ignoring case
 * const counts = await stream
 *   .pipe(sortTransform({ ignoreCase: true }))
 *   .pipe(uniqTransform({ count: true, ignoreCase: true }))
 *   .collect();
 *
 * // Find lines that appear more than once
 * const duplicates = await stream
 *   .pipe(sortTransform())
 *   .pipe(uniqTransform({ duplicatesOnly: true }))
 *   .collect();
 * ```
 */
export function uniqTransform(options: UniqOptions = {}): Transform<string, string> {
  return (stream) => uniq(stream, options);
}

// Export default as the transform factory for convenience
export default uniqTransform;
