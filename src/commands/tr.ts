/**
 * tr - Translate or delete characters
 *
 * Provides character translation, deletion, and squeezing.
 * Supports POSIX character classes and escape sequences.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";

/**
 * Options for tr command
 */
export interface TrOptions {
  /** First character set (characters to translate/delete) */
  set1: string;
  /** Second character set (replacement characters) */
  set2?: string;
  /** Delete characters in set1 */
  delete?: boolean;
  /** Squeeze repeated characters in set1 (or set2 if translating) */
  squeeze?: boolean;
  /** Complement set1 (use characters NOT in set1) */
  complement?: boolean;
}

/**
 * POSIX character class definitions
 */
const POSIX_CLASSES: Record<string, string> = {
  "[:alnum:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  "[:alpha:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  "[:blank:]": " \t",
  "[:cntrl:]": Array.from({ length: 32 }, (_, i) => String.fromCharCode(i))
    .join("")
    .concat(String.fromCharCode(127)),
  "[:digit:]": "0123456789",
  "[:graph:]": Array.from({ length: 94 }, (_, i) =>
    String.fromCharCode(33 + i)
  ).join(""),
  "[:lower:]": "abcdefghijklmnopqrstuvwxyz",
  "[:print:]": Array.from({ length: 95 }, (_, i) =>
    String.fromCharCode(32 + i)
  ).join(""),
  "[:punct:]": "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  "[:space:]": " \t\n\r\f\v",
  "[:upper:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "[:xdigit:]": "0123456789ABCDEFabcdef",
};

/**
 * Expand character set notation to actual characters
 *
 * Supports:
 * - Character ranges: a-z, A-Z, 0-9
 * - POSIX classes: [:alpha:], [:digit:], etc.
 * - Escape sequences: \n, \t, \r, \\
 * - Octal escapes: \NNN
 */
function expandSet(set: string): string {
  let result = "";
  let i = 0;

  while (i < set.length) {
    // Check for POSIX character classes like [:alnum:]
    if (set[i] === "[" && set[i + 1] === ":") {
      let found = false;
      for (const [className, chars] of Object.entries(POSIX_CLASSES)) {
        if (set.slice(i).startsWith(className)) {
          result += chars;
          i += className.length;
          found = true;
          break;
        }
      }
      if (found) continue;
    }

    // Handle escape sequences
    if (set[i] === "\\" && i + 1 < set.length) {
      const next = set[i + 1];
      if (next === "n") {
        result += "\n";
        i += 2;
        continue;
      } else if (next === "t") {
        result += "\t";
        i += 2;
        continue;
      } else if (next === "r") {
        result += "\r";
        i += 2;
        continue;
      } else if (next === "f") {
        result += "\f";
        i += 2;
        continue;
      } else if (next === "v") {
        result += "\v";
        i += 2;
        continue;
      } else if (next === "\\") {
        result += "\\";
        i += 2;
        continue;
      } else if (/[0-7]/.test(next)) {
        // Octal escape \NNN
        let octal = "";
        let j = i + 1;
        while (j < set.length && j < i + 4 && /[0-7]/.test(set[j])) {
          octal += set[j];
          j++;
        }
        result += String.fromCharCode(parseInt(octal, 8));
        i = j;
        continue;
      } else {
        // Escaped literal character
        result += next;
        i += 2;
        continue;
      }
    }

    // Handle character ranges like a-z
    if (i + 2 < set.length && set[i + 1] === "-" && set[i + 2] !== "") {
      const start = set.charCodeAt(i);
      const end = set.charCodeAt(i + 2);
      if (start <= end) {
        for (let code = start; code <= end; code++) {
          result += String.fromCharCode(code);
        }
        i += 3;
        continue;
      }
    }

    // Regular character
    result += set[i];
    i++;
  }

  return result;
}

/**
 * Process text with tr options
 */
function processText(text: string, options: TrOptions): string {
  const {
    set1: set1Raw,
    set2: set2Raw,
    delete: deleteMode = false,
    squeeze = false,
    complement = false,
  } = options;

  const set1 = expandSet(set1Raw);
  const set2 = set2Raw ? expandSet(set2Raw) : "";

  // Create a set for fast lookups
  const set1Chars = new Set(set1);

  // Helper to check if character is in set1 (considering complement)
  const isInSet1 = (char: string): boolean => {
    const inSet = set1Chars.has(char);
    return complement ? !inSet : inSet;
  };

  let output = "";

  if (deleteMode) {
    // Delete mode: remove characters in set1
    for (const char of text) {
      if (!isInSet1(char)) {
        output += char;
      }
    }

    // If squeeze is also enabled with delete, squeeze remaining chars in set2
    if (squeeze && set2) {
      const set2Chars = new Set(set2);
      let squeezed = "";
      let prev = "";
      for (const char of output) {
        if (set2Chars.has(char) && char === prev) {
          continue; // Skip repeated character
        }
        squeezed += char;
        prev = char;
      }
      output = squeezed;
    }
  } else if (squeeze && !set2Raw) {
    // Squeeze-only mode: squeeze consecutive characters in set1
    let prev = "";
    for (const char of text) {
      if (isInSet1(char) && char === prev) {
        continue; // Skip repeated character
      }
      output += char;
      prev = char;
    }
  } else if (set2) {
    // Translate mode: map set1 to set2
    if (complement) {
      // In complement mode, all chars NOT in set1 map to last char of set2
      const targetChar = set2.length > 0 ? set2[set2.length - 1] : "";
      for (const char of text) {
        if (!set1Chars.has(char)) {
          output += targetChar;
        } else {
          output += char;
        }
      }
    } else {
      // Normal translation: build character map
      const translationMap = new Map<string, string>();
      for (let i = 0; i < set1.length; i++) {
        // If set2 is shorter, pad with last character of set2
        const targetChar = i < set2.length ? set2[i] : set2[set2.length - 1];
        translationMap.set(set1[i], targetChar);
      }

      for (const char of text) {
        output += translationMap.get(char) ?? char;
      }
    }

    // Apply squeeze on translated characters (set2)
    if (squeeze) {
      const set2Chars = new Set(set2);
      let squeezed = "";
      let prev = "";
      for (const char of output) {
        if (set2Chars.has(char) && char === prev) {
          continue; // Skip repeated character
        }
        squeezed += char;
        prev = char;
      }
      output = squeezed;
    }
  } else {
    // No operation specified - return original
    output = text;
  }

  return output;
}

/**
 * Translate characters in a stream
 *
 * @param input - Input stream of text chunks
 * @param options - Tr options
 * @returns Async iterable of translated text
 *
 * @example
 * ```ts
 * // Convert lowercase to uppercase
 * for await (const text of tr(inputStream, {
 *   set1: "[:lower:]",
 *   set2: "[:upper:]"
 * })) {
 *   console.log(text);
 * }
 *
 * // Delete digits
 * for await (const text of tr(inputStream, {
 *   set1: "[:digit:]",
 *   delete: true
 * })) {
 *   console.log(text);
 * }
 * ```
 */
export async function* tr(
  input: AsyncIterable<string>,
  options: TrOptions,
): AsyncIterable<string> {
  for await (const text of input) {
    yield processText(text, options);
  }
}

/**
 * Create a tr transform for stream pipelines
 *
 * @param options - Tr options
 * @returns Transform function for use with Stream.pipe()
 *
 * @example
 * ```ts
 * // Replace spaces with underscores and squeeze
 * const result = await cat("input.txt")
 *   .pipe(trTransform({ set1: " ", set2: "_", squeeze: true }))
 *   .collect();
 *
 * // Delete all non-alphanumeric characters
 * const cleaned = await stream
 *   .pipe(trTransform({ set1: "[:alnum:]", complement: true, delete: true }))
 *   .collect();
 * ```
 */
export function trTransform(options: TrOptions): Transform<string, string> {
  return (stream) => tr(stream, options);
}

// Export default as the transform factory for convenience
export default trTransform;
