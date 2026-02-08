/**
 * ShellJS-style mv command
 *
 * Moves/renames files and directories using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { join, basename, dirname, resolve } from "@std/path";
import { ShellString } from "./types.ts";
import { parseOptions, flattenArgs, expandTilde } from "./common.ts";
import type { OptionsMap } from "./types.ts";
import { validatePath } from "../../core/permissions.ts";
import { getDefaultConfig } from "../../core/utils.ts";

/** Options for mv command */
export interface MvOptions {
  /** Force overwrite */
  force?: boolean;
  /** No clobber - don't overwrite existing */
  noClobber?: boolean;
}

const OPTIONS_MAP: OptionsMap = {
  f: "force",
  n: "noClobber",
};

/**
 * Parse mv options from string
 */
export function parseMvOptions(optStr: string): MvOptions {
  return parseOptions(optStr, OPTIONS_MAP) as MvOptions;
}

/**
 * Move/rename files and directories
 *
 * @param options - Options string (e.g., "-f") or MvOptions object
 * @param args - Source file(s) followed by destination
 * @returns ShellString with empty string on success
 *
 * @example
 * ```ts
 * // Rename file
 * await mv("old.txt", "new.txt");
 *
 * // Move to directory
 * await mv("file.txt", "some-dir/");
 *
 * // Move multiple files to directory
 * await mv("a.txt", "b.txt", "dest-dir/");
 *
 * // Force overwrite
 * await mv("-f", "src.txt", "existing.txt");
 * ```
 */
export async function mv(
  optionsOrPath: string | MvOptions,
  ...args: (string | string[])[]
): Promise<ShellString> {
  let options: MvOptions = {};
  let allArgs: string[];

  // Parse arguments
  if (typeof optionsOrPath === "string" && optionsOrPath.startsWith("-")) {
    options = parseMvOptions(optionsOrPath);
    allArgs = flattenArgs(...args);
  } else if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    options = optionsOrPath;
    allArgs = flattenArgs(...args);
  } else {
    allArgs = flattenArgs(optionsOrPath as string, ...args);
  }

  if (allArgs.length < 2) {
    return new ShellString("", "mv: missing destination", 1);
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
    return new ShellString("", "mv: target is not a directory", 1);
  }

  const cwd = Deno.cwd();
  const config = getDefaultConfig(cwd);
  for (const src of sources) {
    try {
      const validatedSrc = await validatePath(src, config, cwd, "write");
      const validatedDest = await validatePath(dest, config, cwd, "write");
      const targetPath = destIsDir ? join(validatedDest, basename(validatedSrc)) : validatedDest;

      // Check if target exists
      let targetExists = false;
      try {
        await Deno.stat(targetPath);
        targetExists = true;
      } catch {
        // target doesn't exist
      }

      // Handle no-clobber
      if (targetExists && options.noClobber) {
        continue;
      }

      // Ensure parent directory exists
      await Deno.mkdir(dirname(targetPath), { recursive: true }).catch(() => {});

      // Move/rename
      await Deno.rename(src, targetPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        errors.push(`mv: ${src}: No such file or directory`);
      } else if (error instanceof Deno.errors.PermissionDenied) {
        errors.push(`mv: ${src}: Permission denied`);
      } else {
        errors.push(`mv: ${src}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    return new ShellString("", errors.join("\n"), 1);
  }

  return new ShellString("");
}
