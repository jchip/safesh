/**
 * Grep Command - Pure TypeScript grep implementation for Deno
 *
 * A streaming grep implementation that works with safesh streams.
 * Supports common grep options including regex, context lines,
 * and various output modes.
 *
 * @module
 */

import type { Transform } from "../stdlib/stream.ts";
import { createStream, type Stream } from "../stdlib/stream.ts";

/**
 * Result of a grep match
 */
export interface GrepMatch {
  /** The matched line content */
  line: string;
  /** 1-based line number in the input */
  lineNumber: number;
  /** The matched portions of the line (for -o mode) */
  matches?: string[];
  /** Filename if processing multiple files */
  filename?: string;
  /** Whether this is a context line (before/after match) */
  isContext?: boolean;
  /** Whether this is a separator line between context groups */
  isSeparator?: boolean;
}

/**
 * Options for grep operations
 */
export interface GrepOptions {
  /** Case insensitive matching (-i) */
  ignoreCase?: boolean;

  /** Invert match - select non-matching lines (-v) */
  invertMatch?: boolean;

  /** Show line numbers (-n) */
  lineNumbers?: boolean;

  /** Count only - return count of matching lines (-c) */
  countOnly?: boolean;

  /** Return only filenames with matches (-l) */
  filesWithMatches?: boolean;

  /** Return only filenames without matches (-L) */
  filesWithoutMatch?: boolean;

  /** Show only the matching part of lines (-o) */
  onlyMatching?: boolean;

  /** Use extended regex (-E) */
  extendedRegex?: boolean;

  /** Fixed strings - treat pattern as literal (-F) */
  fixedStrings?: boolean;

  /** Match whole words only (-w) */
  wholeWord?: boolean;

  /** Match whole lines only (-x) */
  wholeLine?: boolean;

  /** Lines of context after match (-A) */
  afterContext?: number;

  /** Lines of context before match (-B) */
  beforeContext?: number;

  /** Lines of context before and after (-C) */
  context?: number;

  /** Maximum number of matches (-m) */
  maxCount?: number;

  /** Quiet mode - suppress output (-q) */
  quiet?: boolean;

  /** Suppress filename prefix (-h) */
  noFilename?: boolean;

  /** Filename to include in output */
  filename?: string;
}

/**
 * Build a RegExp from a pattern string and options
 */
function buildRegex(
  pattern: string | RegExp,
  options: GrepOptions = {},
): RegExp {
  // If already a RegExp, handle appropriately
  if (pattern instanceof RegExp) {
    // Apply case insensitive if needed
    if (options.ignoreCase && !pattern.flags.includes("i")) {
      return new RegExp(pattern.source, pattern.flags + "i");
    }
    return pattern;
  }

  let regexPattern = pattern;

  // Handle fixed strings mode - escape all regex special chars
  if (options.fixedStrings) {
    regexPattern = pattern.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  }

  // Handle whole word matching
  if (options.wholeWord) {
    regexPattern = `\\b${regexPattern}\\b`;
  }

  // Handle whole line matching
  if (options.wholeLine) {
    regexPattern = `^${regexPattern}$`;
  }

  // Build flags
  let flags = "g"; // Global for finding all matches
  if (options.ignoreCase) {
    flags += "i";
  }

  return new RegExp(regexPattern, flags);
}

/**
 * Test if a line matches the pattern
 */
function testLine(line: string, regex: RegExp, invert: boolean): boolean {
  regex.lastIndex = 0;
  const matches = regex.test(line);
  return invert ? !matches : matches;
}

/**
 * Get all matches in a line
 */
function getMatches(line: string, regex: RegExp): string[] {
  regex.lastIndex = 0;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    matches.push(match[0]);
    // Prevent infinite loop on zero-width matches
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  return matches;
}

/**
 * Core grep function that works with async iterables
 *
 * Processes lines from an async iterable and yields GrepMatch objects
 * for matching lines. Supports all common grep options.
 *
 * @param pattern - String or RegExp pattern to match
 * @param input - Async iterable of strings (lines)
 * @param options - Grep options
 * @returns AsyncIterable of GrepMatch objects
 *
 * @example
 * ```ts
 * // Basic usage
 * const matches = grep(/error/i, lines);
 * for await (const match of matches) {
 *   console.log(`${match.lineNumber}: ${match.line}`);
 * }
 *
 * // With options
 * const results = grep("TODO", source, {
 *   lineNumbers: true,
 *   ignoreCase: true,
 *   afterContext: 2
 * });
 * ```
 */
export async function* grep(
  pattern: string | RegExp,
  input: AsyncIterable<string>,
  options: GrepOptions = {},
): AsyncIterable<GrepMatch> {
  // Handle -C as shorthand for -A and -B
  const afterContext = options.afterContext ?? options.context ?? 0;
  const beforeContext = options.beforeContext ?? options.context ?? 0;

  const regex = buildRegex(pattern, options);
  const invert = options.invertMatch ?? false;
  const onlyMatching = options.onlyMatching ?? false;
  const maxCount = options.maxCount ?? 0;

  let lineNumber = 0;
  let matchCount = 0;
  let countResult = 0;

  // Buffer for before context
  const beforeBuffer: Array<{ line: string; lineNumber: number }> = [];

  // Track how many after-context lines we need to emit
  let afterRemaining = 0;

  // Track the last match line number for separator detection
  let lastMatchLineNumber = -1;

  // For count-only mode, we just count matches
  if (options.countOnly) {
    for await (const line of input) {
      lineNumber++;
      if (testLine(line, regex, invert)) {
        countResult++;
        if (maxCount > 0 && countResult >= maxCount) {
          break;
        }
      }
    }

    // Yield a single result with the count
    yield {
      line: String(countResult),
      lineNumber: 0,
      filename: options.filename,
    };
    return;
  }

  // For files-with-matches mode
  if (options.filesWithMatches) {
    for await (const line of input) {
      lineNumber++;
      if (testLine(line, regex, invert)) {
        yield {
          line: options.filename ?? "",
          lineNumber: 0,
          filename: options.filename,
        };
        return;
      }
    }
    return;
  }

  // For files-without-match mode
  if (options.filesWithoutMatch) {
    let foundMatch = false;
    for await (const line of input) {
      lineNumber++;
      if (testLine(line, regex, invert)) {
        foundMatch = true;
        break;
      }
    }
    if (!foundMatch && options.filename) {
      yield {
        line: options.filename,
        lineNumber: 0,
        filename: options.filename,
      };
    }
    return;
  }

  // Regular matching mode with optional context
  for await (const line of input) {
    lineNumber++;

    const isMatch = testLine(line, regex, invert);

    if (isMatch) {
      // Check max count
      if (maxCount > 0 && matchCount >= maxCount) {
        break;
      }

      // Emit separator if there's a gap between context groups
      if (
        (beforeContext > 0 || afterContext > 0) &&
        lastMatchLineNumber > 0 &&
        lineNumber > lastMatchLineNumber + afterContext + 1 &&
        beforeBuffer.length > 0 &&
        beforeBuffer[0]!.lineNumber > lastMatchLineNumber + afterContext
      ) {
        yield { line: "--", lineNumber: 0, isSeparator: true };
      }

      // Emit before context lines
      for (const ctx of beforeBuffer) {
        // Skip if this line was already emitted as after-context
        if (lastMatchLineNumber > 0 && ctx.lineNumber <= lastMatchLineNumber + afterContext) {
          continue;
        }
        yield {
          line: ctx.line,
          lineNumber: ctx.lineNumber,
          filename: options.filename,
          isContext: true,
        };
      }
      beforeBuffer.length = 0;

      matchCount++;
      lastMatchLineNumber = lineNumber;
      afterRemaining = afterContext;

      if (onlyMatching) {
        // Yield each match separately
        const matches = getMatches(line, regex);
        for (const m of matches) {
          yield {
            line: m,
            lineNumber,
            matches: [m],
            filename: options.filename,
          };
        }
      } else {
        yield {
          line,
          lineNumber,
          matches: getMatches(line, regex),
          filename: options.filename,
        };
      }
    } else {
      // Not a match - might be context
      if (afterRemaining > 0) {
        // Emit as after-context
        yield {
          line,
          lineNumber,
          filename: options.filename,
          isContext: true,
        };
        afterRemaining--;
      } else if (beforeContext > 0) {
        // Add to before-context buffer
        beforeBuffer.push({ line, lineNumber });
        if (beforeBuffer.length > beforeContext) {
          beforeBuffer.shift();
        }
      }
    }
  }
}

/**
 * Grep transform for use with safesh Stream API
 *
 * Returns a Transform function that can be used with stream.pipe()
 *
 * @param pattern - String or RegExp pattern to match
 * @param options - Grep options
 * @returns Transform function
 *
 * @example
 * ```ts
 * // Basic usage with pipe
 * const errors = await cat("log.txt")
 *   .pipe(lines())
 *   .pipe(grepTransform(/ERROR/))
 *   .map(m => m.line)
 *   .collect();
 *
 * // With options
 * const results = await stream
 *   .pipe(grepTransform("pattern", {
 *     ignoreCase: true,
 *     lineNumbers: true
 *   }))
 *   .collect();
 * ```
 */
export function grepTransform(
  pattern: string | RegExp,
  options: GrepOptions = {},
): Transform<string, GrepMatch> {
  return function (stream: AsyncIterable<string>): AsyncIterable<GrepMatch> {
    return grep(pattern, stream, options);
  };
}

/**
 * Simple grep transform that returns matching lines as strings
 *
 * A simpler version that just filters lines, similar to the
 * existing grep() in transforms.ts but with more options.
 *
 * @param pattern - String or RegExp pattern to match
 * @param options - Grep options (subset: ignoreCase, invertMatch, wholeWord, wholeLine, fixedStrings)
 * @returns Transform function that yields matching lines
 *
 * @example
 * ```ts
 * // Simple line filtering
 * const errors = await cat("log.txt")
 *   .pipe(lines())
 *   .pipe(grepLines(/ERROR/))
 *   .collect();
 *
 * // Case insensitive
 * const warnings = await stream
 *   .pipe(grepLines("warning", { ignoreCase: true }))
 *   .collect();
 * ```
 */
export function grepLines(
  pattern: string | RegExp,
  options: Pick<
    GrepOptions,
    "ignoreCase" | "invertMatch" | "wholeWord" | "wholeLine" | "fixedStrings"
  > = {},
): Transform<string, string> {
  const regex = buildRegex(pattern, options);
  const invert = options.invertMatch ?? false;

  return async function* (stream: AsyncIterable<string>): AsyncIterable<string> {
    for await (const line of stream) {
      if (testLine(line, regex, invert)) {
        yield line;
      }
    }
  };
}

/**
 * Format a GrepMatch for output
 *
 * Produces output similar to GNU grep format.
 *
 * @param match - The GrepMatch to format
 * @param options - Formatting options
 * @returns Formatted string
 */
export function formatGrepMatch(
  match: GrepMatch,
  options: {
    showLineNumbers?: boolean;
    showFilename?: boolean;
  } = {},
): string {
  if (match.isSeparator) {
    return match.line;
  }

  const parts: string[] = [];

  if (options.showFilename && match.filename) {
    parts.push(match.filename);
  }

  if (options.showLineNumbers && match.lineNumber > 0) {
    const separator = match.isContext ? "-" : ":";
    parts.push(String(match.lineNumber));
    // Join with separator for line number
    if (parts.length > 1) {
      return parts.slice(0, -1).join(":") + ":" + parts[parts.length - 1] + separator + match.line;
    }
    return parts[0] + separator + match.line;
  }

  if (parts.length > 0) {
    return parts.join(":") + ":" + match.line;
  }

  return match.line;
}

/**
 * Format transform for grep output
 *
 * Transforms GrepMatch objects into formatted strings.
 *
 * @param options - Formatting options
 * @returns Transform function
 *
 * @example
 * ```ts
 * await cat("file.txt")
 *   .pipe(lines())
 *   .pipe(grepTransform(/pattern/))
 *   .pipe(grepFormat({ showLineNumbers: true }))
 *   .forEach(console.log);
 * ```
 */
export function grepFormat(
  options: {
    showLineNumbers?: boolean;
    showFilename?: boolean;
  } = {},
): Transform<GrepMatch, string> {
  return async function* (stream: AsyncIterable<GrepMatch>): AsyncIterable<string> {
    for await (const match of stream) {
      yield formatGrepMatch(match, options);
    }
  };
}

/**
 * Create a Stream from grep results
 *
 * Convenience function that wraps grep() results in a Stream
 * for easy integration with the safesh stream API.
 *
 * @param pattern - String or RegExp pattern to match
 * @param input - Async iterable of strings (lines)
 * @param options - Grep options
 * @returns Stream of GrepMatch objects
 *
 * @example
 * ```ts
 * const results = await grepStream(/error/i, linesIterable)
 *   .pipe(grepFormat({ showLineNumbers: true }))
 *   .collect();
 * ```
 */
export function grepStream(
  pattern: string | RegExp,
  input: AsyncIterable<string>,
  options: GrepOptions = {},
): Stream<GrepMatch> {
  return createStream(grep(pattern, input, options));
}

/**
 * Grep multiple files/sources
 *
 * Processes multiple input sources and yields matches from all of them.
 * Automatically sets the filename in match results.
 *
 * @param pattern - String or RegExp pattern to match
 * @param sources - Array of [filename, asyncIterable] tuples
 * @param options - Grep options
 * @returns AsyncIterable of GrepMatch objects
 *
 * @example
 * ```ts
 * const sources = [
 *   ["file1.txt", readLines("file1.txt")],
 *   ["file2.txt", readLines("file2.txt")],
 * ];
 *
 * for await (const match of grepMultiple(/pattern/, sources)) {
 *   console.log(`${match.filename}:${match.lineNumber}: ${match.line}`);
 * }
 * ```
 */
export async function* grepMultiple(
  pattern: string | RegExp,
  sources: Array<[string, AsyncIterable<string>]>,
  options: GrepOptions = {},
): AsyncIterable<GrepMatch> {
  for (const [filename, source] of sources) {
    for await (const match of grep(pattern, source, { ...options, filename })) {
      yield match;
    }
  }
}

// Re-export types
export type { Transform };
