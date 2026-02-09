/**
 * Streaming execution functions
 *
 * Provides real-time output streaming for long-running commands
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { timeout as timeoutError } from "../core/errors.ts";
import type { ExecOptions, SafeShellConfig, Shell, StreamChunk } from "../core/types.ts";
import { buildPermissionFlags, findConfig } from "./executor.ts";
import { cleanupProcess } from "../core/utils.ts";
import { getScriptsDir } from "../core/temp.ts";

const TEMP_DIR = getScriptsDir();
const DEFAULT_TIMEOUT = 30000;

/**
 * Hash code to create a cache key
 */
async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the preamble that gets prepended to user code
 */
function buildPreamble(shell?: Shell): string {
  if (!shell) {
    return "";
  }

  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    "// Shell context available on $ namespace",
    `(globalThis as any).$ = {`,
    `  ID: ${JSON.stringify(shell.id)},`,
    `  CWD: ${JSON.stringify(shell.cwd)},`,
    `  ENV: ${JSON.stringify(shell.env)},`,
    `  VARS: ${JSON.stringify(shell.vars)},`,
    `};`,
    "",
    "// User code starts here",
    "",
  ];

  return lines.join("\n");
}

/**
 * Build environment variables for subprocess
 */
function buildEnv(
  config: SafeShellConfig,
  shell?: Shell,
): Record<string, string> {
  const result: Record<string, string> = {};
  const envConfig = config.env ?? {};
  const allowList = envConfig.allow ?? [];
  const maskPatterns = envConfig.mask ?? [];

  // Helper to check if a key matches any mask pattern
  const isMasked = (key: string): boolean => {
    return maskPatterns.some((pattern) => {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*") + "$",
      );
      return regex.test(key);
    });
  };

  // Copy allowed env vars that aren't masked
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

  return result;
}


/**
 * Stream stdout and stderr from a spawned process with timeout support.
 * Common async generator used by both executeCodeStreaming and runCommandStreaming.
 */
async function* streamProcess(
  process: Deno.ChildProcess,
  timeoutMs: number,
  label: string,
): AsyncGenerator<StreamChunk> {
  const decoder = new TextDecoder();
  const startTime = Date.now();

  try {
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();

    let stdoutDone = false;
    let stderrDone = false;

    let stdoutPromise = stdoutReader.read();
    let stderrPromise = stderrReader.read();

    while (!stdoutDone || !stderrDone) {
      if (Date.now() - startTime > timeoutMs) {
        throw timeoutError(timeoutMs, `${label} (streaming)`);
      }

      const promises: Array<{ promise: Promise<ReadableStreamReadResult<Uint8Array>>; type: "stdout" | "stderr" }> = [];

      if (!stdoutDone) {
        promises.push({ promise: stdoutPromise, type: "stdout" });
      }
      if (!stderrDone) {
        promises.push({ promise: stderrPromise, type: "stderr" });
      }

      const result = await Promise.race(
        promises.map(async ({ promise, type }) => ({
          result: await promise,
          type,
        }))
      );

      if (result.type === "stdout") {
        if (result.result.done) {
          stdoutDone = true;
        } else if (result.result.value) {
          yield { type: "stdout", data: decoder.decode(result.result.value, { stream: true }) };
          stdoutPromise = stdoutReader.read();
        }
      } else {
        if (result.result.done) {
          stderrDone = true;
        } else if (result.result.value) {
          yield { type: "stderr", data: decoder.decode(result.result.value, { stream: true }) };
          stderrPromise = stderrReader.read();
        }
      }
    }

    const status = await process.status;
    yield { type: "exit", code: status.code };
  } catch (error) {
    await cleanupProcess(process);
    throw error;
  }
}

/**
 * Execute code with streaming output
 * Yields chunks as they arrive from stdout/stderr in real-time
 */
export async function* executeCodeStreaming(
  code: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
  shell?: Shell,
): AsyncGenerator<StreamChunk> {
  const cwd = options.cwd ?? shell?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT;

  // Ensure temp directory exists
  await ensureDir(TEMP_DIR);

  // Create script file
  const hash = await hashCode(code);
  const scriptPath = join(TEMP_DIR, `${hash}.ts`);

  // Build full code with preamble
  const preamble = buildPreamble(shell);
  const fullCode = preamble + code;

  // Write script to temp file
  await Deno.writeTextFile(scriptPath, fullCode);

  // Build command
  const permFlags = buildPermissionFlags(config, cwd);
  const configPath = await findConfig(cwd);

  const args = [
    "run",
    "--no-prompt",
    ...permFlags,
  ];

  if (configPath) {
    args.push(`--config=${configPath}`);
  }

  args.push(scriptPath);

  const command = new Deno.Command("deno", {
    args,
    cwd,
    env: buildEnv(config, shell),
    stdout: "piped",
    stderr: "piped",
  });

  yield* streamProcess(command.spawn(), timeoutMs, "exec");
}

/**
 * Execute external command with streaming output
 */
export async function* runCommandStreaming(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): AsyncGenerator<StreamChunk> {
  const processEnv = { ...Deno.env.toObject(), ...env };

  const cmd = new Deno.Command(command, {
    args,
    cwd,
    env: processEnv,
    stdout: "piped",
    stderr: "piped",
  });

  yield* streamProcess(cmd.spawn(), timeoutMs, "run");
}
