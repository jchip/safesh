/**
 * which command - locate a command
 *
 * @module
 */

import { resolve, join } from "@std/path";
import { ShellString } from "./types.ts";
import { splitPath, isWindows, checkPath, isExecutable } from "./common.ts";

/**
 * Options for which command
 */
export interface WhichOptions {
  /** Return all matches, not just the first */
  all?: boolean;
}

// Default PATHEXT for Windows (if not set)
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH";

/**
 * Search for a command in the system PATH
 *
 * @param cmd - Command name to search for
 * @param options - Which options
 * @returns ShellString with path to command, or null if not found
 *
 * @example
 * ```ts
 * const nodePath = await which("node");
 * console.log(nodePath?.toString()); // "/usr/local/bin/node"
 *
 * // Find all matches
 * const allPython = await which("python", { all: true });
 * ```
 */
export async function which(
  cmd: string,
  options: WhichOptions = {},
): Promise<ShellString | null> {
  if (!cmd) {
    return ShellString.error("which: must specify command", 1);
  }

  const pathArray = splitPath(Deno.env.get("PATH"));
  const matches: string[] = [];
  const onWindows = isWindows();

  // Check if cmd contains a path separator (absolute or relative path)
  if (cmd.includes("/") || (onWindows && cmd.includes("\\"))) {
    const resolvedPath = resolve(cmd);
    if (await isPathExecutable(resolvedPath, onWindows)) {
      return ShellString.ok(resolvedPath + "\n");
    }
    return null;
  }

  // Get path extensions for Windows
  let pathExtArray = [""];
  if (onWindows) {
    const pathExt = Deno.env.get("PATHEXT") || DEFAULT_PATHEXT;
    pathExtArray = pathExt.toUpperCase().split(";");
  }

  // Search in PATH
  for (const dir of pathArray) {
    if (matches.length > 0 && !options.all) {
      break;
    }

    let attempt = resolve(dir, cmd);
    if (onWindows) {
      attempt = attempt.toUpperCase();
    }

    // Check if command already has a valid extension
    const hasExt = pathExtArray.some((ext) =>
      attempt.toUpperCase().endsWith(ext)
    );

    if (hasExt) {
      if (await isPathExecutable(attempt, onWindows)) {
        matches.push(attempt);
        if (!options.all) break;
      }
    } else {
      // Try each extension
      for (const ext of pathExtArray) {
        const withExt = attempt + ext;
        if (await isPathExecutable(withExt, onWindows)) {
          matches.push(withExt);
          if (!options.all) break;
        }
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  if (options.all) {
    return ShellString.ok(matches.join("\n") + "\n");
  }

  return ShellString.ok(matches[0] + "\n");
}

/**
 * Check if a path is an executable file
 */
async function isPathExecutable(
  path: string,
  onWindows: boolean,
): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    if (stat.isDirectory) return false;

    if (onWindows) {
      // On Windows, any existing file in PATH with valid extension is executable
      return true;
    }

    // On Unix, check executable bit
    return stat.mode !== null && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
