/**
 * Path Utilities Module
 *
 * Provides consolidated utilities for path checking and validation.
 * Eliminates duplication of "isWithin" path checking patterns across the codebase.
 */

import { resolve, isAbsolute } from "@std/path";
import type { SafeShellConfig } from "./types.ts";

/**
 * Check if a path is within (or equal to) a parent directory
 *
 * This is the core "isWithin" check pattern used throughout the codebase.
 * Replaces the duplicated pattern: `path === parent || path.startsWith(parent + "/")`
 *
 * @param path - The path to check (should be absolute)
 * @param parent - The parent directory (should be absolute)
 * @returns true if path is within or equal to parent
 */
export function isPathWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + "/");
}

/**
 * Check if a path is within any of the allowed directories
 *
 * @param path - The path to check (should be absolute)
 * @param allowedPaths - Array of allowed parent directories (should be absolute)
 * @returns true if path is within any of the allowed paths
 */
export function isPathWithinAny(path: string, allowedPaths: string[]): boolean {
  return allowedPaths.some((allowed) => isPathWithin(path, allowed));
}

/**
 * Options for path checking operations
 */
export interface PathCheckOptions {
  /** Array of allowed parent directories */
  allowedPaths: string[];
  /** Current working directory for resolving relative paths */
  cwd?: string;
  /** Workspace directory for variable expansion */
  workspace?: string;
  /** Whether to expand path variables like ${CWD}, ${HOME}, etc */
  expandVars?: boolean;
}

/**
 * Check if a path is within allowed directories with flexible options
 *
 * This consolidates the various "isWithin" patterns with path resolution,
 * expansion, and validation logic.
 *
 * @param path - The path to check (relative or absolute)
 * @param options - Configuration options for the check
 * @returns true if path is within allowed directories
 */
export function isPathWithinAllowed(
  path: string,
  options: PathCheckOptions,
): boolean {
  const cwd = options.cwd ?? Deno.cwd();

  // Resolve path to absolute
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);

  // Resolve all allowed paths to absolute
  const absoluteAllowed = options.allowedPaths.map((p) => {
    // If expandVars is enabled, we'd expand here
    // For now, just resolve to absolute
    return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  });

  return isPathWithinAny(absolutePath, absoluteAllowed);
}

/**
 * Result of path permission check with detailed reason
 */
export interface PathPermissionResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** The resolved absolute path */
  resolvedPath?: string;
  /** Reason for denial (if not allowed) */
  reason?: string;
}

/**
 * Check path permission against SafeShell configuration
 *
 * Provides a higher-level check with detailed reasoning for debugging.
 *
 * @param path - The path to check
 * @param operation - The operation type ('read' or 'write')
 * @param config - The SafeShell configuration
 * @param cwd - Current working directory
 * @returns Result object with allowed status and optional reason
 */
export function checkPathPermission(
  path: string,
  operation: "read" | "write",
  config: SafeShellConfig,
  cwd: string,
): PathPermissionResult {
  // Resolve to absolute path
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);

  // Check project directory first (if configured)
  if (config.projectDir) {
    const projectDir = resolve(config.projectDir);
    if (isPathWithin(absolutePath, projectDir)) {
      // For write operations, check if project writes are blocked
      if (operation === "write" && config.blockProjectDirWrite) {
        return {
          allowed: false,
          resolvedPath: absolutePath,
          reason: "Write access to project directory is blocked",
        };
      }
      return {
        allowed: true,
        resolvedPath: absolutePath,
      };
    }
  }

  // Check against explicit permissions
  const permissions = config.permissions;
  if (!permissions) {
    return {
      allowed: false,
      resolvedPath: absolutePath,
      reason: "No permissions configured",
    };
  }

  const pathsToCheck =
    operation === "read" ? permissions.read : permissions.write;

  if (!pathsToCheck || pathsToCheck.length === 0) {
    return {
      allowed: false,
      resolvedPath: absolutePath,
      reason: `No ${operation} permissions configured`,
    };
  }

  // Resolve all allowed paths
  const allowedPaths = pathsToCheck.map((p) =>
    isAbsolute(p) ? resolve(p) : resolve(cwd, p)
  );

  if (isPathWithinAny(absolutePath, allowedPaths)) {
    return {
      allowed: true,
      resolvedPath: absolutePath,
    };
  }

  return {
    allowed: false,
    resolvedPath: absolutePath,
    reason: `Path not within allowed ${operation} paths`,
  };
}
