/**
 * Background job control for SafeShell
 *
 * Provides functionality to:
 * - Launch background jobs (code or external commands)
 * - Track running jobs with buffered output
 * - Query job status and output
 * - Stop jobs with signal support
 * - Stream job output (foreground mode)
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { Job, SafeShellConfig, Session } from "../core/types.ts";
import { JOB_OUTPUT_LIMIT } from "../core/types.ts";
import { buildPermissionFlags, findConfig } from "./executor.ts";
import { executionError } from "../core/errors.ts";

const TEMP_DIR = "/tmp/safesh/scripts";

/**
 * Truncate output to limit, keeping most recent content
 */
export function truncateOutput(
  output: string,
  limit: number = JOB_OUTPUT_LIMIT,
): { text: string; truncated: boolean } {
  if (output.length <= limit) {
    return { text: output, truncated: false };
  }
  return { text: output.slice(-limit), truncated: true };
}

/**
 * Generate a new job ID for a session
 */
export function generateJobId(session: Session): string {
  const seq = session.jobSequence++;
  return `job-${session.id}-${seq}`;
}

/**
 * Create a new job record
 */
export function createJob(
  session: Session,
  code: string,
  background: boolean,
  pid: number = 0,
): Job {
  return {
    id: generateJobId(session),
    code,
    pid,
    status: "running",
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    startedAt: new Date(),
    background,
  };
}

/**
 * Launch a background job from code
 */
export async function launchCodeJob(
  code: string,
  config: SafeShellConfig,
  session: Session,
): Promise<Job> {
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
  const permFlags = buildPermissionFlags(config, session.cwd);
  const configPath = await findConfig(session.cwd);

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
    cwd: session.cwd,
    env: buildEnv(config, session),
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process
  const process = command.spawn();

  // Create job with new structure
  const job = createJob(session, code, true, process.pid);
  job.process = process;

  // Add to session maps
  session.jobs.set(job.id, job);
  session.jobsByPid.set(job.pid, job.id);

  // Start collecting output in background
  collectJobOutput(job);

  return job;
}

/**
 * Launch a background job from external command
 */
export async function launchCommandJob(
  command: string,
  args: string[],
  config: SafeShellConfig,
  session: Session,
): Promise<Job> {
  // Build environment
  const processEnv = buildEnv(config, session);

  // Create command
  const cmd = new Deno.Command(command, {
    args,
    cwd: session.cwd,
    env: processEnv,
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process
  const process = cmd.spawn();

  // Create job with command as code
  const code = `${command} ${args.join(" ")}`;
  const job = createJob(session, code, true, process.pid);
  job.process = process;

  // Add to session maps
  session.jobs.set(job.id, job);
  session.jobsByPid.set(job.pid, job.id);

  // Start collecting output in background
  collectJobOutput(job);

  return job;
}

/**
 * Get buffered output from a job
 */
export function getJobOutput(
  job: Job,
  since?: number,
): {
  stdout: string;
  stderr: string;
  offset: number;
  status: Job["status"];
  exitCode?: number;
  truncated: { stdout: boolean; stderr: boolean };
} {
  const stdoutOffset = since ?? 0;
  const stderrOffset = since ?? 0;

  return {
    stdout: job.stdout.slice(stdoutOffset),
    stderr: job.stderr.slice(stderrOffset),
    offset: job.stdout.length,
    status: job.status,
    exitCode: job.exitCode,
    truncated: {
      stdout: job.stdoutTruncated,
      stderr: job.stderrTruncated,
    },
  };
}

/**
 * Kill a job with specified signal
 */
export async function killJob(job: Job, signal: Deno.Signal = "SIGTERM"): Promise<void> {
  if (!job.process) {
    throw executionError("Job process not available");
  }

  if (job.status !== "running") {
    throw executionError(`Job is not running (status: ${job.status})`);
  }

  // Send signal to process
  try {
    job.process.kill(signal);

    // Wait for process to exit (with timeout)
    const timeoutId = setTimeout(() => {
      // Force kill if still running after 5 seconds
      try {
        job.process?.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }, 5000);

    await job.process.status;
    clearTimeout(timeoutId);

    job.status = "failed";
    job.exitCode = -1;
    job.completedAt = new Date();
    job.duration = job.completedAt.getTime() - job.startedAt.getTime();
    job.process = undefined; // Clear to allow GC
  } catch (error) {
    throw executionError(`Failed to kill job: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Stream job output (foreground mode)
 *
 * Note: This returns buffered output since the streams are already being
 * collected in the background. For true streaming, use this before
 * collectJobOutput is called.
 */
export async function* streamJobOutput(
  job: Job,
): AsyncGenerator<{ type: "stdout" | "stderr" | "exit"; data?: string; code?: number }> {
  if (!job.process) {
    throw executionError("Job process not available");
  }

  // Since streams are already being collected, we'll poll the buffered output
  // and yield it incrementally
  let lastStdoutLen = 0;
  let lastStderrLen = 0;

  // Poll for new output while job is running
  while (job.status === "running") {
    // Check for new stdout
    if (job.stdout.length > lastStdoutLen) {
      const newStdout = job.stdout.slice(lastStdoutLen);
      lastStdoutLen = job.stdout.length;
      yield { type: "stdout", data: newStdout };
    }

    // Check for new stderr
    if (job.stderr.length > lastStderrLen) {
      const newStderr = job.stderr.slice(lastStderrLen);
      lastStderrLen = job.stderr.length;
      yield { type: "stderr", data: newStderr };
    }

    // Small delay to avoid busy-waiting
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Yield any remaining output after job completes
  if (job.stdout.length > lastStdoutLen) {
    const newStdout = job.stdout.slice(lastStdoutLen);
    yield { type: "stdout", data: newStdout };
  }

  if (job.stderr.length > lastStderrLen) {
    const newStderr = job.stderr.slice(lastStderrLen);
    yield { type: "stderr", data: newStderr };
  }

  // Yield exit status
  yield { type: "exit", code: job.exitCode ?? -1 };
}

/**
 * Collect job output in background (non-blocking)
 */
function collectJobOutput(job: Job): void {
  if (!job.process) return;

  const decoder = new TextDecoder();

  // Collect stdout with truncation
  (async () => {
    const reader = job.process!.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const decoded = decoder.decode(value);
          job.stdout += decoded;

          // Apply truncation if needed
          if (job.stdout.length > JOB_OUTPUT_LIMIT) {
            job.stdout = job.stdout.slice(-JOB_OUTPUT_LIMIT);
            job.stdoutTruncated = true;
          }
        }
      }
    } catch (error) {
      console.error("Error collecting stdout:", error);
    } finally {
      reader.releaseLock();
    }
  })();

  // Collect stderr with truncation
  (async () => {
    const reader = job.process!.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const decoded = decoder.decode(value);
          job.stderr += decoded;

          // Apply truncation if needed
          if (job.stderr.length > JOB_OUTPUT_LIMIT) {
            job.stderr = job.stderr.slice(-JOB_OUTPUT_LIMIT);
            job.stderrTruncated = true;
          }
        }
      }
    } catch (error) {
      console.error("Error collecting stderr:", error);
    } finally {
      reader.releaseLock();
    }
  })();

  // Wait for process completion in background
  (async () => {
    try {
      const status = await job.process!.status;
      job.status = status.code === 0 ? "completed" : "failed";
      job.exitCode = status.code;
      job.completedAt = new Date();
      job.duration = job.completedAt.getTime() - job.startedAt.getTime();
      job.process = undefined; // Clear to allow GC
    } catch (error) {
      console.error("Error waiting for job:", error);
      job.status = "failed";
      job.exitCode = -1;
      job.completedAt = new Date();
      job.duration = job.completedAt.getTime() - job.startedAt.getTime();
      job.process = undefined; // Clear to allow GC
    }
  })();
}

/**
 * Helper: Hash code for caching
 */
async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Helper: Build preamble for code execution
 */
function buildPreamble(session: Session): string {
  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    'import * as fs from "safesh:fs";',
    'import * as text from "safesh:text";',
    'import $ from "safesh:shell";',
  ];

  lines.push("");
  lines.push("// Session context");
  lines.push(`const $session = ${JSON.stringify({
    id: session.id,
    cwd: session.cwd,
    env: session.env,
    vars: session.vars,
  })};`);

  lines.push("");
  lines.push("// User code starts here");
  lines.push("");

  return lines.join("\n");
}

/**
 * Helper: Build environment variables
 */
function buildEnv(
  config: SafeShellConfig,
  session: Session,
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
  if (session.env) {
    for (const [key, value] of Object.entries(session.env)) {
      if (!isMasked(key)) {
        result[key] = value;
      }
    }
  }

  return result;
}
