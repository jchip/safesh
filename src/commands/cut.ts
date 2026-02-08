/**
 * cut - Extract sections from each line
 *
 * Provides field, character, and byte extraction from text streams.
 * Supports both function and transform versions for stream pipelines.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Options for cut command
 */
export interface CutOptions {
  /** Field delimiter (default: "\t") */
  delimiter?: string;
  /** Fields to extract (1-indexed, e.g., "1,3,5-7") */
  fields?: string;
  /** Characters to extract (1-indexed, e.g., "1-5,10") */
  characters?: string;
  /** Bytes to extract (1-indexed, e.g., "1-10") */
  bytes?: string;
  /** Invert selection (output non-selected parts) */
  complement?: boolean;
  /** Suppress lines without delimiters (only with -f) */
  onlyDelimited?: boolean;
  /** Output delimiter (default: same as input delimiter) */
  outputDelimiter?: string;
}

/**
 * Range specification for field/char/byte extraction
 */
interface CutRange {
  start: number;
  end: number | null; // null means to end of line
}

/**
 * Parse a range specification like "1,3,5-7" into CutRange[]
 */
function parseRange(spec: string): CutRange[] {
  const ranges: CutRange[] = [];
  const parts = spec.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      ranges.push({
        start: startStr ? parseInt(startStr, 10) : 1,
        end: endStr ? parseInt(endStr, 10) : null,
      });
    } else {
      const num = parseInt(trimmed, 10);
      if (!Number.isNaN(num)) {
        ranges.push({ start: num, end: num });
      }
    }
  }

  // Sort ranges by start position
  ranges.sort((a, b) => a.start - b.start);

  return ranges;
}

/**
 * Extract items by ranges, maintaining order
 */
function extractByRanges(
  items: string[],
  ranges: CutRange[],
  complement: boolean,
): string[] {
  const selected = new Set<number>();

  for (const range of ranges) {
    const start = range.start - 1; // Convert to 0-indexed
    const end = range.end === null ? items.length : range.end;

    for (let i = start; i < end && i < items.length; i++) {
      if (i >= 0) {
        selected.add(i);
      }
    }
  }

  const result: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const isSelected = selected.has(i);
    if (complement ? !isSelected : isSelected) {
      result.push(items[i]);
    }
  }

  return result;
}

/**
 * Process a single line with cut options
 */
function processLine(line: string, options: CutOptions): string | null {
  const {
    delimiter = "\t",
    fields,
    characters,
    bytes,
    complement = false,
    onlyDelimited = false,
    outputDelimiter,
  } = options;

  const outDelim = outputDelimiter ?? delimiter;

  if (bytes) {
    // Byte mode: extract actual byte ranges using TextEncoder/TextDecoder
    const spec = bytes;
    const ranges = parseRange(spec);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const encoded = encoder.encode(line);
    const selected = new Set<number>();

    for (const range of ranges) {
      const start = range.start - 1;
      const end = range.end === null ? encoded.length : range.end;
      for (let i = start; i < end && i < encoded.length; i++) {
        if (i >= 0) selected.add(i);
      }
    }

    const resultBytes: number[] = [];
    for (let i = 0; i < encoded.length; i++) {
      const isSelected = selected.has(i);
      if (complement ? !isSelected : isSelected) {
        resultBytes.push(encoded[i]!);
      }
    }
    return decoder.decode(new Uint8Array(resultBytes));
  }

  if (characters) {
    // Character mode: handle Unicode properly via code points
    const spec = characters;
    const ranges = parseRange(spec);
    const chars = [...line]; // Handle Unicode properly
    const selected = extractByRanges(chars, ranges, complement);
    return selected.join("");
  }

  if (fields) {
    // Field mode
    if (onlyDelimited && !line.includes(delimiter)) {
      return null; // Suppress line without delimiter
    }

    const fieldList = line.split(delimiter);
    const ranges = parseRange(fields);
    const selected = extractByRanges(fieldList, ranges, complement);
    return selected.join(outDelim);
  }

  // No extraction spec - return whole line
  return line;
}

/**
 * Cut lines from an async iterable stream
 *
 * @param input - Input stream of lines
 * @param options - Cut options
 * @returns Async iterable of processed lines
 *
 * @example
 * ```ts
 * // Extract fields 1 and 3 from TSV data
 * for await (const line of cut(inputStream, { fields: "1,3" })) {
 *   console.log(line);
 * }
 *
 * // Extract first 10 characters from each line
 * for await (const line of cut(inputStream, { characters: "1-10" })) {
 *   console.log(line);
 * }
 * ```
 */
export async function* cut(
  input: AsyncIterable<string>,
  options: CutOptions = {},
): AsyncIterable<string> {
  for await (const line of input) {
    const result = processLine(line, options);
    if (result !== null) {
      yield result;
    }
  }
}

/**
 * Create a cut transform for stream pipelines
 *
 * @param options - Cut options
 * @returns Transform function for use with Stream.pipe()
 *
 * @example
 * ```ts
 * // Extract second field from CSV
 * const secondColumn = await cat("data.csv")
 *   .pipe(lines())
 *   .pipe(cutTransform({ delimiter: ",", fields: "2" }))
 *   .collect();
 *
 * // Extract characters 1-5 with complement (everything except 1-5)
 * const rest = await stream
 *   .pipe(cutTransform({ characters: "1-5", complement: true }))
 *   .collect();
 * ```
 */
export function cutTransform(options: CutOptions = {}): Transform<string, string> {
  return (stream) => cut(stream, options);
}

// Export default as the transform factory for convenience
export default cutTransform;
