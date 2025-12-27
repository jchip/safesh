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
import type { ExecOptions, ExecResult, SafeShellConfig, Shell, Job } from "../core/types.ts";
import { JOB_OUTPUT_LIMIT } from "../core/types.ts";
import { createJob, truncateOutput } from "./jobs.ts";

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
 *
 * The preamble injects:
 * - Shell context as $shell
 * - Standard library (fs, text, $)
 * - Streaming shell API (cat, glob, git, lines, grep, map, filter, etc.)
 */
function buildPreamble(shell?: Shell): string {
  // Get absolute path to stdlib directory
  const stdlibPath = new URL("../stdlib/", import.meta.url).pathname;

  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    "",
    "// Import standard library",
    `import * as fs from 'file://${stdlibPath}fs.ts';`,
    `import * as text from 'file://${stdlibPath}text.ts';`,
    "",
    "// Import streaming shell API",
    `import { createStream, fromArray, empty } from 'file://${stdlibPath}stream.ts';`,
    `import { filter, map, flatMap, take, head, tail, lines, grep } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout, stderr, tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat, glob, src, dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd, git, docker, deno, str, bytes, toCmd, toCmdLines } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands",
    `import { echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
    "",
  ];

  if (shell) {
    lines.push(
      "// Shell context available as $shell",
      `const $shell = ${JSON.stringify({
        id: shell.id,
        cwd: shell.cwd,
        env: shell.env,
        vars: shell.vars,
      })};`,
      "",
    );
  }

  lines.push(
    "// User code starts here",
    "",
  );

  return lines.join("\n");
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

  // Env permissions
  if (perms.env?.length) {
    flags.push(`--allow-env=${perms.env.join(",")}`);
  }

  return flags;
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
 * Execute JS/TS code in a sandboxed Deno subprocess
 *
 * When an explicit shell is provided, automatically creates a job record
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

  // Create job for tracking if shell provided
  let job: Job | undefined;
  if (shell) {
    job = createJob(shell, code, false, 0);
    shell.jobs.set(job.id, job);
    shell.lastActivityAt = new Date();
  }

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
    env: buildEnv(config, shell),
    stdout: "piped",
    stderr: "piped",
  });

  // Spawn process so we can kill it on timeout
  const process = command.spawn();

  // Update job with PID
  if (job) {
    job.pid = process.pid;
    shell!.jobsByPid.set(process.pid, job.id);
  }

  try {
    // Create a promise that collects output
    const outputPromise = (async () => {
      const [status, stdout, stderr] = await Promise.all([
        process.status,
        collectStream(process.stdout),
        collectStream(process.stderr),
      ]);
      return { status, stdout, stderr };
    })();

    const { status, stdout, stderr } = await deadline(outputPromise, timeoutMs);

    // Update job with results
    if (job) {
      const stdoutResult = truncateOutput(stdout);
      const stderrResult = truncateOutput(stderr);

      job.status = status.code === 0 ? "completed" : "failed";
      job.exitCode = status.code;
      job.stdout = stdoutResult.text;
      job.stderr = stderrResult.text;
      job.stdoutTruncated = stdoutResult.truncated;
      job.stderrTruncated = stderrResult.truncated;
      job.completedAt = new Date();
      job.duration = job.completedAt.getTime() - job.startedAt.getTime();
    }

    return {
      stdout,
      stderr,
      code: status.code,
      success: status.code === 0,
      jobId: job?.id,
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

    // Update job with failure
    if (job) {
      job.status = "failed";
      job.completedAt = new Date();
      job.duration = job.completedAt.getTime() - job.startedAt.getTime();
      if (error instanceof DOMException && error.name === "TimeoutError") {
        job.stderr = `Execution timed out after ${timeoutMs}ms`;
        job.stderrTruncated = false;
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
        collectStream(process.stdout),
        collectStream(process.stderr),
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
