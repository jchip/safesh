/**
 * ShellJS-style touch command
 *
 * Creates files or updates timestamps using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { expandTilde, flattenArgs, parseOptions } from "./common.ts";
import type { OptionsMap } from "./types.ts";
import { validatePath } from "../../core/permissions.ts";
import { getDefaultConfig } from "../../core/utils.ts";

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

function parseTouchTimestamp(timestamp: string): Date {
  const match = timestamp.match(/^(\d{8}|\d{10}|\d{12})(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new Error(`touch: invalid date format '${timestamp}'`);
  }

  const digits = match[1]!;
  const seconds = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  let year: number;
  let offset: number;

  if (digits.length === 12) {
    year = Number(digits.slice(0, 4));
    offset = 4;
  } else if (digits.length === 10) {
    const yy = Number(digits.slice(0, 2));
    year = yy >= 69 ? 1900 + yy : 2000 + yy;
    offset = 2;
  } else {
    year = new Date().getFullYear();
    offset = 0;
  }

  const month = Number(digits.slice(offset, offset + 2));
  const day = Number(digits.slice(offset + 2, offset + 4));
  const hour = Number(digits.slice(offset + 4, offset + 6));
  const minute = Number(digits.slice(offset + 6, offset + 8));
  const date = new Date(year, month - 1, day, hour, minute, seconds);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== seconds
  ) {
    throw new Error(`touch: invalid date format '${timestamp}'`);
  }

  return date;
}

function parseTouchStringArgs(args: string[]): { options: TouchOptions; paths: string[] } {
  const options: TouchOptions = {};
  const paths: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--") {
      paths.push(...args.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      paths.push(arg, ...args.slice(i + 1));
      break;
    }

    const flags = arg.slice(1);
    for (let j = 0; j < flags.length; j++) {
      const flag = flags[j]!;
      if (flag === "a") {
        options.accessOnly = true;
      } else if (flag === "c") {
        options.noCreate = true;
      } else if (flag === "m") {
        options.modifyOnly = true;
      } else if (flag === "t") {
        const inlineTimestamp = flags.slice(j + 1);
        const timestamp = inlineTimestamp || args[++i];
        if (!timestamp) {
          throw new Error("touch: option requires an argument -- t");
        }
        options.date = parseTouchTimestamp(timestamp);
        break;
      } else {
        throw new Error(`Option not recognized: ${flag}`);
      }
    }
  }

  return { options, paths };
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
  if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    options = optionsOrPath;
    allPaths = flattenArgs(...paths);
  } else {
    try {
      const parsed = parseTouchStringArgs(flattenArgs(optionsOrPath as string, ...paths));
      options = parsed.options;
      allPaths = parsed.paths;
    } catch (error) {
      return new ShellString("", error instanceof Error ? error.message : String(error), 1);
    }
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

  const cwd = Deno.cwd();
  const config = getDefaultConfig(cwd);
  for (const path of expandedPaths) {
    try {
      const validatedPath = await validatePath(path, config, cwd, "write");
      // Check if file exists
      let exists = true;
      try {
        await Deno.stat(validatedPath);
      } catch {
        exists = false;
      }

      if (!exists) {
        if (options.noCreate) {
          continue;
        }
        // Create empty file
        const file = await Deno.create(validatedPath);
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
        const stat = await Deno.stat(validatedPath);
        if (options.accessOnly) {
          mtime = stat.mtime ?? now;
        }
        if (options.modifyOnly) {
          atime = stat.atime ?? now;
        }
      }

      await Deno.utime(validatedPath, atime, mtime);
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
