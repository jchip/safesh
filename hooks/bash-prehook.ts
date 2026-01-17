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
import { getAllowedCommands } from "../src/core/command_permission.ts";
import { executeCode, executeCodeStreaming } from "../src/runtime/executor.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { getPendingFilePath, getScriptFilePath, generateTempId, getErrorLogPath, getSessionFilePath, getScriptsDir, getTempRoot } from "../src/core/temp.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { isCommandWithinProjectDir } from "../src/core/permissions.ts";

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
 * Generate SHA-256 hash for content-based script caching
 * Returns the first 16 chars of the URL-safe Base64 encoded SHA-256 hash.
 */
async function hashContent(content: string): Promise<string> {
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
 * Clean up old transpiled script files and pending files if count exceeds threshold
 *
 * When script file count exceeds 100, delete any files older than 24 hours
 * Also cleans up corresponding pending-*.json files
 * This runs proactively to prevent unlimited growth of temp files
 */
function cleanupOldScripts(): void {
  try {
    const scriptsDir = getScriptsDir();
    const tempRoot = getTempRoot();

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
            id = legacyMatch[1];
          } else {
            const hashMatch = file.name.match(/^(?:script|tx-script)-(.+)\.ts$/);
            if (hashMatch) {
              id = hashMatch[1];
            }
          }

          if (id) {
            const pendingPath = `${tempRoot}/pending-${id}.json`;
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

/**
 * Project root markers - only truly reliable ones
 * Other markers like package.json can exist in subdirectories
 */
const PROJECT_MARKERS = [
  ".claude",  // Claude Code project config (most reliable)
  ".git",     // Git repository root
];

/**
 * Find project root by walking up from cwd
 *
 * Priority:
 * 1. CLAUDE_PROJECT_DIR env var
 * 2. Walk up to find project markers
 * 3. Fallback to cwd
 */
function findProjectRoot(cwd: string): string {
  // Check env var first
  const envProjectDir = Deno.env.get("CLAUDE_PROJECT_DIR");
  if (envProjectDir) {
    debug(`Project root from CLAUDE_PROJECT_DIR: ${envProjectDir}`);
    return envProjectDir;
  }

  // Walk up looking for markers
  let dir = cwd;
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      try {
        const markerPath = `${dir}/${marker}`;
        Deno.statSync(markerPath);
        debug(`Project root found via ${marker}: ${dir}`);
        return dir;
      } catch {
        // Marker not found, continue
      }
    }

    // Move up one directory
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir || parent === "") {
      // Reached root, give up
      break;
    }
    dir = parent;
  }

  // Fallback to cwd
  debug(`Project root fallback to cwd: ${cwd}`);
  return cwd;
}

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
 * Get session-allowed commands from session file
 */
function getSessionAllowedCommands(): Set<string> {
  const sessionFile = getSessionFilePath();

  try {
    const content = Deno.readTextFileSync(sessionFile);
    const session = JSON.parse(content) as { allowedCommands?: string[] };
    return new Set(session.allowedCommands ?? []);
  } catch {
    return new Set();
  }
}

/**
 * Check which commands are not in the allowed list
 * Also checks session-allowed commands and project directory commands
 */
function getDisallowedCommands(
  commands: Set<string>,
  config: SafeShellConfig,
  cwd: string,
): string[] {
  const allowed = getAllowedCommands(config);
  const sessionAllowed = getSessionAllowedCommands();
  const disallowed: string[] = [];

  for (const cmd of commands) {
    // Check if command is in allowed list or session allowed
    if (allowed.has(cmd) || sessionAllowed.has(cmd)) {
      continue;
    }

    // Check if allowProjectCommands is enabled and command is within project
    if (config.allowProjectCommands && config.projectDir) {
      if (isCommandWithinProjectDir(cmd, config.projectDir, cwd)) {
        continue; // Allow project commands
      }
    }

    // Command is not allowed
    disallowed.push(cmd);
  }

  return disallowed;
}

/**
 * Read stdin completely
 */
async function readStdin(): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
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
    const rawInput = await readStdin();
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

/**
 * SafeShell TypeScript signature prefix
 * Agent must prefix code with this to indicate it's SafeShell TypeScript
 */
const SAFESH_SIGNATURE = "/*#*/";

/**
 * Detect if the command is SafeShell TypeScript
 * Returns the TypeScript code if detected, null otherwise
 *
 * Detection methods:
 * 1. Signature prefix: /\*$*\/ followed by TypeScript code
 * 2. .ts file path: path/to/script.ts (reads and returns file contents)
 */
function detectTypeScript(command: string): string | null {
  const trimmed = command.trim();

  // Check for SafeShell signature prefix: /*#*/
  if (trimmed.startsWith(SAFESH_SIGNATURE)) {
    const code = trimmed.slice(SAFESH_SIGNATURE.length).trim();
    if (!code) {
      debug("SafeShell signature with empty code, returning no-op");
      return "// empty";  // No-op TypeScript
    }
    debug(`Detected SafeShell signature, code: ${code}`);
    return code;
  }

  // Check if it's a .ts file path (execute the file)
  if (trimmed.endsWith(".ts") && !trimmed.includes(" ")) {
    // Single .ts file path - read and return its contents
    try {
      const code = Deno.readTextFileSync(trimmed);
      debug(`Detected .ts file: ${trimmed}`);
      return code;
    } catch {
      // File doesn't exist or can't be read, fall through to transpilation
      debug(`Could not read .ts file: ${trimmed}`);
    }
  }

  return null;
}

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
  // Add marker to prove code went through SafeShell transpilation
  const markedCode = `console.error("# /*#*/ ${projectDir}");\n${tsCode}`;

  // Generate hash-based ID for caching and retry
  // For bash: hash original command to cache transpiled result
  // For /*#*/ scripts: hash TypeScript code directly
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);
  const prefix = options?.isDirectTs ? "script" : "tx-script";
  const id = hash;
  const scriptsDir = getScriptsDir();
  const tempFile = `${scriptsDir}/${prefix}-${hash}.ts`;

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
  // Note: tsCode is NOT stored here - it's read from the script file during retry
  const pending: PendingCommand = {
    id,
    commands: [], // Will be filled by initCmds if commands are blocked
    cwd: Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };
  const pendingFile = getPendingFilePath(id);
  Deno.writeTextFileSync(pendingFile, JSON.stringify(pending, null, 2));

  // Create desh command with file path and pass ID via env var
  // Also pass allowProjectCommands flag so desh runtime allows project scripts
  const deshCommand = `SAFESH_SCRIPT_ID=${id} SAFESH_ALLOW_PROJECT_COMMANDS=true ${DESH_CMD} -q -f ${tempFile}`;

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
  // Add marker to prove code went through SafeShell transpilation
  const markedCode = `console.error("# /*#*/ ${projectDir}");\n${tsCode}`;

  // Generate hash-based ID for caching and retry
  // For bash: hash original command to cache transpiled result
  // For /*#*/ scripts: hash TypeScript code directly
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);
  const id = hash;

  // Save metadata for potential retry (if initCmds encounters blocked commands)
  // Note: tsCode is NOT stored here - it's read from the script file during retry
  const pending: PendingCommand = {
    id,
    commands: [], // Will be filled by initCmds if commands are blocked
    cwd: Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };
  const pendingFile = getPendingFilePath(id);
  Deno.writeTextFileSync(pendingFile, JSON.stringify(pending, null, 2));

  // Create desh heredoc command with ID via env var
  // Also pass allowProjectCommands flag so desh runtime allows project scripts
  const deshCommand = `SAFESH_SCRIPT_ID=${id} SAFESH_ALLOW_PROJECT_COMMANDS=true ${DESH_CMD} -q <<'SAFESH_EOF'\n${markedCode}\nSAFESH_EOF`;

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
interface PendingCommand {
  id: string;
  commands: string[];  // Disallowed commands (filled by initCmds)
  cwd: string;
  timeout?: number;
  runInBackground?: boolean;
  createdAt: string;
  // Note: tsCode removed - read from script file using id/hash
}

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

  // Generate hash-based ID for caching and retry
  // For bash: hash original command to cache transpiled result
  // For /*#*/ scripts: hash TypeScript code directly
  const hashInput = options?.originalCommand || tsCode;
  const hash = await hashContent(hashInput);
  const prefix = "tx-script"; // Denied commands are always transpiled bash
  const id = hash;
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

  // Save pending command metadata to temp file (without tsCode)
  const pending: PendingCommand = {
    id,
    commands: disallowedCommands,
    cwd: Deno.cwd(),
    timeout: options?.timeout,
    runInBackground: options?.runInBackground,
    createdAt: new Date().toISOString(),
  };

  const pendingFile = getPendingFilePath(id);
  Deno.writeTextFileSync(pendingFile, JSON.stringify(pending, null, 2));

  // Build deny message with retry instructions for LLM
  const message = `[SAFESH] BLOCKED: ${cmdList}

WAIT for user choice (1-4):
1. Allow once
2. Always allow
3. Allow for session
4. Deny

DO NOT SHOW OR REPEAT OPTIONS. AFTER USER RESPONDS: desh retry --id=${id} --choice=<user's choice>`;

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

    // Check if command is already TypeScript (skip transpilation and permission check)
    let tsCode = detectTypeScript(parsed.command);
    if (tsCode) {
      debug("TypeScript detected, rewriting to desh");

      // Add error handlers for better error formatting (without storing original command)
      tsCode = `// Global error handlers for unhandled errors
globalThis.addEventListener("error", (event) => {
  event.preventDefault();
  const error = event.error;
  const errorFile = \`${getErrorLogPath()}\`;

  const errorMsg = [
    "=== TypeScript Error ===",
    \`Error: \${error?.message || error}\`,
    error?.stack ? \`\nStack trace:\n\${error.stack}\` : "",
    "=======================\\n"
  ].join("\\n");

  try {
    Deno.writeTextFileSync(errorFile, errorMsg);
    console.error(\`\\nError log: \${errorFile}\`);
  } catch {}

  console.error(errorMsg);
  Deno.exit(1);
});

globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  const reason = event.reason;
  const errorFile = \`${getErrorLogPath()}\`;

  const errorMsg = [
    "=== Unhandled Promise Rejection ===",
    \`Error: \${reason?.message || reason}\`,
    reason?.stack ? \`\nStack trace:\n\${reason.stack}\` : "",
    "===================================\\n"
  ].join("\\n");

  try {
    Deno.writeTextFileSync(errorFile, errorMsg);
    console.error(\`\\nError log: \${errorFile}\`);
  } catch {}

  console.error(errorMsg);
  Deno.exit(1);
});

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

    // Check command complexity
    // Simple commands: passthrough to native bash (let Bash tool handle permissions)
    // Complex commands: transpile to TypeScript (need SafeShell runtime)
    if (isSimpleCommand(ast)) {
      debug("Simple command detected - passthrough to native bash");
      outputPassthrough();
      Deno.exit(0);
    }

    // Complex command - extract commands for permission checking
    debug(`Complex command detected - will transpile and check permissions`);
    const commands = extractCommands(ast);
    debug(`Extracted commands: ${[...commands].join(", ") || "(none)"}`);

    // Check which commands are not allowed
    const disallowed = getDisallowedCommands(commands, config, cwd);

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
      /\.pipe\(.{1,500}\)\.pipe\(.{1,500}\)\.stdout\(\)/,  // Calling stdout() after multiple pipes - invalid (with nested parens)
      /\.lines\(\)\.pipe\(.{1,500}\)\.lines\(\)/,  // Calling .lines() twice with pipe - invalid
    ];

    for (const pattern of knownBadPatterns) {
      if (pattern.test(tsCode)) {
        const message = `[SAFESH] Transpiler Error: The bash script is too complex for automatic transpilation.

DO NOT USE BASH FOR SCRIPTS THAT ARE TOO COMPLEX. Use safesh /*#*/ TypeScript instead.

Example:
  /*#*/
  const branches = (await $.cmd('git', 'branch', '-r').text()).split('\\n');
  for (const branch of branches) {
    console.log(\`Branch: \${branch}\`);
  }
`;

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
    const preview = parsed.command.length > 100 ? parsed.command.slice(0, 100) + "..." : parsed.command;
    const previewEscaped = preview.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

    // Add global error handlers to catch all errors (sync and async)
    tsCode = `const __ORIGINAL_BASH_COMMAND__ = \`${bashCommandEscaped}\`;
const __handleError = (error) => {
  const fullCommand = __ORIGINAL_BASH_COMMAND__;

  // Generate unique error log file (directory is auto-created)
  const errorFile = \`${getErrorLogPath()}\`;

  // Build full error message
  const errorMsg = [
    "=== Bash Command Error ===",
    \`Command: \${fullCommand}\`,
    \`\\nError: \${error.message || error}\`,
    error.stack ? \`\\nStack trace:\\n\${error.stack}\` : "",
    "=========================\\n"
  ].join("\\n");

  // Write to file
  try {
    Deno.writeTextFileSync(errorFile, errorMsg);
  } catch (e) {
    console.error("Warning: Could not write error log:", e);
  }

  // Output with file reference first
  console.error(\`\\nError log: \${errorFile}\`);
  console.error(errorMsg);
  Deno.exit(1);
};

// Global error handlers for uncaught errors
globalThis.addEventListener("error", (event) => {
  event.preventDefault();
  __handleError(event.error);
});

globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  __handleError(event.reason);
});

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
