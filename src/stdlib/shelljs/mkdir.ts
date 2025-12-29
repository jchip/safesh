/**
 * ShellJS-style mkdir command
 *
 * Creates directories using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { parseOptions, flattenArgs } from "./common.ts";
import type { OptionsMap } from "./types.ts";

/** Options for mkdir command */
export interface MkdirOptions {
  /** Create parent directories as needed */
  parents?: boolean;
}

const OPTIONS_MAP: OptionsMap = {
  p: "parents",
};

/**
 * Parse mkdir options from string
 */
export function parseMkdirOptions(optStr: string): MkdirOptions {
  return parseOptions(optStr, OPTIONS_MAP) as MkdirOptions;
}

/**
 * Create directories
 *
 * @param options - Options string (e.g., "-p") or MkdirOptions object
 * @param paths - Directories to create
 * @returns ShellString with empty string on success
 *
 * @example
 * ```ts
 * // Create directory
 * await mkdir("new-dir");
 *
 * // Create nested directories
 * await mkdir("-p", "path/to/nested/dir");
 *
 * // Create multiple directories
 * await mkdir("dir1", "dir2", "dir3");
 * ```
 */
export async function mkdir(
  optionsOrPath: string | MkdirOptions,
  ...paths: (string | string[])[]
): Promise<ShellString> {
  let options: MkdirOptions = {};
  let allPaths: string[];

  // Parse arguments
  if (typeof optionsOrPath === "string" && optionsOrPath.startsWith("-")) {
    options = parseMkdirOptions(optionsOrPath);
    allPaths = flattenArgs(...paths);
  } else if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    options = optionsOrPath;
    allPaths = flattenArgs(...paths);
  } else {
    allPaths = flattenArgs(optionsOrPath as string, ...paths);
  }

  if (allPaths.length === 0) {
    return new ShellString("", "mkdir: missing operand", 1);
  }

  const errors: string[] = [];

  for (const path of allPaths) {
    try {
      await Deno.mkdir(path, { recursive: options.parents });
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        if (!options.parents) {
          errors.push(`mkdir: ${path}: File exists`);
        }
        // With -p, silently ignore existing directories
      } else if (error instanceof Deno.errors.PermissionDenied) {
        errors.push(`mkdir: ${path}: Permission denied`);
      } else if (error instanceof Deno.errors.NotFound) {
        errors.push(`mkdir: ${path}: No such file or directory`);
      } else {
        errors.push(`mkdir: ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    return new ShellString("", errors.join("\n"), 1);
  }

  return new ShellString("");
}
