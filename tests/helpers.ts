/**
 * Test Helpers
 *
 * Common utilities for SafeShell tests to reduce boilerplate and ensure
 * consistent test environment setup and teardown.
 */

/** Resolved /tmp path for consistent test temp directories (handles macOS /tmp -> /private/tmp symlink) */
export const REAL_TMP = Deno.realPathSync("/tmp");

/**
 * Create a unique test directory under REAL_TMP
 *
 * Creates a uniquely named directory suitable for test isolation.
 * The directory is not automatically cleaned up - use cleanupTestDir() or withTestDir().
 *
 * @param prefix - Prefix for the directory name (e.g., "mytest")
 * @returns Absolute path to the created directory
 *
 * @example
 * ```typescript
 * const testDir = createTestDir("permissions");
 * // testDir = "/private/tmp/permissions-550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function createTestDir(prefix: string): string {
  const uuid = crypto.randomUUID();
  return `${REAL_TMP}/${prefix}-${uuid}`;
}

/**
 * Remove a test directory recursively
 *
 * Safely removes a directory and all its contents. Ignores errors (best-effort cleanup).
 * Validates that the path is within REAL_TMP for safety.
 *
 * @param path - Absolute path to the directory to remove
 *
 * @example
 * ```typescript
 * const testDir = createTestDir("mytest");
 * // ... use testDir ...
 * cleanupTestDir(testDir);
 * ```
 */
export function cleanupTestDir(path: string): void {
  // Safety check: ensure path is within REAL_TMP
  if (!path.startsWith(REAL_TMP)) {
    console.warn(`Refusing to cleanup directory outside REAL_TMP: ${path}`);
    return;
  }

  try {
    Deno.removeSync(path, { recursive: true });
  } catch {
    // Ignore errors - best-effort cleanup
  }
}

/**
 * Run a function with a temporary test directory, ensuring cleanup
 *
 * Higher-order function for test isolation. Creates a temp directory,
 * runs the provided function, and ensures cleanup even if the function throws.
 *
 * @param prefix - Prefix for the directory name
 * @param fn - Function to run with the temp directory
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * await withTestDir("mytest", async (dir) => {
 *   await Deno.writeTextFile(`${dir}/test.txt`, "content");
 *   // Test code here...
 *   // Directory is automatically cleaned up
 * });
 * ```
 */
export async function withTestDir<T>(
  prefix: string,
  fn: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = createTestDir(prefix);
  await Deno.mkdir(dir, { recursive: true });

  try {
    return await fn(dir);
  } finally {
    cleanupTestDir(dir);
  }
}

let denoDirPromise: Promise<string | undefined> | undefined;

/**
 * Resolve the DENO_DIR of the current Deno process (cached)
 *
 * Integration tests that spawn nested `deno run` subprocesses pass this
 * through so the child reuses the parent's module cache instead of
 * re-downloading dependencies.
 *
 * @returns The configured DENO_DIR, the denoDir reported by `deno info`,
 *          or undefined if neither is available
 */
export function getCurrentDenoDir(): Promise<string | undefined> {
  if (!denoDirPromise) {
    denoDirPromise = (async () => {
      const configured = Deno.env.get("DENO_DIR");
      if (configured) return configured;
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["info", "--json"],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (output.code !== 0) return undefined;
      const info = JSON.parse(new TextDecoder().decode(output.stdout)) as { denoDir?: string };
      return info.denoDir;
    })();
  }
  return denoDirPromise;
}

/** Result of a bash-prehook run (see runBashPrehook) */
export interface BashPrehookResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Options for runBashPrehook */
export interface RunBashPrehookOptions {
  /** CLAUDE_SESSION_ID for the prehook process (suites use a per-suite label) */
  sessionId?: string;
  /** Extra environment variables merged over the harness defaults */
  env?: Record<string, string>;
  /** Set run_in_background on the Bash tool input */
  runInBackground?: boolean;
}

/**
 * Spawn hooks/bash-prehook.ts as Claude Code would for a Bash PreToolUse hook
 *
 * Feeds the hook a PreToolUse JSON payload for `commandText` on stdin and
 * collects its decision output. `cwd` is the simulated Bash tool working
 * directory (BASH_PREHOOK_CWD); the subprocess itself runs from Deno.cwd()
 * so the hook script path resolves from the repo root.
 *
 * @param commandText - The Bash tool command under test
 * @param cwd - Simulated working directory for the prehook (BASH_PREHOOK_CWD)
 * @param options - Session id, extra env, and background flag
 * @returns Exit code plus captured stdout/stderr of the hook process
 */
export async function runBashPrehook(
  commandText: string,
  cwd: string,
  options: RunBashPrehookOptions = {},
): Promise<BashPrehookResult> {
  const denoDir = await getCurrentDenoDir();
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "hooks/bash-prehook.ts",
    ],
    cwd: Deno.cwd(),
    env: {
      BASH_PREHOOK_CWD: cwd,
      CLAUDE_SESSION_ID: options.sessionId ?? "safesh-test",
      ...(denoDir ? { DENO_DIR: denoDir } : {}),
      ...options.env,
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const child = command.spawn();
  const writer = child.stdin.getWriter();
  const toolInput: Record<string, unknown> = { command: commandText };
  if (options.runInBackground) toolInput.run_in_background = true;
  await writer.write(
    new TextEncoder().encode(
      JSON.stringify({
        hookEventName: "PreToolUse",
        tool_name: "Bash",
        tool_input: toolInput,
      }),
    ),
  );
  await writer.close();

  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
