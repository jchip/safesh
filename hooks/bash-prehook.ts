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
import { loadConfig, mergeConfigs } from "../src/core/config.ts";
import { executeCode, executeCodeStreaming } from "../src/runtime/executor.ts";
import { SafeShellError } from "../src/core/errors.ts";

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
  /^desh\b/,              // desh CLI
  /^\.\/src\/cli\/desh\.ts\b/,  // desh via path
  /desh\.ts\b/,           // any desh.ts path
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
 * Exit 0 with no output = hook succeeded, allow normal execution
 */
function outputPassthrough(): void {
  // No output, just exit 0 - signals success without blocking
}

/**
 * SafeShell TypeScript signature prefix
 * Agent must prefix code with this to indicate it's SafeShell TypeScript
 */
const SAFESH_SIGNATURE = "/*$*/";

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

  // Check for SafeShell signature prefix: /*$*/
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
 * Transpile bash command to TypeScript
 */
function transpileBash(bashCommand: string): string {
  debug(`Transpiling bash command: ${bashCommand}`);

  try {
    // Parse bash command to AST
    const ast = parse(bashCommand);

    // Transpile without imports - executeCode will add the preamble with $ namespace
    const code = transpile(ast, {
      imports: false,  // Don't generate import statements
      strict: false,   // Don't add "use strict" (preamble may add it)
    });

    debug(`Transpiled successfully`);
    debug(`Generated code:\n${code}`);
    return code;
  } catch (error) {
    throw new SafeShellError(
      `Failed to transpile bash command: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
 */
function outputRewriteToDeshFile(tsCode: string, options?: { timeout?: number; runInBackground?: boolean }): void {
  // Add marker to prove code went through SafeShell transpilation
  const markedCode = `console.error("# /*$*/");\n${tsCode}`;

  // Write to temp file using timestamp + pid for uniqueness
  const tempFile = `/tmp/safesh-${Date.now()}-${Deno.pid}.ts`;
  Deno.writeTextFileSync(tempFile, markedCode);

  // Create desh command with file path
  const deshCommand = `${DESH_CMD} -q -f ${tempFile}`;

  outputHookResponse(deshCommand, options);
}

/**
 * Output hook decision to rewrite command as desh heredoc
 * Uses heredoc to pass code inline
 */
function outputRewriteToDeshHeredoc(tsCode: string, options?: { timeout?: number; runInBackground?: boolean }): void {
  // Add marker to prove code went through SafeShell transpilation
  const markedCode = `console.error("# /*$*/");\n${tsCode}`;

  // Create desh heredoc command
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
 * Output hook decision to rewrite command to desh
 * Uses file mode by default, heredoc if configured
 */
function outputRewriteToDesh(tsCode: string, options?: { timeout?: number; runInBackground?: boolean }): void {
  if (DESH_MODE === "heredoc") {
    outputRewriteToDeshHeredoc(tsCode, options);
  } else {
    outputRewriteToDeshFile(tsCode, options);
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
  try {
    // Get the bash command with options
    const parsed = await getBashCommand();

    if (!parsed.command) {
      console.error("Error: Empty bash command provided");
      Deno.exit(1);
    }

    // Check if command should pass through to native bash (e.g., desh)
    if (shouldPassthrough(parsed.command)) {
      outputPassthrough();
      Deno.exit(0);
    }

    // Determine working directory
    const cwd = OVERRIDE_CWD || Deno.cwd();
    debug(`Working directory: ${cwd}`);

    // Load SafeShell config
    const projectDir = Deno.env.get("CLAUDE_PROJECT_DIR") || cwd;
    const baseConfig = await loadConfig(cwd, { logWarnings: false });
    const config = mergeConfigs(baseConfig, { projectDir });
    debug(`Config loaded. ProjectDir: ${projectDir}`);

    // Check if command is already TypeScript (skip transpilation)
    let tsCode = detectTypeScript(parsed.command);
    if (tsCode) {
      debug("TypeScript detected, rewriting to desh");
    } else {
      // Transpile bash to TypeScript
      tsCode = transpileBash(parsed.command);
      debug("Bash transpiled to TypeScript, rewriting to desh");
    }

    // Rewrite command to use desh with heredoc
    // Pass through timeout and run_in_background options
    outputRewriteToDesh(tsCode, {
      timeout: parsed.timeout,
      runInBackground: parsed.runInBackground,
    });
    Deno.exit(0);
  } catch (error) {
    // On error, output error message and let it through
    // (desh will show the error when it tries to run)
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Transpilation error: ${errorMsg}`);
    // Exit 2 to signal error, native bash won't run
    Deno.exit(2);
  }
}

if (import.meta.main) {
  main();
}
