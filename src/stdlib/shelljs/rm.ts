/**
 * ShellJS-style rm command
 *
 * Removes files and directories using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { parseOptions, flattenArgs, expandTilde } from "./common.ts";
import type { OptionsMap } from "./types.ts";
import { validatePath } from "../../core/permissions.ts";
import { getDefaultConfig } from "../../core/utils.ts";

/** Options for rm command */
export interface RmOptions {
  /** Force removal (ignore nonexistent files) */
  force?: boolean;
  /** Remove directories and their contents recursively */
  recursive?: boolean;
}

const OPTIONS_MAP: OptionsMap = {
  f: "force",
  r: "recursive",
  R: "recursive",
};

/**
 * Parse rm options from string
 */
export function parseRmOptions(optStr: string): RmOptions {
  return parseOptions(optStr, OPTIONS_MAP) as RmOptions;
}

/**
 * Remove files and directories
 *
 * @param options - Options string (e.g., "-rf") or RmOptions object
 * @param paths - Files/directories to remove
 * @returns ShellString with empty string on success, error message on failure
 *
 * @example
 * ```ts
 * // Remove a file
 * await rm("file.txt");
 *
 * // Force remove (ignore if doesn't exist)
 * await rm("-f", "maybe-exists.txt");
 *
 * // Remove directory recursively (string options)
 * await rm("-rf", "some-dir");
 *
 * // Remove directory recursively (object options as second arg)
 * await rm("some-dir", { recursive: true });
 *
 * // Remove directory recursively (object options first)
 * await rm({ recursive: true }, "some-dir");
 *
 * // Remove multiple files
 * await rm("file1.txt", "file2.txt", "file3.txt");
 *
 * // Remove using array
 * await rm("-f", ["file1.txt", "file2.txt"]);
 * ```
 */
export async function rm(
  path: string,
  options: RmOptions,
  ...morePaths: (string | string[])[]
): Promise<ShellString>;
export async function rm(
  options: RmOptions | string,
  ...paths: (string | string[])[]
): Promise<ShellString>;
export async function rm(
  optionsOrPath: string | RmOptions,
  ...paths: (string | string[] | RmOptions)[]
): Promise<ShellString> {
  let options: RmOptions = {};
  let allPaths: string[];

  // Parse arguments
  if (typeof optionsOrPath === "string" && optionsOrPath.startsWith("-")) {
    // Pattern: rm("-rf", "path1", "path2")
    options = parseRmOptions(optionsOrPath);
    allPaths = flattenArgs(...(paths as (string | string[])[]));
  } else if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    // Pattern: rm({ recursive: true }, "path1", "path2")
    options = optionsOrPath;
    allPaths = flattenArgs(...(paths as (string | string[])[]));
  } else if (
    typeof optionsOrPath === "string" &&
    paths.length > 0 &&
    typeof paths[0] === "object" &&
    !Array.isArray(paths[0])
  ) {
    // Pattern: rm("path", { recursive: true })
    options = paths[0] as RmOptions;
    allPaths = [optionsOrPath, ...flattenArgs(...(paths.slice(1) as (string | string[])[]))];
  } else {
    // First arg is a path
    allPaths = flattenArgs(optionsOrPath as string, ...(paths as (string | string[])[]));
  }

  if (allPaths.length === 0) {
    return new ShellString("", "rm: no paths given", 1);
  }

  const errors: string[] = [];
  const cwd = Deno.cwd();
  const config = getDefaultConfig(cwd);

  for (const path of allPaths) {
    const expandedPath = expandTilde(path);
    try {
      await validatePath(expandedPath, config, cwd, "write");
      const stat = await Deno.lstat(expandedPath);

      if (stat.isDirectory) {
        if (options.recursive) {
          await Deno.remove(expandedPath, { recursive: true });
        } else {
          errors.push(`rm: ${path}: is a directory`);
        }
      } else {
        await Deno.remove(expandedPath);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        if (!options.force) {
          errors.push(`rm: ${path}: No such file or directory`);
        }
        // With -f, silently ignore missing files
      } else if (error instanceof Deno.errors.PermissionDenied) {
        errors.push(`rm: ${path}: Permission denied`);
      } else {
        errors.push(`rm: ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (errors.length > 0) {
    return new ShellString("", errors.join("\n"), 1);
  }

  return new ShellString("");
}
