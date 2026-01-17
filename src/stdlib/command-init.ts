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
import { getPendingFilePath } from "../core/temp.ts";

/**
 * Config interface injected by preamble for permission checking
 */
interface PreambleConfig {
  projectDir?: string;
  allowProjectCommands?: boolean;
  allowedCommands: string[];
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
 * Resolve a path relative to a directory
 */
function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative;
  // Simple path join
  const basePath = base.endsWith("/") ? base : base + "/";
  return basePath + relative;
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
  const { allowedCommands, projectDir, allowProjectCommands, cwd } = config;

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
      const errorEvent = {
        type: ERROR_COMMANDS_BLOCKED,
        notAllowed,
        notFound,
      };
      console.error(`${INIT_ERROR_MARKER}${JSON.stringify(errorEvent)}`);

      // Check if we're running under a script ID (TypeScript via prehook)
      const scriptId = Deno.env.get("SAFESH_SCRIPT_ID");
      if (scriptId) {
        // Update pending command file with blocked commands
        const pendingFile = getPendingFilePath(scriptId);
        try {
          const pendingContent = Deno.readTextFileSync(pendingFile);
          const pending = JSON.parse(pendingContent);
          pending.commands = notAllowed; // Update with actual blocked commands
          Deno.writeTextFileSync(pendingFile, JSON.stringify(pending, null, 2));
        } catch (error) {
          console.error(`Warning: Could not update pending file: ${error}`);
        }

        // Output deny-with-retry message (same format as bash prehook)
        const cmdList = notAllowed.join(", ");
        const message = `[SAFESH] BLOCKED: ${cmdList}

WAIT for user choice (1-4):
1. Allow once
2. Always allow
3. Allow for session
4. Deny

DO NOT SHOW OR REPEAT OPTIONS. AFTER USER RESPONDS: desh retry --id=${scriptId} --choice=<user's choice>`;

        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: message,
          },
        };
        console.log(JSON.stringify(output));
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
