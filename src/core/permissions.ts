/**
 * Deno permission configuration
 *
 * Translates SafeShell config into Deno permission flags.
 */

import { resolve, isAbsolute } from "@std/path";
import type { PermissionsConfig, SafeShellConfig } from "./types.ts";
import { pathDenied, pathViolation, symlinkViolation } from "./errors.ts";
import { getRealPathAsync } from "./utils.ts";
import { isPathWithin } from "./path-utils.ts";
import { normalizeWorkspaceRoots } from "./project-root.ts";

function getWorkspaceVariable(config: SafeShellConfig): string | undefined {
  if (config.workspace) {
    return resolveWorkspace(config.workspace);
  }
  if (config.workspaceDir) {
    return resolveWorkspace(config.workspaceDir);
  }
  return undefined;
}

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

  return isPathWithin(absolutePath, absoluteWorkspace);
}

/**
 * Check if a path is within the project directory
 */
export function isWithinProjectDir(path: string, projectDir: string, cwd?: string): boolean {
  // Resolve path to absolute
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd ?? Deno.cwd(), path);
  const absoluteProjectDir = resolve(projectDir);

  return isPathWithin(absolutePath, absoluteProjectDir);
}

/**
 * Get all configured top-level roots, preserving projectDir as the primary root.
 */
export function getWorkspaceRoots(config: SafeShellConfig): string[] {
  return normalizeWorkspaceRoots([
    ...(config.projectDir ? [config.projectDir] : []),
    ...(config.workspaceRoots ?? []),
  ]);
}

/**
 * Check if a path is within any configured top-level root.
 */
export function isWithinWorkspaceRoots(
  path: string,
  config: SafeShellConfig,
  cwd?: string,
): boolean {
  return getWorkspaceRoots(config).some((root) => isWithinProjectDir(path, root, cwd));
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
 * Check if a command path is allowed under any configured top-level root.
 */
export function isCommandWithinWorkspaceRoots(
  commandPath: string,
  config: SafeShellConfig,
  cwd?: string,
): boolean {
  if (!commandPath.includes("/") && !commandPath.includes("\\")) {
    return false;
  }

  return isWithinWorkspaceRoots(commandPath, config, cwd);
}

/**
 * Expand path variables like ${CWD}, ${HOME}, ${WORKSPACE} and tilde (~)
 */
export function expandPath(path: string, cwd: string, workspace?: string): string {
  const home = Deno.env.get("HOME") ?? "";
  const workspaceResolved = workspace ?? "";

  // Expand tilde first
  let expanded = path;
  if (expanded === "~") {
    expanded = home;
  } else if (expanded.startsWith("~/")) {
    expanded = home + expanded.slice(1);
  }

  return expanded
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

  return expandedAllowed.some((allowed) =>
    isPathWithin(absolutePath, allowed)
  );
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
  const workspace = getWorkspaceVariable(config);

  // Expand tilde and path variables before resolving
  const expandedPath = expandPath(requestedPath, cwd, workspace);
  const absolutePath = resolve(cwd, expandedPath);

  // Resolve symlinks to get real path
  const realPath = await getRealPathAsync(absolutePath);

  const effectivePerms = getEffectivePermissions(config, cwd);

  // SSH-588: deny lists win over every allow source, including workspace
  // roots and the temp-dir defaults. Deno's --deny-* flags only protect
  // subprocesses; this check is the only gate for in-process callers and the
  // prehook's passthrough decision.
  const denyPaths = operation === "write"
    ? (effectivePerms.denyWrite ?? [])
    : (effectivePerms.denyRead ?? []);
  if (denyPaths.length > 0 && isPathAllowed(realPath, denyPaths, cwd, workspace)) {
    throw pathDenied(requestedPath, realPath, operation);
  }

  const workspaceRoots = getWorkspaceRoots(config);

  // Top-level roots get full read access, and write access unless blockProjectDirWrite is true
  if (workspaceRoots.length > 0) {
    if (isWithinWorkspaceRoots(realPath, config)) {
      // For write operations, check if writes are blocked
      if (operation === "write" && config.blockProjectDirWrite) {
        // Fall through to normal permission checking (roots not in write list)
      } else {
        return realPath;
      }
    }
  }

  // Get allowed paths for this operation (using effective permissions with defaults)
  const allowedPaths = operation === "write"
    ? (effectivePerms.write ?? [])
    : (effectivePerms.read ?? []);

  if (allowedPaths.length === 0 && workspaceRoots.length === 0) {
    throw pathViolation(requestedPath, [], absolutePath);
  }

  const expandedAllowed = expandPaths(allowedPaths, cwd, workspace);

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
 * Compute the temp-dir entries for the default read/write lists.
 *
 * SSH-586: temp dirs are allowed under both their literal and canonical
 * forms — on macOS /tmp and /var are symlinks into /private, and the
 * symlink validator compares resolved paths. The OS per-user temp dir
 * (macOS: $TMPDIR -> /var/folders/<xx>/<hash>/T; Linux: sometimes
 * /run/user/<uid>) is /tmp's moral equivalent, so treat it like /tmp.
 *
 * Exported for tests; runtime callers use the module-scope snapshot below.
 */
export function computeTempDirDefaults(tmpdir: string | undefined): string[] {
  const dirs: string[] = [];
  const push = (dir: string) => {
    dirs.push(dir);
    try {
      const real = Deno.realPathSync(dir);
      if (real !== dir) {
        dirs.push(real);
      }
    } catch {
      // dir may not exist; the literal entry alone is fine then
    }
  };
  push("/tmp");
  const osTmp = tmpdir?.replace(/\/+$/, "");
  if (osTmp && osTmp !== "/tmp" && osTmp !== "/private/tmp") {
    push(osTmp);
  }
  return dirs;
}

// SSH-591: snapshotted once at startup — $TMPDIR is attacker-influenced
// (exports persist across commands since SSH-580), so later env mutation
// must not widen the sandbox, and the per-validation hot path must not
// repeat realpath syscalls.
const TEMP_DIR_DEFAULTS: readonly string[] = computeTempDirDefaults(
  Deno.env.get("TMPDIR"),
);

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

  // Default read includes cwd, temp dirs, and optionally home directory
  // (read is less dangerous). Default write is ONLY the temp dirs -
  // projectDir must be explicitly enabled.
  const home = Deno.env.get("HOME");
  const defaultRead = [cwd, ...TEMP_DIR_DEFAULTS];
  // Include HOME in default read paths unless explicitly disabled (default: true)
  if (home && config.includeHomeInDefaultRead !== false) {
    defaultRead.push(home);
  }
  const defaultWrite = [...TEMP_DIR_DEFAULTS];
  const workspaceDir = config.workspaceDir ? resolveWorkspace(config.workspaceDir) : undefined;
  if (workspaceDir) {
    defaultRead.push(workspaceDir);
    defaultWrite.push(workspaceDir);
  }

  // Top-level roots get full read access, and write access unless blockProjectDirWrite is true
  // When blockProjectDirWrite is true, add projectDir to denyWrite to ensure it's blocked
  // even if a parent directory (like /tmp) is in the write list
  const denyWrite = [...(perms.denyWrite ?? [])];
  const workspaceRoots = getWorkspaceRoots(config);
  if (workspaceRoots.length > 0) {
    defaultRead.push(...workspaceRoots);
    if (!config.blockProjectDirWrite) {
      defaultWrite.push(...workspaceRoots);
    } else {
      // Add to denyWrite to block writes at Deno sandbox level
      denyWrite.push(...workspaceRoots);
    }
  }

  return {
    read: [...new Set([...defaultRead, ...(perms.read ?? [])])],
    denyRead: perms.denyRead ?? [],
    write: [...new Set([...defaultWrite, ...(perms.write ?? [])])],
    denyWrite,
    net: perms.net ?? [],
    run: perms.run ?? [],
    env: perms.env ?? [],
  };
}
