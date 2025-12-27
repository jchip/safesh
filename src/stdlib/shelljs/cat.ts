/**
 * cat command - concatenate and display files
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { parseOptions, expand, expandTilde } from "./common.ts";
import * as fs from "../fs.ts";
import type { SandboxOptions } from "../fs.ts";

/**
 * Options for cat command
 */
export interface CatOptions extends SandboxOptions {
  /** Number all output lines */
  number?: boolean;
}

/**
 * Concatenate files and return their contents
 *
 * @param files - File path(s) to read (supports globs)
 * @param options - Cat options
 * @returns ShellString with concatenated contents
 *
 * @example
 * ```ts
 * // Read single file
 * const content = await cat("file.txt");
 *
 * // Read multiple files
 * const content = await cat(["file1.txt", "file2.txt"]);
 *
 * // With line numbers
 * const content = await cat("file.txt", { number: true });
 * ```
 */
export async function cat(
  files: string | string[],
  options: CatOptions = {},
): Promise<ShellString> {
  const fileList = Array.isArray(files) ? files : [files];

  if (fileList.length === 0) {
    return ShellString.error("cat: no files specified", 1, options);
  }

  // Expand globs and tilde
  const expandedFiles = await expand(
    fileList.map((f) => expandTilde(f)),
    options,
  );

  if (expandedFiles.length === 0) {
    return ShellString.error("cat: no files matched", 1, options);
  }

  let result = "";
  const errors: string[] = [];

  for (const file of expandedFiles) {
    try {
      // Check if it's a directory
      const stat = await Deno.stat(file);
      if (stat.isDirectory) {
        errors.push(`cat: ${file}: Is a directory`);
        continue;
      }

      const content = await fs.read(file, options);
      result += content;
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        errors.push(`cat: ${file}: No such file or directory`);
      } else if (e instanceof Deno.errors.PermissionDenied) {
        errors.push(`cat: ${file}: Permission denied`);
      } else {
        errors.push(`cat: ${file}: ${e}`);
      }
    }
  }

  // Add line numbers if requested
  if (options.number && result.length > 0) {
    result = addLineNumbers(result);
  }

  const stderr = errors.join("\n");
  const code = errors.length > 0 && result.length === 0 ? 1 : 0;

  return new ShellString(result, stderr, code, options);
}

/**
 * Add line numbers to content (GNU cat style)
 */
function addLineNumbers(content: string): string {
  const lines = content.split("\n");
  const lastLine = lines.pop() ?? "";

  const numberedLines = lines.map((line, i) => formatLineNumber(i + 1, line));

  // Only number last line if it has content
  if (lastLine.length > 0) {
    numberedLines.push(formatLineNumber(numberedLines.length + 1, lastLine));
  } else {
    numberedLines.push(lastLine);
  }

  return numberedLines.join("\n");
}

/**
 * Format a numbered line (GNU cat uses 6-char padded number + tab)
 */
function formatLineNumber(n: number, line: string): string {
  const padded = String(n).padStart(6, " ");
  return `${padded}\t${line}`;
}

/**
 * Parse cat options from command-line style arguments
 */
export function parseCatOptions(
  opts: string | Record<string, unknown>,
): CatOptions {
  const parsed = parseOptions(opts, {
    n: "number",
  });

  return {
    number: parsed.number as boolean,
  };
}
