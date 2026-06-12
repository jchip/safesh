#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/**
 * Bash Pre-hook for Claude Code
 *
 * This hook intercepts bash commands, transpiles them to SafeShell TypeScript,
 * and executes them using desh. This allows Claude Code to execute bash commands
 * through SafeShell's sandboxed runtime.
 *
 * Usage (as pre-hook):
 *   - Claude Code passes bash command as stdin or as arguments
 *   - Hook transpiles bash -> TypeScript using transpiler2
 *   - Hook executes TypeScript using desh via executeCodeStreaming
 *   - Returns output in expected format with proper exit codes
 *
 * Environment Variables:
 *   BASH_PREHOOK_MODE: "streaming" (default) or "buffered"
 *   BASH_PREHOOK_DEBUG: Set to "1" to enable debug logging to stderr
 *   BASH_PREHOOK_CWD: Override working directory (default: inherit from process)
 *
 * Example standalone usage:
 *   echo "ls -la | grep .ts" | ./hooks/bash-prehook.ts
 *   ./hooks/bash-prehook.ts "echo hello && pwd"
 */

import { parse, transpile } from "../src/bash/mod.ts";
import type * as AST from "../src/bash/ast.ts";
import { loadConfig, mergeConfigs } from "../src/core/config.ts";
import { checkCommandPermission } from "../src/core/command_permission.ts";
import { executeCode, executeCodeStreaming } from "../src/runtime/executor.ts";
import { SafeShellError } from "../src/core/errors.ts";
import {
  generateTempId,
  getErrorLogPath,
  getPendingDir,
  getPendingFilePath,
  getScriptFilePath,
  getScriptsDir,
  getSessionFilePath,
  getStateTrailerPath,
  getTempRoot,
} from "../src/core/temp.ts";
import type { PendingCommand, SafeShellConfig } from "../src/core/types.ts";
// New unified core modules (DRY refactoring)
import { findProjectRoot, PROJECT_MARKERS } from "../src/core/project-root.ts";
import { generatePendingId, writePendingCommand, writePendingPath } from "../src/core/pending.ts";
import { getSessionAllowedCommands } from "../src/core/session.ts";
import { generateInlineErrorHandler, logExecutionError } from "../src/core/error-handlers.ts";
import { readStdinFully } from "../src/core/io-utils.ts";
import { detectHybridCommand, detectTypeScript, SAFESH_SIGNATURE } from "../src/hooks/detection.ts";
import {
  analyzeForPassthrough,
  type PassthroughAnalysis,
} from "../src/hooks/passthrough-analyzer.ts";
import { validatePath } from "../src/core/permissions.ts";
import { expandGlob } from "@std/fs";

// =============================================================================
// Configuration
// =============================================================================

const DEBUG = Deno.env.get("BASH_PREHOOK_DEBUG") === "1";
const MODE = Deno.env.get("BASH_PREHOOK_MODE") || "streaming";
const OVERRIDE_CWD = Deno.env.get("BASH_PREHOOK_CWD");
// Path to desh executable - derived dynamically from this file's location
const DESH_CMD = new URL("../src/cli/desh.ts", import.meta.url).pathname;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Log debug message to stderr (only if DEBUG enabled)
 */
function debug(message: string): void {
  if (DEBUG) {
    console.error(`[bash-prehook] ${message}`);
    try {
      Deno.writeTextFileSync(
        "/tmp/gemini_hook_debug.log",
        `[${new Date().toISOString()}] ${message}\n`,
        { append: true },
      );
    } catch {}
  }
}

/**
 * Transpiler cache version. Bump this whenever the transpiler or preamble
 * output changes to invalidate cached scripts.
 */
const TRANSPILER_VERSION = 5;

/**
 * Generate SHA-256 hash for content-based script caching
 * Returns the first 16 chars of the URL-safe Base64 encoded SHA-256 hash.
 * Includes TRANSPILER_VERSION so cache invalidates when transpiler changes.
 */
async function hashContent(content: string): Promise<string> {
  content = `v${TRANSPILER_VERSION}:${content}`;
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // Convert 32-byte buffer to binary string safely
  const binary = String.fromCharCode(...new Uint8Array(hashBuffer));

  // Convert to Base64 and make URL-safe (replace +/ with -_ and remove padding)
  const base64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return base64.slice(0, 16);
}

/**
 * Clean up old pending files from the pending directory
 *
 * Deletes pending-*.json and pending-path-*.json files older than 30 minutes
 * This runs on every bash-prehook invocation to prevent accumulation of stale pending files
 */
function cleanupOldPendingFiles(): void {
  try {
    const pendingDir = getPendingDir();

    // Read all files in pending directory
    const entries = [...Deno.readDirSync(pendingDir)];
    const files = entries.filter((e) => e.isFile && e.name.endsWith(".json"));

    debug(`Pending file count: ${files.length}`);

    // Delete files older than 30 minutes
    const now = Date.now();
    const thirtyMinutesMs = 30 * 60 * 1000; // 30 minutes in milliseconds
    let deletedCount = 0;

    for (const file of files) {
      try {
        const filePath = `${pendingDir}/${file.name}`;
        const stat = Deno.statSync(filePath);
        const age = now - stat.mtime!.getTime();

        // Delete if older than 30 minutes
        if (age > thirtyMinutesMs) {
          Deno.removeSync(filePath);
          deletedCount++;
          debug(`Deleted old pending file: ${file.name} (age: ${Math.round(age / 1000 / 60)}m)`);
        }
      } catch (error) {
        // Ignore errors for individual files
        debug(`Failed to delete ${file.name}: ${error}`);
      }
    }

    if (deletedCount > 0) {
      debug(`Pending cleanup complete: deleted ${deletedCount} files`);
    }
  } catch (error) {
    // Cleanup errors shouldn't block execution
    debug(`Pending cleanup failed: ${error}`);
  }
}

/**
 * Clean up old transpiled script files and pending files if count exceeds threshold
 *
 * When script file count exceeds 100, delete any files older than 24 hours
 * Also cleans up corresponding pending-*.json files
 * This runs proactively to prevent unlimited growth of temp files
 */
function cleanupOldScripts(): void {
  try {
    const scriptsDir = getScriptsDir();
    const pendingDir = getPendingDir();

    // Read all files in scripts directory
    const entries = [...Deno.readDirSync(scriptsDir)];
    const files = entries.filter((e) => e.isFile && e.name.endsWith(".ts"));

    debug(`Script file count: ${files.length}`);

    // Only cleanup if we exceed 100 files
    if (files.length <= 100) {
      return;
    }

    debug(`Exceeded 100 files (${files.length}), cleaning up files older than 24 hours`);

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    let deletedScripts = 0;
    let deletedPending = 0;

    for (const file of files) {
      try {
        const filePath = `${scriptsDir}/${file.name}`;
        const stat = Deno.statSync(filePath);
        const age = now - stat.mtime!.getTime();

        // Delete if older than 24 hours
        if (age > oneDayMs) {
          Deno.removeSync(filePath);
          deletedScripts++;
          debug(`Deleted old script: ${file.name} (age: ${Math.round(age / 1000 / 60 / 60)}h)`);

          // Also try to delete corresponding pending file
          // Extract ID from patterns that have pending files (bash-prehook scripts):
          // - file_<id>.ts (legacy timestamp-based)
          // - script-<hash>.ts (direct TypeScript via bash-prehook)
          // - tx-script-<hash>.ts (transpiled bash via bash-prehook)
          // Note: Other prefixes (exec-, bg-script-) are from direct desh execution
          // and don't have pending files
          let id: string | null = null;

          const legacyMatch = file.name.match(/^file_(.+)\.ts$/);
          if (legacyMatch) {
            id = legacyMatch[1]!;
          } else {
            const hashMatch = file.name.match(/^(?:script|tx-script)-(.+)\.ts$/);
            if (hashMatch) {
              id = hashMatch[1]!;
            }
          }

          if (id) {
            const pendingPath = `${pendingDir}/pending-${id}.json`;
            try {
              Deno.removeSync(pendingPath);
              deletedPending++;
              debug(`Deleted corresponding pending file: pending-${id}.json`);
            } catch {
              // Pending file might not exist or already deleted
            }
          }
        }
      } catch (error) {
        // Ignore errors for individual files
        debug(`Failed to delete ${file.name}: ${error}`);
      }
    }

    if (deletedScripts > 0 || deletedPending > 0) {
      debug(`Cleanup complete: deleted ${deletedScripts} scripts, ${deletedPending} pending files`);
    } else {
      debug(`Cleanup complete: no files older than 24 hours found`);
    }
  } catch (error) {
    // Cleanup errors shouldn't block execution
    debug(`Cleanup failed: ${error}`);
  }
}

// Project root and markers now imported from core/project-root.ts

// =============================================================================
// Command Extraction and Permission Checking
// =============================================================================

/**
 * Built-in shell commands that don't need external permission
 * These are handled by the transpiler without spawning processes
 */
const BUILTIN_COMMANDS = new Set([
  "echo",
  "printf",
  "cd",
  "pwd",
  "pushd",
  "popd",
  "dirs",
  "export",
  "unset",
  "local",
  "declare",
  "readonly",
  "typeset",
  "source",
  ".",
  "eval",
  "exec",
  "exit",
  "return",
  "break",
  "continue",
  "true",
  "false",
  ":",
  "test",
  "[",
  "[[",
  "read",
  "mapfile",
  "readarray",
  "set",
  "shopt",
  "shift",
  "getopts",
  "trap",
  "wait",
  "jobs",
  "fg",
  "bg",
  "kill",
  "disown",
  "alias",
  "unalias",
  "type",
  "which",
  "hash",
  "command",
  "builtin",
  "let",
  "expr",
  // SafeShell built-in utilities (transpiled to __rm, __cp, etc.)
  "rm",
  "rmdir",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "ln",
  "chmod",
  "ls",
]);

/**
 * Check if AST represents a simple command that can be executed with native bash
 * Simple commands: basic commands, pipelines with &&/||/|, redirects
 * Complex commands: loops, conditionals, functions, subshells, command substitutions
 */
function isSimpleCommand(ast: AST.Program): boolean {
  // Check each statement in the program
  for (const stmt of ast.body) {
    if (!isSimpleStatement(stmt)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a statement is simple (can execute with native bash)
 */
function isSimpleStatement(stmt: AST.Statement): boolean {
  switch (stmt.type) {
    case "Command":
      // Simple command - check for command substitutions in args
      return !hasComplexExpansions(stmt);

    case "Pipeline":
      // Pipelines are OK if all commands are simple
      return stmt.commands.every((cmd) => isSimpleStatement(cmd));

    case "VariableAssignment":
      // Variable assignments are OK if no command substitution in value
      return !hasComplexValue(stmt.value);

    // Complex statements that need transpilation
    case "IfStatement":
    case "ForStatement":
    case "CStyleForStatement":
    case "WhileStatement":
    case "UntilStatement":
    case "CaseStatement":
    case "FunctionDeclaration":
    case "Subshell":
    case "BraceGroup":
      return false;

    case "TestCommand":
    case "ArithmeticCommand":
      // These are OK for native bash
      return true;

    default:
      // Unknown statement type - safer to transpile
      return false;
  }
}

/**
 * Check if command has complex expansions (command substitution, process substitution, heredocs)
 */
function hasComplexExpansions(cmd: AST.Command): boolean {
  // Check command name
  if (cmd.name.type === "CommandSubstitution") {
    return true;
  }

  // Check arguments
  for (const arg of cmd.args) {
    if (arg.type === "CommandSubstitution") {
      return true;
    }
    if (arg.type === "Word" && arg.parts) {
      for (const part of arg.parts) {
        if (part.type === "CommandSubstitution" || part.type === "ProcessSubstitution") {
          return true;
        }
      }
    }
  }

  // Check redirects for heredocs (<<, <<-, <<<)
  // Heredocs need transpilation for proper handling
  for (const redirect of cmd.redirects) {
    if (redirect.operator === "<<" || redirect.operator === "<<-" || redirect.operator === "<<<") {
      return true;
    }
  }

  return false;
}

/**
 * Check if value has command substitution
 */
function hasComplexValue(
  value:
    | AST.Word
    | AST.ParameterExpansion
    | AST.CommandSubstitution
    | AST.ArithmeticExpansion
    | AST.ArrayLiteral,
): boolean {
  if (value.type === "CommandSubstitution") {
    return true;
  }
  if (value.type === "Word" && value.parts) {
    for (const part of value.parts) {
      if (part.type === "CommandSubstitution" || part.type === "ProcessSubstitution") {
        return true;
      }
    }
  }
  if (value.type === "ArrayLiteral") {
    for (const elem of value.elements) {
      if (elem.type === "CommandSubstitution") {
        return true;
      }
      if (elem.type === "Word" && elem.parts) {
        for (const part of elem.parts) {
          if (part.type === "CommandSubstitution" || part.type === "ProcessSubstitution") {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Options for command extraction
 */
interface ExtractCommandsOptions {
  /** If true, skip builtin commands (default: false) */
  skipBuiltins?: boolean;
}

interface CommandExtractionState {
  vars: Map<string, string>;
}

function cloneExtractionState(state: CommandExtractionState): CommandExtractionState {
  return { vars: new Map(state.vars) };
}

function isAssignmentOnlyCommand(stmt: AST.Command): boolean {
  return stmt.name.type === "Word" && stmt.name.value === "" && stmt.assignments.length > 0;
}

function expandStaticLiteral(value: string, quoted: boolean, firstPart: boolean): string {
  if (!quoted && firstPart && (value === "~" || value.startsWith("~/"))) {
    return `${Deno.env.get("HOME") || "~"}${value.slice(1)}`;
  }
  return value;
}

function resolveStaticParameter(
  expansion: AST.ParameterExpansion,
  state: CommandExtractionState,
): string | undefined {
  if (expansion.modifier || expansion.subscript !== undefined || expansion.indirection) {
    return undefined;
  }

  const name = expansion.parameter;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return undefined;
  }

  return state.vars.get(name) ?? Deno.env.get(name);
}

function resolveStaticWord(
  word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  state: CommandExtractionState,
): string | undefined {
  if (word.type === "CommandSubstitution") {
    return undefined;
  }

  if (word.type === "ParameterExpansion") {
    return resolveStaticParameter(word, state);
  }

  if (word.singleQuoted) {
    return word.value;
  }

  if (word.parts.length === 0) {
    return expandStaticLiteral(word.value, word.quoted, true);
  }

  let value = "";
  for (let i = 0; i < word.parts.length; i++) {
    const part = word.parts[i]!;
    if (part.type === "LiteralPart") {
      value += expandStaticLiteral(part.value, word.quoted, i === 0);
    } else if (part.type === "ParameterExpansion") {
      const expanded = resolveStaticParameter(part, state);
      if (expanded === undefined) return undefined;
      value += expanded;
    } else {
      return undefined;
    }
  }
  return value;
}

function recordStaticAssignment(
  assignment: AST.VariableAssignment,
  state: CommandExtractionState,
): void {
  if (
    assignment.value.type !== "Word" &&
    assignment.value.type !== "ParameterExpansion" &&
    assignment.value.type !== "CommandSubstitution"
  ) {
    state.vars.delete(assignment.name);
    return;
  }

  const value = resolveStaticWord(assignment.value, state);
  if (value === undefined) {
    state.vars.delete(assignment.name);
    return;
  }
  state.vars.set(assignment.name, value);
}

function extractCommandName(
  stmt: AST.Command,
  state: CommandExtractionState,
): string {
  return resolveStaticWord(stmt.name, state) ?? (stmt.name.type === "Word" ? stmt.name.value : "");
}

function extractCommandsFromStatements(
  statements: AST.Statement[],
  commands: Set<string>,
  options: ExtractCommandsOptions,
  state: CommandExtractionState,
): void {
  for (const stmt of statements) {
    extractCommandsFromStatement(stmt, commands, options, state);
  }
}

function extractCommandsFromScopedStatements(
  statements: AST.Statement[],
  commands: Set<string>,
  options: ExtractCommandsOptions,
  state: CommandExtractionState,
): void {
  extractCommandsFromStatements(statements, commands, options, cloneExtractionState(state));
}

/**
 * Extract command names from a statement recursively.
 *
 * @param stmt - AST statement to extract from
 * @param commands - Set to collect command names into
 * @param options - Extraction options (skipBuiltins filters BUILTIN_COMMANDS)
 */
function extractCommandsFromStatement(
  stmt: AST.Statement,
  commands: Set<string>,
  options: ExtractCommandsOptions = {},
  state: CommandExtractionState = { vars: new Map() },
): void {
  const { skipBuiltins = false } = options;

  switch (stmt.type) {
    case "Command": {
      if (isAssignmentOnlyCommand(stmt)) {
        for (const assignment of stmt.assignments) {
          recordStaticAssignment(assignment, state);
        }
        break;
      }

      const cmdName = extractCommandName(stmt, state);
      if (cmdName && (!skipBuiltins || !BUILTIN_COMMANDS.has(cmdName))) {
        commands.add(cmdName);
      }
      break;
    }
    case "Pipeline": {
      if (stmt.operator === null && stmt.commands.length === 1) {
        extractCommandsFromStatement(stmt.commands[0]!, commands, options, state);
        break;
      }

      for (const command of stmt.commands) {
        extractCommandsFromStatement(command, commands, options, cloneExtractionState(state));
      }
      break;
    }
    case "IfStatement": {
      if (stmt.test.type !== "TestCommand" && stmt.test.type !== "ArithmeticCommand") {
        extractCommandsFromStatement(stmt.test, commands, options, cloneExtractionState(state));
      }
      extractCommandsFromScopedStatements(stmt.consequent, commands, options, state);
      if (stmt.alternate) {
        if (Array.isArray(stmt.alternate)) {
          extractCommandsFromScopedStatements(stmt.alternate, commands, options, state);
        } else {
          extractCommandsFromStatement(
            stmt.alternate,
            commands,
            options,
            cloneExtractionState(state),
          );
        }
      }
      break;
    }
    case "ForStatement":
    case "WhileStatement":
    case "UntilStatement": {
      if (
        "test" in stmt && stmt.test.type !== "TestCommand" && stmt.test.type !== "ArithmeticCommand"
      ) {
        extractCommandsFromStatement(
          stmt.test as AST.Statement,
          commands,
          options,
          cloneExtractionState(state),
        );
      }
      extractCommandsFromScopedStatements(stmt.body, commands, options, state);
      break;
    }
    case "CStyleForStatement": {
      extractCommandsFromScopedStatements(stmt.body, commands, options, state);
      break;
    }
    case "CaseStatement": {
      for (const clause of stmt.cases) {
        extractCommandsFromScopedStatements(clause.body, commands, options, state);
      }
      break;
    }
    case "FunctionDeclaration": {
      extractCommandsFromScopedStatements(stmt.body, commands, options, state);
      break;
    }
    case "Subshell":
    case "BraceGroup": {
      extractCommandsFromScopedStatements(stmt.body, commands, options, state);
      break;
    }
    case "VariableAssignment": {
      recordStaticAssignment(stmt, state);
      break;
    }
  }
}

/**
 * Extract external command names from a parsed AST (skips builtins)
 */
function extractCommands(ast: AST.Program): Set<string> {
  const commands = new Set<string>();
  const state: CommandExtractionState = { vars: new Map() };
  extractCommandsFromStatements(ast.body, commands, { skipBuiltins: true }, state);
  return commands;
}

/**
 * List of dangerous commands that should always go through safesh for permission checks
 * These commands can modify/delete files, change permissions, or perform destructive operations
 *
 * NOTE: rm, chmod are NOT in this list because they use SafeShell's sandboxed built-in implementations
 */
const DANGEROUS_COMMANDS = new Set([
  // File deletion/modification (rm uses builtin)
  "rmdir",
  "unlink",
  "shred",
  // Permission/ownership changes (chmod uses builtin)
  "chown",
  "chgrp",
  // Disk operations
  "dd",
  "mkfs",
  "fdisk",
  "parted",
  "wipefs",
  // System modifications
  "mount",
  "umount",
  "kill",
  "killall",
  "pkill",
  // Package managers
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "pacman",
  "brew",
  // Low-level operations
  "truncate",
  "fallocate",
]);

/**
 * Check if AST contains any dangerous commands that require safesh permission checks.
 * Uses extractCommandsFromStatement without skipBuiltins to include all commands.
 */
function hasDangerousCommands(ast: AST.Program): boolean {
  const commands = new Set<string>();
  for (const stmt of ast.body) {
    extractCommandsFromStatement(stmt, commands);
  }

  for (const cmd of commands) {
    if (DANGEROUS_COMMANDS.has(cmd)) {
      debug(`Dangerous command detected: ${cmd}`);
      return true;
    }
  }
  return false;
}

// getSessionAllowedCommands now imported from core/session.ts

/**
 * Check which commands are not in the allowed list.
 * Delegates to the canonical checkCommandPermission() in core/command_permission.ts,
 * passing session commands to ensure consistent behavior across all entry paths.
 */
async function getDisallowedCommands(
  commands: Set<string>,
  config: SafeShellConfig,
  cwd: string,
): Promise<string[]> {
  const sessionCmds = getSessionAllowedCommands(config.projectDir);
  const disallowed: string[] = [];

  // Check all commands in parallel via canonical permission checker
  const checks = await Promise.all(
    [...commands].map(async (cmd) => {
      const result = await checkCommandPermission(cmd, config, cwd, sessionCmds);
      return { cmd, result };
    }),
  );

  for (const { cmd, result } of checks) {
    if (!result.allowed) {
      disallowed.push(cmd);
    }
  }

  return disallowed;
}

/**
 * SSH-576: Final permission gate for passthrough inversion.
 *
 * The analyzer's command set is sound (covers command substitutions and
 * other nesting the legacy extractor misses), so any names it found beyond
 * the already-checked set get the same permission check, and every static
 * redirect/cd target must pass the canonical workspace path validation the
 * runtime would have applied.
 */
async function isPassthroughPermitted(
  analysis: PassthroughAnalysis,
  alreadyChecked: Set<string>,
  config: SafeShellConfig,
  cwd: string,
): Promise<boolean> {
  const extra = new Set(
    [...analysis.commands].filter(
      (cmd) => !BUILTIN_COMMANDS.has(cmd) && !alreadyChecked.has(cmd),
    ),
  );
  if (extra.size > 0) {
    const extraDisallowed = await getDisallowedCommands(extra, config, cwd);
    if (extraDisallowed.length > 0) {
      debug(`Passthrough denied, nested commands disallowed: ${extraDisallowed.join(", ")}`);
      return false;
    }
  }

  for (const target of analysis.redirects) {
    try {
      await validatePath(target.path, config, cwd, target.operation);
    } catch {
      debug(`Passthrough denied, path outside roots: ${target.path} (${target.operation})`);
      return false;
    }
  }

  // SSH-579: a non-matching glob is passed through literally by bash but
  // aborts the whole command under zsh — only pass through globs that match.
  for (const pattern of analysis.globs) {
    if (!(await globHasMatch(pattern, cwd))) {
      debug(`Passthrough denied, glob has no match: ${pattern}`);
      return false;
    }
  }

  return true;
}

export async function globHasMatch(pattern: string, cwd: string): Promise<boolean> {
  try {
    // SSH-590: bash leaves globstar off by default, so `**` matches a single
    // path segment (like `*`). @std/fs defaults globstar on (zsh-like), which
    // would let the analyzer approve a recursive file set bash never produces;
    // disable it to keep the match check faithful to native bash.
    for await (const _entry of expandGlob(pattern, { root: cwd, globstar: false })) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Generic Hook Input format (Claude Code / Gemini CLI)
 * Supports both snake_case (Claude) and camelCase (Gemini potential)
 */
interface HookInput {
  hookEventName?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: {
    command: string;
    timeout?: number;
    description?: string;
    run_in_background?: boolean;
    runInBackground?: boolean;
  };
  toolInput?: {
    command: string;
    timeout?: number;
    description?: string;
    run_in_background?: boolean;
    runInBackground?: boolean;
  };
}

/**
 * Parsed command with optional parameters
 */
interface ParsedCommand {
  command: string;
  timeout?: number;
  runInBackground?: boolean;
  hookEventName?: string;
}

/**
 * Parse Hook input from JSON
 * Handles both Claude Code and Gemini CLI formats
 */
function parseHookInput(input: string): ParsedCommand | null {
  try {
    const parsed = JSON.parse(input) as HookInput;

    // Normalize fields
    const toolName = parsed.tool_name || parsed.toolName || "";
    const toolInput = parsed.tool_input || parsed.toolInput;

    // Check if it's a supported tool
    if (/^(Bash|bash|run_shell_command)$/i.test(toolName) && toolInput?.command) {
      debug(`Parsed input for tool: ${toolName}`);
      debug(`Command: ${toolInput.command}`);

      const timeout = toolInput.timeout;
      // Handle both boolean flag styles
      const runInBackground = toolInput.run_in_background ?? toolInput.runInBackground;

      debug(`Timeout: ${timeout}`);
      debug(`Run in background: ${runInBackground}`);

      return {
        command: toolInput.command,
        timeout: timeout,
        runInBackground: runInBackground,
        hookEventName: parsed.hookEventName,
      };
    }
  } catch {
    // Not JSON, might be raw bash command
  }
  return null;
}

/**
 * Get bash command from args or stdin
 */
async function getBashCommand(): Promise<ParsedCommand> {
  // Check if command passed as argument
  if (Deno.args.length > 0) {
    const cmd = Deno.args.join(" ");
    debug(`Command from args: ${cmd}`);
    return { command: cmd };
  }

  // Check if stdin has data (piped)
  if (!Deno.stdin.isTerminal()) {
    const rawInput = await readStdinFully();
    const trimmed = rawInput.trim();
    debug(`Raw stdin input: ${trimmed}`);

    // Try to parse as Claude Code hook input (JSON format)
    const parsed = parseHookInput(trimmed);
    if (parsed) {
      return parsed;
    }

    // Otherwise treat as raw bash command
    debug(`Command from stdin (raw): ${trimmed}`);
    return { command: trimmed };
  }

  throw new Error("No bash command provided. Pass as argument or via stdin.");
}

/**
 * Commands that should pass through to native bash (not intercepted)
 * These are typically SafeShell CLI tools that should run directly
 */
const PASSTHROUGH_COMMANDS = [
  /^desh\b/, // desh CLI (includes "desh retry")
  /^\.\/src\/cli\/desh\.ts\b/, // desh via path
  /desh\.ts\b/, // any desh.ts path
  /^deno\b/, // deno runtime (for tests, etc.)
];

/**
 * Strip leading NAME=value assignment words so the command word itself decides
 * passthrough (SSH-570): `TMPDIR=/tmp desh retry-path ...` must be recognized
 * as desh — otherwise the retry command for a blocked command is itself
 * blocked and the permission prompt recurses. Detection only; the original
 * command line is what passes through to bash.
 */
const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*\+?=(?:'[^']*'|"(?:[^"\\]|\\.)*"|[^\s'"]+)*\s+/;

export function stripLeadingAssignments(command: string): string {
  let rest = command;
  while (true) {
    const next = rest.replace(ASSIGNMENT_PREFIX, "");
    if (next === rest) return rest;
    rest = next;
  }
}

/**
 * Check if command should pass through to native bash
 */
export function shouldPassthrough(command: string): boolean {
  const trimmed = command.trim();
  const withoutAssignments = stripLeadingAssignments(trimmed);
  for (const pattern of PASSTHROUGH_COMMANDS) {
    if (pattern.test(trimmed) || pattern.test(withoutAssignments)) {
      debug(`Passthrough command detected: ${trimmed}`);
      return true;
    }
  }
  return false;
}

/**
 * Output passthrough decision - let native bash handle the command
 * Exits with no output so the hook is effectively a no-op
 * The command continues to the Bash tool which handles it normally
 */
function outputPassthrough(): void {
  // Exit 0 with no output = hook completed successfully, no decision made
  // This allows the Bash tool to handle the command with its own permission system
  // Cleaner than returning "allow" which might bypass permission checks
}

// detectTypeScript, detectHybridCommand, and SAFESH_SIGNATURE are imported from
// src/hooks/detection.ts for shared logic between bash-prehook and tests (SSH-480)

/**
 * Execution result with captured output
 */
interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute TypeScript code and capture output
 */
async function executeAndCapture(
  code: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  cwd: string,
): Promise<ExecutionResult> {
  debug("Executing and capturing output");

  try {
    const result = await executeCode(code, config, { cwd });
    debug(`Execution completed with exit code: ${result.code}`);
    return {
      exitCode: result.code,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    const errorMsg = error instanceof SafeShellError
      ? `Error: ${error.message}`
      : `Execution failed: ${error}`;
    return {
      exitCode: 1,
      stdout: "",
      stderr: errorMsg,
    };
  }
}

/**
 * Mode for passing transpiled code to desh
 */
const DESH_MODE = Deno.env.get("BASH_PREHOOK_DESH_MODE") || "file"; // "file" or "heredoc"

/** Options for desh rewrite output */
interface DeshRewriteOptions {
  timeout?: number;
  runInBackground?: boolean;
  isDirectTs?: boolean;
  originalCommand?: string;
  hookEventName?: string;
  cwd?: string;
}

/**
 * Shared logic for preparing desh rewrite: hash, pending ID, marked code, and pending command.
 *
 * Both file and heredoc modes share this preparation step.
 * Returns the data needed to form the final desh command.
 */
async function prepareDeshRewrite(
  tsCode: string,
  projectDir: string,
  options?: DeshRewriteOptions,
): Promise<{ hash: string; pendingId: string; markedCode: string; prefix: string }> {
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);
  const prefix = options?.isDirectTs ? "script" : "tx-script";
  const pendingId = generatePendingId();

  const markedCode = `// Set SafeShell execution context
Deno.env.set("SAFESH_SCRIPT_ID", "${pendingId}");
Deno.env.set("SAFESH_SCRIPT_HASH", "${hash}");
Deno.env.set("SAFESH_ALLOW_PROJECT_COMMANDS", "true");

console.error("# /*#*/ ${projectDir}");
${tsCode}`;

  const pending: PendingCommand = {
    id: pendingId,
    scriptHash: hash,
    commands: [],
    cwd: options?.cwd ?? Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };
  writePendingCommand(pending);

  return { hash, pendingId, markedCode, prefix };
}

/**
 * Output hook decision to rewrite command as desh with file.
 * Writes transpiled code to /tmp and passes file path to desh.
 */
async function outputRewriteToDeshFile(
  tsCode: string,
  projectDir: string,
  options?: DeshRewriteOptions,
): Promise<void> {
  const { hash, markedCode, prefix } = await prepareDeshRewrite(tsCode, projectDir, options);
  const scriptsDir = getScriptsDir();
  const tempFile = `${scriptsDir}/${prefix}-${hash}.ts`;

  // Check if cached script exists, only write if it doesn't
  try {
    await Deno.stat(tempFile);
    debug(`Using cached script: ${prefix}-${hash}.ts`);
  } catch {
    Deno.writeTextFileSync(tempFile, markedCode);
    debug(`Created new script: ${prefix}-${hash}.ts`);
  }

  // SSH-580: state trailer. The desh run writes its cd/export/var deltas to
  // a trailer snippet; sourcing it afterwards applies them to the Bash
  // tool's persistent shell — the same state owner passthrough commands use.
  // Skipped for background runs (no shell waits to apply state). The [ -O ]
  // ownership check guards against another user pre-creating the file.
  if (options?.runInBackground) {
    outputHookResponse(`${DESH_CMD} -q -f ${tempFile}`, options);
    return;
  }

  const trailerPath = getStateTrailerPath(generateTempId());
  const command = `${DESH_CMD} -q -f ${tempFile} --state-trailer '${trailerPath}'; ` +
    `__safesh_rc=$?; ` +
    `[ -f '${trailerPath}' ] && [ -O '${trailerPath}' ] && . '${trailerPath}'; ` +
    `rm -f '${trailerPath}' 2>/dev/null; ` +
    `(exit $__safesh_rc)`;
  outputHookResponse(command, options);
}

/**
 * Output hook decision to rewrite command as desh heredoc.
 * Uses heredoc to pass code inline.
 */
async function outputRewriteToDeshHeredoc(
  tsCode: string,
  projectDir: string,
  options?: DeshRewriteOptions,
): Promise<void> {
  const { markedCode } = await prepareDeshRewrite(tsCode, projectDir, options);
  outputHookResponse(`${DESH_CMD} -q <<'SAFESH_EOF'\n${markedCode}\nSAFESH_EOF`, options);
}

/**
 * Output the hook response with the desh command
 */
function outputHookResponse(
  deshCommand: string,
  options?: { timeout?: number; runInBackground?: boolean; hookEventName?: string },
): void {
  const command = options?.runInBackground
    ? `SAFESH_RUN_IN_BACKGROUND=1 ${deshCommand}`
    : deshCommand;

  // Build updatedInput preserving timeout and run_in_background
  const updatedInput: Record<string, unknown> = { command };
  if (options?.timeout !== undefined) {
    updatedInput.timeout = options.timeout;
  }
  if (options?.runInBackground !== undefined) {
    updatedInput.run_in_background = options.runInBackground;
  }

  // Correct format with hookSpecificOutput wrapper
  const output = {
    hookSpecificOutput: {
      hookEventName: options?.hookEventName || "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Transpiled to SafeShell TypeScript via desh",
      updatedInput,
    },
  };
  console.log(JSON.stringify(output));
}

/**
 * Pending command structure saved to temp file for retry flow
 */
// PendingCommand interface now imported from core/types.ts

/**
 * Output hook decision to deny and prompt user for choice via LLM
 *
 * Flow:
 * 1. Save script file and pending command metadata with hash-based ID
 * 2. Return "deny" with message for LLM to prompt user
 * 3. LLM prompts user with choices (once/always/session/deny)
 * 4. User picks, LLM runs: desh retry --id=X --choice=N
 * 5. desh retry executes command and persists choice if needed
 */
async function outputDenyWithRetry(
  disallowedCommands: string[],
  tsCode: string,
  projectDir: string,
  options?: {
    timeout?: number;
    runInBackground?: boolean;
    originalCommand?: string;
    hookEventName?: string;
    cwd?: string;
  },
): Promise<void> {
  const cmdList = disallowedCommands.join(", ");

  // Add marker to prove code went through SafeShell transpilation
  const markedCode = `console.error("# /*#*/ ${projectDir}");\n${tsCode}`;

  // Generate hash for script caching
  // For bash: hash original command to cache transpiled result
  // TRANSPILER_VERSION in hashContent ensures cache busts when transpiler changes
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);
  const prefix = "tx-script"; // Denied commands are always transpiled bash
  const scriptsDir = getScriptsDir();
  const scriptFile = `${scriptsDir}/${prefix}-${hash}.ts`;

  // Write script file (needed for retry execution)
  // Check if cached script exists
  try {
    await Deno.stat(scriptFile);
    debug(`Using cached script for denied command: ${prefix}-${hash}.ts`);
  } catch {
    // File doesn't exist, write it
    Deno.writeTextFileSync(scriptFile, markedCode);
    debug(`Created script for denied command: ${prefix}-${hash}.ts`);
  }

  // Generate unique pending ID (timestamp+pid for multi-instance safety)
  const pendingId = generatePendingId();

  // Save pending command metadata to temp file (without tsCode)
  const pending: PendingCommand = {
    id: pendingId,
    scriptHash: hash,
    commands: disallowedCommands,
    cwd: options?.cwd ?? Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };

  writePendingCommand(pending);

  // Build deny message with retry instructions for LLM
  const message = `[SAFESH] BLOCKED: ${cmdList}

WAIT for user choice (1-4):
1. Allow once
2. Always allow
3. Allow for session
4. Deny

DO NOT SHOW OR REPEAT OPTIONS. AFTER USER RESPONDS: desh retry --id=${pendingId} --choice=<user's choice>

HINT: Use safesh TypeScript code with /*#*/ prefix - many shell utils are pre-approved.`;

  const output = {
    hookSpecificOutput: {
      hookEventName: options?.hookEventName || "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
    },
  };
  console.log(JSON.stringify(output));
}

/**
 * Output hook decision to rewrite command to desh
 * Uses file mode by default, heredoc if configured
 */
async function outputRewriteToDesh(
  tsCode: string,
  projectDir: string,
  options?: DeshRewriteOptions,
): Promise<void> {
  if (DESH_MODE === "heredoc") {
    await outputRewriteToDeshHeredoc(tsCode, projectDir, options);
  } else {
    await outputRewriteToDeshFile(tsCode, projectDir, options);
  }
}

/**
 * Execute TypeScript code in streaming mode
 * Returns exit code instead of calling Deno.exit directly
 */
async function executeStreaming(
  code: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  cwd: string,
): Promise<number> {
  debug("Executing in streaming mode");

  const encoder = new TextEncoder();
  let exitCode = 0;

  try {
    for await (const chunk of executeCodeStreaming(code, config, { cwd })) {
      if (chunk.type === "stdout" && chunk.data) {
        await Deno.stdout.write(encoder.encode(chunk.data));
      } else if (chunk.type === "stderr" && chunk.data) {
        await Deno.stderr.write(encoder.encode(chunk.data));
      } else if (chunk.type === "exit") {
        exitCode = chunk.code ?? 0;
      }
    }

    debug(`Streaming execution completed with exit code: ${exitCode}`);
    return exitCode;
  } catch (error) {
    logExecutionError(error, code);

    if (error instanceof SafeShellError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Execution failed: ${error}`);
    }
    return 1;
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  // Clean up old script files proactively
  cleanupOldScripts();

  // Clean up old pending files proactively
  cleanupOldPendingFiles();

  let parsed: ParsedCommand | undefined;
  try {
    // Get the bash command with options
    parsed = await getBashCommand();

    if (!parsed.command) {
      console.error("Error: Empty bash command provided");
      Deno.exit(1);
    }

    // Check if command should pass through to native bash (e.g., desh)
    if (shouldPassthrough(parsed.command)) {
      outputPassthrough();
      Deno.exit(0);
    }

    // Determine working directory and project root
    const cwd = OVERRIDE_CWD || Deno.cwd();
    const projectDir = findProjectRoot(cwd);
    debug(`Working directory: ${cwd}, Project root: ${projectDir}`);

    // Load SafeShell config
    const baseConfig = await loadConfig(cwd, { logWarnings: false });
    // Enable allowProjectCommands by default for Claude Code bash commands
    // This allows executing project-local scripts like .temp/script.sh
    const config = mergeConfigs(baseConfig, {
      projectDir,
      allowProjectCommands: true,
    });
    debug(`Config loaded`);

    // SSH-423: Check if command is hybrid bash | TypeScript
    const hybrid = detectHybridCommand(parsed.command);
    if (hybrid) {
      debug("Hybrid bash | TypeScript detected");

      // Parse and transpile the bash part
      let bashAst;
      try {
        bashAst = parse(hybrid.bashPart);
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        throw new Error(`Failed to parse bash part of hybrid command: ${errorMsg}`);
      }

      let bashTsCode;
      try {
        bashTsCode = transpile(bashAst, { imports: false, strict: false });
      } catch (transpileError) {
        const errorMsg = transpileError instanceof Error
          ? transpileError.message
          : String(transpileError);
        throw new Error(`Failed to transpile bash part of hybrid command: ${errorMsg}`);
      }

      // Combine: pipe bash command output to TypeScript code
      // We need to capture the bash part's output and feed it to the TypeScript part
      // The TypeScript code expects to read from Deno.stdin, so we simulate piping by:
      // 1. Capturing bash command's stdout
      // 2. Creating a ReadableStream from that output
      // 3. Temporarily replacing Deno.stdin with our stream
      const combinedTsCode = `
// Execute bash part and capture output
const __bashOutput = await ${bashTsCode.trim()};

// Get the stdout from the bash command result
let __stdout: string;
if (typeof __bashOutput === "object" && __bashOutput !== null && "stdout" in __bashOutput) {
  __stdout = __bashOutput.stdout;
} else {
  __stdout = String(__bashOutput);
}

// Create a readable stream from the bash output
const __encoder = new TextEncoder();
const __stream = new ReadableStream({
  start(controller) {
    controller.enqueue(__encoder.encode(__stdout));
    controller.close();
  }
});

// Temporarily replace Deno.stdin with our stream
const __originalStdin = Deno.stdin;
Object.defineProperty(Deno, "stdin", {
  value: {
    readable: __stream,
    rid: __originalStdin.rid,
    isTerminal: () => false,
    setRaw: () => {},
    read: async (p: Uint8Array) => {
      const reader = __stream.getReader();
      const { value, done } = await reader.read();
      if (done) return null;
      p.set(value!);
      reader.releaseLock();
      return value!.length;
    },
  },
  writable: true,
  configurable: true,
});

// Execute the TypeScript part (which reads from Deno.stdin)
${hybrid.tsPart}

// Restore original stdin
Object.defineProperty(Deno, "stdin", {
  value: __originalStdin,
  writable: true,
  configurable: true,
});
`;

      // Add error handlers
      const finalTsCode = generateInlineErrorHandler({
        prefix: "Hybrid Command Error",
        errorLogPath: getErrorLogPath(),
        includeCommand: false,
      }) + `
${combinedTsCode}
`;

      await outputRewriteToDesh(finalTsCode, projectDir, {
        timeout: parsed.timeout,
        runInBackground: parsed.runInBackground,
        isDirectTs: true,
        hookEventName: parsed.hookEventName,
        cwd,
      });
      Deno.exit(0);
    }

    // Check if command is already TypeScript (skip transpilation and permission check)
    let tsCode = detectTypeScript(parsed.command);
    if (tsCode) {
      debug("TypeScript detected, rewriting to desh");

      // Add error handlers for better error formatting (without storing original command)
      tsCode = generateInlineErrorHandler({
        prefix: "TypeScript Error",
        errorLogPath: getErrorLogPath(),
        includeCommand: false,
      }) + `
${tsCode}
`;

      await outputRewriteToDesh(tsCode, projectDir, {
        timeout: parsed.timeout,
        runInBackground: parsed.runInBackground,
        isDirectTs: true,
        hookEventName: parsed.hookEventName,
        cwd,
      });
      Deno.exit(0);
    }

    // Parse bash command to AST
    let ast;
    try {
      ast = parse(parsed.command);
    } catch (parseError) {
      // On parse error, show the command for debugging
      const lines = parsed.command.split("\n");
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      debug(`Parse error: ${errorMsg}`);
      debug(`Command (${lines.length} lines):`);
      lines.forEach((line, i) => debug(`  ${i + 1}: ${line}`));
      throw parseError;
    }

    // Check command complexity and safety
    // Simple commands: passthrough to native bash (let Bash tool handle permissions)
    // Complex commands: transpile to TypeScript (need SafeShell runtime)
    // Dangerous commands: always go through safesh for permission checks
    // Config option: alwaysTranspile can force all commands through transpiler
    if (isSimpleCommand(ast) && !hasDangerousCommands(ast) && !config.alwaysTranspile) {
      debug("Simple command detected - passthrough to native bash");
      outputPassthrough();
      Deno.exit(0);
    }

    if (config.alwaysTranspile) {
      debug("alwaysTranspile enabled - forcing transpilation");
    }

    if (hasDangerousCommands(ast)) {
      debug("Dangerous command detected - forcing through safesh for permission checks");
    }

    // Complex command - extract commands for permission checking
    debug(`Complex command detected - will transpile and check permissions`);
    const commands = extractCommands(ast);
    debug(`Extracted commands: ${[...commands].join(", ") || "(none)"}`);

    // Check which commands are not allowed
    const disallowed = await getDisallowedCommands(commands, config, cwd);

    // SSH-576: Passthrough inversion. If every command the script can run is
    // statically enumerable and allowed (including inside command
    // substitutions), and redirect/cd targets pass workspace path checks,
    // hand the original command to native bash instead of transpiling.
    if (config.passthroughAnalyzable !== false && disallowed.length === 0) {
      // SSH-585: optional mvdan/sh front-end for the analysis only; the
      // legacy AST keeps driving detection and transpilation. On any mvdan
      // failure the legacy AST is the fallback.
      let analysisAst = ast;
      if (config.parserFrontend === "mvdan") {
        try {
          const { parseWithMvdan } = await import("../src/bash/mvdan/adapter.ts");
          analysisAst = parseWithMvdan(parsed.command);
          debug("Passthrough analysis using mvdan front-end (SSH-585)");
        } catch (mvdanError) {
          debug(`mvdan front-end failed, using legacy AST: ${mvdanError}`);
        }
      }
      const analysis = analyzeForPassthrough(analysisAst, {
        blockedCommands: DANGEROUS_COMMANDS,
      });
      if (analysis.eligible) {
        if (await isPassthroughPermitted(analysis, commands, config, cwd)) {
          debug("Analyzable command fully allowed - passthrough to native bash (SSH-576)");
          outputPassthrough();
          Deno.exit(0);
        }
      } else {
        debug(`Passthrough ineligible: ${analysis.reasons.join("; ")}`);
      }
    }

    // Transpile AST to TypeScript (needed for both ask and allow)
    tsCode = transpile(ast, {
      imports: false,
      strict: false,
    });
    debug("Bash transpiled to TypeScript");

    // Check for known transpiler bugs that generate invalid TypeScript
    // These patterns indicate the transpiler couldn't handle the bash complexity
    const knownBadPatterns = [
      /const\s+\w+\s+=\s+for\s+await/, // "const x = for await" - invalid syntax
      /for\s*\(\s*const\s+\w+\s+of\s+\["\$\{await/, // "for (const x of ["${await..." - template in array
      /for\s*\(\s*const\s+\w+\s+of\s+\["[^"]*await/, // Alternative: for (const x of ["...await
      /\.pipe\(\$\.(?:grep|head|tail|sort|uniq|wc|filter|map|flatMap|take|tee)\((?:(?!\breturn\b)[^\n`]){0,500}\)\)\.pipe\((?:(?!\breturn\b)[^\n`]){1,500}\)\.stdout\(\)/, // Calling stdout() after transform pipes - invalid (SSH-496/498/570/34: avoid command-pipe false positives)
      /\.lines\(\)\.pipe\((?:(?!\breturn\b)[^\n`]){1,500}\)\.lines\(\)/, // Calling .lines() twice with pipe - invalid (SSH-496: exclude cross-IIFE, SSH-498: exclude cross-template-literal, SSH-570: exclude cross-statement)
    ];

    for (const pattern of knownBadPatterns) {
      if (pattern.test(tsCode)) {
        // Save detailed error to file
        let errorFile = "";
        try {
          const errorId = `${Date.now()}-${Deno.pid}`;
          const errorDir = `${getTempRoot()}/errors`;
          Deno.mkdirSync(errorDir, { recursive: true });
          errorFile = `${errorDir}/transpile-${errorId}.log`;

          const errorLog = `=== Transpiler Error ===
Original Bash Command:
${parsed.command}

Error: The bash script is too complex for automatic transpilation.

Suggestion: Use safesh /*#*/ TypeScript syntax instead of bash for complex scripts.

Generated TypeScript (invalid):
${tsCode}
=========================
`;

          Deno.writeTextFileSync(errorFile, errorLog);
        } catch (e) {
          debug(`Failed to write error log: ${e}`);
        }

        // Brief console message with prominent error log path
        const message =
          `[SAFESH] Transpiler Error: The bash script is too complex for automatic transpilation.

${errorFile ? `Full details saved to: ${errorFile}\n` : ""}
Reason: The transpiler generated invalid TypeScript code.

DO NOT USE BASH FOR SCRIPTS THAT ARE TOO COMPLEX. Use safesh /*#*/ TypeScript instead.

Example:
  /*#*/
  const branches = (await $.cmd('git', 'branch', '-r').text()).split('\\n');
  for (const branch of branches) {
    console.log(\`Branch: \${branch}\`);
  }`;

        // Output hook denial to block execution
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
    }

    // Prepend original bash command as a constant for error messages and wrap in error handler
    const bashCommandEscaped = parsed.command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(
      /\$/g,
      "\\$",
    );

    // SSH-475: Save transpiled code before wrapping with error handler
    const transpiledCodeForErrorLog = tsCode;

    // Add global error handlers to catch all errors (sync and async)
    // SSH-475: Include transpiled code in error handler for detailed error logs
    tsCode = `const __ORIGINAL_BASH_COMMAND__ = \`${bashCommandEscaped}\`;
${
      generateInlineErrorHandler({
        prefix: "Bash Command Error",
        errorLogPath: getErrorLogPath(),
        includeCommand: true,
        originalCommand: bashCommandEscaped,
        transpiledCode: transpiledCodeForErrorLog,
      })
    }
${tsCode}
`;

    // If we reach here with disallowed commands, deny with retry prompt
    if (disallowed.length > 0) {
      debug(`Disallowed commands: ${disallowed.join(", ")}`);
      // Deny and prompt user for choice via LLM, then retry with desh retry
      await outputDenyWithRetry(disallowed, tsCode, projectDir, {
        timeout: parsed.timeout,
        runInBackground: parsed.runInBackground,
        originalCommand: parsed.command,
        hookEventName: parsed.hookEventName,
        cwd,
      });
      Deno.exit(0);
    }

    // Complex command with all permissions granted - rewrite to desh
    debug("Complex command with all permissions granted, rewriting to desh");

    // Rewrite command to use desh with heredoc
    // Pass through timeout and run_in_background options
    await outputRewriteToDesh(tsCode, projectDir, {
      timeout: parsed.timeout,
      runInBackground: parsed.runInBackground,
      originalCommand: parsed.command,
      hookEventName: parsed.hookEventName,
      cwd,
    });
    Deno.exit(0);
  } catch (error) {
    // On error, output error message and save to log file
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Show first few lines of command for context (if available)
    let context = "";
    let fullCommand = "";
    if (parsed?.command) {
      fullCommand = parsed.command;
      const lines = parsed.command.split("\n");
      const preview = lines.slice(0, 3).join("\n");
      const more = lines.length > 3 ? `\n... (${lines.length} lines total)` : "";
      context = `\n\nCommand preview:\n${preview}${more}`;
    }

    // Build full error message
    const errorLogContent = [
      "=== Bash Transpilation Error ===",
      `Command: ${fullCommand}`,
      `\nError: ${errorMsg}`,
      stack ? `\nStack trace:\n${stack}` : "",
      "================================\n",
    ].join("\n");

    // Save to error log file
    const errorFile = getErrorLogPath();
    try {
      Deno.writeTextFileSync(errorFile, errorLogContent);
      console.error(`\nError log: ${errorFile}`);
    } catch (e) {
      console.error("Warning: Could not write error log:", e);
    }

    console.error(`Transpilation error: ${errorMsg}${context}`);
    // Exit 2 to signal error, native bash won't run
    Deno.exit(2);
  }
}

if (import.meta.main) {
  main();
}
