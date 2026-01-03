/**
 * ShellJS-style touch command
 *
 * Creates files or updates timestamps using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { parseOptions, flattenArgs, expandTilde } from "./common.ts";
import type { OptionsMap } from "./types.ts";

/** Options for touch command */
export interface TouchOptions {
  /** Only update access time */
  accessOnly?: boolean;
  /** Don't create file if it doesn't exist */
  noCreate?: boolean;
  /** Only update modification time */
  modifyOnly?: boolean;
  /** Use specified date instead of current time */
  date?: Date;
  /** Use timestamp from reference file */
  reference?: string;
}

const OPTIONS_MAP: OptionsMap = {
  a: "accessOnly",
  c: "noCreate",
  m: "modifyOnly",
};

/**
 * Parse touch options from string
 */
export function parseTouchOptions(optStr: string): TouchOptions {
  return parseOptions(optStr, OPTIONS_MAP) as TouchOptions;
}

/**
 * Create files or update timestamps
 *
 * @param options - Options string (e.g., "-c") or TouchOptions object
 * @param paths - Files to touch
 * @returns ShellString with empty string on success
 *
 * @example
 * ```ts
 * // Create file or update timestamp
 * await touch("file.txt");
 *
 * // Don't create if doesn't exist
 * await touch("-c", "maybe-exists.txt");
 *
 * // Touch multiple files
 * await touch("a.txt", "b.txt", "c.txt");
 *
 * // Use specific date
 * await touch({ date: new Date("2024-01-01") }, "file.txt");
 * ```
 */
export async function touch(
  optionsOrPath: string | TouchOptions,
  ...paths: (string | string[])[]
): Promise<ShellString> {
  let options: TouchOptions = {};
  let allPaths: string[];

  // Parse arguments
  if (typeof optionsOrPath === "string" && optionsOrPath.startsWith("-")) {
    options = parseTouchOptions(optionsOrPath);
    allPaths = flattenArgs(...paths);
  } else if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    options = optionsOrPath;
    allPaths = flattenArgs(...paths);
  } else {
    allPaths = flattenArgs(optionsOrPath as string, ...paths);
  }

  if (allPaths.length === 0) {
    return new ShellString("", "touch: missing operand", 1);
  }

  // Expand tilde in all paths
  const expandedPaths = allPaths.map(expandTilde);
  const errors: string[] = [];

  // Get reference time if specified
  let refAtime: Date | undefined;
  let refMtime: Date | undefined;
  if (options.reference) {
    try {
      const refStat = await Deno.stat(expandTilde(options.reference));
      refAtime = refStat.atime ?? undefined;
      refMtime = refStat.mtime ?? undefined;
    } catch {
      return new ShellString("", `touch: failed to get attributes of '${options.reference}'`, 1);
    }
  }

  const now = options.date ?? new Date();

  for (const path of expandedPaths) {
    try {
      // Check if file exists
      let exists = true;
      try {
        await Deno.stat(path);
      } catch {
        exists = false;
      }

      if (!exists) {
        if (options.noCreate) {
          continue;
        }
        // Create empty file
        const file = await Deno.create(path);
        file.close();
      }

      // Determine times to set
      let atime: Date;
      let mtime: Date;

      if (options.reference) {
        atime = refAtime ?? now;
        mtime = refMtime ?? now;
      } else {
        atime = now;
        mtime = now;
      }

      // If only updating one time, get the other from the file
      if (options.accessOnly || options.modifyOnly) {
        const stat = await Deno.stat(path);
        if (options.accessOnly) {
          mtime = stat.mtime ?? now;
        }
        if (options.modifyOnly) {
          atime = stat.atime ?? now;
        }
      }

      await Deno.utime(path, atime, mtime);
    } catch (error) {
      if (error instanceof Deno.errors.PermissionDenied) {
        errors.push(`touch: ${path}: Permission denied`);
      } else {
        errors.push(`touch: ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    return new ShellString("", errors.join("\n"), 1);
  }

  return new ShellString("");
}
