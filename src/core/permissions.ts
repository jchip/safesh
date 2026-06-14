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
  const userPerms = config.permissions ?? {};

  // SSH-588: user-written deny lists win over every allow source, including
  // workspace roots and the temp-dir defaults. Deno's --deny-* flags only
  // protect subprocesses; this check is the only gate for in-process callers
  // and the prehook's passthrough decision.
  const userDeny = operation === "write"
    ? (userPerms.denyWrite ?? [])
    : (userPerms.denyRead ?? []);
  if (userDeny.length > 0 && isPathAllowed(realPath, userDeny, cwd, workspace)) {
    throw pathDenied(requestedPath, realPath, operation);
  }

  const workspaceRoots = getWorkspaceRoots(config);

  // SSH-592: blockProjectDirWrite injects the workspace roots as a deny, but
  // explicitly configured write paths punch through it; everything else in a
  // root is denied here, before a parent dir (like /tmp) in the default
  // write list could allow it.
  if (operation === "write" && config.blockProjectDirWrite) {
    const explicitWrite = userPerms.write ?? [];
    if (
      explicitWrite.length > 0 &&
      isPathAllowed(realPath, explicitWrite, cwd, workspace)
    ) {
      return realPath;
    }
    if (workspaceRoots.length > 0 && isWithinWorkspaceRoots(realPath, config)) {
      throw pathDenied(requestedPath, realPath, operation);
    }
  }

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
 * Compute the $PATH bin-dir entries for the default read list.
 *
 * SSH-638: `$.which` / `$.fs.exists` / `test -x` resolve commands by stat-ing
 * each `PATH/<cmd>` candidate, but the read sandbox excludes system bin dirs
 * (/usr/bin, /sbin, /opt/homebrew/bin, …), so those stats throw and the
 * command reads as "not found". Adding the PATH dirs to default read fixes it.
 *
 * Pure string processing (no stat/realpath) so the parent (building Deno
 * flags) and the in-sandbox validatePath compute identical sets — the
 * executor's getRealPathBoth handles literal/canonical expansion downstream.
 * Only absolute entries are kept: relative PATH entries (e.g. "." or "") would
 * let sandbox reads follow cwd and are already covered by the cwd default.
 *
 * Exported for tests; runtime callers use the module-scope snapshot below.
 */
export function computePathDirDefaults(pathEnv: string | undefined): string[] {
  if (!pathEnv) return [];
  const sep = Deno.build.os === "windows" ? ";" : ":";
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const raw of pathEnv.split(sep)) {
    const dir = raw.replace(/[/\\]+$/, ""); // strip trailing separators
    if (!dir || !isAbsolute(dir) || seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs;
}

// SSH-638: snapshotted once at startup, mirroring TEMP_DIR_DEFAULTS — $PATH is
// attacker-influenced (exports persist across commands since SSH-580), so later
// env mutation must not widen the read sandbox.
const PATH_DIR_DEFAULTS: readonly string[] = computePathDirDefaults(
  Deno.env.get("PATH"),
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
  // SSH-638: include $PATH bin dirs so command resolution (which/exists/test -x)
  // can stat executables — these are less sensitive than HOME (added above).
  if (config.includePathDirsInDefaultRead !== false) {
    defaultRead.push(...PATH_DIR_DEFAULTS);
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
      // Add to denyWrite to block writes at Deno sandbox level.
      // SSH-592: Deno deny flags beat allow flags regardless of specificity,
      // so a root containing an explicitly configured write path stays out
      // of the injected deny — that root never enters the write list, so
      // writes outside the explicit allows are still rejected by validatePath.
      const explicitWrite = expandPaths(
        perms.write ?? [],
        cwd,
        getWorkspaceVariable(config),
      );
      denyWrite.push(
        ...workspaceRoots.filter((root) =>
          !explicitWrite.some((p) => isPathWithin(resolve(cwd, p), resolve(root)))
        ),
      );
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
