/**
 * Deno permission configuration
 *
 * Translates SafeShell config into Deno permission flags.
 */

import { resolve, isAbsolute } from "@std/path";
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
 * Check if a path is within the project directory
 */
export function isWithinProjectDir(path: string, projectDir: string, cwd?: string): boolean {
  // Resolve path to absolute
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd ?? Deno.cwd(), path);
  const absoluteProjectDir = resolve(projectDir);

  return absolutePath === absoluteProjectDir ||
         absolutePath.startsWith(absoluteProjectDir + "/");
}

/**
 * Check if a command path is allowed under projectDir
 * Used when allowProjectCommands is true
 */
export function isCommandWithinProjectDir(
  commandPath: string,
  projectDir: string,
  cwd?: string,
): boolean {
  // Only applies to path-like commands (relative or absolute paths)
  if (!commandPath.includes("/") && !commandPath.includes("\\")) {
    return false; // Not a path, just a command name
  }

  return isWithinProjectDir(commandPath, projectDir, cwd);
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

  // Resolve symlinks to get real path
  let realPath: string;
  try {
    realPath = await Deno.realPath(absolutePath);
  } catch {
    // File doesn't exist yet, use the absolute path
    realPath = absolutePath;
  }

  // Check if allowProjectFiles permits this path
  if (config.allowProjectFiles && config.projectDir) {
    if (isWithinProjectDir(realPath, config.projectDir)) {
      return realPath;
    }
  }

  // Get allowed paths for this operation (using effective permissions with defaults)
  const effectivePerms = getEffectivePermissions(config, cwd);
  const allowedPaths = operation === "write"
    ? (effectivePerms.write ?? [])
    : (effectivePerms.read ?? []);

  if (allowedPaths.length === 0 && !(config.allowProjectFiles && config.projectDir)) {
    throw pathViolation(requestedPath, [], absolutePath);
  }

  const workspace = config.workspace;
  const expandedAllowed = expandPaths(allowedPaths, cwd, workspace);

  // Check if real path is within allowed directories
  // Note: deny paths are enforced by Deno's --deny-read/--deny-write flags
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
 *
 * IMPORTANT: Write permissions are based on projectDir, not cwd.
 * This ensures cd() cannot be used to escape the sandbox.
 * Deno's --allow-write flags are set at subprocess spawn time
 * and cannot be changed by user code.
 */
export function getEffectivePermissions(
  config: SafeShellConfig,
  cwd: string,
): PermissionsConfig {
  const perms = config.permissions ?? {};

  // Default read includes cwd for convenience (read is less dangerous)
  // Default write is ONLY /tmp - projectDir must be explicitly enabled
  const defaultRead = [cwd, "/tmp"];
  const defaultWrite = ["/tmp"];

  // Include projectDir in read/write if allowProjectFiles is true
  // projectDir is the immutable sandbox boundary (unlike cwd which can change via cd())
  if (config.allowProjectFiles && config.projectDir) {
    defaultRead.push(config.projectDir);
    defaultWrite.push(config.projectDir);
  }

  return {
    read: [...new Set([...defaultRead, ...(perms.read ?? [])])],
    denyRead: perms.denyRead ?? [],
    write: [...new Set([...defaultWrite, ...(perms.write ?? [])])],
    denyWrite: perms.denyWrite ?? [],
    net: perms.net ?? [],
    run: perms.run ?? [],
    env: perms.env ?? [],
  };
}
