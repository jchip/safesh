/**
 * Deno permission configuration
 *
 * Translates SafeShell config into Deno permission flags.
 */

import { resolve } from "@std/path";
import type { PermissionsConfig, SafeShellConfig } from "./types.ts";
import { pathViolation, symlinkViolation } from "./errors.ts";

/**
 * Resolve workspace path - expand ~ and convert to absolute path
 */
export function resolveWorkspace(workspace: string): string {
  let path = workspace;

  // Expand ~ to HOME
  if (path.startsWith("~/")) {
    const home = Deno.env.get("HOME") ?? "";
    path = home + path.slice(1);
  }

  // Resolve to absolute path
  return resolve(path);
}

/**
 * Check if a path is within the workspace directory
 */
export function isWithinWorkspace(path: string, workspace: string): boolean {
  const absolutePath = resolve(path);
  const absoluteWorkspace = resolve(workspace);

  return absolutePath === absoluteWorkspace ||
         absolutePath.startsWith(absoluteWorkspace + "/");
}

/**
 * Expand path variables like ${CWD}, ${HOME}, ${WORKSPACE}
 */
export function expandPath(path: string, cwd: string, workspace?: string): string {
  const home = Deno.env.get("HOME") ?? "";
  const workspaceResolved = workspace ?? "";

  return path
    .replace(/\$\{CWD\}/g, cwd)
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$\{WORKSPACE\}/g, workspaceResolved)
    .replace(/\$CWD\b/g, cwd)
    .replace(/\$HOME\b/g, home)
    .replace(/\$WORKSPACE\b/g, workspaceResolved);
}

/**
 * Expand all paths in a list
 */
export function expandPaths(paths: string[], cwd: string, workspace?: string): string[] {
  return paths.map((p) => expandPath(p, cwd, workspace));
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(
  path: string,
  allowedPaths: string[],
  cwd: string,
  workspace?: string,
): boolean {
  const absolutePath = resolve(cwd, path);
  const expandedAllowed = expandPaths(allowedPaths, cwd, workspace).map((p) =>
    resolve(cwd, p)
  );

  return expandedAllowed.some((allowed) => {
    // Path must start with an allowed path
    return absolutePath === allowed || absolutePath.startsWith(allowed + "/");
  });
}

/**
 * Validate a path against sandbox rules
 * Resolves symlinks and checks against allowed paths
 */
export async function validatePath(
  requestedPath: string,
  config: SafeShellConfig,
  cwd: string,
  operation: "read" | "write" = "read",
): Promise<string> {
  const absolutePath = resolve(cwd, requestedPath);

  // Get allowed paths for this operation
  const perms = config.permissions ?? {};
  const allowedPaths = operation === "write"
    ? (perms.write ?? [])
    : (perms.read ?? []);

  if (allowedPaths.length === 0) {
    throw pathViolation(requestedPath, [], absolutePath);
  }

  const workspace = config.workspace;
  const expandedAllowed = expandPaths(allowedPaths, cwd, workspace);

  // Resolve symlinks to get real path
  let realPath: string;
  try {
    realPath = await Deno.realPath(absolutePath);
  } catch {
    // File doesn't exist yet, use the absolute path
    realPath = absolutePath;
  }

  // Check if real path is within allowed directories
  if (!isPathAllowed(realPath, allowedPaths, cwd, workspace)) {
    if (realPath !== absolutePath) {
      // Symlink resolved to a different location
      throw symlinkViolation(requestedPath, realPath, expandedAllowed);
    }
    throw pathViolation(requestedPath, expandedAllowed, realPath);
  }

  return realPath;
}

/**
 * Validate multiple paths
 */
export async function validatePaths(
  paths: string[],
  config: SafeShellConfig,
  cwd: string,
  operation: "read" | "write" = "read",
): Promise<string[]> {
  return Promise.all(
    paths.map((p) => validatePath(p, config, cwd, operation)),
  );
}

/**
 * Get effective permissions by merging defaults with config
 */
export function getEffectivePermissions(
  config: SafeShellConfig,
  cwd: string,
): PermissionsConfig {
  const perms = config.permissions ?? {};

  // Always include /tmp for scratch operations
  const defaultRead = [cwd, "/tmp"];
  const defaultWrite = ["/tmp"];

  return {
    read: [...new Set([...defaultRead, ...(perms.read ?? [])])],
    write: [...new Set([...defaultWrite, ...(perms.write ?? [])])],
    net: perms.net ?? [],
    run: perms.run ?? [],
    env: perms.env ?? [],
  };
}
