/**
 * Text processing utilities
 *
 * Provides grep, head, tail, sed-like operations for text manipulation.
 * Can work on strings directly or on files with sandbox validation.
 *
 * @module
 */

import * as fs from "./fs.ts";
import { glob, globPaths } from "./glob.ts";
import type { SandboxOptions } from "./fs.ts";
import type { SafeShellConfig } from "../core/types.ts";

/**
 * Validation helpers for type checking with helpful error messages
 */

function getTypeName(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function validateString(input: unknown, functionName: string): asserts input is string {
  if (typeof input !== "string") {
    const actualType = getTypeName(input);
    throw new TypeError(
      `${functionName} expected string, got ${actualType}. ` +
      (actualType === "array"
        ? `Use array.slice() or array.join('\\n') instead.`
        : `Convert to string first.`),
    );
  }
}

function validateStringOrArray(input: unknown, functionName: string): asserts input is string | string[] {
  if (typeof input !== "string" && !Array.isArray(input)) {
    const actualType = getTypeName(input);
    throw new TypeError(
      `${functionName} expected string or array, got ${actualType}. ` +
      `Provide a string or string[] instead.`,
    );
  }
  // If it's an array, validate all elements are strings
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      if (typeof input[i] !== "string") {
        throw new TypeError(
          `${functionName} expected array of strings, but element at index ${i} is ${getTypeName(input[i])}.`,
        );
      }
    }
  }
}

/**
 * Grep match result
 */
export interface GrepMatch {
  /** File path (when grepping files) */
  path?: string;
  /** Line number (1-indexed) */
  line: number;
  /** Full line content */
  content: string;
  /** Matched substring */
  match: string;
  /** Match groups (if regex has capture groups) */
  groups?: string[];
}

/**
 * Options for grep operations
 */
export interface GrepOptions extends SandboxOptions {
  /** Return only first N matches */
  limit?: number;
  /** Case insensitive matching */
  ignoreCase?: boolean;
  /** Return unique matches only */
  unique?: boolean;
  /** Invert match (return non-matching lines) */
  invert?: boolean;
  /** Context lines before match */
  before?: number;
  /** Context lines after match */
  after?: number;
}

/**
 * Search for pattern in text
 *
 * @param pattern - RegExp or string to search for
 * @param input - Text to search in
 * @param options - Grep options
 * @returns Array of matches
 *
 * @example
 * ```ts
 * const content = await Deno.readTextFile("log.txt");
 * const errors = grep(/ERROR/, content);
 * for (const match of errors) {
 *   console.log(`Line ${match.line}: ${match.content}`);
 * }
 * ```
 */
export function grep(
  pattern: RegExp | string,
  input: string,
  options: Omit<GrepOptions, keyof SandboxOptions> = {},
): GrepMatch[] {
  validateString(input, "$.text.grep()");

  const matches: GrepMatch[] = [];
  // No 'g' flag: we test line-by-line, and 'g' breaks match() capture groups
  const regex = typeof pattern === "string"
    ? new RegExp(pattern, options.ignoreCase ? "i" : "")
    : options.ignoreCase
      ? new RegExp(pattern.source, pattern.flags.replace(/g/g, "") + (pattern.flags.includes("i") ? "" : "i"))
      : new RegExp(pattern.source, pattern.flags.replace(/g/g, ""));

  const lines = input.split("\n");
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    const match = line.match(regex);
    const hasMatch = match !== null;

    // Handle invert
    if (options.invert ? hasMatch : !hasMatch) continue;

    // Handle unique
    if (options.unique) {
      const key = hasMatch ? match[0] : line;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    matches.push({
      line: i + 1,
      content: line,
      match: hasMatch ? match[0] : "",
      groups: hasMatch && match.length > 1 ? match.slice(1) : undefined,
    });

    // Handle limit
    if (options.limit && matches.length >= options.limit) break;
  }

  return matches;
}

/**
 * Search for pattern across multiple files
 *
 * @param pattern - RegExp or string to search for
 * @param globPattern - File glob pattern (e.g., "**\/*.ts")
 * @param options - Grep and sandbox options
 * @returns Array of matches with file paths
 *
 * @example
 * ```ts
 * // Find all TODOs in TypeScript files
 * const todos = await grepFiles(/TODO:?(.*)/, "src/**\/*.ts");
 * for (const match of todos) {
 *   console.log(`${match.path}:${match.line}: ${match.groups?.[0]}`);
 * }
 * ```
 */
export async function grepFiles(
  pattern: RegExp | string,
  globPattern: string,
  options: GrepOptions = {},
): Promise<GrepMatch[]> {
  const allMatches: GrepMatch[] = [];
  const files = await globPaths(globPattern, { cwd: options.cwd }, options.config);

  for (const filePath of files) {
    try {
      const content = await fs.read(filePath, options);
      const fileMatches = grep(pattern, content, options);

      for (const match of fileMatches) {
        allMatches.push({ ...match, path: filePath });

        if (options.limit && allMatches.length >= options.limit) {
          return allMatches;
        }
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return allMatches;
}

/**
 * Get first N lines of text
 *
 * @param input - Text to process
 * @param n - Number of lines (default: 10)
 * @returns First N lines
 *
 * @example
 * ```ts
 * const preview = head(content, 5);
 * console.log(preview.join("\n"));
 * ```
 */
export function head(input: string, n: number = 10): string[] {
  validateString(input, "$.text.head()");
  return input.split("\n").slice(0, n);
}

/**
 * Get first N lines of a file
 *
 * @param path - File path
 * @param n - Number of lines (default: 10)
 * @param options - Sandbox options
 * @returns First N lines
 */
export async function headFile(
  path: string,
  n: number = 10,
  options: SandboxOptions = {},
): Promise<string[]> {
  const content = await fs.read(path, options);
  return head(content, n);
}

/**
 * Get last N lines of text
 *
 * @param input - Text to process
 * @param n - Number of lines (default: 10)
 * @returns Last N lines
 *
 * @example
 * ```ts
 * const recentLogs = tail(logContent, 20);
 * ```
 */
export function tail(input: string, n: number = 10): string[] {
  validateString(input, "$.text.tail()");
  const lines = input.split("\n");
  return lines.slice(Math.max(0, lines.length - n));
}

/**
 * Get last N lines of a file
 *
 * @param path - File path
 * @param n - Number of lines (default: 10)
 * @param options - Sandbox options
 * @returns Last N lines
 */
export async function tailFile(
  path: string,
  n: number = 10,
  options: SandboxOptions = {},
): Promise<string[]> {
  const content = await fs.read(path, options);
  return tail(content, n);
}

/**
 * Replace pattern in text (sed-like)
 *
 * @param input - Text to process
 * @param pattern - Pattern to match
 * @param replacement - Replacement string (supports $1, $2 for groups)
 * @returns Modified text
 *
 * @example
 * ```ts
 * const updated = replace(content, /console\.log/g, "logger.debug");
 * ```
 */
export function replace(
  input: string,
  pattern: RegExp | string,
  replacement: string,
): string {
  validateString(input, "$.text.replace()");
  return input.replace(pattern, replacement);
}

/**
 * Replace pattern in file
 *
 * @param path - File path
 * @param pattern - Pattern to match
 * @param replacement - Replacement string
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await replaceFile("config.ts", /localhost/g, "production.example.com");
 * ```
 */
export async function replaceFile(
  path: string,
  pattern: RegExp | string,
  replacement: string,
  options: SandboxOptions = {},
): Promise<void> {
  const content = await fs.read(path, options);
  const updated = replace(content, pattern, replacement);
  await fs.write(path, updated, options);
}

/**
 * Replace in multiple files matching glob
 *
 * @param globPattern - File glob pattern
 * @param pattern - Pattern to match
 * @param replacement - Replacement string
 * @param options - Sandbox options
 * @returns Number of files modified
 */
export async function replaceInFiles(
  globPattern: string,
  pattern: RegExp | string,
  replacement: string,
  options: SandboxOptions = {},
): Promise<number> {
  const files = await globPaths(globPattern, { cwd: options.cwd }, options.config);
  let modified = 0;

  for (const filePath of files) {
    try {
      const content = await fs.read(filePath, options);
      const updated = replace(content, pattern, replacement);

      if (content !== updated) {
        await fs.write(filePath, updated, options);
        modified++;
      }
    } catch {
      // Skip files that can't be read/written
      continue;
    }
  }

  return modified;
}

/**
 * Split text into lines
 *
 * @param input - Text to split
 * @returns Array of lines
 */
export function lines(input: string): string[] {
  validateString(input, "$.text.lines()");
  return input.split("\n");
}

/**
 * Join lines into text
 *
 * @param input - Lines to join
 * @param separator - Line separator (default: "\n")
 * @returns Joined text
 */
export function joinLines(input: string[], separator: string = "\n"): string {
  return input.join(separator);
}

/**
 * Word count result
 */
export interface CountResult {
  /** Number of lines */
  lines: number;
  /** Number of words */
  words: number;
  /** Number of characters */
  chars: number;
  /** Number of bytes */
  bytes: number;
}

/**
 * Count lines, words, and characters (wc equivalent)
 *
 * @param input - Text to count
 * @returns Count statistics
 *
 * @example
 * ```ts
 * const stats = count(content);
 * console.log(`${stats.lines} lines, ${stats.words} words`);
 * ```
 */
export function count(input: string): CountResult {
  validateString(input, "$.text.count()");
  // Match wc -l: count newline characters (not split segments)
  let lineCount = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "\n") lineCount++;
  }
  const wordCount = input.split(/\s+/).filter((w) => w.length > 0).length;
  const charCount = input.length;
  const byteCount = new TextEncoder().encode(input).length;

  return {
    lines: lineCount,
    words: wordCount,
    chars: charCount,
    bytes: byteCount,
  };
}

/**
 * Count lines, words, chars in a file
 *
 * @param path - File path
 * @param options - Sandbox options
 * @returns Count statistics
 */
export async function countFile(
  path: string,
  options: SandboxOptions = {},
): Promise<CountResult> {
  const content = await fs.read(path, options);
  return count(content);
}

/**
 * Sort lines
 *
 * @param input - Text or array of lines
 * @param options - Sort options
 * @returns Sorted lines
 *
 * @example
 * ```ts
 * const sorted = sort(content, { numeric: true, reverse: true });
 * ```
 */
export function sort(
  input: string | string[],
  options: {
    /** Numeric sort */
    numeric?: boolean;
    /** Reverse order */
    reverse?: boolean;
    /** Unique only */
    unique?: boolean;
    /** Case insensitive */
    ignoreCase?: boolean;
  } = {},
): string[] {
  validateStringOrArray(input, "$.text.sort()");
  let lineArray = Array.isArray(input) ? [...input] : input.split("\n");

  // Unique first
  if (options.unique) {
    const seen = new Set<string>();
    lineArray = lineArray.filter((line) => {
      const key = options.ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Sort
  lineArray.sort((a, b) => {
    let aVal: string | number = options.ignoreCase ? a.toLowerCase() : a;
    let bVal: string | number = options.ignoreCase ? b.toLowerCase() : b;

    if (options.numeric) {
      aVal = parseFloat(a) || 0;
      bVal = parseFloat(b) || 0;
    }

    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });

  if (options.reverse) {
    lineArray.reverse();
  }

  return lineArray;
}

/**
 * Get unique lines (preserves order)
 *
 * @param input - Text or array of lines
 * @param options - Unique options
 * @returns Unique lines
 */
export function uniq(
  input: string | string[],
  options: {
    /** Count occurrences */
    count?: boolean;
    /** Case insensitive */
    ignoreCase?: boolean;
  } = {},
): string[] | { line: string; count: number }[] {
  validateStringOrArray(input, "$.text.uniq()");
  const lineArray = Array.isArray(input) ? input : input.split("\n");
  const seen = new Map<string, { line: string; count: number }>();

  for (const line of lineArray) {
    const key = options.ignoreCase ? line.toLowerCase() : line;
    const existing = seen.get(key);
    if (existing) {
      existing.count++;
    } else {
      seen.set(key, { line, count: 1 });
    }
  }

  if (options.count) {
    return Array.from(seen.values());
  }

  return Array.from(seen.values()).map((v) => v.line);
}

/**
 * Cut columns from lines (like cut command)
 *
 * @param input - Text or array of lines
 * @param options - Cut options
 * @returns Cut lines
 *
 * @example
 * ```ts
 * // Get second and third fields from CSV
 * const columns = cut(csvContent, { delimiter: ",", fields: [2, 3] });
 * ```
 */
export function cut(
  input: string | string[],
  options: {
    /** Field delimiter (default: tab) */
    delimiter?: string;
    /** Fields to extract (1-indexed) */
    fields?: number[];
    /** Characters to extract (1-indexed) */
    characters?: number[];
  } = {},
): string[] {
  validateStringOrArray(input, "$.text.cut()");
  const lineArray = Array.isArray(input) ? input : input.split("\n");
  const delimiter = options.delimiter ?? "\t";

  return lineArray.map((line) => {
    if (options.characters) {
      return options.characters
        .map((i) => line[i - 1] ?? "")
        .join("");
    }

    if (options.fields) {
      const parts = line.split(delimiter);
      return options.fields
        .map((i) => parts[i - 1] ?? "")
        .join(delimiter);
    }

    return line;
  });
}

/**
 * Diff result
 */
export interface DiffLine {
  /** Type: added, removed, or unchanged */
  type: "added" | "removed" | "unchanged";
  /** Line content */
  content: string;
  /** Line number in old file (for removed/unchanged) */
  oldLine?: number;
  /** Line number in new file (for added/unchanged) */
  newLine?: number;
}

/**
 * Simple line-by-line diff
 *
 * @param oldText - Original text
 * @param newText - New text
 * @returns Array of diff lines
 */
export function diff(oldText: string, newText: string): DiffLine[] {
  validateString(oldText, "$.text.diff()");
  validateString(newText, "$.text.diff()");
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;

  for (const common of lcs) {
    // Output removed lines
    while (oldIdx < oldLines.length && oldLines[oldIdx] !== common) {
      result.push({
        type: "removed",
        content: oldLines[oldIdx]!,
        oldLine: oldIdx + 1,
      });
      oldIdx++;
    }

    // Output added lines
    while (newIdx < newLines.length && newLines[newIdx] !== common) {
      result.push({
        type: "added",
        content: newLines[newIdx]!,
        newLine: newIdx + 1,
      });
      newIdx++;
    }

    // Output common line
    if (oldIdx < oldLines.length && newIdx < newLines.length) {
      result.push({
        type: "unchanged",
        content: common,
        oldLine: oldIdx + 1,
        newLine: newIdx + 1,
      });
      oldIdx++;
      newIdx++;
    }
  }

  // Output remaining removed lines
  while (oldIdx < oldLines.length) {
    result.push({
      type: "removed",
      content: oldLines[oldIdx]!,
      oldLine: oldIdx + 1,
    });
    oldIdx++;
  }

  // Output remaining added lines
  while (newIdx < newLines.length) {
    result.push({
      type: "added",
      content: newLines[newIdx]!,
      newLine: newIdx + 1,
    });
    newIdx++;
  }

  return result;
}

/**
 * Compute Longest Common Subsequence
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Diff two files
 *
 * @param oldPath - Original file path
 * @param newPath - New file path
 * @param options - Sandbox options
 * @returns Array of diff lines
 */
export async function diffFiles(
  oldPath: string,
  newPath: string,
  options: SandboxOptions = {},
): Promise<DiffLine[]> {
  const oldText = await fs.read(oldPath, options);
  const newText = await fs.read(newPath, options);
  return diff(oldText, newText);
}

/**
 * Trim whitespace from text or lines
 *
 * When input is a string without newlines, returns a trimmed string.
 * When input is a multi-line string or array, returns array of trimmed lines.
 *
 * @param input - Text or array of lines
 * @param mode - Trim mode
 * @returns Trimmed string or array of trimmed lines
 *
 * @example
 * ```ts
 * trim('  hello  ');           // 'hello'
 * trim('  a  \n  b  ');        // ['a', 'b']
 * trim(['  a  ', '  b  ']);    // ['a', 'b']
 * ```
 */
export function trim(
  input: string | string[],
  mode: "both" | "left" | "right" = "both",
): string | string[] {
  validateStringOrArray(input, "$.text.trim()");
  const trimFn = (line: string) => {
    switch (mode) {
      case "left":
        return line.trimStart();
      case "right":
        return line.trimEnd();
      default:
        return line.trim();
    }
  };

  // For single-line strings, return a string
  if (typeof input === "string" && !input.includes("\n")) {
    return trimFn(input);
  }

  // For arrays or multi-line strings, return array
  const lineArray = Array.isArray(input) ? input : input.split("\n");
  return lineArray.map(trimFn);
}

/**
 * Filter lines matching predicate
 *
 * @param input - Text or array of lines
 * @param predicate - Filter function
 * @returns Filtered lines
 */
export function filter(
  input: string | string[],
  predicate: (line: string, index: number) => boolean,
): string[] {
  validateStringOrArray(input, "$.text.filter()");
  const lineArray = Array.isArray(input) ? input : input.split("\n");
  return lineArray.filter(predicate);
}

/**
 * Map over lines
 *
 * @param input - Text or array of lines
 * @param mapper - Map function
 * @returns Mapped lines
 */
export function map(
  input: string | string[],
  mapper: (line: string, index: number) => string,
): string[] {
  validateStringOrArray(input, "$.text.map()");
  const lineArray = Array.isArray(input) ? input : input.split("\n");
  return lineArray.map(mapper);
}
