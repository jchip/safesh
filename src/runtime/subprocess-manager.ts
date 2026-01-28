/**
 * Subprocess management for SafeShell
 *
 * Handles spawning and lifecycle management of Deno subprocesses that execute
 * user code. Responsible for:
 * - Building Deno command arguments
 * - Spawning subprocess with proper I/O configuration
 * - Collecting stdout/stderr with optional real-time scanning
 * - Timeout enforcement and process cleanup
 * - PID tracking and lifecycle callbacks
 *
 * @module
 */

import { deadline } from "@std/async";
import { collectStreamText, cleanupProcess } from "../core/utils.ts";
import { executionError, timeout as timeoutError } from "../core/errors.ts";

/** Options for building Deno command arguments */
export interface DenoArgsOptions {
  /** Permission flags to include */
  permFlags: string[];
  /** Import map path */
  importMapPath: string;
  /** Config file path (deno.json) */
  configPath?: string;
  /** Script path to execute */
  scriptPath: string;
  /** Additional Deno CLI flags */
  denoFlags?: string[];
}

/**
 * Build Deno run command arguments
 */
export function buildDenoArgs(options: DenoArgsOptions): string[] {
  const { permFlags, importMapPath, configPath, scriptPath, denoFlags } = options;
  const args = [
    "run",
    "--no-prompt", // Never prompt for permissions
    `--import-map=${importMapPath}`,
    ...(denoFlags ?? []),
    ...permFlags,
  ];

  if (configPath) {
    args.push(`--config=${configPath}`);
  }

  args.push(scriptPath);
  return args;
}

/** Options for spawning subprocess */
export interface SpawnOptions {
  /** Deno command arguments */
  args: string[];
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env: Record<string, string>;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Optional callback invoked with PID immediately after spawn */
  onSpawn?: (pid: number) => void;
  /** Optional callback invoked on timeout (before throwing) */
  onTimeout?: () => void;
  /** Optional callback invoked on error (before throwing) */
  onError?: () => void;
  /** Optional callback for stderr lines (real-time) */
  onStderrLine?: (line: string) => void;
}

/** Raw output from subprocess */
export interface SubprocessOutput {
  /** Process exit status */
  status: Deno.CommandStatus;
  /** Raw stdout text */
  stdout: string;
  /** Raw stderr text */
  stderr: string;
  /** Process ID */
  pid: number;
}

/**
 * Collect a readable stream into a string, scanning for lines in real-time
 */
async function collectAndScanStreamText(
  stream: ReadableStream<Uint8Array>,
  onLine?: (line: string) => void
): Promise<string> {
  if (!onLine) {
    return collectStreamText(stream);
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        text += chunk;
        buffer += chunk;

        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
           const line = buffer.slice(0, idx);
           onLine(line);
           buffer = buffer.slice(idx + 1);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Process remaining buffer if it contains data
  if (buffer.length > 0) {
      onLine(buffer);
  }

  return text;
}

/**
 * SubprocessManager - spawns and manages Deno subprocess execution
 *
 * Provides a clean interface for spawning Deno subprocesses with:
 * - Configurable timeout with automatic cleanup
 * - Real-time stderr line processing
 * - PID tracking with spawn callback
 * - Lifecycle event callbacks (spawn, timeout, error)
 */
export class SubprocessManager {
  /**
   * Spawn Deno subprocess and collect output with timeout
   *
   * @throws {Error} On timeout or execution error
   */
  async spawnAndCollectOutput(options: SpawnOptions): Promise<SubprocessOutput> {
    const { args, cwd, env, timeoutMs, onSpawn, onTimeout, onError, onStderrLine } = options;

    const command = new Deno.Command("deno", {
      args,
      cwd,
      env,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    // Notify caller of PID immediately after spawn
    onSpawn?.(process.pid);

    try {
      const outputPromise = (async () => {
        const [status, stdout, stderr] = await Promise.all([
          process.status,
          collectStreamText(process.stdout),
          collectAndScanStreamText(process.stderr, onStderrLine),
        ]);
        return { status, stdout, stderr, pid: process.pid };
      })();

      return await deadline(outputPromise, timeoutMs);
    } catch (error) {
      // Kill the process and cancel streams on timeout or error
      await cleanupProcess(process);

      if (error instanceof DOMException && error.name === "TimeoutError") {
        onTimeout?.();
        throw timeoutError(timeoutMs, "exec");
      }
      onError?.();
      throw executionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Build Deno run command arguments
   *
   * Convenience method that delegates to buildDenoArgs function
   */
  buildDenoArgs(options: DenoArgsOptions): string[] {
    return buildDenoArgs(options);
  }
}
