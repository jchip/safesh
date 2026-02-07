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
import { getPendingFilePath, getScriptFilePath, generateTempId, getErrorLogPath, getSessionFilePath, getScriptsDir, getTempRoot, getPendingDir } from "../src/core/temp.ts";
import type { SafeShellConfig, PendingCommand } from "../src/core/types.ts";
// New unified core modules (DRY refactoring)
import { findProjectRoot, PROJECT_MARKERS } from "../src/core/project-root.ts";
import { generatePendingId, writePendingCommand, writePendingPath } from "../src/core/pending.ts";
import { getSessionAllowedCommands } from "../src/core/session.ts";
import { generateInlineErrorHandler } from "../src/core/error-handlers.ts";
import { readStdinFully } from "../src/core/io-utils.ts";
import {
  detectHybridCommand,
  detectTypeScript,
  SAFESH_SIGNATURE,
} from "../src/hooks/detection.ts";

// =============================================================================
// Configuration
// =============================================================================

const DEBUG = Deno.env.get("BASH_PREHOOK_DEBUG") === "1";
const MODE = Deno.env.get("BASH_PREHOOK_MODE") || "streaming";
const OVERRIDE_CWD = Deno.env.get("BASH_PREHOOK_CWD");
// Path to desh executable - absolute path to safesh project
const DESH_CMD = "/Users/jc/dev/safesh/src/cli/desh.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Log debug message to stderr (only if DEBUG enabled)
 */
function debug(message: string): void {
  if (DEBUG) {
    console.error(`[bash-prehook] ${message}`);
  }
}

/**
 * Transpiler cache version. Bump this whenever the transpiler or preamble
 * output changes to invalidate cached scripts.
 */
const TRANSPILER_VERSION = 2;

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
    const files = entries.filter(e => e.isFile && e.name.endsWith('.json'));

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
    const files = entries.filter(e => e.isFile && e.name.endsWith('.ts'));

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
  "echo", "printf", "cd", "pwd", "pushd", "popd", "dirs",
  "export", "unset", "local", "declare", "readonly", "typeset",
  "source", ".", "eval", "exec", "exit", "return", "break", "continue",
  "true", "false", ":", "test", "[", "[[",
  "read", "mapfile", "readarray",
  "set", "shopt", "shift", "getopts",
  "trap", "wait", "jobs", "fg", "bg", "kill", "disown",
  "alias", "unalias", "type", "which", "hash", "command", "builtin",
  "let", "expr",
  // SafeShell built-in utilities (transpiled to __rm, __cp, etc.)
  "rm", "rmdir", "cp", "mv", "mkdir", "touch", "ln", "chmod", "ls",
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
      return stmt.commands.every(cmd => isSimpleStatement(cmd));

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
function hasComplexValue(value: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution | AST.ArithmeticExpansion | AST.ArrayLiteral): boolean {
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
 * Extract command names from a statement recursively
 */
function extractCommandsFromStatement(stmt: AST.Statement, commands: Set<string>): void {
  switch (stmt.type) {
    case "Command": {
      // Extract command name if it's a simple word
      if (stmt.name.type === "Word") {
        const cmdName = stmt.name.value;
        // Skip builtins and variable assignments (empty command name)
        if (cmdName && !BUILTIN_COMMANDS.has(cmdName)) {
          commands.add(cmdName);
        }
      }
      break;
    }
    case "Pipeline": {
      for (const cmd of stmt.commands) {
        extractCommandsFromStatement(cmd, commands);
      }
      break;
    }
    case "IfStatement": {
      // Check test condition
      if (stmt.test.type !== "TestCommand" && stmt.test.type !== "ArithmeticCommand") {
        extractCommandsFromStatement(stmt.test, commands);
      }
      // Check consequent
      for (const s of stmt.consequent) {
        extractCommandsFromStatement(s, commands);
      }
      // Check alternate
      if (stmt.alternate) {
        if (Array.isArray(stmt.alternate)) {
          for (const s of stmt.alternate) {
            extractCommandsFromStatement(s, commands);
          }
        } else {
          extractCommandsFromStatement(stmt.alternate, commands);
        }
      }
      break;
    }
    case "ForStatement":
    case "WhileStatement":
    case "UntilStatement": {
      if ("test" in stmt && stmt.test.type !== "TestCommand" && stmt.test.type !== "ArithmeticCommand") {
        extractCommandsFromStatement(stmt.test as AST.Statement, commands);
      }
      for (const s of stmt.body) {
        extractCommandsFromStatement(s, commands);
      }
      break;
    }
    case "CStyleForStatement": {
      for (const s of stmt.body) {
        extractCommandsFromStatement(s, commands);
      }
      break;
    }
    case "CaseStatement": {
      for (const clause of stmt.cases) {
        for (const s of clause.body) {
          extractCommandsFromStatement(s, commands);
        }
      }
      break;
    }
    case "FunctionDeclaration": {
      for (const s of stmt.body) {
        extractCommandsFromStatement(s, commands);
      }
      break;
    }
    case "Subshell":
    case "BraceGroup": {
      for (const s of stmt.body) {
        extractCommandsFromStatement(s, commands);
      }
      break;
    }
  }
}

/**
 * Extract all external command names from a parsed AST
 */
function extractCommands(ast: AST.Program): Set<string> {
  const commands = new Set<string>();
  for (const stmt of ast.body) {
    extractCommandsFromStatement(stmt, commands);
  }
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
  "rmdir", "unlink", "shred",
  // Permission/ownership changes (chmod uses builtin)
  "chown", "chgrp",
  // Disk operations
  "dd", "mkfs", "fdisk", "parted", "wipefs",
  // System modifications
  "mount", "umount", "kill", "killall", "pkill",
  // Package managers
  "apt", "apt-get", "yum", "dnf", "pacman", "brew",
  // Low-level operations
  "truncate", "fallocate",
]);

/**
 * Extract all command names including builtins (for dangerous command detection)
 */
function extractAllCommands(stmt: AST.Statement, commands: Set<string>): void {
  switch (stmt.type) {
    case "Command": {
      // Extract command name if it's a simple word (including builtins)
      if (stmt.name.type === "Word") {
        const cmdName = stmt.name.value;
        if (cmdName) {
          commands.add(cmdName);
        }
      }
      break;
    }
    case "Pipeline": {
      for (const cmd of stmt.commands) {
        extractAllCommands(cmd, commands);
      }
      break;
    }
    case "IfStatement": {
      if (stmt.test.type !== "TestCommand" && stmt.test.type !== "ArithmeticCommand") {
        extractAllCommands(stmt.test, commands);
      }
      for (const s of stmt.consequent) {
        extractAllCommands(s, commands);
      }
      if (stmt.alternate) {
        if (Array.isArray(stmt.alternate)) {
          for (const s of stmt.alternate) {
            extractAllCommands(s, commands);
          }
        } else {
          extractAllCommands(stmt.alternate, commands);
        }
      }
      break;
    }
    case "ForStatement":
    case "WhileStatement":
    case "UntilStatement": {
      for (const s of stmt.body) {
        extractAllCommands(s, commands);
      }
      break;
    }
    case "CStyleForStatement": {
      for (const s of stmt.body) {
        extractAllCommands(s, commands);
      }
      break;
    }
    case "CaseStatement": {
      for (const caseItem of stmt.cases) {
        for (const s of caseItem.body) {
          extractAllCommands(s, commands);
        }
      }
      break;
    }
    case "Subshell":
    case "BraceGroup": {
      for (const s of stmt.body) {
        extractAllCommands(s, commands);
      }
      break;
    }
  }
}

/**
 * Check if AST contains any dangerous commands that require safesh permission checks
 */
function hasDangerousCommands(ast: AST.Program): boolean {
  const commands = new Set<string>();
  for (const stmt of ast.body) {
    extractAllCommands(stmt, commands);
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
 * Claude Code PreToolUse hook input format
 */
interface ClaudeCodeHookInput {
  tool_name: string;
  tool_input: {
    command: string;
    timeout?: number;
    description?: string;
    run_in_background?: boolean;
  };
}

/**
 * Parsed command with optional parameters
 */
interface ParsedCommand {
  command: string;
  timeout?: number;
  runInBackground?: boolean;
}

/**
 * Parse Claude Code hook input from JSON
 */
function parseClaudeCodeInput(input: string): ParsedCommand | null {
  try {
    const parsed = JSON.parse(input) as ClaudeCodeHookInput;
    if (parsed.tool_name === "Bash" && parsed.tool_input?.command) {
      debug(`Parsed Claude Code input: ${parsed.tool_input.command}`);
      debug(`Timeout: ${parsed.tool_input.timeout}`);
      debug(`Run in background: ${parsed.tool_input.run_in_background}`);
      return {
        command: parsed.tool_input.command,
        timeout: parsed.tool_input.timeout,
        runInBackground: parsed.tool_input.run_in_background,
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
    const parsed = parseClaudeCodeInput(trimmed);
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
  /^desh\b/,              // desh CLI (includes "desh retry")
  /^\.\/src\/cli\/desh\.ts\b/,  // desh via path
  /desh\.ts\b/,           // any desh.ts path
  /^deno\b/,              // deno runtime (for tests, etc.)
];

/**
 * Check if command should pass through to native bash
 */
function shouldPassthrough(command: string): boolean {
  const trimmed = command.trim();
  for (const pattern of PASSTHROUGH_COMMANDS) {
    if (pattern.test(trimmed)) {
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

/**
 * Output hook decision to rewrite command as desh with file
 * Writes transpiled code to /tmp and passes file path to desh
 *
 * For TypeScript code, generates an ID and saves metadata for potential
 * retry flow if initCmds encounters blocked commands at runtime.
 */
async function outputRewriteToDeshFile(tsCode: string, projectDir: string, options?: { timeout?: number; runInBackground?: boolean; isDirectTs?: boolean; originalCommand?: string }): Promise<void> {
  // Generate hash-based ID for caching and retry
  // For bash: hash original command to cache transpiled result
  // For /*#*/ scripts: hash TypeScript code directly
  // TRANSPILER_VERSION in hashContent ensures cache busts when transpiler changes
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);
  const prefix = options?.isDirectTs ? "script" : "tx-script";
  const id = hash;
  const scriptsDir = getScriptsDir();
  const tempFile = `${scriptsDir}/${prefix}-${hash}.ts`;

  // Generate pending ID for retry flow
  const pendingId = generatePendingId();

  // Set env vars at the top of the script instead of in the command string
  // This avoids polluting the command with env vars which breaks permission pattern matching
  const markedCode = `// Set SafeShell execution context
Deno.env.set("SAFESH_SCRIPT_ID", "${pendingId}");
Deno.env.set("SAFESH_SCRIPT_HASH", "${hash}");
Deno.env.set("SAFESH_ALLOW_PROJECT_COMMANDS", "true");

console.error("# /*#*/ ${projectDir}");
${tsCode}`;

  // Check if cached script exists, only write if it doesn't
  let cached = false;
  try {
    await Deno.stat(tempFile);
    cached = true;
    debug(`Using cached script: ${prefix}-${hash}.ts`);
  } catch {
    // File doesn't exist, write it
    Deno.writeTextFileSync(tempFile, markedCode);
    debug(`Created new script: ${prefix}-${hash}.ts`);
  }

  // Save metadata for potential retry (if initCmds encounters blocked commands)
  // Note: tsCode is NOT stored here - it's read from the script file using scriptHash
  const pending: PendingCommand = {
    id: pendingId,
    scriptHash: hash,
    commands: [], // Will be filled by initCmds if commands are blocked
    cwd: Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };
  writePendingCommand(pending);

  // Create clean desh command without env vars in the command string
  // Env vars are set inside the script file itself
  const deshCommand = `${DESH_CMD} -q -f ${tempFile}`;

  outputHookResponse(deshCommand, options);
}

/**
 * Output hook decision to rewrite command as desh heredoc
 * Uses heredoc to pass code inline
 *
 * For TypeScript code, generates an ID and saves metadata for potential
 * retry flow if initCmds encounters blocked commands at runtime.
 */
async function outputRewriteToDeshHeredoc(tsCode: string, projectDir: string, options?: { timeout?: number; runInBackground?: boolean; isDirectTs?: boolean; originalCommand?: string }): Promise<void> {
  // Generate hash-based ID for caching and retry
  // For bash: hash original command to cache transpiled result
  // For /*#*/ scripts: hash TypeScript code directly
  // TRANSPILER_VERSION in hashContent ensures cache busts when transpiler changes
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);

  // Generate pending ID for retry flow
  const pendingId = generatePendingId();

  // Set env vars at the top of the script instead of in the command string
  // This avoids polluting the command with env vars which breaks permission pattern matching
  const markedCode = `// Set SafeShell execution context
Deno.env.set("SAFESH_SCRIPT_ID", "${pendingId}");
Deno.env.set("SAFESH_SCRIPT_HASH", "${hash}");
Deno.env.set("SAFESH_ALLOW_PROJECT_COMMANDS", "true");

console.error("# /*#*/ ${projectDir}");
${tsCode}`;

  // Save metadata for potential retry (if initCmds encounters blocked commands)
  // Note: tsCode is NOT stored here - it's passed via heredoc, scriptHash used for caching
  const pending: PendingCommand = {
    id: pendingId,
    scriptHash: hash,
    commands: [], // Will be filled by initCmds if commands are blocked
    cwd: Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };
  writePendingCommand(pending);

  // Create clean desh heredoc command without env vars in the command string
  // Env vars are set inside the script itself
  const deshCommand = `${DESH_CMD} -q <<'SAFESH_EOF'\n${markedCode}\nSAFESH_EOF`;

  outputHookResponse(deshCommand, options);
}

/**
 * Output the hook response with the desh command
 */
function outputHookResponse(deshCommand: string, options?: { timeout?: number; runInBackground?: boolean }): void {
  // Build updatedInput preserving timeout and run_in_background
  const updatedInput: Record<string, unknown> = { command: deshCommand };
  if (options?.timeout !== undefined) {
    updatedInput.timeout = options.timeout;
  }
  if (options?.runInBackground !== undefined) {
    updatedInput.run_in_background = options.runInBackground;
  }

  // Correct format with hookSpecificOutput wrapper
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
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
  options?: { timeout?: number; runInBackground?: boolean; originalCommand?: string },
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
    cwd: Deno.cwd(),
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
      hookEventName: "PreToolUse",
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
async function outputRewriteToDesh(tsCode: string, projectDir: string, options?: { timeout?: number; runInBackground?: boolean; isDirectTs?: boolean; originalCommand?: string }): Promise<void> {
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
    // SSH-477: Save error to log file with context
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Build error log with available context
    const errorLogParts = [
      "=== Execution Error ===",
      `Code:\n${code}`,
      `\nError: ${errorMessage}`,
      errorStack ? `\nStack trace:\n${errorStack}` : "",
      "=========================\n",
    ].join("\n");

    // Save to error log file
    try {
      const errorDir = `${getTempRoot()}/errors`;
      Deno.mkdirSync(errorDir, { recursive: true });
      const errorFile = `${errorDir}/${Date.now()}-${Deno.pid}.log`;
      Deno.writeTextFileSync(errorFile, errorLogParts);
      console.error(`\nFull details saved to: ${errorFile}`);
    } catch {
      // Ignore logging errors
    }

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
        const errorMsg = transpileError instanceof Error ? transpileError.message : String(transpileError);
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
const __bashOutput = ${bashTsCode.trim()};

// Get the stdout from the bash command result
let __stdout: string;
if (typeof __bashOutput === "object" && "stdout" in __bashOutput) {
  __stdout = __bashOutput.stdout;
} else if (typeof __bashOutput === "string") {
  __stdout = __bashOutput;
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
      });
      Deno.exit(0);
    }

    // Parse bash command to AST
    let ast;
    try {
      ast = parse(parsed.command);
    } catch (parseError) {
      // On parse error, show the command for debugging
      const lines = parsed.command.split('\n');
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

    // Transpile AST to TypeScript (needed for both ask and allow)
    tsCode = transpile(ast, {
      imports: false,
      strict: false,
    });
    debug("Bash transpiled to TypeScript");

    // Check for known transpiler bugs that generate invalid TypeScript
    // These patterns indicate the transpiler couldn't handle the bash complexity
    const knownBadPatterns = [
      /const\s+\w+\s+=\s+for\s+await/,  // "const x = for await" - invalid syntax
      /for\s*\(\s*const\s+\w+\s+of\s+\["\$\{await/,  // "for (const x of ["${await..." - template in array
      /for\s*\(\s*const\s+\w+\s+of\s+\["[^"]*await/,  // Alternative: for (const x of ["...await
      /\.pipe\((?:(?!\breturn\b).){1,500}\)\.pipe\((?:(?!\breturn\b).){1,500}\)\.stdout\(\)/,  // Calling stdout() after multiple pipes - invalid (SSH-496: exclude cross-IIFE matches)
      /\.lines\(\)\.pipe\((?:(?!\breturn\b).){1,500}\)\.lines\(\)/,  // Calling .lines() twice with pipe - invalid (SSH-496: exclude cross-IIFE matches)
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
        const message = `[SAFESH] Transpiler Error: The bash script is too complex for automatic transpilation.

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
    const bashCommandEscaped = parsed.command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

    // SSH-475: Save transpiled code before wrapping with error handler
    const transpiledCodeForErrorLog = tsCode;

    // Add global error handlers to catch all errors (sync and async)
    // SSH-475: Include transpiled code in error handler for detailed error logs
    tsCode = `const __ORIGINAL_BASH_COMMAND__ = \`${bashCommandEscaped}\`;
${generateInlineErrorHandler({
        prefix: "Bash Command Error",
        errorLogPath: getErrorLogPath(),
        includeCommand: true,
        originalCommand: bashCommandEscaped,
        transpiledCode: transpiledCodeForErrorLog,
      })}
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
      const lines = parsed.command.split('\n');
      const preview = lines.slice(0, 3).join('\n');
      const more = lines.length > 3 ? `\n... (${lines.length} lines total)` : "";
      context = `\n\nCommand preview:\n${preview}${more}`;
    }

    // Build full error message
    const errorLogContent = [
      "=== Bash Transpilation Error ===",
      `Command: ${fullCommand}`,
      `\nError: ${errorMsg}`,
      stack ? `\nStack trace:\n${stack}` : "",
      "================================\n"
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
