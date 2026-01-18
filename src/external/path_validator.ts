/**
 * Path argument validation for external commands
 *
 * Validates that path arguments to external commands don't escape the sandbox.
 * Supports auto-detection of paths and explicit position specification.
 */

import { resolve } from "@std/path";
import type { ExternalCommandConfig, SafeShellConfig } from "../core/types.ts";
import { expandPath, isPathAllowed, isWithinWorkspace } from "../core/permissions.ts";
import { pathViolation, symlinkViolation } from "../core/errors.ts";
import { getRealPathAsync } from "../core/utils.ts";

/**
 * Patterns that indicate an argument is likely a path
 */
const PATH_PATTERNS = [
  /^\//, // Absolute path: /path/to/file
  /^\.\.?\//, // Relative path: ./file or ../file
  /^~\//, // Home directory: ~/file
];

/**
 * Arguments that take path values (e.g., -o FILE, --output=FILE)
 * This is a subset of common patterns; specific commands may need custom config
 */
const PATH_FLAGS = [
  "-o",
  "--output",
  "--input",
  "-i",
  "-f",
  "--file",
  "-d",
  "--directory",
  "-C",
  "--chdir",
  "--path",
  "-p",
];

/**
 * Check if an argument looks like a path
 */
export function isPathLike(arg: string): boolean {
  return PATH_PATTERNS.some((pattern) => pattern.test(arg));
}

/**
 * Check if an argument is a flag that takes a path value
 */
export function isPathFlag(arg: string): boolean {
  // Exact match for short flags
  if (PATH_FLAGS.includes(arg)) {
    return true;
  }

  // Check for --flag=value pattern
  for (const flag of PATH_FLAGS) {
    if (arg.startsWith(flag + "=")) {
      return true;
    }
  }

  return false;
}

/**
 * Extract path from flag argument (e.g., "--output=/path" -> "/path")
 */
export function extractPathFromFlag(arg: string): string | null {
  const eqIndex = arg.indexOf("=");
  if (eqIndex !== -1) {
    return arg.substring(eqIndex + 1);
  }
  return null;
}

/**
 * Result of path extraction from arguments
 */
export interface ExtractedPath {
  /** The path value */
  path: string;
  /** The argument index where this path was found */
  argIndex: number;
  /** Whether this was from a flag (true) or a positional arg (false) */
  fromFlag: boolean;
  /** Original argument (for error reporting) */
  originalArg: string;
}

/**
 * Extract all path-like arguments from a command's arguments
 */
export function extractPaths(
  args: string[],
  config?: ExternalCommandConfig["pathArgs"],
): ExtractedPath[] {
  const paths: ExtractedPath[] = [];
  const positions = config?.positions ?? [];
  const autoDetect = config?.autoDetect ?? true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    // Check explicit positions
    if (positions.includes(i)) {
      paths.push({
        path: arg,
        argIndex: i,
        fromFlag: false,
        originalArg: arg,
      });
      continue;
    }

    // Auto-detection if enabled
    if (autoDetect) {
      // Check if argument looks like a path
      if (isPathLike(arg)) {
        paths.push({
          path: arg,
          argIndex: i,
          fromFlag: false,
          originalArg: arg,
        });
        continue;
      }

      // Check if this is a path flag with embedded value (--output=/path)
      if (isPathFlag(arg)) {
        const extractedPath = extractPathFromFlag(arg);
        if (extractedPath) {
          paths.push({
            path: extractedPath,
            argIndex: i,
            fromFlag: true,
            originalArg: arg,
          });
          continue;
        }

        // Check if next arg is the path value (-o /path)
        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith("-")) {
          paths.push({
            path: nextArg,
            argIndex: i + 1,
            fromFlag: true,
            originalArg: `${arg} ${nextArg}`,
          });
          i++; // Skip next arg
        }
      }
    }
  }

  return paths;
}

/**
 * Validate that all path arguments are within the sandbox
 *
 * @throws SafeShellError if any path violates sandbox rules
 */
export async function validatePathArgs(
  args: string[],
  command: string,
  config: SafeShellConfig,
  cwd: string,
  commandConfig?: ExternalCommandConfig,
): Promise<void> {
  const pathConfig = commandConfig?.pathArgs;

  // If validation is explicitly disabled, skip
  if (pathConfig?.validateSandbox === false) {
    return;
  }

  // Extract paths from arguments
  const extractedPaths = extractPaths(args, pathConfig);

  // Get allowed paths (use both read and write permissions)
  const perms = config.permissions ?? {};
  const allowedPaths = [
    ...(perms.read ?? []),
    ...(perms.write ?? []),
  ];

  if (allowedPaths.length === 0 && !config.workspace) {
    // No allowed paths configured and no workspace, can't validate
    return;
  }

  const workspace = config.workspace;

  // Validate each extracted path
  for (const extracted of extractedPaths) {
    let pathToCheck = extracted.path;

    // Expand ~ to HOME
    if (pathToCheck.startsWith("~/")) {
      const home = Deno.env.get("HOME") ?? "";
      pathToCheck = home + pathToCheck.slice(1);
    }

    // Expand path variables
    pathToCheck = expandPath(pathToCheck, cwd, workspace);

    // Resolve to absolute path
    const absolutePath = resolve(cwd, pathToCheck);

    // Try to resolve symlinks
    const realPath = await getRealPathAsync(absolutePath);

    // If workspace is configured and path is within workspace, allow it
    if (workspace && isWithinWorkspace(realPath, workspace)) {
      continue;
    }

    // Check against allowed paths
    if (!isPathAllowed(realPath, allowedPaths, cwd, workspace)) {
      if (realPath !== absolutePath) {
        // Symlink resolved to outside location
        const expandedAllowed = allowedPaths.map((p) => expandPath(p, cwd, workspace));
        throw symlinkViolation(extracted.path, realPath, expandedAllowed);
      }

      const expandedAllowed = allowedPaths.map((p) => expandPath(p, cwd, workspace));
      throw pathViolation(extracted.path, expandedAllowed, realPath);
    }
  }
}

/**
 * Sanitize paths in arguments to absolute paths within sandbox
 * Returns a new array with sanitized arguments
 */
export async function sanitizePathArgs(
  args: string[],
  cwd: string,
): Promise<string[]> {
  const result = [...args];

  for (let i = 0; i < result.length; i++) {
    const arg = result[i];
    if (arg === undefined) continue;

    // Check for path-like arguments
    if (isPathLike(arg)) {
      // Resolve to absolute path
      result[i] = resolve(cwd, arg);
    } else if (isPathFlag(arg)) {
      const extractedPath = extractPathFromFlag(arg);
      if (extractedPath) {
        // --flag=/path -> --flag=/absolute/path
        const flagPart = arg.substring(0, arg.indexOf("=") + 1);
        result[i] = flagPart + resolve(cwd, extractedPath);
      }
    }
  }

  return result;
}
