/**
 * Common utilities for shelljs-like commands
 *
 * Provides option parsing, glob expansion, path utilities.
 *
 * @module
 */

import { resolve, join, DELIMITER } from "@std/path";
import { expandGlob } from "@std/fs/expand-glob";
import type { OptionsMap, ParsedOptions } from "./types.ts";
import type { SandboxOptions } from "../fs.ts";
import type { SafeShellConfig } from "../../core/types.ts";

/**
 * Parse Unix-style command options
 *
 * @param opt - Options string like "-rf" or object like {"-r": true}
 * @param map - Map of short options to long names
 * @returns Parsed options object
 *
 * @example
 * ```ts
 * const opts = parseOptions("-rf", { r: "recursive", f: "force" });
 * // { recursive: true, force: true }
 *
 * const opts2 = parseOptions({ "-n": 5 }, { n: "number" });
 * // { number: 5 }
 * ```
 */
export function parseOptions(
  opt: string | Record<string, unknown>,
  map: OptionsMap,
): ParsedOptions {
  const options: ParsedOptions = {};

  // Initialize all options to false
  for (const key of Object.keys(map)) {
    const optName = map[key]!;
    if (!optName.startsWith("!")) {
      options[optName] = false;
    }
  }

  // Handle empty or "--" (no options)
  if (opt === "" || opt === "--") {
    return options;
  }

  if (typeof opt === "string") {
    if (!opt.startsWith("-")) {
      throw new Error("Options string must start with '-'");
    }

    // Parse "-rf" style options
    const chars = opt.slice(1).split("");
    for (const c of chars) {
      if (c in map) {
        const optName = map[c]!;
        if (optName.startsWith("!")) {
          options[optName.slice(1)] = false;
        } else {
          options[optName] = true;
        }
      } else {
        throw new Error(`Option not recognized: ${c}`);
      }
    }
  } else {
    // Parse object style options { "-r": true, "-n": 5 }
    for (const key of Object.keys(opt)) {
      if (key.startsWith("-")) {
        const c = key[1];
        if (c && c in map) {
          const optName = map[c];
          if (optName) {
            options[optName] = opt[key] as boolean | string | number;
          }
        } else {
          throw new Error(`Option not recognized: ${c}`);
        }
      } else if (key in options) {
        // Long option name
        options[key] = opt[key] as boolean | string | number;
      } else {
        throw new Error(`Option not recognized: ${key}`);
      }
    }
  }

  return options;
}

/**
 * Expand glob patterns to file paths
 *
 * @param patterns - Glob patterns to expand
 * @param options - Sandbox options
 * @returns Array of matched file paths
 *
 * @example
 * ```ts
 * const files = await expand(["*.ts", "src/**\/*.js"]);
 * ```
 */
export async function expand(
  patterns: string[],
  options?: SandboxOptions,
): Promise<string[]> {
  const results: string[] = [];
  const cwd = options?.cwd ?? Deno.cwd();

  for (const pattern of patterns) {
    // Handle tilde expansion
    const expanded = expandTilde(pattern);

    // Check if it's a glob pattern
    if (isGlob(expanded)) {
      for await (const entry of expandGlob(expanded, {
        root: cwd,
        includeDirs: true,
        followSymlinks: false,
      })) {
        results.push(entry.path);
      }
    } else {
      // Not a glob, use as-is (resolve relative to cwd)
      results.push(resolve(cwd, expanded));
    }
  }

  return results.sort();
}

/**
 * Check if a string contains glob characters
 */
export function isGlob(str: string): boolean {
  return /[*?[\]{}]/.test(str);
}

/**
 * Expand tilde (~) to home directory
 *
 * @param path - Path that may contain ~
 * @returns Path with ~ expanded to home directory
 *
 * @example
 * ```ts
 * expandTilde("~/Documents") // "/Users/john/Documents"
 * expandTilde("~") // "/Users/john"
 * ```
 */
export function expandTilde(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    const home = Deno.env.get("HOME") ?? "";
    return path.replace(/^~/, home);
  }
  return path;
}

/**
 * Split PATH environment variable
 *
 * @param pathEnv - PATH environment variable value
 * @returns Array of paths
 */
export function splitPath(pathEnv: string | undefined): string[] {
  return pathEnv ? pathEnv.split(DELIMITER) : [];
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return Deno.build.os === "windows";
}

/**
 * Check if a file is executable
 *
 * @param path - Path to check
 * @returns True if file is executable
 */
export async function isExecutable(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) return false;

    // On Windows, check file extension
    if (isWindows()) {
      const ext = path.toLowerCase().split(".").pop();
      const pathExt = (Deno.env.get("PATHEXT") || ".COM;.EXE;.BAT;.CMD")
        .toLowerCase()
        .split(";")
        .map((e) => e.replace(".", ""));
      return pathExt.includes(ext || "");
    }

    // On Unix, check executable bit
    // mode & 0o111 checks if any execute bit is set
    return stat.mode !== null && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Check if path exists and is not a directory
 *
 * @param path - Path to check
 * @returns True if path exists and is a file
 */
export async function checkPath(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return !stat.isDirectory && (isWindows() || await isExecutable(path));
  } catch {
    return false;
  }
}

/**
 * Get real path, handling symlinks
 */
export async function realPath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return path;
  }
}

/**
 * Get file info (stat), following symlinks
 */
export async function statFollowLinks(
  path: string,
): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.stat(path);
  } catch {
    return null;
  }
}

/**
 * Get file info (lstat), not following symlinks
 */
export async function statNoFollowLinks(
  path: string,
): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch {
    return null;
  }
}

/**
 * Random filename for temp files
 */
export function randomFileName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "safesh_";
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Permission constants for chmod
 */
export const PERMS = {
  OTHER_EXEC: 0o001,
  OTHER_WRITE: 0o002,
  OTHER_READ: 0o004,

  GROUP_EXEC: 0o010,
  GROUP_WRITE: 0o020,
  GROUP_READ: 0o040,

  OWNER_EXEC: 0o100,
  OWNER_WRITE: 0o200,
  OWNER_READ: 0o400,

  STICKY: 0o1000,
  SETGID: 0o2000,
  SETUID: 0o4000,

  TYPE_MASK: 0o770000,
} as const;

/**
 * Convert string arguments to array, flattening nested arrays
 */
export function flattenArgs(...args: (string | string[])[]): string[] {
  return args.flat();
}

/**
 * Create default config for sandbox
 */
export function getDefaultConfig(cwd: string): SafeShellConfig {
  return {
    permissions: {
      read: [cwd, "/tmp"],
      write: [cwd, "/tmp"],
    },
  };
}
