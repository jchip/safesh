/**
 * Glob matching utilities
 *
 * Provides glob pattern matching that respects sandbox boundaries.
 * Uses Deno's @std/fs/expand_glob with path validation.
 *
 * @module
 */

import { expandGlob, type ExpandGlobOptions } from "@std/fs/expand-glob";
import { resolve, normalize, dirname } from "@std/path";
import { expandPath, isPathAllowed } from "../core/permissions.ts";
import { pathViolation } from "../core/errors.ts";
import type { SafeShellConfig } from "../core/types.ts";

/**
 * Options for glob matching
 */
export interface GlobOptions {
  /** Current working directory for relative patterns */
  cwd?: string;
  /** Include directories in results (default: false) */
  includeDirs?: boolean;
  /** Follow symlinks (default: false - for security) */
  followSymlinks?: boolean;
  /** Root directory to restrict matching (default: cwd) */
  root?: string;
  /** Exclude patterns (gitignore style) */
  exclude?: string[];
  /** Case insensitive matching (default: false) */
  caseInsensitive?: boolean;
}

/**
 * Entry returned by glob matching
 */
export interface GlobEntry {
  /** Absolute path to the file/directory */
  path: string;
  /** Filename (basename) */
  name: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Whether this is a file */
  isFile: boolean;
  /** Whether this is a symlink */
  isSymlink: boolean;
}

/**
 * Get real path, handling symlinks and non-existent paths
 */
function getRealPath(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
}

/**
 * Default sandbox configuration (fallback when no config provided)
 */
function getDefaultAllowedPaths(cwd: string): string[] {
  // Resolve /tmp to real path (on macOS, /tmp is a symlink to /private/tmp)
  const tmpPath = getRealPath("/tmp");
  const realCwd = getRealPath(cwd);
  return [realCwd, tmpPath];
}

/**
 * Validate that a path is within allowed directories
 */
function validateGlobPath(
  path: string,
  allowedPaths: string[],
  cwd: string,
): void {
  if (!isPathAllowed(path, allowedPaths, cwd)) {
    const expandedAllowed = allowedPaths.map((p) => expandPath(p, cwd));
    throw pathViolation(path, expandedAllowed);
  }
}

/**
 * Get base directory from a glob pattern
 * Used to validate the pattern is within sandbox before expanding
 */
export function getGlobBase(pattern: string): string {
  // Find the first segment without wildcards
  const segments = pattern.split("/");
  const baseSegments: string[] = [];

  for (const segment of segments) {
    if (segment.includes("*") || segment.includes("?") || segment.includes("[")) {
      break;
    }
    baseSegments.push(segment);
  }

  return baseSegments.join("/") || ".";
}

/**
 * Expand a glob pattern and yield matching paths
 *
 * @param pattern - Glob pattern (e.g., "**\/*.ts", "src/*.js")
 * @param options - Glob options
 * @param config - SafeShell config for sandbox validation (optional)
 * @yields GlobEntry for each matching file/directory
 *
 * @example
 * ```ts
 * // Find all TypeScript files
 * for await (const entry of glob("**\/*.ts")) {
 *   console.log(entry.path);
 * }
 *
 * // Find all files in src, excluding tests
 * for await (const entry of glob("src/**\/*", { exclude: ["**\/*.test.ts"] })) {
 *   console.log(entry.path);
 * }
 * ```
 */
export async function* glob(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): AsyncGenerator<GlobEntry> {
  const cwd = options.cwd ?? Deno.cwd();
  const root = options.root ?? cwd;

  // Get allowed paths from config or use defaults
  const perms = config?.permissions ?? {};
  const allowedPaths = [
    ...(perms.read ?? []),
    ...(perms.write ?? []),
  ];
  const effectiveAllowedPaths = allowedPaths.length > 0
    ? allowedPaths
    : getDefaultAllowedPaths(cwd);

  // Validate the base directory of the pattern is within sandbox
  const globBase = getGlobBase(pattern);
  const absoluteBase = resolve(root, globBase);

  // Check if base is allowed - if pattern starts with absolute path
  if (pattern.startsWith("/") || globBase !== ".") {
    validateGlobPath(absoluteBase, effectiveAllowedPaths, cwd);
  }

  // Build expand_glob options
  const expandOptions: ExpandGlobOptions = {
    root,
    includeDirs: options.includeDirs ?? false,
    followSymlinks: options.followSymlinks ?? false,
    caseInsensitive: options.caseInsensitive ?? false,
    exclude: options.exclude,
  };

  // Expand the glob pattern
  for await (const entry of expandGlob(pattern, expandOptions)) {
    // Validate each result is within sandbox
    try {
      validateGlobPath(entry.path, effectiveAllowedPaths, cwd);

      yield {
        path: entry.path,
        name: entry.name,
        isDirectory: entry.isDirectory,
        isFile: entry.isFile,
        isSymlink: entry.isSymlink,
      };
    } catch {
      // Skip paths outside sandbox silently
      continue;
    }
  }
}

/**
 * Collect all glob matches into an array
 *
 * @param pattern - Glob pattern
 * @param options - Glob options
 * @param config - SafeShell config for sandbox validation
 * @returns Array of matching entries
 *
 * @example
 * ```ts
 * const files = await globArray("src/**\/*.ts");
 * console.log(`Found ${files.length} TypeScript files`);
 * ```
 */
export async function globArray(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): Promise<GlobEntry[]> {
  const results: GlobEntry[] = [];
  for await (const entry of glob(pattern, options, config)) {
    results.push(entry);
  }
  return results;
}

/**
 * Collect only file paths from glob matches
 *
 * @param pattern - Glob pattern
 * @param options - Glob options
 * @param config - SafeShell config for sandbox validation
 * @returns Array of matching file paths
 *
 * @example
 * ```ts
 * const paths = await globPaths("**\/*.json");
 * // paths = ["/project/package.json", "/project/tsconfig.json", ...]
 * ```
 */
export async function globPaths(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): Promise<string[]> {
  const entries = await globArray(pattern, options, config);
  return entries.map((e) => e.path);
}

/**
 * Check if any files match the pattern
 *
 * @param pattern - Glob pattern
 * @param options - Glob options
 * @param config - SafeShell config for sandbox validation
 * @returns True if at least one file matches
 *
 * @example
 * ```ts
 * if (await hasMatch("**\/*.test.ts")) {
 *   console.log("Tests found!");
 * }
 * ```
 */
export async function hasMatch(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): Promise<boolean> {
  for await (const _ of glob(pattern, options, config)) {
    return true;
  }
  return false;
}

/**
 * Count matching files
 *
 * @param pattern - Glob pattern
 * @param options - Glob options
 * @param config - SafeShell config for sandbox validation
 * @returns Number of matching files
 */
export async function countMatches(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): Promise<number> {
  let count = 0;
  for await (const _ of glob(pattern, options, config)) {
    count++;
  }
  return count;
}

/**
 * Find first matching file
 *
 * @param pattern - Glob pattern
 * @param options - Glob options
 * @param config - SafeShell config for sandbox validation
 * @returns First matching entry or undefined
 */
export async function findFirst(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): Promise<GlobEntry | undefined> {
  for await (const entry of glob(pattern, options, config)) {
    return entry;
  }
  return undefined;
}
