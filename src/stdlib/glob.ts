/**
 * Glob matching utilities
 *
 * Provides glob pattern matching that respects sandbox boundaries.
 * Uses Deno's @std/fs/expand_glob with path validation.
 *
 * @module
 */

import { expandGlob, type ExpandGlobOptions } from "@std/fs/expand-glob";
import { isAbsolute, relative, resolve } from "@std/path";
import { expandPath, isPathAllowed } from "../core/permissions.ts";
import { pathViolation } from "../core/errors.ts";
import type { SafeShellConfig } from "../core/types.ts";
import { getDefaultAllowedPaths, getRealPath } from "../core/utils.ts";

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
  /** Allow ** to cross directory boundaries (default: @std/fs default) */
  globstar?: boolean;
  /** Enable extended globs like @(...) +(...) (default: @std/fs default) */
  extended?: boolean;
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
 * Validate that a path is within allowed directories
 */
function validateGlobPath(
  path: string,
  allowedPaths: string[],
  cwd: string,
  workspace?: string,
): void {
  // SSH-574: compare canonical forms — configured roots may be in symlinked
  // form (/tmp, macOS /var/...) while expandGlob yields resolved paths
  // (/private/...), which made every match look out-of-sandbox
  const realPath = getRealPath(path);
  const realAllowed = allowedPaths.map((p) => getRealPath(expandPath(p, cwd, workspace)));
  if (!isPathAllowed(realPath, realAllowed, cwd, workspace)) {
    throw pathViolation(path, realAllowed);
  }
}

/**
 * Get base directory from a glob pattern
 * Used to validate the pattern is within sandbox before expanding
 */
export function getGlobBase(pattern: string): string {
  if (pattern === undefined || pattern === null) {
    throw new TypeError("getGlobBase: pattern cannot be undefined or null");
  }
  if (typeof pattern !== "string") {
    throw new TypeError(`getGlobBase: pattern must be a string, got ${typeof pattern}`);
  }
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
  const workspace = config?.workspace;

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
    validateGlobPath(absoluteBase, effectiveAllowedPaths, cwd, workspace);
  }

  // Build expand_glob options
  const expandOptions: ExpandGlobOptions = {
    root,
    includeDirs: options.includeDirs ?? false,
    followSymlinks: options.followSymlinks ?? false,
    caseInsensitive: options.caseInsensitive ?? false,
    exclude: options.exclude,
    // undefined leaves the @std/fs default untouched (existing callers unchanged)
    globstar: options.globstar,
    extended: options.extended,
  };

  // Expand the glob pattern
  for await (const entry of expandGlob(pattern, expandOptions)) {
    // Validate each result is within sandbox
    try {
      validateGlobPath(entry.path, effectiveAllowedPaths, cwd, workspace);

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
 * SSH-642: per-component dotfile exclusion, matching bash pathname expansion.
 *
 * A wildcard does not match a filename component that begins with `.` unless
 * the corresponding pattern component also begins with `.` (so `*` skips
 * `.hidden` but `.*` matches it). Pattern and match have the same number of
 * components because globstar is disabled (a `*` never crosses `/`).
 */
function isDotExcluded(pattern: string, rel: string): boolean {
  const patternComponents = pattern.split("/");
  const matchComponents = rel.split("/");
  const n = Math.min(patternComponents.length, matchComponents.length);
  for (let i = 0; i < n; i++) {
    if (matchComponents[i]!.startsWith(".") && !patternComponents[i]!.startsWith(".")) {
      return true;
    }
  }
  return false;
}

/**
 * SSH-642: bash-faithful command-argument glob expansion (nullglob OFF).
 *
 * Returns matches relative to `cwd` (absolute when the pattern is absolute),
 * sorted in C/byte order, with dot-prefixed names excluded per bash rules
 * ({@link isDotExcluded}). When nothing matches, returns the literal pattern —
 * bash's default (nullglob off). Any failure (malformed pattern, sandbox
 * violation, etc.) also yields the literal pattern, so a command never receives
 * fewer or different args than it does today; expansion only ever *adds* real
 * matches. This is the canonical helper for `$.__expandGlob` in transpiled code.
 *
 * @param pattern - The glob pattern (an unquoted command argument)
 * @param config - SafeShell config for sandbox validation
 * @param cwd - Base directory for relative patterns (defaults to Deno.cwd())
 * @returns Sorted matches, or `[pattern]` when there are none
 */
export async function expandGlobArg(
  pattern: string,
  config?: SafeShellConfig,
  cwd: string = Deno.cwd(),
): Promise<string[]> {
  try {
    const absolute = isAbsolute(pattern);
    const matches: string[] = [];
    for await (
      const entry of glob(pattern, {
        cwd,
        root: cwd,
        includeDirs: true,
        globstar: false,
        extended: false,
      }, config)
    ) {
      const rel = absolute ? entry.path : relative(cwd, entry.path);
      if (!isDotExcluded(pattern, rel)) matches.push(rel);
    }
    matches.sort();
    return matches.length > 0 ? matches : [pattern];
  } catch {
    // nullglob-off literal fallback — never expand to fewer/other args than bash
    return [pattern];
  }
}

/**
 * SSH-642: expand a list of command operands, flattening each pattern's matches
 * in order (each via {@link expandGlobArg}). Used by fluent file commands such
 * as `cat` and `wc` that accept multiple operands. The canonical helper for
 * `$.__expandGlobAll` in transpiled code.
 */
export async function expandGlobAll(
  patterns: string[],
  config?: SafeShellConfig,
  cwd?: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const pattern of patterns) {
    out.push(...(await expandGlobArg(pattern, config, cwd)));
  }
  return out;
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
