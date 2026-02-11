/**
 * Code execution engine
 *
 * Executes JS/TS code in a sandboxed Deno subprocess with configured permissions.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { executionError } from "../core/errors.ts";
import { generateImportMap, validateImports } from "../core/import_map.ts";
import type { ExecOptions, ExecResult, SafeShellConfig, Shell, Script, Job, ImportPolicy } from "../core/types.ts";
import { SCRIPT_OUTPUT_LIMIT } from "../core/types.ts";
import { hashCode, buildEnv, getRealPathBoth, getLoginShellPath } from "../core/utils.ts";
import { createScript, truncateOutput } from "./scripts.ts";
import {
  buildPreamble,
  buildFilePreamble,
  buildFilePostamble,
  buildErrorHandler,
  extractShellState,
  extractPreambleConfig,
} from "./preamble.ts";
import { getEffectivePermissions, expandPath } from "../core/permissions.ts";
import {
  JOB_MARKER,
  CMD_ERROR_MARKER,
  INIT_ERROR_MARKER,
  NET_ERROR_MARKER,
  ENV_SHELL_ID,
  ENV_SCRIPT_ID,
  ERROR_COMMAND_NOT_ALLOWED,
  ERROR_COMMANDS_BLOCKED,
  ERROR_NETWORK_BLOCKED,
} from "../core/constants.ts";
import { DEFAULT_TIMEOUT_MS, TEMP_SCRIPT_DIR } from "../core/defaults.ts";
import { SubprocessManager, buildDenoArgs } from "./subprocess-manager.ts";
import type { SubprocessOutput } from "./subprocess-manager.ts";

// NOTE: filterExistingCommands cache and function removed since we now always
// use unrestricted --allow-run. No need to filter commands anymore.

// Stderr markers - use constants from core/constants.ts
const STDERR_MARKERS = {
  job: JOB_MARKER,
  cmdError: CMD_ERROR_MARKER,
  initError: INIT_ERROR_MARKER,
  netError: NET_ERROR_MARKER,
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
  type: typeof ERROR_COMMAND_NOT_ALLOWED;
  command: string;
}

/** Init error event from subprocess (from init() permission check) */
interface InitErrorEvent {
  type: typeof ERROR_COMMANDS_BLOCKED;
  notAllowed: string[];
  notFound: string[];
}

/** Network error event from subprocess */
interface NetworkErrorEvent {
  type: typeof ERROR_NETWORK_BLOCKED;
  host: string;
}

/** Parse a marker line, returns parsed JSON or null if invalid */
function parseMarkerLine<T>(line: string, marker: string): T | null {
  if (!line.startsWith(marker)) return null;
  try {
    return JSON.parse(line.slice(marker.length)) as T;
  } catch {
    // Invalid JSON in marker line, treat as regular output
    return null;
  }
}

/**
 * Enhance Deno permission errors with CWD context and allowed paths.
 * Transforms: 'Requires write access to ".temp/foo"'
 * Into: 'Requires write access to ".temp/foo"\nCWD: /full/path\nAllowed write paths: /foo, /bar'
 * Also detects network permission errors and injects NET_ERROR_MARKER
 */
function enhancePermissionErrors(stderr: string, cwd: string, config: SafeShellConfig): string {
  // Match Deno permission error patterns for files
  const pattern = /Requires (read|write) access to "([^"]+)"/g;
  const perms = getEffectivePermissions(config, cwd);
  let hasMatch = false;
  let firstAccessType: string | null = null;

  let enhanced = stderr.replace(pattern, (match, accessType) => {
    hasMatch = true;
    if (!firstAccessType) firstAccessType = accessType;
    return match;
  });

  // If we found file permission errors, append context info
  if (hasMatch && firstAccessType) {
    const allowedPaths = firstAccessType === "write" ? perms.write : perms.read;
    const expandedPaths = allowedPaths?.map(p => expandPath(p, cwd)) ?? [];
    const lines = [
      enhanced.trim(),
      `CWD: ${cwd}`,
    ];
    if (expandedPaths.length > 0) {
      lines.push(`Allowed ${firstAccessType} paths: ${expandedPaths.join(", ")}`);
    }
    enhanced = lines.join("\n");
  }

  // Detect network permission errors and extract host
  // Deno error format: "Requires net access to \"example.com\""
  const netPattern = /Requires net access to "([^"]+)"/;
  const netMatch = enhanced.match(netPattern);
  if (netMatch && netMatch[1]) {
    const host = netMatch[1];
    // Inject NET_ERROR_MARKER so extractStderrEvents can pick it up
    const netErrorJson = JSON.stringify({ type: ERROR_NETWORK_BLOCKED, host });
    enhanced = `${NET_ERROR_MARKER}${netErrorJson}\n${enhanced}`;
  }

  return enhanced;
}

/**
 * Extract job events and command errors from stderr and return cleaned output
 */
function extractStderrEvents(stderr: string): {
  cleanStderr: string;
  jobEvents: JobEvent[];
  cmdErrors: CommandErrorEvent[];
  initErrors: InitErrorEvent[];
  netErrors: NetworkErrorEvent[];
} {
  const lines = stderr.split("\n");
  const jobEvents: JobEvent[] = [];
  const cmdErrors: CommandErrorEvent[] = [];
  const initErrors: InitErrorEvent[] = [];
  const netErrors: NetworkErrorEvent[] = [];
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

    const netError = parseMarkerLine<NetworkErrorEvent>(line, STDERR_MARKERS.netError);
    if (netError) {
      netErrors.push(netError);
      continue;
    }

    cleanLines.push(line);
  }

  return { cleanStderr: cleanLines.join("\n"), jobEvents, cmdErrors, initErrors, netErrors };
}

/**
 * Process job events and register jobs in shell
 */

/**
 * Process a single job event and update shell state immediately
 */
function processJobEvent(shell: Shell, script: Script, event: JobEvent): void {
  if (event.type === "start") {
    // Create new job
    const job: Job = {
      id: event.id,
      scriptId: script.id,
      command: event.command ?? "unknown",
      args: event.args ?? [],
      pid: event.pid ?? 0,
      status: "running",
      exitCode: undefined,
      stdout: "", 
      stderr: "",
      startedAt: new Date(event.startedAt ?? Date.now()),
      completedAt: undefined,
      duration: undefined,
    };
    
    shell.jobs.set(job.id, job);
    
    if (!script.jobIds.includes(job.id)) {
      script.jobIds.push(job.id);
    }
  } else if (event.type === "end") {
    const job = shell.jobs.get(event.id);
    if (job) {
      job.status = event.exitCode === 0 ? "completed" : "failed";
      job.exitCode = event.exitCode;
      job.completedAt = event.completedAt ? new Date(event.completedAt) : new Date();
      job.duration = event.duration;
    }
  }
}

function processJobEvents(shell: Shell, script: Script, events: JobEvent[]): void {
  for (const event of events) {
    processJobEvent(shell, script, event);
  }
}

// NOTE: DenoArgsOptions and buildDenoArgs moved to subprocess-manager.ts

// NOTE: SpawnOptions, SubprocessOutput, collectAndScanStreamText, and
// spawnAndCollectOutput moved to subprocess-manager.ts

/**
 * Sync extracted shell state back to shell object
 */
function syncShellState(
  shell: Shell | undefined,
  state: { cwd?: string; env?: Record<string, string>; vars?: Record<string, unknown> },
): void {
  if (!shell) return;
  if (state.cwd) shell.cwd = state.cwd;
  if (state.env) shell.env = state.env;
  if (state.vars) shell.vars = state.vars;
}

/**
 * Update script record with successful execution results
 */
function updateScriptSuccess(
  script: Script,
  status: Deno.CommandStatus,
  stdout: string,
  stderr: string,
): void {
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

/**
 * Update script record with timeout failure
 */
function updateScriptTimeout(script: Script, timeoutMs: number): void {
  script.status = "failed";
  script.completedAt = new Date();
  script.duration = script.completedAt.getTime() - script.startedAt.getTime();
  script.stderr = `Execution timed out after ${timeoutMs}ms`;
  script.stderrTruncated = false;
}

/**
 * Update script record with general failure
 */
function updateScriptFailure(script: Script): void {
  script.status = "failed";
  script.completedAt = new Date();
  script.duration = script.completedAt.getTime() - script.startedAt.getTime();
}

/**
 * Extract blocked command info from stderr events
 */
function extractBlockedCommands(
  cmdErrors: CommandErrorEvent[],
  initErrors: InitErrorEvent[],
  netErrors: NetworkErrorEvent[],
): { blockedCommand?: string; blockedCommands?: string[]; notFoundCommands?: string[]; blockedHost?: string } {
  // Check for blocked command (legacy single command)
  const firstCmdError = cmdErrors[0];
  const blockedCommand = firstCmdError?.command;

  // Check for init errors (multiple commands)
  const firstInitError = initErrors[0];
  const blockedCommands = firstInitError?.notAllowed.length ? firstInitError.notAllowed : undefined;
  const notFoundCommands = firstInitError?.notFound.length ? firstInitError.notFound : undefined;

  // Check for network errors
  const firstNetError = netErrors[0];
  const blockedHost = firstNetError?.host;

  return { blockedCommand, blockedCommands, notFoundCommands, blockedHost };
}


/**
 * Build a path-based permission flag.
 * Common helper for read/write allow/deny permissions.
 */
function buildPathPermission(
  flag: string,
  paths: string[],
  cwd: string,
  extraPaths: string[] = [],
): string | null {
  const allPaths = [...paths];
  for (const extra of extraPaths) {
    if (!allPaths.includes(extra)) {
      allPaths.push(extra);
    }
  }
  if (allPaths.length) {
    const expanded = allPaths.map(p => expandPath(p, cwd)).flatMap(getRealPathBoth).join(",");
    return `--${flag}=${expanded}`;
  }
  return null;
}

/** Safesh source directory for imports */
const SAFESH_SRC_DIR = new URL("../../", import.meta.url).pathname;

/**
 * Build read permission flag
 */
function buildReadPermission(paths: string[], cwd: string): string | null {
  return buildPathPermission("allow-read", paths, cwd, [TEMP_SCRIPT_DIR, SAFESH_SRC_DIR]);
}

/**
 * Build deny-read permission flag
 */
function buildDenyReadPermission(paths: string[], cwd: string): string | null {
  return buildPathPermission("deny-read", paths, cwd);
}

/**
 * Build write permission flag
 */
function buildWritePermission(paths: string[], cwd: string): string | null {
  return buildPathPermission("allow-write", paths, cwd, [TEMP_SCRIPT_DIR]);
}

/**
 * Build deny-write permission flag
 */
function buildDenyWritePermission(paths: string[], cwd: string): string | null {
  return buildPathPermission("deny-write", paths, cwd);
}

/**
 * Build network permission flag
 * Defaults to allowing all network access unless explicitly restricted
 */
function buildNetPermission(net: boolean | string[] | undefined): string {
  if (net === false) {
    return "";  // Explicitly disabled
  } else if (Array.isArray(net) && net.length) {
    return `--allow-net=${net.join(",")}`;
  }
  // Default: allow all network access (undefined or true)
  return "--allow-net";
}

/**
 * Build run permission flag
 *
 * Always returns unrestricted --allow-run because:
 * 1. Deno doesn't support directory-based run permissions
 * 2. No wildcard/glob support for command lists
 * 3. Dynamic scripts cannot be listed upfront
 * 4. Security is enforced at application layer (bash-prehook, initCmds)
 */
function buildRunPermission(): string {
  return "--allow-run";
}

/**
 * Build env permission flag
 */
function buildEnvPermission(
  envVars: string[] | undefined,
  envConfig: { allowReadAll?: boolean },
): string | null {
  const allowReadAll = envConfig.allowReadAll !== false; // default true

  if (allowReadAll) {
    return "--allow-env";
  } else if (envVars?.length) {
    // Restricted mode: only allow specific env vars
    const allVars = [...envVars, ENV_SHELL_ID, ENV_SCRIPT_ID];
    return `--allow-env=${[...new Set(allVars)].join(",")}`;
  }
  return null;
}

/**
 * Build Deno permission flags from config
 */
export function buildPermissionFlags(config: SafeShellConfig, cwd: string): string[] {
  const flags: string[] = [];
  const perms = getEffectivePermissions(config, cwd);

  // Build allow permissions
  const readFlag = buildReadPermission(perms.read ?? [], cwd);
  if (readFlag) flags.push(readFlag);

  const writeFlag = buildWritePermission(perms.write ?? [], cwd);
  if (writeFlag) flags.push(writeFlag);

  // Build deny permissions (take precedence over allow)
  const denyReadFlag = buildDenyReadPermission(perms.denyRead ?? [], cwd);
  if (denyReadFlag) flags.push(denyReadFlag);

  const denyWriteFlag = buildDenyWritePermission(perms.denyWrite ?? [], cwd);
  if (denyWriteFlag) flags.push(denyWriteFlag);

  const netFlag = buildNetPermission(perms.net);
  if (netFlag) flags.push(netFlag);

  flags.push(buildRunPermission());

  const envFlag = buildEnvPermission(perms.env, config.env ?? {});
  if (envFlag) flags.push(envFlag);

  return flags;
}

/** Context for execution preparation */
interface ExecutionContext {
  cwd: string;
  timeoutMs: number;
  importPolicy: ImportPolicy;
}

/**
 * Phase 1: Prepare execution context
 * Resolves CWD, timeout, and validates imports
 */
function prepareExecutionContext(
  code: string,
  config: SafeShellConfig,
  options: ExecOptions,
  shell?: Shell,
): ExecutionContext {
  const cwd = options.cwd ?? shell?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS;
  const importPolicy = config.imports ?? { trusted: [], allowed: [], blocked: [] };

  // Validate imports against security policy
  validateImports(code, importPolicy);

  return { cwd, timeoutMs, importPolicy };
}

/**
 * Phase 2: Create execution script
 * Creates and registers script record for tracking if shell is provided
 */
function createExecutionScript(
  code: string,
  shell: Shell | undefined,
): Script | undefined {
  if (!shell) {
    return undefined;
  }

  const script = createScript(shell, code, false, 0);
  shell.scripts.set(script.id, script);
  shell.lastActivityAt = new Date();

  return script;
}

/** Result of script file generation */
interface ScriptFileInfo {
  scriptPath: string;
  preambleLineCount: number;
}

/**
 * Phase 3: Generate script file
 * Creates temp script file with preamble, user code, and error handler
 */
async function generateScriptFile(
  code: string,
  config: SafeShellConfig,
  cwd: string,
  shell: Shell | undefined,
): Promise<ScriptFileInfo> {
  // Ensure temp directory exists
  await ensureDir(TEMP_SCRIPT_DIR);

  // Create script file with exec prefix for inline code execution
  const hash = await hashCode(code);
  const scriptPath = join(TEMP_SCRIPT_DIR, `exec-${hash}.ts`);

  // Build full code with preamble, user code, and error handler
  const preambleConfig = extractPreambleConfig(config, cwd);
  const { preamble, preambleLineCount } = buildPreamble(shell, preambleConfig);
  const errorHandler = buildErrorHandler(scriptPath, preambleLineCount, !!shell, !!preambleConfig.vfs?.enabled);

  // Structure: preamble (with async IIFE start) + user code + error handler (closes IIFE with catch)
  const fullCode = preamble + code + errorHandler;

  // Write script to temp file
  await Deno.writeTextFile(scriptPath, fullCode);

  return { scriptPath, preambleLineCount };
}

/** Deno command configuration */
interface DenoCommandConfig {
  args: string[];
  importMapPath: string;
  subprocessManager: SubprocessManager;
}

/**
 * Phase 4: Build Deno command
 * Generates import map, permission flags, and command arguments
 */
async function buildDenoCommand(
  scriptPath: string,
  config: SafeShellConfig,
  cwd: string,
  importPolicy: ImportPolicy,
): Promise<DenoCommandConfig> {
  // Generate import map and build command args
  const importMapPath = await generateImportMap(importPolicy);
  const permFlags = buildPermissionFlags(config, cwd);

  // Always use SafeShell's deno.json for stdlib imports
  const safeshRoot = new URL("../../", import.meta.url).pathname;
  const safeshConfig = join(safeshRoot, "deno.json");

  const subprocessManager = new SubprocessManager();
  const args = subprocessManager.buildDenoArgs({
    permFlags,
    importMapPath,
    configPath: safeshConfig, // Use SafeShell's config for @std imports
    scriptPath,
    denoFlags: config.denoFlags,
  });

  return { args, importMapPath, subprocessManager };
}

/**
 * Phase 5: Execute with tracking
 * Spawns subprocess with real-time job event processing and script tracking
 */
async function executeWithTracking(
  subprocessManager: SubprocessManager,
  args: string[],
  cwd: string,
  config: SafeShellConfig,
  timeoutMs: number,
  shell: Shell | undefined,
  script: Script | undefined,
): Promise<SubprocessOutput> {
  return await subprocessManager.spawnAndCollectOutput({
    args,
    cwd,
    env: buildEnv(config, shell, script?.id),
    timeoutMs,
    onSpawn: (pid) => {
      if (script && shell) {
        script.pid = pid;
        shell.scriptsByPid.set(pid, script.id);
      }
    },
    onStderrLine: (line) => {
      if (shell && script) {
        const jobEvent = parseMarkerLine<JobEvent>(line, STDERR_MARKERS.job);
        if (jobEvent) {
          processJobEvent(shell, script, jobEvent);
        }
      }
    },
    onTimeout: () => {
      if (script) updateScriptTimeout(script, timeoutMs);
    },
    onError: () => {
      if (script) updateScriptFailure(script);
    },
  });
}

/**
 * Phase 6: Process execution result
 * Extracts state, events, enhances errors, and assembles final result
 */
function processExecutionResult(
  output: SubprocessOutput,
  config: SafeShellConfig,
  cwd: string,
  shell: Shell | undefined,
  script: Script | undefined,
): ExecResult {
  // Extract shell state from stdout and sync back
  const { cleanOutput: stdout, ...extractedState } = extractShellState(output.stdout);
  syncShellState(shell, extractedState);

  // Extract job events and command errors from stderr
  const { cleanStderr, jobEvents, cmdErrors, initErrors, netErrors } = extractStderrEvents(output.stderr);
  if (shell && script && jobEvents.length > 0) {
    processJobEvents(shell, script, jobEvents);
  }

  // Enhance permission errors with full path context
  const stderr = enhancePermissionErrors(cleanStderr, cwd, config);

  // Extract blocked command info
  const { blockedCommand, blockedCommands, notFoundCommands, blockedHost } = extractBlockedCommands(
    cmdErrors,
    initErrors,
    netErrors,
  );

  // Update script with results
  if (script) {
    updateScriptSuccess(script, output.status, stdout, stderr);
  }

  return {
    stdout,
    stderr,
    code: output.status.code,
    success: output.status.code === 0,
    scriptId: script?.id,
    blockedCommand,
    blockedCommands,
    notFoundCommands,
    blockedHost,
  };
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
  // SSH-483: Initialize login shell PATH cache to include user's full PATH
  // This ensures commands available in user's shell are also found by SafeShell
  await getLoginShellPath();

  // Phase 1: Prepare execution context (validate, resolve options)
  // SSH-562: Catch import validation errors and return as failed result
  let ctx: ExecutionContext;
  try {
    ctx = prepareExecutionContext(code, config, options, shell);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { stdout: "", stderr: msg, code: 1, success: false };
  }
  const { cwd, timeoutMs, importPolicy } = ctx;

  // Phase 2: Create script record for tracking
  const script = createExecutionScript(code, shell);

  // Phase 3: Generate script file with preamble and error handler
  const { scriptPath } = await generateScriptFile(code, config, cwd, shell);

  // Phase 4: Build Deno command with permissions and imports
  const { args, subprocessManager } = await buildDenoCommand(scriptPath, config, cwd, importPolicy);

  // Phase 5: Execute subprocess with real-time tracking
  const output = await executeWithTracking(subprocessManager, args, cwd, config, timeoutMs, shell, script);

  // Phase 6: Process result, extract events, enhance errors
  return processExecutionResult(output, config, cwd, shell, script);
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
    // deno.json not found, try deno.jsonc
  }

  // Check for deno.jsonc
  const denoJsonc = join(cwd, "deno.jsonc");
  try {
    await Deno.stat(denoJsonc);
    return denoJsonc;
  } catch {
    // deno.jsonc not found, no config file in this directory
  }

  return undefined;
}

/** Result of file execution preparation */
interface FileExecutionPrep {
  cwd: string;
  args: string[];
  subprocessManager: SubprocessManager;
}

/**
 * Shared preparation for file execution: read file, validate imports,
 * build preamble/postamble, write temp file, and build Deno command args.
 */
async function prepareFileExecution(
  filePath: string,
  config: SafeShellConfig,
  cwd: string,
  shell?: Shell,
): Promise<FileExecutionPrep> {
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
  const filePostamble = buildFilePostamble(!!shell);

  // Wrap file code with preamble and postamble
  const wrappedCode = filePreamble + fileCode + filePostamble;

  // Write wrapped code to temp file
  await ensureDir(TEMP_SCRIPT_DIR);
  const hash = await hashCode(wrappedCode);
  const tempPath = join(TEMP_SCRIPT_DIR, `file_${hash}.ts`);
  await Deno.writeTextFile(tempPath, wrappedCode);

  // Generate import map and build command args
  const importMapPath = await generateImportMap(importPolicy);
  const permFlags = buildPermissionFlags(config, cwd);
  const configPath = await findConfig(cwd);

  const subprocessManager = new SubprocessManager();
  const args = subprocessManager.buildDenoArgs({
    permFlags,
    importMapPath,
    configPath,
    scriptPath: tempPath,
    denoFlags: config.denoFlags,
  });

  return { cwd, args, subprocessManager };
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
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS;

  const { args, subprocessManager } = await prepareFileExecution(filePath, config, cwd, shell);

  // Build environment
  const env = buildEnv(config, shell);

  // DEBUG: Add environment variable for debugging path permissions
  if (Deno.env.get("SAFESH_SCRIPT_HASH")) {
    env.SAFESH_RETRY_PATH_DEBUG = "1";
  }

  // Spawn and collect output
  const { status, stdout: rawStdout, stderr: rawStderr } = await subprocessManager.spawnAndCollectOutput({
    args,
    cwd,
    env,
    timeoutMs,
  });

  // Extract shell state from stdout and sync back
  const { cleanOutput: stdout, ...extractedState } = extractShellState(rawStdout);
  syncShellState(shell, extractedState);

  // Enhance permission errors with full path context
  const stderr = enhancePermissionErrors(rawStderr, cwd, config);

  return {
    stdout,
    stderr,
    code: status.code,
    success: status.code === 0,
  };
}

/**
 * Execute a file with inherited stdio for real-time output passthrough.
 * Unlike executeFile which buffers all output, this spawns the subprocess
 * with stdout/stderr inherited so output appears immediately.
 * Returns the exit code.
 */
export async function executeFilePassthrough(
  filePath: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? Deno.cwd();

  const { args } = await prepareFileExecution(filePath, config, cwd);

  const env = buildEnv(config);

  // Spawn with inherited stdio for real-time output
  const command = new Deno.Command("deno", {
    args,
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const process = command.spawn();
  const status = await process.status;
  return status.code;
}

/**
 * Properly merge stdout and stderr streams concurrently using Promise.race
 */
async function* mergeStreams(
  stdoutReader: ReadableStreamDefaultReader<Uint8Array>,
  stderrReader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ type: "stdout" | "stderr"; data: string }> {
  type StreamResult = { stream: "stdout" | "stderr"; result: ReadableStreamReadResult<Uint8Array> };
  const decoder = new TextDecoder();

  let stdoutDone = false;
  let stderrDone = false;

  // Create pending read promises
  let stdoutPromise: Promise<StreamResult> | null = null;
  let stderrPromise: Promise<StreamResult> | null = null;

  const createStdoutPromise = () =>
    stdoutReader.read().then(result => ({ stream: "stdout" as const, result }));
  const createStderrPromise = () =>
    stderrReader.read().then(result => ({ stream: "stderr" as const, result }));

  while (!stdoutDone || !stderrDone) {
    // Start reads if not already pending
    if (!stdoutDone && !stdoutPromise) {
      stdoutPromise = createStdoutPromise();
    }
    if (!stderrDone && !stderrPromise) {
      stderrPromise = createStderrPromise();
    }

    // Wait for either stream to have data
    const promises: Promise<StreamResult>[] = [];
    if (stdoutPromise) promises.push(stdoutPromise);
    if (stderrPromise) promises.push(stderrPromise);

    if (promises.length === 0) break;

    const { stream, result } = await Promise.race(promises);

    if (result.done) {
      if (stream === "stdout") {
        stdoutDone = true;
        stdoutPromise = null;
      } else {
        stderrDone = true;
        stderrPromise = null;
      }
    } else if (result.value) {
      yield { type: stream, data: decoder.decode(result.value) };
      // Clear the completed promise so we start a new read
      if (stream === "stdout") {
        stdoutPromise = null;
      } else {
        stderrPromise = null;
      }
    }
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
  await ensureDir(TEMP_SCRIPT_DIR);

  // Create script file with exec prefix for inline code execution
  const hash = await hashCode(code);
  const scriptPath = join(TEMP_SCRIPT_DIR, `exec-${hash}.ts`);

  // Build full code with preamble and error handler
  const preambleConfig = extractPreambleConfig(config, cwd);
  const { preamble, preambleLineCount } = buildPreamble(shell, preambleConfig);
  const errorHandler = buildErrorHandler(scriptPath, preambleLineCount, !!shell, !!preambleConfig.vfs?.enabled);
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

  // Get stream readers
  const stdoutReader = process.stdout.getReader();
  const stderrReader = process.stderr.getReader();

  // Use the merged stream for proper real-time interleaving
  for await (const chunk of mergeStreams(stdoutReader, stderrReader)) {
    yield chunk;
  }

  const status = await process.status;
  yield { type: "exit", code: status.code };
}
