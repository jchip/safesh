/**
 * nl - Number lines of input
 *
 * Works with AsyncIterable<string> input and yields numbered lines.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Numbering style for nl command
 * - 'a': Number all lines
 * - 't': Number non-empty lines only (default)
 * - 'n': No line numbering
 */
export type NumberingStyle = "a" | "t" | "n";

/**
 * Number format for nl command
 * - 'ln': Left justified
 * - 'rn': Right justified (default)
 * - 'rz': Right justified with leading zeros
 */
export type NumberFormat = "ln" | "rn" | "rz";

/**
 * Options for nl command
 */
export interface NlOptions {
  /** Body numbering style: a (all), t (non-empty), n (none). Default: 't' */
  bodyStyle?: NumberingStyle;
  /** Number format: ln (left), rn (right), rz (right zeros). Default: 'rn' */
  numberFormat?: NumberFormat;
  /** Number field width. Default: 6 */
  width?: number;
  /** Separator after number. Default: '\t' */
  separator?: string;
  /** Starting line number. Default: 1 */
  startNumber?: number;
  /** Line number increment. Default: 1 */
  increment?: number;
}

/**
 * Format a line number according to options
 *
 * @param num - The line number
 * @param format - Number format (ln, rn, rz)
 * @param width - Field width
 * @returns Formatted number string
 */
function formatLineNumber(
  num: number,
  format: NumberFormat,
  width: number,
): string {
  const numStr = String(num);
  switch (format) {
    case "ln":
      // Left justified
      return numStr.padEnd(width);
    case "rn":
      // Right justified with spaces
      return numStr.padStart(width);
    case "rz":
      // Right justified with zeros
      return numStr.padStart(width, "0");
    default: {
      const _exhaustive: never = format;
      return _exhaustive;
    }
  }
}

/**
 * Check if a line should be numbered based on style
 *
 * @param line - The line content
 * @param style - Numbering style
 * @returns True if the line should be numbered
 */
function shouldNumber(line: string, style: NumberingStyle): boolean {
  switch (style) {
    case "a":
      return true;
    case "t":
      return line.trim().length > 0;
    case "n":
      return false;
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}

/**
 * Number lines from an async iterable
 *
 * @param input - Async iterable of lines
 * @param options - Numbering options
 * @returns Async iterable of numbered lines
 *
 * @example
 * ```ts
 * // Number all lines
 * for await (const line of nlLines(stream, { bodyStyle: 'a' })) {
 *   console.log(line);
 * }
 * ```
 */
export async function* nlLines(
  input: AsyncIterable<string>,
  options: NlOptions = {},
): AsyncIterable<string> {
  const {
    bodyStyle = "t",
    numberFormat = "rn",
    width = 6,
    separator = "\t",
    startNumber = 1,
    increment = 1,
  } = options;

  let lineNumber = startNumber;

  for await (const line of input) {
    if (shouldNumber(line, bodyStyle)) {
      const formattedNum = formatLineNumber(lineNumber, numberFormat, width);
      yield `${formattedNum}${separator}${line}`;
      lineNumber += increment;
    } else {
      // Empty line without numbering - add padding for alignment
      const padding = " ".repeat(width);
      yield `${padding}${separator}${line}`;
    }
  }
}

/**
 * Simple line numbering - number all lines starting from 1
 *
 * @param input - Async iterable of lines
 * @returns Async iterable of numbered lines
 *
 * @example
 * ```ts
 * for await (const line of nlSimple(stream)) {
 *   console.log(line); // "     1\tFirst line"
 * }
 * ```
 */
export async function* nlSimple(
  input: AsyncIterable<string>,
): AsyncIterable<string> {
  yield* nlLines(input, { bodyStyle: "a" });
}

/**
 * Nl transform - number lines with default options
 *
 * @param options - Numbering options
 * @returns Transform that yields numbered lines
 *
 * @example
 * ```ts
 * // Number non-empty lines (default)
 * const numbered = stream.pipe(nl());
 *
 * // Number all lines
 * const allNumbered = stream.pipe(nl({ bodyStyle: 'a' }));
 *
 * // Custom format
 * const custom = stream.pipe(nl({
 *   bodyStyle: 'a',
 *   numberFormat: 'rz',
 *   width: 4,
 *   separator: ': '
 * }));
 * ```
 */
export function nl(options: NlOptions = {}): Transform<string, string> {
  return (stream) => nlLines(stream, options);
}

/**
 * Number all lines transform (shorthand for nl({ bodyStyle: 'a' }))
 *
 * @returns Transform that numbers all lines
 *
 * @example
 * ```ts
 * const numbered = stream.pipe(nlAll());
 * ```
 */
export function nlAll(): Transform<string, string> {
  return (stream) => nlLines(stream, { bodyStyle: "a" });
}

/**
 * Number non-empty lines transform (shorthand for nl({ bodyStyle: 't' }))
 *
 * @returns Transform that numbers non-empty lines only
 *
 * @example
 * ```ts
 * const numbered = stream.pipe(nlNonEmpty());
 * ```
 */
export function nlNonEmpty(): Transform<string, string> {
  return (stream) => nlLines(stream, { bodyStyle: "t" });
}

/**
 * Process nl with full options
 *
 * @param input - Async iterable of lines
 * @param options - Nl options
 * @returns Async iterable of numbered lines
 */
export async function* nlWithOptions(
  input: AsyncIterable<string>,
  options: NlOptions = {},
): AsyncIterable<string> {
  yield* nlLines(input, options);
}

/**
 * Nl transform with full options
 *
 * @param options - Nl options
 * @returns Transform for nl operation
 */
export function nlTransform(options: NlOptions = {}): Transform<string, string> {
  return nl(options);
}

// Export default as the transform factory for convenience
export default nlTransform;
