/**
 * Background script control for SafeShell
 *
 * Provides functionality to:
 * - Launch background scripts (code or external commands)
 * - Track running scripts with buffered output
 * - Query script status and output
 * - Stop scripts with signal support
 * - Stream script output (foreground mode)
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { SafeShellConfig, Script, Shell } from "../core/types.ts";
import { SCRIPT_OUTPUT_LIMIT } from "../core/types.ts";
import { buildPermissionFlags, findConfig } from "./executor.ts";
import { executionError } from "../core/errors.ts";

const TEMP_DIR = "/tmp/safesh/scripts";

/**
 * Truncate output to limit, keeping most recent content
 */
export function truncateOutput(
  output: string,
  limit: number = SCRIPT_OUTPUT_LIMIT,
): { text: string; truncated: boolean } {
  if (output.length <= limit) {
    return { text: output, truncated: false };
  }
  return { text: output.slice(-limit), truncated: true };
}

/**
 * Generate a new script ID for a shell
 */
export function generateScriptId(shell: Shell): string {
  const seq = shell.scriptSequence++;
  return `script-${shell.id}-${seq}`;
}

/**
 * Create a new script record
 */
export function createScript(
  shell: Shell,
  code: string,
  background: boolean,
  pid: number = 0,
): Script {
  return {
    id: generateScriptId(shell),
    code,
    pid,
    status: "running",
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    startedAt: new Date(),
    background,
    jobIds: [],
  };
}

/**
 * Launch a background script from code
 */
export async function launchCodeScript(
  code: string,
  config: SafeShellConfig,
  shell: Shell,
): Promise<Script> {
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
  const permFlags = buildPermissionFlags(config, shell.cwd);
  const configPath = await findConfig(shell.cwd);

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
    cwd: shell.cwd,
    env: buildEnv(config, shell),
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process
  const process = command.spawn();

  // Create script with new structure
  const script = createScript(shell, code, true, process.pid);
  script.process = process;

  // Add to shell maps
  shell.scripts.set(script.id, script);
  shell.scriptsByPid.set(script.pid, script.id);

  // Start collecting output in background
  collectScriptOutput(script);

  return script;
}

/**
 * Launch a background script from external command
 */
export async function launchCommandScript(
  command: string,
  args: string[],
  config: SafeShellConfig,
  shell: Shell,
): Promise<Script> {
  // Build environment
  const processEnv = buildEnv(config, shell);

  // Create command
  const cmd = new Deno.Command(command, {
    args,
    cwd: shell.cwd,
    env: processEnv,
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process
  const process = cmd.spawn();

  // Create script with command as code
  const code = `${command} ${args.join(" ")}`;
  const script = createScript(shell, code, true, process.pid);
  script.process = process;

  // Add to shell maps
  shell.scripts.set(script.id, script);
  shell.scriptsByPid.set(script.pid, script.id);

  // Start collecting output in background
  collectScriptOutput(script);

  return script;
}

/**
 * Get buffered output from a script
 */
export function getScriptOutput(
  script: Script,
  since?: number,
): {
  stdout: string;
  stderr: string;
  offset: number;
  status: Script["status"];
  exitCode?: number;
  truncated: { stdout: boolean; stderr: boolean };
} {
  const stdoutOffset = since ?? 0;
  const stderrOffset = since ?? 0;

  return {
    stdout: script.stdout.slice(stdoutOffset),
    stderr: script.stderr.slice(stderrOffset),
    offset: script.stdout.length,
    status: script.status,
    exitCode: script.exitCode,
    truncated: {
      stdout: script.stdoutTruncated,
      stderr: script.stderrTruncated,
    },
  };
}

/**
 * Kill a script with specified signal
 */
export async function killScript(script: Script, signal: Deno.Signal = "SIGTERM"): Promise<void> {
  if (!script.process) {
    throw executionError("Script process not available");
  }

  if (script.status !== "running") {
    throw executionError(`Script is not running (status: ${script.status})`);
  }

  // Send signal to process
  try {
    script.process.kill(signal);

    // Wait for process to exit (with timeout)
    const timeoutId = setTimeout(() => {
      // Force kill if still running after 5 seconds
      try {
        script.process?.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }, 5000);

    await script.process.status;
    clearTimeout(timeoutId);

    script.status = "failed";
    script.exitCode = -1;
    script.completedAt = new Date();
    script.duration = script.completedAt.getTime() - script.startedAt.getTime();
    script.process = undefined; // Clear to allow GC
  } catch (error) {
    throw executionError(`Failed to kill script: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Stream script output (foreground mode)
 *
 * Note: This returns buffered output since the streams are already being
 * collected in the background. For true streaming, use this before
 * collectScriptOutput is called.
 */
export async function* streamScriptOutput(
  script: Script,
): AsyncGenerator<{ type: "stdout" | "stderr" | "exit"; data?: string; code?: number }> {
  if (!script.process) {
    throw executionError("Script process not available");
  }

  // Since streams are already being collected, we'll poll the buffered output
  // and yield it incrementally
  let lastStdoutLen = 0;
  let lastStderrLen = 0;

  // Poll for new output while script is running
  while (script.status === "running") {
    // Check for new stdout
    if (script.stdout.length > lastStdoutLen) {
      const newStdout = script.stdout.slice(lastStdoutLen);
      lastStdoutLen = script.stdout.length;
      yield { type: "stdout", data: newStdout };
    }

    // Check for new stderr
    if (script.stderr.length > lastStderrLen) {
      const newStderr = script.stderr.slice(lastStderrLen);
      lastStderrLen = script.stderr.length;
      yield { type: "stderr", data: newStderr };
    }

    // Small delay to avoid busy-waiting
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Yield any remaining output after script completes
  if (script.stdout.length > lastStdoutLen) {
    const newStdout = script.stdout.slice(lastStdoutLen);
    yield { type: "stdout", data: newStdout };
  }

  if (script.stderr.length > lastStderrLen) {
    const newStderr = script.stderr.slice(lastStderrLen);
    yield { type: "stderr", data: newStderr };
  }

  // Yield exit status
  yield { type: "exit", code: script.exitCode ?? -1 };
}

/**
 * Collect script output in background (non-blocking)
 */
function collectScriptOutput(script: Script): void {
  if (!script.process) return;

  const decoder = new TextDecoder();

  // Collect stdout with truncation
  (async () => {
    const reader = script.process!.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const decoded = decoder.decode(value);
          script.stdout += decoded;

          // Apply truncation if needed
          if (script.stdout.length > SCRIPT_OUTPUT_LIMIT) {
            script.stdout = script.stdout.slice(-SCRIPT_OUTPUT_LIMIT);
            script.stdoutTruncated = true;
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
    const reader = script.process!.stderr.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const decoded = decoder.decode(value);
          script.stderr += decoded;

          // Apply truncation if needed
          if (script.stderr.length > SCRIPT_OUTPUT_LIMIT) {
            script.stderr = script.stderr.slice(-SCRIPT_OUTPUT_LIMIT);
            script.stderrTruncated = true;
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
      const status = await script.process!.status;
      script.status = status.code === 0 ? "completed" : "failed";
      script.exitCode = status.code;
      script.completedAt = new Date();
      script.duration = script.completedAt.getTime() - script.startedAt.getTime();
      script.process = undefined; // Clear to allow GC
    } catch (error) {
      console.error("Error waiting for script:", error);
      script.status = "failed";
      script.exitCode = -1;
      script.completedAt = new Date();
      script.duration = script.completedAt.getTime() - script.startedAt.getTime();
      script.process = undefined; // Clear to allow GC
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
function buildPreamble(shell: Shell): string {
  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    'import * as fs from "safesh:fs";',
    'import * as text from "safesh:text";',
    'import $ from "safesh:shell";',
  ];

  lines.push("");
  lines.push("// Shell context");
  lines.push(`const $session = ${JSON.stringify({
    id: shell.id,
    cwd: shell.cwd,
    env: shell.env,
    vars: shell.vars,
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
  shell: Shell,
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
  if (shell.env) {
    for (const [key, value] of Object.entries(shell.env)) {
      if (!isMasked(key)) {
        result[key] = value;
      }
    }
  }

  return result;
}
