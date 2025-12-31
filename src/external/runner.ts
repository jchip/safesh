/**
 * External command runner
 *
 * Executes validated external commands via Deno.Command.
 * Provides timeout handling and structured result output.
 */

import { deadline } from "@std/async";
import { executionError, timeout as timeoutError } from "../core/errors.ts";
import type { ExecResult, RunOptions, SafeShellConfig, Shell } from "../core/types.ts";
import { createRegistry } from "./registry.ts";
import { validateExternal } from "./validator.ts";
import { writeStdin } from "../stdlib/io.ts";
import { cleanupProcess } from "../core/utils.ts";

const DEFAULT_TIMEOUT = 30000;

/**
 * Execute a validated external command
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param config - SafeShell configuration
 * @param options - Execution options (timeout, cwd, env, shellId)
 * @param shell - Optional shell for context
 * @returns Promise<ExecResult> with stdout, stderr, code, and success
 */
export async function runExternal(
  command: string,
  args: string[],
  config: SafeShellConfig,
  options: RunOptions = {},
  shell?: Shell,
): Promise<ExecResult> {
  const cwd = options.cwd ?? shell?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT;

  // Create command registry and validate
  const registry = createRegistry(config);
  const validationResult = await validateExternal(command, args, registry, config, cwd);

  if (!validationResult.valid) {
    throw validationResult.error;
  }

  // Build environment variables
  const processEnv = buildEnv(config, shell, options.env);

  // Check if stdin is provided
  const hasStdin = options.stdin !== undefined;

  // Create Deno command
  const cmd = new Deno.Command(command, {
    args,
    cwd,
    env: processEnv,
    clearEnv: true, // Don't inherit parent environment
    stdout: "piped",
    stderr: "piped",
    stdin: hasStdin ? "piped" : undefined,
  });

  // Spawn process
  const process = cmd.spawn();

  try {
    // Create a promise that collects output (and writes stdin if provided)
    const outputPromise = (async () => {
      const promises: Promise<unknown>[] = [
        process.status,
        collectStream(process.stdout),
        collectStream(process.stderr),
      ];

      // Write stdin concurrently to avoid deadlock
      if (hasStdin && process.stdin) {
        promises.push(writeStdin(process.stdin, options.stdin!));
      }

      const [status, stdout, stderr] = (await Promise.all(promises)) as [
        Deno.CommandStatus,
        string,
        string,
      ];
      return { status, stdout, stderr };
    })();

    // Run with timeout
    const { status, stdout, stderr } = await deadline(outputPromise, timeoutMs);

    return {
      stdout,
      stderr,
      code: status.code,
      success: status.code === 0,
    };
  } catch (error) {
    // Kill the process and cancel streams on timeout or error
    await cleanupProcess(process);

    // Also close stdin if it was used
    if (hasStdin) {
      try {
        await process.stdin.close();
      } catch {
        // Stream may already be closed
      }
    }

    // Handle timeout errors
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw timeoutError(timeoutMs, "run");
    }

    throw executionError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Collect a readable stream into a string
 */
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

/**
 * Build environment variables for the subprocess
 */
function buildEnv(
  config: SafeShellConfig,
  shell?: Shell,
  additionalEnv?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const envConfig = config.env ?? {};
  const allowList = envConfig.allow ?? [];
  const maskPatterns = envConfig.mask ?? [];

  // Helper to check if a key matches any mask pattern
  const isMasked = (key: string): boolean => {
    if (maskPatterns.length === 0) return false;
    return maskPatterns.some((pattern) => {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*") + "$",
      );
      return regex.test(key);
    });
  };

  // Copy allowed env vars from current process
  for (const key of allowList) {
    if (!isMasked(key)) {
      const value = Deno.env.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  // Merge shell env vars (they override)
  if (shell?.env) {
    for (const [key, value] of Object.entries(shell.env)) {
      if (!isMasked(key)) {
        result[key] = value;
      }
    }
  }

  // Merge additional env vars (they override everything)
  if (additionalEnv) {
    for (const [key, value] of Object.entries(additionalEnv)) {
      if (!isMasked(key)) {
        result[key] = value;
      }
    }
  }

  return result;
}
