/**
 * ShellJS-style cp command
 *
 * Copies files and directories using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { join, basename, dirname, resolve } from "@std/path";
import { copy as fsCopy } from "jsr:@std/fs";
import { ShellString } from "./types.ts";
import { parseOptions, flattenArgs, expandTilde } from "./common.ts";
import type { OptionsMap } from "./types.ts";
import { validatePath } from "../../core/permissions.ts";
import { getDefaultConfig } from "../../core/utils.ts";

/** Options for cp command */
export interface CpOptions {
  /** Force overwrite (default) */
  force?: boolean;
  /** No clobber - don't overwrite existing */
  noClobber?: boolean;
  /** Copy directories recursively */
  recursive?: boolean;
  /** Only copy if source is newer */
  update?: boolean;
}

const OPTIONS_MAP: OptionsMap = {
  f: "force",
  n: "noClobber",
  r: "recursive",
  R: "recursive",
  u: "update",
};

/**
 * Parse cp options from string
 */
export function parseCpOptions(optStr: string): CpOptions {
  return parseOptions(optStr, OPTIONS_MAP) as CpOptions;
}

/**
 * Copy files and directories
 *
 * @param options - Options string (e.g., "-r") or CpOptions object
 * @param args - Source file(s) followed by destination
 * @returns ShellString with empty string on success
 *
 * @example
 * ```ts
 * // Copy file
 * await cp("src.txt", "dest.txt");
 *
 * // Copy to directory
 * await cp("file.txt", "some-dir/");
 *
 * // Copy directory recursively
 * await cp("-r", "src-dir", "dest-dir");
 *
 * // Copy multiple files to directory
 * await cp("a.txt", "b.txt", "dest-dir/");
 * ```
 */
export async function cp(
  optionsOrPath: string | CpOptions,
  ...args: (string | string[])[]
): Promise<ShellString> {
  let options: CpOptions = {};
  let allArgs: string[];

  // Parse arguments
  if (typeof optionsOrPath === "string" && optionsOrPath.startsWith("-")) {
    options = parseCpOptions(optionsOrPath);
    allArgs = flattenArgs(...args);
  } else if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    options = optionsOrPath;
    allArgs = flattenArgs(...args);
  } else {
    allArgs = flattenArgs(optionsOrPath as string, ...args);
  }

  if (allArgs.length < 2) {
    return new ShellString("", "cp: missing destination", 1);
  }

  // Expand tilde in all paths
  const expandedArgs = allArgs.map(expandTilde);
  const dest = expandedArgs[expandedArgs.length - 1]!;
  const sources = expandedArgs.slice(0, -1);
  const errors: string[] = [];

  // Check if dest is a directory
  let destIsDir = false;
  try {
    const destStat = await Deno.stat(dest);
    destIsDir = destStat.isDirectory;
  } catch {
    // dest doesn't exist
  }

  // Multiple sources require dest to be a directory
  if (sources.length > 1 && !destIsDir) {
    return new ShellString("", "cp: target is not a directory", 1);
  }

  const cwd = Deno.cwd();
  const config = getDefaultConfig(cwd);
  for (const src of sources) {
    try {
      const validatedSrc = await validatePath(src, config, cwd, "read");
      const validatedDest = await validatePath(dest, config, cwd, "write");
      const srcStat = await Deno.stat(validatedSrc);
      const targetPath = destIsDir ? join(validatedDest, basename(validatedSrc)) : validatedDest;

      // Check if target exists
      let targetExists = false;
      let targetMtime: Date | undefined;
      try {
        const targetStat = await Deno.stat(targetPath);
        targetExists = true;
        targetMtime = targetStat.mtime ?? undefined;
      } catch {
        // target doesn't exist
      }

      // Handle no-clobber
      if (targetExists && options.noClobber) {
        continue;
      }

      // Handle update mode
      if (options.update && targetExists && targetMtime) {
        const srcMtime = srcStat.mtime;
        if (srcMtime && srcMtime <= targetMtime) {
          continue;
        }
      }

      if (srcStat.isDirectory) {
        if (!options.recursive) {
          errors.push(`cp: -r not specified; omitting directory '${src}'`);
          continue;
        }
        // Ensure parent directory exists
        await Deno.mkdir(dirname(targetPath), { recursive: true }).catch(() => {});
        await fsCopy(src, targetPath, { overwrite: !options.noClobber });
      } else {
        // Ensure parent directory exists
        await Deno.mkdir(dirname(targetPath), { recursive: true }).catch(() => {});
        await Deno.copyFile(src, targetPath);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        errors.push(`cp: ${src}: No such file or directory`);
      } else if (error instanceof Deno.errors.PermissionDenied) {
        errors.push(`cp: ${src}: Permission denied`);
      } else {
        errors.push(`cp: ${src}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    return new ShellString("", errors.join("\n"), 1);
  }

  return new ShellString("");
}
