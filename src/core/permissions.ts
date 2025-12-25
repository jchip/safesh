/**
 * Deno permission configuration
 *
 * Translates SafeShell config into Deno permission flags.
 */

import { resolve } from "@std/path";
import type { PermissionsConfig, SafeShellConfig } from "./types.ts";
import { pathViolation, symlinkViolation } from "./errors.ts";

/**
 * Expand path variables like ${CWD}, ${HOME}
 */
export function expandPath(path: string, cwd: string): string {
  const home = Deno.env.get("HOME") ?? "";

  return path
    .replace(/\$\{CWD\}/g, cwd)
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$CWD\b/g, cwd)
    .replace(/\$HOME\b/g, home);
}

/**
 * Expand all paths in a list
 */
export function expandPaths(paths: string[], cwd: string): string[] {
  return paths.map((p) => expandPath(p, cwd));
}

/**
 * Build Deno permission flags from config
 */
export function buildPermissionFlags(
  config: SafeShellConfig,
  cwd: string,
): string[] {
  const flags: string[] = [];
  const perms = config.permissions ?? {};

  // Read permissions
  if (perms.read?.length) {
    const paths = expandPaths(perms.read, cwd);
    flags.push(`--allow-read=${paths.join(",")}`);
  }

  // Write permissions
  if (perms.write?.length) {
    const paths = expandPaths(perms.write, cwd);
    flags.push(`--allow-write=${paths.join(",")}`);
  }

  // Network permissions
  if (perms.net === true) {
    flags.push("--allow-net");
  } else if (Array.isArray(perms.net) && perms.net.length) {
    flags.push(`--allow-net=${perms.net.join(",")}`);
  }

  // Run permissions (for external commands)
  if (perms.run?.length) {
    flags.push(`--allow-run=${perms.run.join(",")}`);
  }

  // Env permissions
  if (perms.env?.length) {
    flags.push(`--allow-env=${perms.env.join(",")}`);
  }

  return flags;
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(
  path: string,
  allowedPaths: string[],
  cwd: string,
): boolean {
  const absolutePath = resolve(cwd, path);
  const expandedAllowed = expandPaths(allowedPaths, cwd).map((p) =>
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

  const expandedAllowed = expandPaths(allowedPaths, cwd);

  // Resolve symlinks to get real path
  let realPath: string;
  try {
    realPath = await Deno.realPath(absolutePath);
  } catch {
    // File doesn't exist yet, use the absolute path
    realPath = absolutePath;
  }

  // Check if real path is within allowed directories
  if (!isPathAllowed(realPath, allowedPaths, cwd)) {
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
