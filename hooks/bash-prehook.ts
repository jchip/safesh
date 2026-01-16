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
 * Get bash command from args or stdin
 */
async function getBashCommand(): Promise<string> {
  // Check if command passed as argument
  if (Deno.args.length > 0) {
    const cmd = Deno.args.join(" ");
    debug(`Command from args: ${cmd}`);
    return cmd;
  }

  // Check if stdin has data (piped)
  if (!Deno.stdin.isTerminal()) {
    const cmd = await readStdin();
    debug(`Command from stdin: ${cmd}`);
    return cmd.trim();
  }

  throw new Error("No bash command provided. Pass as argument or via stdin.");
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
 * Execute TypeScript code in buffered mode
 */
async function executeBuffered(
  code: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  cwd: string,
): Promise<void> {
  debug("Executing in buffered mode");

  try {
    const result = await executeCode(code, config, { cwd });

    // Write stdout
    if (result.stdout) {
      await Deno.stdout.write(new TextEncoder().encode(result.stdout));
    }

    // Write stderr
    if (result.stderr) {
      await Deno.stderr.write(new TextEncoder().encode(result.stderr));
    }

    // Exit with same code
    debug(`Execution completed with exit code: ${result.code}`);
    Deno.exit(result.code);
  } catch (error) {
    if (error instanceof SafeShellError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Execution failed: ${error}`);
    }
    Deno.exit(1);
  }
}

/**
 * Execute TypeScript code in streaming mode
 */
async function executeStreaming(
  code: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  cwd: string,
): Promise<void> {
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
    Deno.exit(exitCode);
  } catch (error) {
    if (error instanceof SafeShellError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Execution failed: ${error}`);
    }
    Deno.exit(1);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  try {
    // Get the bash command
    const bashCommand = await getBashCommand();

    if (!bashCommand) {
      console.error("Error: Empty bash command provided");
      Deno.exit(1);
    }

    // Determine working directory
    const cwd = OVERRIDE_CWD || Deno.cwd();
    debug(`Working directory: ${cwd}`);

    // Load SafeShell config
    const projectDir = Deno.env.get("CLAUDE_PROJECT_DIR") || cwd;
    const baseConfig = await loadConfig(cwd, { logWarnings: false });
    const config = mergeConfigs(baseConfig, { projectDir });
    debug(`Config loaded. ProjectDir: ${projectDir}`);

    // Transpile bash to TypeScript
    const tsCode = transpileBash(bashCommand);

    // Execute based on mode
    if (MODE === "streaming") {
      await executeStreaming(tsCode, config, cwd);
    } else {
      await executeBuffered(tsCode, config, cwd);
    }
  } catch (error) {
    if (error instanceof SafeShellError) {
      console.error(`Error: ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`Fatal error: ${error.message}`);
      if (DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error(`Fatal error: ${String(error)}`);
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
