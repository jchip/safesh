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
import { hashCode, buildEnv, cleanupProcess } from "../core/utils.ts";
import { buildPreamble, buildErrorHandler, extractPreambleConfig } from "./preamble.ts";
import { getScriptsDir } from "../core/temp.ts";

const TEMP_DIR = getScriptsDir();
const DEFAULT_TIMEOUT = 30000;


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
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        throw timeoutError(timeoutMs, `${label} (streaming)`);
      }

      const promises: Array<{ promise: Promise<ReadableStreamReadResult<Uint8Array>>; type: "stdout" | "stderr" }> = [];

      if (!stdoutDone) {
        promises.push({ promise: stdoutPromise, type: "stdout" });
      }
      if (!stderrDone) {
        promises.push({ promise: stderrPromise, type: "stderr" });
      }

      // SSH-563: Race a timeout against stream reads so hanging processes get killed
      const remaining = timeoutMs - elapsed;
      let timerId: number | undefined;
      const result = await Promise.race([
        ...promises.map(async ({ promise, type }) => ({
          result: await promise,
          type: type as "stdout" | "stderr",
          timedOut: false as const,
        })),
        new Promise<{ timedOut: true; type: "timeout"; result: null }>((resolve) => {
          timerId = setTimeout(() => resolve({ timedOut: true, type: "timeout", result: null }), remaining) as unknown as number;
        }),
      ]);
      clearTimeout(timerId);

      if (result.timedOut) {
        throw timeoutError(timeoutMs, `${label} (streaming)`);
      }

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
    // Release readers before cleanup so streams can be canceled
    try { stdoutReader.cancel(); } catch { /* already closed */ }
    try { stderrReader.cancel(); } catch { /* already closed */ }
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

  // Build full code with preamble and error handler from canonical preamble module
  const preambleConfig = extractPreambleConfig(config, cwd);
  const { preamble, preambleLineCount } = buildPreamble(shell, preambleConfig);
  const errorHandler = buildErrorHandler(scriptPath, preambleLineCount, !!shell);
  const fullCode = preamble + code + errorHandler;

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
