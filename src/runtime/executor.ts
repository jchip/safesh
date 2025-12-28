/**
 * Code execution engine
 *
 * Executes JS/TS code in a sandboxed Deno subprocess with configured permissions.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { deadline } from "@std/async";
import { executionError, timeout as timeoutError } from "../core/errors.ts";
import { generateImportMap, validateImports } from "../core/import_map.ts";
import type { ExecOptions, ExecResult, SafeShellConfig, Shell, Script, Job } from "../core/types.ts";
import { SCRIPT_OUTPUT_LIMIT } from "../core/types.ts";
import { hashCode, buildEnv, collectStreamText } from "../core/utils.ts";
import { createScript, truncateOutput } from "./scripts.ts";
import {
  buildPreamble,
  buildEpilogue,
  extractShellState,
} from "./preamble.ts";

const TEMP_DIR = "/tmp/safesh/scripts";
const DEFAULT_TIMEOUT = 30000;

// Cache for existing commands (checked once per unique command list)
const existingCommandsCache = new Map<string, string[]>();

/**
 * Filter commands to only those that exist on the system (cached)
 */
function filterExistingCommands(commands: string[]): string[] {
  const cacheKey = commands.sort().join(",");

  if (existingCommandsCache.has(cacheKey)) {
    return existingCommandsCache.get(cacheKey)!;
  }

  const existing = commands.filter((cmd) => {
    try {
      const result = new Deno.Command("which", {
        args: [cmd],
        stderr: "null",
        stdout: "null"
      }).outputSync();
      return result.success;
    } catch {
      return false;
    }
  });

  existingCommandsCache.set(cacheKey, existing);
  return existing;
}

// Marker for job events (must match command.ts)
const JOB_MARKER = "__SAFESH_JOB__:";

/** Job event from subprocess */
interface JobEvent {
  type: "start" | "end";
  id: string;
  scriptId?: string;
  shellId?: string;
  command?: string;
  args?: string[];
  pid?: number;
  startedAt?: string;
  exitCode?: number;
  completedAt?: string;
  duration?: number;
}

/**
 * Extract job events from stderr and return cleaned output
 */
function extractJobEvents(stderr: string): { cleanStderr: string; events: JobEvent[] } {
  const lines = stderr.split("\n");
  const events: JobEvent[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(JOB_MARKER)) {
      try {
        const jsonStr = line.slice(JOB_MARKER.length);
        const event = JSON.parse(jsonStr) as JobEvent;
        events.push(event);
      } catch {
        // Invalid JSON, keep the line as-is
        cleanLines.push(line);
      }
    } else {
      cleanLines.push(line);
    }
  }

  return { cleanStderr: cleanLines.join("\n"), events };
}

/**
 * Process job events and register jobs in shell
 */
function processJobEvents(shell: Shell, script: Script, events: JobEvent[]): void {
  // Group events by job ID
  const startEvents = new Map<string, JobEvent>();
  const endEvents = new Map<string, JobEvent>();

  for (const event of events) {
    if (event.type === "start") {
      startEvents.set(event.id, event);
    } else if (event.type === "end") {
      endEvents.set(event.id, event);
    }
  }

  // Create Job records from paired events
  for (const [jobId, start] of startEvents) {
    const end = endEvents.get(jobId);

    const job: Job = {
      id: jobId,
      scriptId: script.id,
      command: start.command ?? "unknown",
      args: start.args ?? [],
      pid: start.pid ?? 0,
      status: end ? (end.exitCode === 0 ? "completed" : "failed") : "running",
      exitCode: end?.exitCode,
      stdout: "", // Not captured at this level
      stderr: "", // Not captured at this level
      startedAt: new Date(start.startedAt ?? Date.now()),
      completedAt: end?.completedAt ? new Date(end.completedAt) : undefined,
      duration: end?.duration,
    };

    // Add job to shell
    shell.jobs.set(jobId, job);

    // Link job to script
    if (!script.jobIds.includes(jobId)) {
      script.jobIds.push(jobId);
    }
  }
}

/**
 * Build Deno permission flags from config
 */
export function buildPermissionFlags(config: SafeShellConfig, cwd: string): string[] {
  const flags: string[] = [];
  const perms = config.permissions ?? {};

  // Helper to expand path variables
  const expandPath = (p: string): string => {
    return p
      .replace(/\$\{CWD\}/g, cwd)
      .replace(/\$\{HOME\}/g, Deno.env.get("HOME") ?? "")
      .replace(/\$CWD/g, cwd)
      .replace(/\$HOME/g, Deno.env.get("HOME") ?? "");
  };

  // Read permissions - always include temp dir and safesh source for imports
  const readPaths = [...(perms.read ?? [])];
  if (!readPaths.includes("/tmp") && !readPaths.includes(TEMP_DIR)) {
    readPaths.push(TEMP_DIR);
  }

  // Add safesh source directory for imports (resolve from this file's location)
  const safeshSrcDir = new URL("../../", import.meta.url).pathname;
  if (!readPaths.includes(safeshSrcDir)) {
    readPaths.push(safeshSrcDir);
  }

  if (readPaths.length) {
    const paths = readPaths.map(expandPath).join(",");
    flags.push(`--allow-read=${paths}`);
  }

  // Write permissions - always include temp dir
  const writePaths = [...(perms.write ?? [])];
  if (!writePaths.includes("/tmp") && !writePaths.includes(TEMP_DIR)) {
    writePaths.push(TEMP_DIR);
  }

  if (writePaths.length) {
    const paths = writePaths.map(expandPath).join(",");
    flags.push(`--allow-write=${paths}`);
  }

  // Network permissions
  if (perms.net === true) {
    flags.push("--allow-net");
  } else if (Array.isArray(perms.net) && perms.net.length) {
    flags.push(`--allow-net=${perms.net.join(",")}`);
  }

  // Run permissions (for external commands)
  // Filter to only commands that exist to avoid Deno warnings (cached)
  if (perms.run?.length) {
    const existingCommands = filterExistingCommands(perms.run);
    if (existingCommands.length) {
      flags.push(`--allow-run=${existingCommands.join(",")}`);
    }
  }

  // Env permissions - always include SAFESH_* for job tracking
  const envVars = [...(perms.env ?? [])];
  if (!envVars.includes("SAFESH_SHELL_ID")) {
    envVars.push("SAFESH_SHELL_ID");
  }
  if (!envVars.includes("SAFESH_SCRIPT_ID")) {
    envVars.push("SAFESH_SCRIPT_ID");
  }
  if (envVars.length) {
    flags.push(`--allow-env=${envVars.join(",")}`);
  }

  return flags;
}

/**
 * Execute JS/TS code in a sandboxed Deno subprocess
 *
 * When an explicit shell is provided, automatically creates a script record
 * for tracking execution history.
 */
export async function executeCode(
  code: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
  shell?: Shell,
): Promise<ExecResult> {
  const cwd = options.cwd ?? shell?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT;

  // Validate imports against security policy
  const importPolicy = config.imports ?? { trusted: [], allowed: [], blocked: [] };
  validateImports(code, importPolicy);

  // Create script for tracking if shell provided
  let script: Script | undefined;
  if (shell) {
    script = createScript(shell, code, false, 0);
    shell.scripts.set(script.id, script);
    shell.lastActivityAt = new Date();
  }

  // Ensure temp directory exists
  await ensureDir(TEMP_DIR);

  // Create script file
  const hash = await hashCode(code);
  const scriptPath = join(TEMP_DIR, `${hash}.ts`);

  // Build full code with preamble, user code wrapped in try/finally, and epilogue
  const preamble = buildPreamble(shell);
  const epilogue = buildEpilogue(!!shell);

  // Wrap user code in try/finally to ensure epilogue runs even on error
  let fullCode: string;
  if (shell) {
    fullCode = `${preamble}try {\n${code}\n} finally {\n${epilogue}\n}`;
  } else {
    fullCode = preamble + code;
  }

  // Write script to temp file
  await Deno.writeTextFile(scriptPath, fullCode);

  // Generate import map from policy
  const importMapPath = await generateImportMap(importPolicy);

  // Build command
  const permFlags = buildPermissionFlags(config, cwd);

  // Always use SafeShell's deno.json for stdlib imports
  const safeshRoot = new URL("../../", import.meta.url).pathname;
  const safeshConfig = join(safeshRoot, "deno.json");

  const args = [
    "run",
    "--no-prompt", // Never prompt for permissions
    `--import-map=${importMapPath}`,
    `--config=${safeshConfig}`, // Use SafeShell's config for @std imports
    ...permFlags,
  ];

  args.push(scriptPath);

  // Create command
  const command = new Deno.Command("deno", {
    args,
    cwd,
    env: buildEnv(config, shell, script?.id),
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process so we can kill it on timeout
  const process = command.spawn();

  // Update script with PID
  if (script) {
    script.pid = process.pid;
    shell!.scriptsByPid.set(process.pid, script.id);
  }

  try {
    // Create a promise that collects output
    const outputPromise = (async () => {
      const [status, stdout, stderr] = await Promise.all([
        process.status,
        collectStreamText(process.stdout),
        collectStreamText(process.stderr),
      ]);
      return { status, stdout, stderr };
    })();

    const { status, stdout: rawStdout, stderr: rawStderr } = await deadline(outputPromise, timeoutMs);

    // Extract shell state from stdout and sync vars back
    const { cleanOutput: stdout, vars } = extractShellState(rawStdout);
    if (shell && vars) {
      shell.vars = vars;
    }

    // Extract job events from stderr and process them
    const { cleanStderr: stderr, events: jobEvents } = extractJobEvents(rawStderr);
    if (shell && script && jobEvents.length > 0) {
      processJobEvents(shell, script, jobEvents);
    }

    // Update script with results (using cleaned output)
    if (script) {
      const stdoutResult = truncateOutput(stdout);
      const stderrResult = truncateOutput(stderr);

      script.status = status.code === 0 ? "completed" : "failed";
      script.exitCode = status.code;
      script.stdout = stdoutResult.text;
      script.stderr = stderrResult.text;
      script.stdoutTruncated = stdoutResult.truncated;
      script.stderrTruncated = stderrResult.truncated;
      script.completedAt = new Date();
      script.duration = script.completedAt.getTime() - script.startedAt.getTime();
    }

    return {
      stdout,
      stderr,
      code: status.code,
      success: status.code === 0,
      scriptId: script?.id,
    };
  } catch (error) {
    // Kill the process and cancel streams on timeout or error
    try {
      process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }

    // Cancel the streams to prevent leaks
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

    // Update script with failure
    if (script) {
      script.status = "failed";
      script.completedAt = new Date();
      script.duration = script.completedAt.getTime() - script.startedAt.getTime();
      if (error instanceof DOMException && error.name === "TimeoutError") {
        script.stderr = `Execution timed out after ${timeoutMs}ms`;
        script.stderrTruncated = false;
      }
    }

    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw timeoutError(timeoutMs, "exec");
    }
    throw executionError(
      error instanceof Error ? error.message : String(error),
    );
  }
}


/**
 * Find Deno config file (deno.json or deno.jsonc)
 */
export async function findConfig(cwd: string): Promise<string | undefined> {
  // Check for deno.json in cwd
  const denoJson = join(cwd, "deno.json");
  try {
    await Deno.stat(denoJson);
    return denoJson;
  } catch {
    // Not found
  }

  // Check for deno.jsonc
  const denoJsonc = join(cwd, "deno.jsonc");
  try {
    await Deno.stat(denoJsonc);
    return denoJsonc;
  } catch {
    // Not found
  }

  return undefined;
}

/**
 * Execute a JS/TS file directly
 */
export async function executeFile(
  filePath: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
  shell?: Shell,
): Promise<ExecResult> {
  const cwd = options.cwd ?? shell?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT;

  // Resolve file path - if already absolute, use as-is, otherwise resolve from cwd
  const absolutePath = filePath.startsWith("/") ? filePath : join(cwd, filePath);

  // Read and validate file imports
  let fileCode: string;
  try {
    fileCode = await Deno.readTextFile(absolutePath);
  } catch (error) {
    throw executionError(
      `Failed to read file '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const importPolicy = config.imports ?? { trusted: [], allowed: [], blocked: [] };
  validateImports(fileCode, importPolicy);

  // Generate import map from policy
  const importMapPath = await generateImportMap(importPolicy);

  // Build command
  const permFlags = buildPermissionFlags(config, cwd);
  const configPath = await findConfig(cwd);

  const args = [
    "run",
    "--no-prompt",
    `--import-map=${importMapPath}`,
    ...permFlags,
  ];

  if (configPath) {
    args.push(`--config=${configPath}`);
  }

  args.push(absolutePath);

  // Create command
  const command = new Deno.Command("deno", {
    args,
    cwd,
    env: buildEnv(config, shell),
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process so we can kill it on timeout
  const process = command.spawn();

  try {
    // Create a promise that collects output
    const outputPromise = (async () => {
      const [status, stdout, stderr] = await Promise.all([
        process.status,
        collectStreamText(process.stdout),
        collectStreamText(process.stderr),
      ]);
      return { status, stdout, stderr };
    })();

    const { status, stdout, stderr } = await deadline(outputPromise, timeoutMs);

    return {
      stdout,
      stderr,
      code: status.code,
      success: status.code === 0,
    };
  } catch (error) {
    // Kill the process and cancel streams on timeout or error
    try {
      process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }

    // Cancel the streams to prevent leaks
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

    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw timeoutError(timeoutMs, "exec");
    }
    throw executionError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Execute code with streaming output
 */
export async function* executeCodeStreaming(
  code: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
  shell?: Shell,
): AsyncGenerator<{ type: "stdout" | "stderr" | "exit"; data?: string; code?: number }> {
  const cwd = options.cwd ?? shell?.cwd ?? Deno.cwd();

  // Validate imports against security policy
  const importPolicy = config.imports ?? { trusted: [], allowed: [], blocked: [] };
  validateImports(code, importPolicy);

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

  // Generate import map from policy
  const importMapPath = await generateImportMap(importPolicy);

  // Build command
  const permFlags = buildPermissionFlags(config, cwd);
  const configPath = await findConfig(cwd);

  const args = [
    "run",
    "--no-prompt",
    `--import-map=${importMapPath}`,
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
    env: buildEnv(config, shell),
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  // Stream stdout
  const stdoutReader = process.stdout.getReader();
  const stderrReader = process.stderr.getReader();
  const decoder = new TextDecoder();

  // Read both streams concurrently
  const readStream = async function* (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    type: "stdout" | "stderr",
  ) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield { type, data: decoder.decode(value) };
    }
  };

  // Merge streams (simplified - in production use proper merging)
  for await (const chunk of readStream(stdoutReader, "stdout")) {
    yield chunk;
  }
  for await (const chunk of readStream(stderrReader, "stderr")) {
    yield chunk;
  }

  const status = await process.status;
  yield { type: "exit", code: status.code };
}
