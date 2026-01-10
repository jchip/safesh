/**
 * sort - Sort lines of text
 *
 * Provides line sorting with numeric, reverse, key-based, and other options.
 * Supports both function and transform versions for stream pipelines.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Key specification for field-based sorting
 */
export interface SortKeySpec {
  /** Start field (1-indexed) */
  startField: number;
  /** Start character within field (1-indexed) */
  startChar?: number;
  /** End field (1-indexed) */
  endField?: number;
  /** End character within field (1-indexed) */
  endChar?: number;
  /** Per-key modifiers */
  numeric?: boolean;
  reverse?: boolean;
  ignoreCase?: boolean;
  ignoreLeading?: boolean;
  humanNumeric?: boolean;
  versionSort?: boolean;
  dictionaryOrder?: boolean;
  monthSort?: boolean;
}

/**
 * Options for sort command
 */
export interface SortOptions {
  /** Reverse sort order */
  reverse?: boolean;
  /** Numeric sort */
  numeric?: boolean;
  /** Output only unique lines */
  unique?: boolean;
  /** Ignore case when comparing */
  ignoreCase?: boolean;
  /** Human numeric sort (e.g., 2K, 1G) */
  humanNumeric?: boolean;
  /** Natural sort of version numbers */
  versionSort?: boolean;
  /** Dictionary order (only blanks and alphanumeric) */
  dictionaryOrder?: boolean;
  /** Month sort (JAN < FEB < ... < DEC) */
  monthSort?: boolean;
  /** Ignore leading blanks */
  ignoreLeadingBlanks?: boolean;
  /** Stable sort (preserve input order for equal elements) */
  stable?: boolean;
  /** Key specifications for field-based sorting */
  keys?: SortKeySpec[];
  /** Field delimiter */
  fieldDelimiter?: string;
}

// Human-readable size suffixes
const SIZE_SUFFIXES: Record<string, number> = {
  "": 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
  t: 1024 ** 4,
  p: 1024 ** 5,
  e: 1024 ** 6,
};

// Month names for -M
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a human-readable size like "1K", "2.5M", "3G"
 */
function parseHumanSize(s: string): number {
  const trimmed = s.trim();
  const match = trimmed.match(/^([+-]?\d*\.?\d+)\s*([kmgtpeKMGTPE])?[iI]?[bB]?$/);
  if (!match) {
    const num = parseFloat(trimmed);
    return Number.isNaN(num) ? 0 : num;
  }
  const num = parseFloat(match[1]);
  const suffix = (match[2] || "").toLowerCase();
  const multiplier = SIZE_SUFFIXES[suffix] || 1;
  return num * multiplier;
}

/**
 * Parse month name and return sort order (0 for unknown)
 */
function parseMonth(s: string): number {
  const trimmed = s.trim().toLowerCase().slice(0, 3);
  return MONTHS[trimmed] || 0;
}

/**
 * Compare version strings naturally (e.g., "1.2" < "1.10")
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(/(\d+)/);
  const partsB = b.split(/(\d+)/);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] || "";
    const partB = partsB[i] || "";

    const numA = /^\d+$/.test(partA) ? parseInt(partA, 10) : null;
    const numB = /^\d+$/.test(partB) ? parseInt(partB, 10) : null;

    if (numA !== null && numB !== null) {
      if (numA !== numB) return numA - numB;
    } else {
      if (partA !== partB) return partA.localeCompare(partB);
    }
  }
  return 0;
}

/**
 * Apply dictionary order: keep only alphanumeric and blanks
 */
function toDictionaryOrder(s: string): string {
  return s.replace(/[^a-zA-Z0-9\s]/g, "");
}

/**
 * Extract key value from a line based on key specification
 */
function extractKeyValue(
  line: string,
  key: SortKeySpec,
  delimiter: string | undefined,
): string {
  const splitPattern = delimiter !== undefined ? delimiter : /\s+/;
  const fields = line.split(splitPattern);

  const startFieldIdx = key.startField - 1;
  if (startFieldIdx >= fields.length) {
    return "";
  }

  if (key.endField === undefined) {
    let field = fields[startFieldIdx] || "";
    if (key.startChar !== undefined) {
      field = field.slice(key.startChar - 1);
    }
    if (key.ignoreLeading) {
      field = field.trimStart();
    }
    return field;
  }

  const endFieldIdx = Math.min(key.endField - 1, fields.length - 1);
  let result = "";

  for (let i = startFieldIdx; i <= endFieldIdx && i < fields.length; i++) {
    let field = fields[i] || "";

    if (i === startFieldIdx && key.startChar !== undefined) {
      field = field.slice(key.startChar - 1);
    }

    if (i === endFieldIdx && key.endChar !== undefined) {
      const endIdx =
        i === startFieldIdx && key.startChar !== undefined
          ? key.endChar - key.startChar + 1
          : key.endChar;
      field = field.slice(0, endIdx);
    }

    if (i > startFieldIdx) {
      result += delimiter || " ";
    }
    result += field;
  }

  if (key.ignoreLeading) {
    result = result.trimStart();
  }

  return result;
}

interface CompareOptions {
  numeric?: boolean;
  ignoreCase?: boolean;
  humanNumeric?: boolean;
  versionSort?: boolean;
  dictionaryOrder?: boolean;
  monthSort?: boolean;
}

/**
 * Compare two values with various sort modes
 */
function compareValues(a: string, b: string, opts: CompareOptions): number {
  let valA = a;
  let valB = b;

  if (opts.dictionaryOrder) {
    valA = toDictionaryOrder(valA);
    valB = toDictionaryOrder(valB);
  }

  if (opts.ignoreCase) {
    valA = valA.toLowerCase();
    valB = valB.toLowerCase();
  }

  if (opts.monthSort) {
    return parseMonth(valA) - parseMonth(valB);
  }

  if (opts.humanNumeric) {
    return parseHumanSize(valA) - parseHumanSize(valB);
  }

  if (opts.versionSort) {
    return compareVersions(valA, valB);
  }

  if (opts.numeric) {
    const numA = parseFloat(valA) || 0;
    const numB = parseFloat(valB) || 0;
    return numA - numB;
  }

  return valA.localeCompare(valB);
}

/**
 * Create a comparator function based on sort options
 */
function createComparator(
  options: SortOptions,
): (a: string, b: string) => number {
  const {
    keys = [],
    fieldDelimiter,
    numeric: globalNumeric,
    ignoreCase: globalIgnoreCase,
    reverse: globalReverse,
    humanNumeric: globalHumanNumeric,
    versionSort: globalVersionSort,
    dictionaryOrder: globalDictionaryOrder,
    monthSort: globalMonthSort,
    ignoreLeadingBlanks: globalIgnoreLeadingBlanks,
    stable: globalStable,
  } = options;

  return (a: string, b: string): number => {
    let lineA = a;
    let lineB = b;

    if (globalIgnoreLeadingBlanks) {
      lineA = lineA.trimStart();
      lineB = lineB.trimStart();
    }

    if (keys.length === 0) {
      const opts: CompareOptions = {
        numeric: globalNumeric,
        ignoreCase: globalIgnoreCase,
        humanNumeric: globalHumanNumeric,
        versionSort: globalVersionSort,
        dictionaryOrder: globalDictionaryOrder,
        monthSort: globalMonthSort,
      };

      const result = compareValues(lineA, lineB, opts);

      if (result !== 0) {
        return globalReverse ? -result : result;
      }

      if (!globalStable) {
        const tiebreaker = a.localeCompare(b);
        return globalReverse ? -tiebreaker : tiebreaker;
      }
      return 0;
    }

    for (const key of keys) {
      let valA = extractKeyValue(lineA, key, fieldDelimiter);
      let valB = extractKeyValue(lineB, key, fieldDelimiter);

      if (key.ignoreLeading) {
        valA = valA.trimStart();
        valB = valB.trimStart();
      }

      const opts: CompareOptions = {
        numeric: key.numeric ?? globalNumeric,
        ignoreCase: key.ignoreCase ?? globalIgnoreCase,
        humanNumeric: key.humanNumeric ?? globalHumanNumeric,
        versionSort: key.versionSort ?? globalVersionSort,
        dictionaryOrder: key.dictionaryOrder ?? globalDictionaryOrder,
        monthSort: key.monthSort ?? globalMonthSort,
      };
      const useReverse = key.reverse ?? globalReverse;

      const result = compareValues(valA, valB, opts);

      if (result !== 0) {
        return useReverse ? -result : result;
      }
    }

    if (!globalStable) {
      const tiebreaker = a.localeCompare(b);
      return globalReverse ? -tiebreaker : tiebreaker;
    }
    return 0;
  };
}

/**
 * Filter unique lines based on options
 */
function filterUnique(lines: string[], options: SortOptions): string[] {
  if (options.keys && options.keys.length > 0) {
    const key = options.keys[0];
    const seen = new Set<string>();

    return lines.filter((line) => {
      let keyVal = extractKeyValue(line, key, options.fieldDelimiter);
      if (key.ignoreCase ?? options.ignoreCase) {
        keyVal = keyVal.toLowerCase();
      }
      if (seen.has(keyVal)) return false;
      seen.add(keyVal);
      return true;
    });
  }

  if (options.ignoreCase) {
    const seen = new Set<string>();
    return lines.filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return [...new Set(lines)];
}

/**
 * Parse a key specification string like "1,2n" or "1.3,2.5r"
 */
export function parseKeySpec(spec: string): SortKeySpec | null {
  const result: SortKeySpec = { startField: 1 };

  let modifierStr = "";
  let mainSpec = spec;

  const modifierMatch = mainSpec.match(/([bdfhMnrV]+)$/);
  if (modifierMatch) {
    modifierStr = modifierMatch[1];
    mainSpec = mainSpec.slice(0, -modifierStr.length);
  }

  if (modifierStr.includes("n")) result.numeric = true;
  if (modifierStr.includes("r")) result.reverse = true;
  if (modifierStr.includes("f")) result.ignoreCase = true;
  if (modifierStr.includes("b")) result.ignoreLeading = true;
  if (modifierStr.includes("h")) result.humanNumeric = true;
  if (modifierStr.includes("V")) result.versionSort = true;
  if (modifierStr.includes("d")) result.dictionaryOrder = true;
  if (modifierStr.includes("M")) result.monthSort = true;

  const parts = mainSpec.split(",");

  if (parts.length === 0 || parts[0] === "") {
    return null;
  }

  const startParts = parts[0].split(".");
  const startField = parseInt(startParts[0], 10);
  if (Number.isNaN(startField) || startField < 1) {
    return null;
  }
  result.startField = startField;

  if (startParts.length > 1 && startParts[1]) {
    const startChar = parseInt(startParts[1], 10);
    if (!Number.isNaN(startChar) && startChar >= 1) {
      result.startChar = startChar;
    }
  }

  if (parts.length > 1 && parts[1]) {
    let endPart = parts[1];
    const endModifierMatch = endPart.match(/([bdfhMnrV]+)$/);
    if (endModifierMatch) {
      const endModifiers = endModifierMatch[1];
      if (endModifiers.includes("n")) result.numeric = true;
      if (endModifiers.includes("r")) result.reverse = true;
      if (endModifiers.includes("f")) result.ignoreCase = true;
      if (endModifiers.includes("b")) result.ignoreLeading = true;
      if (endModifiers.includes("h")) result.humanNumeric = true;
      if (endModifiers.includes("V")) result.versionSort = true;
      if (endModifiers.includes("d")) result.dictionaryOrder = true;
      if (endModifiers.includes("M")) result.monthSort = true;
      endPart = endPart.slice(0, -endModifiers.length);
    }

    const endParts = endPart.split(".");
    if (endParts[0]) {
      const endField = parseInt(endParts[0], 10);
      if (!Number.isNaN(endField) && endField >= 1) {
        result.endField = endField;
      }

      if (endParts.length > 1 && endParts[1]) {
        const endChar = parseInt(endParts[1], 10);
        if (!Number.isNaN(endChar) && endChar >= 1) {
          result.endChar = endChar;
        }
      }
    }
  }

  return result;
}

/**
 * Sort lines from an async iterable stream
 *
 * Note: This must buffer all input before sorting.
 *
 * @param input - Input stream of lines
 * @param options - Sort options
 * @returns Async iterable of sorted lines
 *
 * @example
 * ```ts
 * // Basic alphabetical sort
 * for await (const line of sort(inputStream)) {
 *   console.log(line);
 * }
 *
 * // Numeric reverse sort
 * for await (const line of sort(inputStream, { numeric: true, reverse: true })) {
 *   console.log(line);
 * }
 * ```
 */
export async function* sort(
  input: AsyncIterable<string>,
  options: SortOptions = {},
): AsyncIterable<string> {
  // Collect all lines (sort requires buffering)
  const lines: string[] = [];
  for await (const line of input) {
    lines.push(line);
  }

  // Create comparator and sort
  const comparator = createComparator(options);
  lines.sort(comparator);

  // Apply unique filter if needed
  const result = options.unique ? filterUnique(lines, options) : lines;

  // Yield sorted lines
  for (const line of result) {
    yield line;
  }
}

/**
 * Create a sort transform for stream pipelines
 *
 * @param options - Sort options
 * @returns Transform function for use with Stream.pipe()
 *
 * @example
 * ```ts
 * // Sort lines alphabetically
 * const sorted = await cat("data.txt")
 *   .pipe(lines())
 *   .pipe(sortTransform())
 *   .collect();
 *
 * // Sort by second field numerically
 * const byField = await stream
 *   .pipe(sortTransform({
 *     keys: [{ startField: 2, numeric: true }],
 *     fieldDelimiter: ","
 *   }))
 *   .collect();
 * ```
 */
export function sortTransform(options: SortOptions = {}): Transform<string, string> {
  return (stream) => sort(stream, options);
}

// Export default as the transform factory for convenience
export default sortTransform;
