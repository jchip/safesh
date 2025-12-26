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
import type { ExecOptions, ExecResult, SafeShellConfig, Session } from "../core/types.ts";

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
 *
 * The preamble injects:
 * - Session context as $session
 * - Standard library (fs, text, $)
 * - Streaming shell API (cat, glob, git, lines, grep, map, filter, etc.)
 */
function buildPreamble(session?: Session): string {
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
    `import { filter, map, flatMap, take, lines, grep } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout, stderr, tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat, glob, src, dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd, git, docker, deno } from 'file://${stdlibPath}command.ts';`,
    "",
  ];

  if (session) {
    lines.push(
      "// Session context available as $session",
      `const $session = ${JSON.stringify({
        id: session.id,
        cwd: session.cwd,
        env: session.env,
        vars: session.vars,
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
  if (perms.run?.length) {
    flags.push(`--allow-run=${perms.run.join(",")}`);
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
 * Execute JS/TS code in a sandboxed Deno subprocess
 */
export async function executeCode(
  code: string,
  config: SafeShellConfig,
  options: ExecOptions = {},
  session?: Session,
): Promise<ExecResult> {
  const cwd = options.cwd ?? session?.cwd ?? Deno.cwd();
  const timeoutMs = options.timeout ?? config.timeout ?? DEFAULT_TIMEOUT;

  // Validate imports against security policy
  const importPolicy = config.imports ?? { trusted: [], allowed: [], blocked: [] };
  validateImports(code, importPolicy);

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
    env: buildEnv(config, session),
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
  session?: Session,
): Promise<ExecResult> {
  const cwd = options.cwd ?? session?.cwd ?? Deno.cwd();
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
    env: buildEnv(config, session),
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
  session?: Session,
): AsyncGenerator<{ type: "stdout" | "stderr" | "exit"; data?: string; code?: number }> {
  const cwd = options.cwd ?? session?.cwd ?? Deno.cwd();

  // Validate imports against security policy
  const importPolicy = config.imports ?? { trusted: [], allowed: [], blocked: [] };
  validateImports(code, importPolicy);

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
    env: buildEnv(config, session),
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
