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
  buildFilePreamble,
  buildErrorHandler,
  extractShellState,
  extractPreambleConfig,
} from "./preamble.ts";
import { getEffectivePermissions, expandPath } from "../core/permissions.ts";

const TEMP_DIR = "/tmp/safesh/scripts";
const DEFAULT_TIMEOUT = 30000;

// Cache for existing commands (checked once per unique command list + cwd)
const existingCommandsCache = new Map<string, string[]>();

/**
 * Filter commands to only those that exist on the system (cached)
 */
function filterExistingCommands(commands: string[], cwd: string): string[] {
  const cacheKey = `${cwd}:${commands.sort().join(",")}`;

  if (existingCommandsCache.has(cacheKey)) {
    return existingCommandsCache.get(cacheKey)!;
  }

  const existing = commands.filter((cmd) => {
    try {
      // For paths (absolute or relative), check if file exists
      if (cmd.startsWith("/") || cmd.startsWith("./") || cmd.startsWith("../")) {
        // Resolve relative paths against cwd
        const fullPath = cmd.startsWith("/") ? cmd : join(cwd, cmd);
        const stat = Deno.statSync(fullPath);
        return stat.isFile;
      }
      // For command names, use which
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

// Stderr markers (must match command.ts)
const STDERR_MARKERS = {
  job: "__SAFESH_JOB__:",
  cmdError: "__SAFESH_CMD_ERROR__:",
  initError: "__SAFESH_INIT_ERROR__:",
} as const;

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

/** Command error event from subprocess */
interface CommandErrorEvent {
  type: "COMMAND_NOT_ALLOWED";
  command: string;
}

/** Init error event from subprocess (from init() permission check) */
interface InitErrorEvent {
  type: "COMMANDS_BLOCKED";
  notAllowed: string[];
  notFound: string[];
}

/** Parse a marker line, returns parsed JSON or null if invalid */
function parseMarkerLine<T>(line: string, marker: string): T | null {
  if (!line.startsWith(marker)) return null;
  try {
    return JSON.parse(line.slice(marker.length)) as T;
  } catch {
    return null;
  }
}

/**
 * Extract job events and command errors from stderr and return cleaned output
 */
function extractStderrEvents(stderr: string): {
  cleanStderr: string;
  jobEvents: JobEvent[];
  cmdErrors: CommandErrorEvent[];
  initErrors: InitErrorEvent[];
} {
  const lines = stderr.split("\n");
  const jobEvents: JobEvent[] = [];
  const cmdErrors: CommandErrorEvent[] = [];
  const initErrors: InitErrorEvent[] = [];
  const cleanLines: string[] = [];

  for (const line of lines) {
    const jobEvent = parseMarkerLine<JobEvent>(line, STDERR_MARKERS.job);
    if (jobEvent) {
      jobEvents.push(jobEvent);
      continue;
    }

    const cmdError = parseMarkerLine<CommandErrorEvent>(line, STDERR_MARKERS.cmdError);
    if (cmdError) {
      cmdErrors.push(cmdError);
      continue;
    }

    const initError = parseMarkerLine<InitErrorEvent>(line, STDERR_MARKERS.initError);
    if (initError) {
      initErrors.push(initError);
      continue;
    }

    cleanLines.push(line);
  }

  return { cleanStderr: cleanLines.join("\n"), jobEvents, cmdErrors, initErrors };
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

  // Get effective permissions with defaults applied
  const perms = getEffectivePermissions(config, cwd);

  // Helper to resolve symlinks and return BOTH original and resolved paths
  // Important for macOS where /tmp -> /private/tmp - Deno checks literal path
  const resolveWithBoth = (p: string): string[] => {
    try {
      const resolved = Deno.realPathSync(p);
      // Return both if different (e.g., /tmp and /private/tmp)
      return resolved !== p ? [p, resolved] : [p];
    } catch {
      // Path doesn't exist yet, return as-is
      return [p];
    }
  };

  // Read permissions - use effective perms which include defaults like /tmp
  const readPaths = [...(perms.read ?? [])];

  // Always include temp dir for script files
  if (!readPaths.includes(TEMP_DIR)) {
    readPaths.push(TEMP_DIR);
  }

  // Add safesh source directory for imports (resolve from this file's location)
  const safeshSrcDir = new URL("../../", import.meta.url).pathname;
  if (!readPaths.includes(safeshSrcDir)) {
    readPaths.push(safeshSrcDir);
  }

  if (readPaths.length) {
    const paths = readPaths.map(p => expandPath(p, cwd)).flatMap(resolveWithBoth).join(",");
    flags.push(`--allow-read=${paths}`);
  }

  // Write permissions - use effective perms which include defaults like /tmp
  const writePaths = [...(perms.write ?? [])];

  // Always include temp dir for script files
  if (!writePaths.includes(TEMP_DIR)) {
    writePaths.push(TEMP_DIR);
  }

  if (writePaths.length) {
    const paths = writePaths.map(p => expandPath(p, cwd)).flatMap(resolveWithBoth).join(",");
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
  const runCommands = [...(perms.run ?? [])];

  // If allowProjectCommands is true, add projectDir to allow running any command there
  // This is a broad permission - Deno will allow running any file under projectDir
  if (config.allowProjectCommands && config.projectDir) {
    runCommands.push(config.projectDir);
  }

  if (runCommands.length) {
    const existingCommands = filterExistingCommands(runCommands, cwd);
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

  // Build full code with preamble, user code, and error handler
  const preambleConfig = extractPreambleConfig(config, cwd);
  const { preamble, preambleLineCount } = buildPreamble(shell, preambleConfig);
  const errorHandler = buildErrorHandler(scriptPath, preambleLineCount, !!shell);

  // Structure: preamble (with async IIFE start) + user code + error handler (closes IIFE with catch)
  const fullCode = preamble + code + errorHandler;

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

    // Extract job events and command errors from stderr
    const { cleanStderr: stderr, jobEvents, cmdErrors, initErrors } = extractStderrEvents(rawStderr);
    if (shell && script && jobEvents.length > 0) {
      processJobEvents(shell, script, jobEvents);
    }

    // Check for blocked command (legacy single command)
    const firstCmdError = cmdErrors[0];
    const blockedCommand = firstCmdError?.command;

    // Check for init errors (multiple commands)
    const firstInitError = initErrors[0];
    const blockedCommands = firstInitError?.notAllowed.length ? firstInitError.notAllowed : undefined;
    const notFoundCommands = firstInitError?.notFound.length ? firstInitError.notFound : undefined;

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
      blockedCommand,
      blockedCommands,
      notFoundCommands,
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

  // Build preamble to inject $ namespace (no async wrapper for files)
  const preambleConfig = extractPreambleConfig(config, cwd);
  const filePreamble = buildFilePreamble(shell, preambleConfig);

  // Prepend preamble to file code
  const wrappedCode = filePreamble + fileCode;

  // Write wrapped code to temp file
  await ensureDir(TEMP_DIR);
  const hash = await hashCode(wrappedCode);
  const tempPath = join(TEMP_DIR, `file_${hash}.ts`);
  await Deno.writeTextFile(tempPath, wrappedCode);

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

  args.push(tempPath);

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

  // Build full code with preamble and error handler
  const preambleConfig = extractPreambleConfig(config, cwd);
  const { preamble, preambleLineCount } = buildPreamble(shell, preambleConfig);
  const errorHandler = buildErrorHandler(scriptPath, preambleLineCount, !!shell);
  const fullCode = preamble + code + errorHandler;

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
