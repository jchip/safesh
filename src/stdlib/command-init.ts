/**
 * Command Initialization and Registration
 *
 * Provides the initCmds function for batch permission checking
 * and command registration.
 *
 * @module
 */

import { Command, type CommandOptions, type CommandResult } from "./command.ts";
import {
  INIT_ERROR_MARKER,
  ERROR_COMMAND_NOT_ALLOWED,
  ERROR_COMMAND_NOT_FOUND,
  ERROR_COMMANDS_BLOCKED,
} from "../core/constants.ts";
import { isPathWithin } from "../core/path-utils.ts";
import { readPendingCommand, writePendingCommand, type PendingCommand } from "../core/pending.ts";

/**
 * Config interface injected by preamble for permission checking.
 * Must stay in sync with PreambleConfig in src/runtime/preamble.ts.
 * Canonical permission logic lives in src/core/command_permission.ts.
 *
 * Note: This file uses its own path utils (getBasename, resolvePath) because
 * the sandbox can't import @std/path. The decision tree mirrors checkCommandPermission().
 */
interface PreambleConfig {
  projectDir?: string;
  allowProjectCommands?: boolean;
  allowedCommands: string[];
  sessionAllowedCommands?: string[];
  cwd: string;
}

/** Symbol for internal config access */
const CONFIG_SYMBOL = Symbol.for('safesh.config');

/** Get the config from $ namespace (where preamble injects it) */
function getConfig(): PreambleConfig | undefined {
  const $ = (globalThis as { $?: Record<symbol, unknown> }).$;
  return $?.[CONFIG_SYMBOL] as PreambleConfig | undefined;
}

/**
 * Check if a command exists at the given path
 */
async function checkCommandExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Check if a command is in the allowed list
 */
function isInAllowedList(command: string, allowedCommands: string[]): boolean {
  return allowedCommands.includes(command);
}

/**
 * Get the basename of a path
 */
function getBasename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/**
 * Resolve a path relative to a directory, normalizing . and .. segments
 */
function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return normalizePath(relative);
  const basePath = base.endsWith("/") ? base : base + "/";
  return normalizePath(basePath + relative);
}

/**
 * Normalize path by resolving . and .. segments
 */
function normalizePath(path: string): string {
  const parts = path.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== "." && part !== "") {
      resolved.push(part);
    }
  }
  return (path.startsWith("/") ? "/" : "") + resolved.join("/");
}

/**
 * Permission check result
 */
type PermResult =
  | { allowed: true; resolvedPath: string }
  | { allowed: false; error: typeof ERROR_COMMAND_NOT_ALLOWED; command: string }
  | { allowed: false; error: typeof ERROR_COMMAND_NOT_FOUND; command: string };

/**
 * Check permission for a single command using the decision tree
 */
async function checkPermission(
  command: string,
  config: PreambleConfig,
): Promise<PermResult> {
  // Merge session-allowed commands into effective allowed list
  const allowedCommands = config.sessionAllowedCommands
    ? [...config.allowedCommands, ...config.sessionAllowedCommands]
    : config.allowedCommands;
  const { projectDir, allowProjectCommands, cwd } = config;

  // Validate command is actually a string
  if (typeof command !== "string") {
    throw new Error(`checkPermission expected string, got ${typeof command}: ${JSON.stringify(command)}`);
  }

  // Is command basic name only (no `/`)?
  if (!command.includes("/")) {
    if (isInAllowedList(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command };
  }

  // Has `/` - check basename first
  const cmdBasename = getBasename(command);
  if (isInAllowedList(cmdBasename, allowedCommands)) {
    const resolvedPath = command.startsWith("/")
      ? command
      : resolvePath(cwd, command);
    return { allowed: true, resolvedPath };
  }

  // Full path (starts with `/`)? → allowed_check(verbatim)
  if (command.startsWith("/")) {
    if (isInAllowedList(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command };
  }

  // Relative path - check CWD first
  const cwdPath = resolvePath(cwd, command);
  if (await checkCommandExists(cwdPath)) {
    // Check if allowProjectCommands is enabled and path is within project
    if (allowProjectCommands && projectDir) {
      // cwdPath is already absolute (resolved from cwd)
      // Check if it's within the project directory
      const absoluteProjectDir = projectDir.startsWith("/") ? projectDir : resolvePath(cwd, projectDir);
      if (isPathWithin(cwdPath, absoluteProjectDir)) {
        return { allowed: true, resolvedPath: cwdPath };
      }
    }
    if (isInAllowedList(cwdPath, allowedCommands)) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command: cwdPath };
  }

  // Check projectDir
  if (projectDir) {
    const projectPath = resolvePath(projectDir, command);
    if (await checkCommandExists(projectPath)) {
      // config allows project cmds? → ALLOWED
      if (allowProjectCommands) {
        return { allowed: true, resolvedPath: projectPath };
      }
      if (isInAllowedList(projectPath, allowedCommands)) {
        return { allowed: true, resolvedPath: projectPath };
      }
      return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command: projectPath };
    }
  }

  // Not found
  return { allowed: false, error: ERROR_COMMAND_NOT_FOUND, command };
}

/** Symbol for storing command name on CommandFn */
export const CMD_NAME_SYMBOL = Symbol.for('safesh.cmdName');

/**
 * Command callable - call with args to get a Command object
 * Has [CMD_NAME_SYMBOL] property with the resolved command path
 *
 * Returns Command (thenable) - can await directly or use .stdout()/.pipe() for streaming
 */
export interface CommandFn {
  (...args: string[]): Command;
  [CMD_NAME_SYMBOL]?: string;
}

/**
 * Initialize commands for convenient access
 *
 * Validates permissions for ALL commands upfront. If any commands are blocked
 * or not found, throws an error with details about ALL failures (not just first).
 *
 * @param commands - Array of command paths
 * @param options - Optional command options (cwd, env, etc.)
 * @returns Array of callable command functions (same order as input)
 *
 * @example
 * ```ts
 * const [cargo, build] = await initCmds(["cargo", "./scripts/build.sh"]);
 *
 * await cargo("build", "--release");
 * await build("--verbose");
 * ```
 */
export async function initCmds<T extends readonly string[]>(
  commands: T,
  options?: CommandOptions,
): Promise<{ [K in keyof T]: CommandFn }> {
  // Get config from globalThis (injected by preamble)
  const config = getConfig();

  if (config) {
    // Check permissions for all commands upfront
    const notAllowed: string[] = [];
    const notFound: string[] = [];

    const checks = await Promise.all(
      commands.map(async (path) => {
        const result = await checkPermission(path, config);
        return { path, result };
      }),
    );

    const resolvedPaths: string[] = [];
    for (const { path, result: permResult } of checks) {
      if (permResult.allowed) {
        resolvedPaths.push(permResult.resolvedPath);
      } else if (permResult.error === ERROR_COMMAND_NOT_ALLOWED) {
        notAllowed.push(permResult.command);
        resolvedPaths.push(path); // placeholder
      } else if (permResult.error === ERROR_COMMAND_NOT_FOUND) {
        notFound.push(permResult.command);
        resolvedPaths.push(path); // placeholder
      }
    }

    // If any errors, check if we're running under a script ID (for retry flow)
    if (notAllowed.length > 0 || notFound.length > 0) {
      // Check if we're running under a script ID (TypeScript via prehook)
      const scriptId = Deno.env.get("SAFESH_SCRIPT_ID");
      if (scriptId) {
        // Update or create pending command file with blocked commands
        const existing = readPendingCommand(scriptId);
        const pending: PendingCommand = existing
          ? { ...existing, commands: notAllowed }
          : {
              id: scriptId,
              scriptHash: Deno.env.get("SAFESH_SCRIPT_HASH") || "",
              commands: notAllowed,
              cwd: Deno.cwd(),
              createdAt: new Date().toISOString(),
            };

        try {
          writePendingCommand(pending);
        } catch (writeError) {
          console.error(`Warning: Could not create pending file: ${writeError}`);
        }

        // Output deny-with-retry message to stderr so user sees it
        const cmdList = notAllowed.join(", ");
        const message = `[SAFESH] BLOCKED: ${cmdList}

WAIT for user choice (1-4):
1. Allow once
2. Always allow
3. Allow for session
4. Deny

DO NOT SHOW OR REPEAT OPTIONS. AFTER USER RESPONDS: desh retry --id=${scriptId} --choice=<user's choice>`;

        console.error(message);
        Deno.exit(1);
      }

      // No script ID - normal error handling
      const errors: string[] = [];
      if (notAllowed.length > 0) {
        errors.push(`Commands not allowed: ${notAllowed.join(", ")}`);
      }
      if (notFound.length > 0) {
        errors.push(`Commands not found: ${notFound.join(", ")}`);
      }
      throw new Error(errors.join(". "));
    }

    // All permissions passed - create callable command functions
    return resolvedPaths.map((resolvedPath) => {
      const fn: CommandFn = (...args: string[]) => new Command(resolvedPath, args, options);
      fn[CMD_NAME_SYMBOL] = resolvedPath;
      return fn;
    }) as { [K in keyof T]: CommandFn };
  } else {
    // No config available (file execution mode) - create callables without permission check
    // Permissions will be enforced by Deno sandbox at execution time
    return commands.map((path) => {
      const fn: CommandFn = (...args: string[]) => new Command(path, args, options);
      fn[CMD_NAME_SYMBOL] = path;
      return fn;
    }) as { [K in keyof T]: CommandFn };
  }
}
