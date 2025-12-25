/**
 * Code execution engine
 *
 * Executes JS/TS code in a sandboxed Deno subprocess with configured permissions.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { deadline } from "@std/async";
import { executionError, timeout as timeoutError } from "../core/errors.ts";
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
 */
function buildPreamble(session?: Session): string {
  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    'import * as fs from "safesh:fs";',
    'import * as text from "safesh:text";',
    'import $ from "safesh:shell";',
  ];

  // Inject session as a global if provided
  if (session) {
    lines.push("");
    lines.push("// Session context");
    lines.push(`const $session = ${JSON.stringify({
      id: session.id,
      cwd: session.cwd,
      env: session.env,
      vars: session.vars,
    })};`);
  }

  lines.push("");
  lines.push("// User code starts here");
  lines.push("");

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

  // Read permissions
  if (perms.read?.length) {
    const paths = perms.read.map(expandPath).join(",");
    flags.push(`--allow-read=${paths}`);
  }

  // Write permissions
  if (perms.write?.length) {
    const paths = perms.write.map(expandPath).join(",");
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
  const importMapPath = await findImportMap(cwd);

  const args = [
    "run",
    "--no-prompt", // Never prompt for permissions
    ...permFlags,
  ];

  if (importMapPath) {
    args.push(`--import-map=${importMapPath}`);
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
 * Find import map file (deno.json or import_map.json)
 */
async function findImportMap(cwd: string): Promise<string | undefined> {
  // Check for deno.json in cwd
  const denoJson = join(cwd, "deno.json");
  try {
    await Deno.stat(denoJson);
    return denoJson;
  } catch {
    // Not found
  }

  // Check for import_map.json
  const importMap = join(cwd, "import_map.json");
  try {
    await Deno.stat(importMap);
    return importMap;
  } catch {
    // Not found
  }

  return undefined;
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
  const importMapPath = await findImportMap(cwd);

  const args = [
    "run",
    "--no-prompt",
    ...permFlags,
  ];

  if (importMapPath) {
    args.push(`--import-map=${importMapPath}`);
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
