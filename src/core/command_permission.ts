/**
 * Command Permission Validation
 *
 * Validates command permissions using a decision tree.
 * Used by init() to check permissions upfront before execution.
 *
 * @module
 */

import { basename, isAbsolute, join, resolve } from "@std/path";
import type { SafeShellConfig } from "./types.ts";
import { ERROR_COMMAND_NOT_ALLOWED, ERROR_COMMAND_NOT_FOUND } from "./constants.ts";
import { isPathWithin } from "./path-utils.ts";
import { getSessionAllowedCommands } from "./session.ts";
import { getWorkspaceRoots } from "./permissions.ts";

/**
 * Result of permission check - allowed with resolved path
 */
export interface PermissionAllowed {
  allowed: true;
  resolvedPath: string;
}

/**
 * Result of permission check - command not in allowed list
 */
export interface PermissionNotAllowed {
  allowed: false;
  error: typeof ERROR_COMMAND_NOT_ALLOWED;
  command: string;
}

/**
 * Result of permission check - relative path command not found
 */
export interface PermissionNotFound {
  allowed: false;
  error: typeof ERROR_COMMAND_NOT_FOUND;
  command: string;
}

export type PermissionResult =
  | PermissionAllowed
  | PermissionNotAllowed
  | PermissionNotFound;

/**
 * Check if a command exists at the given path
 *
 * Note: Similar existence checking logic can be found in:
 * - stdlib/shelljs/test.ts - File/directory existence tests
 * - core/io-utils.ts - File existence checks via Deno.stat
 */
async function commandExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    // Must be a file (or symlink to file) and executable
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Get the allowed commands list from config
 * Merges permissions.run and external command keys
 */
export function getAllowedCommands(config: SafeShellConfig): Set<string> {
  const allowed = new Set<string>();

  // Add from permissions.run
  if (config.permissions?.run) {
    for (const cmd of config.permissions.run) {
      allowed.add(cmd);
    }
  }

  // Add from external command configs
  if (config.external) {
    for (const cmd of Object.keys(config.external)) {
      allowed.add(cmd);
    }
  }

  return allowed;
}

/**
 * Check if a command is in the allowed list
 */
export function isCommandAllowed(
  command: string,
  allowedCommands: Set<string>,
): boolean {
  return allowedCommands.has(command);
}

/**
 * Check command permission using the decision tree
 *
 * Decision Tree:
 * ```
 * Is command basic name only (no `/`)?
 * ├─ Yes → allowed_check(basename)
 * └─ No (has `/`)
 *    ├─ command in allowed? → Yes → ALLOWED
 *    ├─ basename in allowed? → Yes → ALLOWED
 *    └─ No
 *       ├─ Full path (starts with `/`)? → Yes → allowed_check(verbatim)
 *       └─ No (relative path)
 *          ├─ Found in CWD? → Yes → allowed_check(resolved)
 *          └─ No
 *             └─ Found in projectDir?
 *                ├─ Yes → config allows project cmds? → Yes → ALLOWED
 *                │                                   → No → allowed_check(resolved)
 *                └─ No → COMMAND_NOT_FOUND error
 * ```
 *
 * Note: Similar path resolution and validation patterns:
 * - core/path-utils.ts - isPathWithin() for checking path containment
 * - core/permissions.ts - Path validation with expand/resolve logic
 * - stdlib/fs.ts - File operation path validation
 */
export async function checkCommandPermission(
  command: string,
  config: SafeShellConfig,
  cwd: string,
  sessionCommands?: Set<string>,
): Promise<PermissionResult> {
  const allowedCommands = getAllowedCommands(config);

  // Merge session commands into effective allowed set
  if (sessionCommands) {
    for (const cmd of sessionCommands) {
      allowedCommands.add(cmd);
    }
  }

  const workspaceRoots = getWorkspaceRoots(config);
  // Default allowProjectCommands to true when running under Claude Code session
  const allowProjectCommands = config.allowProjectCommands ??
    (Deno.env.get("CLAUDE_SESSION_ID") !== undefined ? true : false);

  // Is command basic name only (no `/`)?
  if (!command.includes("/")) {
    // Yes → allowed_check(basename)
    if (isCommandAllowed(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command };
  }

  // No (has `/`)
  if (isCommandAllowed(command, allowedCommands)) {
    return { allowed: true, resolvedPath: command };
  }

  const cmdBasename = basename(command);

  // basename in allowed? → Yes → ALLOWED
  if (isCommandAllowed(cmdBasename, allowedCommands)) {
    // Resolve the path for the result
    const resolvedPath = command.startsWith("/") ? command : resolve(cwd, command);
    return { allowed: true, resolvedPath };
  }

  // Full path (starts with `/`)? → Yes → allowed_check(verbatim)
  if (command.startsWith("/")) {
    if (isCommandAllowed(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    if (allowProjectCommands && workspaceRoots.some((root) => isPathWithin(command, root))) {
      if (await commandExists(command)) {
        return { allowed: true, resolvedPath: command };
      }
      return { allowed: false, error: ERROR_COMMAND_NOT_FOUND, command };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command };
  }

  // No (relative path)
  // Found in CWD?
  const cwdPath = resolve(cwd, command);
  if (await commandExists(cwdPath)) {
    // If allowProjectCommands is enabled and resolved path is under a configured root, auto-allow
    if (allowProjectCommands && workspaceRoots.some((root) => isPathWithin(cwdPath, root))) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    // Yes → allowed_check(resolved)
    if (isCommandAllowed(cwdPath, allowedCommands)) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command: cwdPath };
  }

  // Found in configured roots?
  for (const root of workspaceRoots) {
    const projectPath = join(root, command);
    if (await commandExists(projectPath)) {
      // config allows project cmds? → Yes → ALLOWED
      if (allowProjectCommands) {
        return { allowed: true, resolvedPath: projectPath };
      }
      // No → allowed_check(resolved)
      if (isCommandAllowed(projectPath, allowedCommands)) {
        return { allowed: true, resolvedPath: projectPath };
      }
      return {
        allowed: false,
        error: ERROR_COMMAND_NOT_ALLOWED,
        command: projectPath,
      };
    }
  }

  // Not found → COMMAND_NOT_FOUND error
  return { allowed: false, error: ERROR_COMMAND_NOT_FOUND, command };
}

/**
 * Effective working directories per relative-path command, keyed by command
 * name (SSH-647). Each value is a set of cwd descriptors: the analyzer cwd
 * path (absolute, relative to the base cwd, or `""` for the base) when
 * statically known, or `null` when unknown. Produced by the passthrough
 * analyzer's static `cd` tracking and consumed by {@link candidateCwds}.
 */
export type CommandCwdMap = Map<string, Set<string | null>>;

/**
 * Compute the working directories a command should be permission-checked in
 * (SSH-647).
 *
 * A bash command may `cd` into another directory before invoking a relative
 * path (`cd /ws/pkg && ./gradlew`). The prehook runs before execution, so the
 * canonical check resolved such commands against the base cwd and missed them.
 * Here we return the base cwd plus every statically-known effective cwd the
 * command runs in, and the caller allows the command if it passes in ANY of
 * them. Because the base cwd is always included, this never blocks a command
 * that the base-cwd-only check would have allowed.
 *
 * Bare names (PATH-resolved) and absolute paths are cwd-independent, so they
 * collapse to the base cwd.
 */
export function candidateCwds(
  command: string,
  baseCwd: string,
  descriptors: Set<string | null> | undefined,
): string[] {
  if (!descriptors || isAbsolute(command) || !command.includes("/")) {
    return [baseCwd];
  }
  const cwds = new Set<string>([baseCwd]);
  for (const descriptor of descriptors) {
    // `null` (unknown) and `""` (base) both fall back to the base cwd; an
    // absolute descriptor wins over baseCwd inside resolve(), a relative one
    // is resolved against it.
    cwds.add(descriptor === null ? baseCwd : resolve(baseCwd, descriptor));
  }
  return [...cwds];
}

/**
 * Check a command across multiple candidate working directories (SSH-647),
 * returning the first allowing result, or the last denial if none allow.
 */
export async function checkCommandAllowedInAnyCwd(
  command: string,
  config: SafeShellConfig,
  cwds: string[],
  sessionCommands?: Set<string>,
): Promise<PermissionResult> {
  let last: PermissionResult = {
    allowed: false,
    error: ERROR_COMMAND_NOT_FOUND,
    command,
  };
  for (const cwd of cwds) {
    const result = await checkCommandPermission(command, config, cwd, sessionCommands);
    if (result.allowed) return result;
    last = result;
  }
  return last;
}

/**
 * Result of checking multiple commands
 */
export interface MultiCommandResult {
  /** True if all commands are allowed */
  allAllowed: boolean;
  /** Results for each command by name */
  results: Record<string, PermissionResult>;
  /** Commands that are not allowed */
  notAllowed: string[];
  /** Commands that were not found */
  notFound: string[];
}

/**
 * Convenience wrapper that auto-loads session commands and checks permission.
 * Use this when you want session commands included without managing them manually.
 */
export async function checkCommandPermissionWithSession(
  command: string,
  config: SafeShellConfig,
  cwd: string,
): Promise<PermissionResult> {
  const sessionCmds = getSessionAllowedCommands(config.projectDir);
  return checkCommandPermission(command, config, cwd, sessionCmds);
}

/**
 * Check permissions for multiple commands
 * Returns results for ALL commands, not just the first failure
 */
export async function checkMultipleCommands(
  commands: Record<string, string>,
  config: SafeShellConfig,
  cwd: string,
  sessionCommands?: Set<string>,
): Promise<MultiCommandResult> {
  const results: Record<string, PermissionResult> = {};
  const notAllowed: string[] = [];
  const notFound: string[] = [];

  // Check all commands in parallel
  const entries = Object.entries(commands);
  const checks = await Promise.all(
    entries.map(async ([name, path]) => {
      const result = await checkCommandPermission(path, config, cwd, sessionCommands);
      return { name, path, result };
    }),
  );

  for (const { name, result } of checks) {
    results[name] = result;

    if (!result.allowed) {
      if (result.error === ERROR_COMMAND_NOT_ALLOWED) {
        notAllowed.push(result.command);
      } else if (result.error === ERROR_COMMAND_NOT_FOUND) {
        notFound.push(result.command);
      }
    }
  }

  return {
    allAllowed: notAllowed.length === 0 && notFound.length === 0,
    results,
    notAllowed,
    notFound,
  };
}
