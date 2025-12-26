/**
 * Streaming execution functions
 *
 * Provides real-time output streaming for long-running commands
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { timeout as timeoutError } from "../core/errors.ts";
import type { ExecOptions, SafeShellConfig, Session, StreamChunk } from "../core/types.ts";
import { buildPermissionFlags, findConfig } from "./executor.ts";

const TEMP_DIR = "/tmp/safesh/scripts";
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
function buildPreamble(session?: Session): string {
  if (!session) {
    return "";
  }

  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    "// Session context available as $session",
    `const $session = ${JSON.stringify({
      id: session.id,
      cwd: session.cwd,
      env: session.env,
      vars: session.vars,
    })};`,
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
  session?: Session,
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

  // Merge session env vars (they override)
  if (session?.env) {
    for (const [key, value] of Object.entries(session.env)) {
      if (!isMasked(key)) {
        result[key] = value;
      }
    }
  }

  return result;
}


/**
 * Execute code with streaming output
 * Yields chunks as they arrive from stdout/stderr in real-time
 */
export async function* executeCodeStreaming(
  code: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
  session?: Session,
): AsyncGenerator<StreamChunk> {
  const cwd = options.cwd ?? session?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT;

  // Ensure temp directory exists
  await ensureDir(TEMP_DIR);

  // Create script file
  const hash = await hashCode(code);
  const scriptPath = join(TEMP_DIR, `${hash}.ts`);

  // Build full code with preamble
  const preamble = buildPreamble(session);
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

  // Create command
  const command = new Deno.Command("deno", {
    args,
    cwd,
    env: buildEnv(config, session),
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();
  const decoder = new TextDecoder();
  const startTime = Date.now();

  try {
    // Read both stdout and stderr concurrently
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();

    // Track pending reads
    let stdoutDone = false;
    let stderrDone = false;

    // Initiate first reads
    let stdoutPromise = stdoutReader.read();
    let stderrPromise = stderrReader.read();

    // Stream chunks as they arrive
    while (!stdoutDone || !stderrDone) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw timeoutError(timeoutMs, "exec (streaming)");
      }

      // Race the pending reads
      const promises: Array<{ promise: Promise<ReadableStreamReadResult<Uint8Array>>; type: "stdout" | "stderr" }> = [];

      if (!stdoutDone) {
        promises.push({ promise: stdoutPromise, type: "stdout" });
      }
      if (!stderrDone) {
        promises.push({ promise: stderrPromise, type: "stderr" });
      }

      // Wait for first chunk
      const result = await Promise.race(
        promises.map(async ({ promise, type }) => ({
          result: await promise,
          type,
        }))
      );

      // Handle the chunk
      if (result.type === "stdout") {
        if (result.result.done) {
          stdoutDone = true;
        } else if (result.result.value) {
          yield { type: "stdout", data: decoder.decode(result.result.value, { stream: true }) };
          // Start next read
          stdoutPromise = stdoutReader.read();
        }
      } else {
        if (result.result.done) {
          stderrDone = true;
        } else if (result.result.value) {
          yield { type: "stderr", data: decoder.decode(result.result.value, { stream: true }) };
          // Start next read
          stderrPromise = stderrReader.read();
        }
      }
    }

    // Get exit status
    const status = await process.status;
    yield { type: "exit", code: status.code };
  } catch (error) {
    // Kill process on error/timeout
    try {
      process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }

    // Cancel streams
    try {
      await process.stdout.cancel();
    } catch {
      // Stream may already be closed
    }
    try {
      await process.stderr.cancel();
    } catch {
      // Stream may already be closed
    }

    throw error;
  }
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
  // Merge session env with process env
  const processEnv = { ...Deno.env.toObject(), ...env };

  const cmd = new Deno.Command(command, {
    args,
    cwd,
    env: processEnv,
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const decoder = new TextDecoder();
  const startTime = Date.now();

  try {
    // Read both stdout and stderr concurrently
    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();

    // Track pending reads
    let stdoutDone = false;
    let stderrDone = false;

    // Initiate first reads
    let stdoutPromise = stdoutReader.read();
    let stderrPromise = stderrReader.read();

    // Stream chunks as they arrive
    while (!stdoutDone || !stderrDone) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        throw timeoutError(timeoutMs, "run (streaming)");
      }

      // Race the pending reads
      const promises: Array<{ promise: Promise<ReadableStreamReadResult<Uint8Array>>; type: "stdout" | "stderr" }> = [];

      if (!stdoutDone) {
        promises.push({ promise: stdoutPromise, type: "stdout" });
      }
      if (!stderrDone) {
        promises.push({ promise: stderrPromise, type: "stderr" });
      }

      // Wait for first chunk
      const result = await Promise.race(
        promises.map(async ({ promise, type }) => ({
          result: await promise,
          type,
        }))
      );

      // Handle the chunk
      if (result.type === "stdout") {
        if (result.result.done) {
          stdoutDone = true;
        } else if (result.result.value) {
          yield { type: "stdout", data: decoder.decode(result.result.value, { stream: true }) };
          // Start next read
          stdoutPromise = stdoutReader.read();
        }
      } else {
        if (result.result.done) {
          stderrDone = true;
        } else if (result.result.value) {
          yield { type: "stderr", data: decoder.decode(result.result.value, { stream: true }) };
          // Start next read
          stderrPromise = stderrReader.read();
        }
      }
    }

    // Get exit status
    const status = await process.status;
    yield { type: "exit", code: status.code };
  } catch (error) {
    // Kill process on error/timeout
    try {
      process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }

    // Cancel streams
    try {
      await process.stdout.cancel();
    } catch {
      // Stream may already be closed
    }
    try {
      await process.stderr.cancel();
    } catch {
      // Stream may already be closed
    }

    throw error;
  }
}
