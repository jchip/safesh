/**
 * Command Permission Validation
 *
 * Validates command permissions using a decision tree.
 * Used by init() to check permissions upfront before execution.
 *
 * @module
 */

import { basename, resolve, join } from "@std/path";
import type { SafeShellConfig } from "./types.ts";

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
  error: "COMMAND_NOT_ALLOWED";
  command: string;
}

/**
 * Result of permission check - relative path command not found
 */
export interface PermissionNotFound {
  allowed: false;
  error: "COMMAND_NOT_FOUND";
  command: string;
}

export type PermissionResult =
  | PermissionAllowed
  | PermissionNotAllowed
  | PermissionNotFound;

/**
 * Check if a command exists at the given path
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
 */
export async function checkCommandPermission(
  command: string,
  config: SafeShellConfig,
  cwd: string,
): Promise<PermissionResult> {
  const allowedCommands = getAllowedCommands(config);
  const projectDir = config.projectDir;
  const allowProjectCommands = config.allowProjectCommands ?? false;

  // Is command basic name only (no `/`)?
  if (!command.includes("/")) {
    // Yes → allowed_check(basename)
    if (isCommandAllowed(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: "COMMAND_NOT_ALLOWED", command };
  }

  // No (has `/`)
  const cmdBasename = basename(command);

  // basename in allowed? → Yes → ALLOWED
  if (isCommandAllowed(cmdBasename, allowedCommands)) {
    // Resolve the path for the result
    const resolvedPath = command.startsWith("/")
      ? command
      : resolve(cwd, command);
    return { allowed: true, resolvedPath };
  }

  // Full path (starts with `/`)? → Yes → allowed_check(verbatim)
  if (command.startsWith("/")) {
    if (isCommandAllowed(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: "COMMAND_NOT_ALLOWED", command };
  }

  // No (relative path)
  // Found in CWD?
  const cwdPath = resolve(cwd, command);
  if (await commandExists(cwdPath)) {
    // If allowProjectCommands is enabled and resolved path is under projectDir, auto-allow
    if (allowProjectCommands && projectDir && cwdPath.startsWith(projectDir + "/")) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    // Yes → allowed_check(resolved)
    if (isCommandAllowed(cwdPath, allowedCommands)) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    return { allowed: false, error: "COMMAND_NOT_ALLOWED", command: cwdPath };
  }

  // Found in projectDir?
  if (projectDir) {
    const projectPath = join(projectDir, command);
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
        error: "COMMAND_NOT_ALLOWED",
        command: projectPath,
      };
    }
  }

  // Not found → COMMAND_NOT_FOUND error
  return { allowed: false, error: "COMMAND_NOT_FOUND", command };
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
 * Check permissions for multiple commands
 * Returns results for ALL commands, not just the first failure
 */
export async function checkMultipleCommands(
  commands: Record<string, string>,
  config: SafeShellConfig,
  cwd: string,
): Promise<MultiCommandResult> {
  const results: Record<string, PermissionResult> = {};
  const notAllowed: string[] = [];
  const notFound: string[] = [];

  // Check all commands in parallel
  const entries = Object.entries(commands);
  const checks = await Promise.all(
    entries.map(async ([name, path]) => {
      const result = await checkCommandPermission(path, config, cwd);
      return { name, path, result };
    }),
  );

  for (const { name, result } of checks) {
    results[name] = result;

    if (!result.allowed) {
      if (result.error === "COMMAND_NOT_ALLOWED") {
        notAllowed.push(result.command);
      } else if (result.error === "COMMAND_NOT_FOUND") {
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
