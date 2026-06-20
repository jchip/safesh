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
  ERROR_COMMAND_NOT_ALLOWED,
  ERROR_COMMAND_NOT_FOUND,
  ERROR_COMMANDS_BLOCKED,
  INIT_ERROR_MARKER,
} from "../core/constants.ts";
import { isPathWithin } from "../core/path-utils.ts";
import { type PendingCommand, readPendingCommand, writePendingCommand } from "../core/pending.ts";

/**
 * Config interface injected by preamble for permission checking.
 * Must stay in sync with PreambleConfig in src/runtime/preamble.ts.
 * Canonical permission logic lives in src/core/command_permission.ts.
 *
 * Note: This file uses its own path utils (getBasename, resolvePath) because
 * the sandbox can't import @std/path. The decision tree mirrors checkCommandPermission().
 */
export interface PreambleConfig {
  projectDir?: string;
  workspaceRoots?: string[];
  allowProjectCommands?: boolean;
  allowedCommands: string[];
  sessionAllowedCommands?: string[];
  cwd: string;
}

/** Symbol for internal config access */
const CONFIG_SYMBOL = Symbol.for("safesh.config");

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

function getWorkspaceRoots(config: PreambleConfig): string[] {
  return [
    ...new Set([
      ...(config.projectDir ? [config.projectDir] : []),
      ...(config.workspaceRoots ?? []),
    ]),
  ];
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
 * Read the live process cwd, returning undefined if it is unavailable (e.g. the
 * directory was removed). `$.cd()` updates this via Deno.chdir().
 */
function liveCwd(): string | undefined {
  try {
    return Deno.cwd();
  } catch {
    return undefined;
  }
}

/**
 * Candidate base directories for resolving a relative-path command (SSH-648).
 *
 * At runtime the live process cwd is authoritative — `$.cd()` calls
 * `Deno.chdir()`, and a spawned command (cwd unset) inherits it — so the live
 * cwd can diverge from the cwd captured at script start. We try the live cwd
 * first (it is where the command actually runs) and keep the static start cwd
 * as a fallback candidate, which makes the change strictly additive: when no
 * `$.cd()` happened the two are equal and behavior is unchanged.
 */
function candidateBaseCwds(startCwd: string): string[] {
  const live = liveCwd();
  return live && live !== startCwd ? [live, startCwd] : [startCwd];
}

/**
 * Resolve a relative command to the candidate cwd where it exists (for the
 * returned resolvedPath); falls back to the first candidate when it exists in
 * none, preserving the original behavior when there is a single candidate.
 */
async function resolveExistingPath(command: string, baseCwds: string[]): Promise<string> {
  for (const baseCwd of baseCwds) {
    const candidate = resolvePath(baseCwd, command);
    if (await checkCommandExists(candidate)) return candidate;
  }
  return resolvePath(baseCwds[0]!, command);
}

/**
 * Check permission for a single command using the decision tree.
 * Exported for testing; the runtime calls it via initCmds().
 */
export async function checkPermission(
  command: string,
  config: PreambleConfig,
): Promise<PermResult> {
  // Merge session-allowed commands into effective allowed list
  const allowedCommands = config.sessionAllowedCommands
    ? [...config.allowedCommands, ...config.sessionAllowedCommands]
    : config.allowedCommands;
  const { allowProjectCommands, cwd } = config;
  const workspaceRoots = getWorkspaceRoots(config);

  // Validate command is actually a string
  if (typeof command !== "string") {
    throw new Error(
      `checkPermission expected string, got ${typeof command}: ${JSON.stringify(command)}`,
    );
  }

  // Is command basic name only (no `/`)?
  if (!command.includes("/")) {
    if (isInAllowedList(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command };
  }

  // Has `/` - honor exact relative/absolute entries before resolving.
  if (isInAllowedList(command, allowedCommands)) {
    return { allowed: true, resolvedPath: command };
  }

  // SSH-648: relative commands resolve against the live cwd ($.cd → Deno.chdir)
  // first, then the start cwd. Workspace roots are config-relative, so they keep
  // resolving against the static start cwd.
  const baseCwds = candidateBaseCwds(cwd);

  // Check basename next
  const cmdBasename = getBasename(command);
  if (isInAllowedList(cmdBasename, allowedCommands)) {
    const resolvedPath = command.startsWith("/")
      ? command
      : await resolveExistingPath(command, baseCwds);
    return { allowed: true, resolvedPath };
  }

  // Full path (starts with `/`)? → allowed_check(verbatim)
  if (command.startsWith("/")) {
    if (isInAllowedList(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    if (allowProjectCommands) {
      const matchingRoot = workspaceRoots.find((root) => {
        const absoluteRoot = root.startsWith("/") ? root : resolvePath(cwd, root);
        return isPathWithin(command, absoluteRoot);
      });
      if (matchingRoot) {
        if (await checkCommandExists(command)) {
          return { allowed: true, resolvedPath: command };
        }
        return { allowed: false, error: ERROR_COMMAND_NOT_FOUND, command };
      }
    }
    return { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command };
  }

  // Relative path - check each candidate cwd (live first), allowing if any
  // permits. The live cwd reflects $.cd and matches where the command runs.
  let foundNotAllowed: PermResult | undefined;
  for (const baseCwd of baseCwds) {
    const cwdPath = resolvePath(baseCwd, command);
    if (!(await checkCommandExists(cwdPath))) continue;
    // Check if allowProjectCommands is enabled and path is within any configured root
    if (allowProjectCommands) {
      // cwdPath is already absolute (resolved from baseCwd)
      const matchingRoot = workspaceRoots.find((root) => {
        const absoluteRoot = root.startsWith("/") ? root : resolvePath(cwd, root);
        return isPathWithin(cwdPath, absoluteRoot);
      });
      if (matchingRoot) {
        return { allowed: true, resolvedPath: cwdPath };
      }
    }
    if (isInAllowedList(cwdPath, allowedCommands)) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    // Found but not permitted here; remember the first (live-cwd) hit and keep
    // trying the remaining candidates.
    if (!foundNotAllowed) {
      foundNotAllowed = { allowed: false, error: ERROR_COMMAND_NOT_ALLOWED, command: cwdPath };
    }
  }

  // Check configured roots
  for (const root of workspaceRoots) {
    const projectPath = resolvePath(root, command);
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

  // Found in a candidate cwd but not permitted beats a bare not-found.
  if (foundNotAllowed) return foundNotAllowed;

  // Not found
  return { allowed: false, error: ERROR_COMMAND_NOT_FOUND, command };
}

/** Symbol for storing command name on CommandFn */
export const CMD_NAME_SYMBOL = Symbol.for("safesh.cmdName");

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
        const pending: PendingCommand = existing ? { ...existing, commands: notAllowed } : {
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
