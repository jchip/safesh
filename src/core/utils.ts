/**
 * Shared utility functions for SafeShell
 *
 * @module
 */

import type { SafeShellConfig, Shell } from "./types.ts";
import { ENV_SHELL_ID, ENV_SCRIPT_ID } from "./constants.ts";

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get real path, handling symlinks and non-existent paths
 *
 * Returns the resolved real path if possible, otherwise returns the input path.
 * Useful for normalizing paths that may contain symlinks (e.g., /tmp -> /private/tmp on macOS).
 */
export function getRealPath(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
}

/**
 * Get both original and resolved paths for symlink handling
 *
 * Returns an array with both the original path and its resolved real path.
 * If they are the same, returns a single-element array.
 * Important for macOS where /tmp -> /private/tmp - Deno checks literal paths.
 *
 * @param path - The path to resolve
 * @returns Array containing [originalPath, resolvedPath] or just [path] if they're the same
 */
export function getRealPathBoth(path: string): string[] {
  try {
    const resolved = Deno.realPathSync(path);
    // Return both if different (e.g., /tmp and /private/tmp)
    return resolved !== path ? [path, resolved] : [path];
  } catch {
    // Path doesn't exist yet or can't be resolved, return as-is
    return [path];
  }
}

/**
 * Async version of getRealPath
 *
 * Returns the resolved real path if possible, otherwise returns the input path.
 * Useful for normalizing paths that may contain symlinks in async contexts.
 *
 * @param path - The path to resolve
 * @returns Promise resolving to the real path or the original path if resolution fails
 */
export async function getRealPathAsync(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return path;
  }
}

/**
 * Get default config with current directory as sandbox
 *
 * Creates a minimal SafeShellConfig allowing read/write to the current directory
 * and /tmp. Resolves /tmp to its real path for symlink handling.
 */
export function getDefaultConfig(cwd: string): SafeShellConfig {
  const tmpPath = getRealPath("/tmp");
  const realCwd = getRealPath(cwd);

  return {
    permissions: {
      read: [realCwd, tmpPath],
      write: [realCwd, tmpPath],
    },
  };
}

/**
 * Get default allowed paths for sandbox validation
 *
 * Returns an array of paths that are allowed by default: cwd and /tmp.
 * Resolves symlinks to real paths.
 */
export function getDefaultAllowedPaths(cwd: string): string[] {
  const tmpPath = getRealPath("/tmp");
  const realCwd = getRealPath(cwd);
  return [realCwd, tmpPath];
}

/**
 * Hash code string using SHA-256 encoded in URL-safe Base64 (truncated)
 *
 * Used for caching script files by content hash.
 * Returns the first 16 chars of the URL-safe Base64 encoded SHA-256 hash.
 * This provides ~96 bits of entropy (vs 64 bits for 16-char hex).
 */
export async function hashCode(code: string, length: number = 16): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  
  // Convert 32-byte buffer to binary string safely (small size)
  const binary = String.fromCharCode(...new Uint8Array(hashBuffer));
  
  // Convert to Base64 and make URL-safe (replace +/ with -_ and remove padding)
  const base64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
    
  return base64.slice(0, length);
}

/**
 * Build environment variables for subprocess execution
 *
 * Handles:
 * - Allowlist filtering from config
 * - Mask pattern matching (e.g., "*_SECRET", "*_KEY")
 * - Shell env var merging
 * - Job tracking context (SAFESH_SHELL_ID, SAFESH_SCRIPT_ID)
 */
export function buildEnv(
  config: SafeShellConfig,
  shell?: Shell,
  scriptId?: string,
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
        // SSH-483: Merge login shell PATH to include user's full PATH
        if (key === "PATH") {
          result[key] = getMergedPathSync(value);
        } else {
          result[key] = value;
        }
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

  // Add shell and script context for job tracking
  if (shell) {
    result[ENV_SHELL_ID] = shell.id;
  }
  if (scriptId) {
    result[ENV_SCRIPT_ID] = scriptId;
  }

  return result;
}

// ============================================================================
// Login Shell PATH Expansion (SSH-483)
// ============================================================================

/** Cached login shell PATH */
let loginShellPathCache: string | null = null;

/**
 * Get PATH from user's login shell
 *
 * This resolves the issue where commands are available in the user's terminal
 * (via .zshrc, .bash_profile, etc.) but not in Deno's inherited environment.
 *
 * The PATH is cached after the first call.
 *
 * @returns The PATH string from the user's login shell
 */
export async function getLoginShellPath(): Promise<string> {
  // Return cached value if available
  if (loginShellPathCache !== null) {
    return loginShellPathCache;
  }

  // Detect user's shell
  const shell = Deno.env.get("SHELL") ?? "/bin/sh";
  const isZsh = shell.endsWith("zsh");
  const isBash = shell.endsWith("bash");

  try {
    // Use login shell to get PATH
    // -l = login shell (sources profile files)
    // -c = run command
    const args = isZsh || isBash
      ? ["-l", "-c", "echo $PATH"]
      : ["-c", "echo $PATH"];

    const command = new Deno.Command(shell, {
      args,
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout } = await command.output();

    if (code === 0) {
      const path = new TextDecoder().decode(stdout).trim();
      if (path) {
        loginShellPathCache = path;
        return path;
      }
    }
  } catch {
    // Fallback to current PATH if shell execution fails
  }

  // Fallback to current Deno PATH
  loginShellPathCache = Deno.env.get("PATH") ?? "";
  return loginShellPathCache;
}

/**
 * Merge current PATH with login shell PATH
 *
 * Combines paths from both sources, removing duplicates while preserving order.
 * Login shell paths are appended to the end to allow user overrides.
 *
 * @param currentPath - The current PATH from Deno.env
 * @returns Merged PATH string
 */
export async function getMergedPath(currentPath: string): Promise<string> {
  const loginPath = await getLoginShellPath();

  // Split both paths
  const currentPaths = currentPath ? currentPath.split(":") : [];
  const loginPaths = loginPath ? loginPath.split(":") : [];

  // Use Set to track seen paths (for deduplication)
  const seen = new Set<string>();
  const merged: string[] = [];

  // Add current paths first (higher priority)
  for (const p of currentPaths) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  // Add login shell paths that aren't already present
  for (const p of loginPaths) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  return merged.join(":");
}

/**
 * Reset the login shell PATH cache (for testing)
 * @internal
 */
export function _resetLoginShellPathCache(): void {
  loginShellPathCache = null;
}

/**
 * Get merged PATH synchronously (uses cache)
 *
 * Returns merged PATH if login shell PATH has been cached,
 * otherwise returns the input PATH unchanged.
 *
 * Call getLoginShellPath() at startup to ensure cache is populated.
 *
 * @param currentPath - The current PATH from Deno.env
 * @returns Merged PATH string (or original if cache not populated)
 */
export function getMergedPathSync(currentPath: string): string {
  // If cache not populated, return current PATH
  if (loginShellPathCache === null) {
    return currentPath;
  }

  // Split both paths
  const currentPaths = currentPath ? currentPath.split(":") : [];
  const loginPaths = loginShellPathCache.split(":");

  // Use Set to track seen paths (for deduplication)
  const seen = new Set<string>();
  const merged: string[] = [];

  // Add current paths first (higher priority)
  for (const p of currentPaths) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  // Add login shell paths that aren't already present
  for (const p of loginPaths) {
    if (p && !seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }

  return merged.join(":");
}

/**
 * Concatenate multiple Uint8Array chunks into a single Uint8Array.
 *
 * @param chunks - Array of Uint8Array chunks to concatenate
 * @returns Single Uint8Array containing all chunks
 */
export function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Collect a readable stream into bytes
 */
export async function collectStreamBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatUint8Arrays(chunks);
}

/**
 * Collect stream bytes with abort signal support (SSH-429)
 *
 * This version allows canceling the stream collection if it takes too long.
 * When aborted, it returns all chunks collected so far instead of losing data.
 *
 * Use case: Commands that spawn background daemons may leave file descriptors
 * open. After the parent process exits, we give streams a grace period to flush,
 * then abort collection to avoid hanging forever.
 *
 * @param stream - The readable stream to collect
 * @param signal - AbortSignal to cancel collection
 * @returns All collected bytes (even if aborted)
 */
export async function collectStreamBytesWithTimeout(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (!signal.aborted) {
      // Race between reading next chunk and abort signal
      const readPromise = reader.read();
      const abortPromise = new Promise<{ done: boolean; value?: Uint8Array }>(
        (resolve) => {
          const abortHandler = () => resolve({ done: true });
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      );

      const { done, value } = await Promise.race([readPromise, abortPromise]);
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    // Try to cancel the stream to release resources
    try {
      await stream.cancel();
    } catch {
      // Stream may already be closed, ignore errors
    }
  }

  return concatUint8Arrays(chunks);
}

/**
 * Collect a readable stream into a string
 */
export async function collectStreamText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const bytes = await collectStreamBytes(stream);
  return new TextDecoder().decode(bytes);
}

// ============================================================================
// Process Utilities
// ============================================================================

/**
 * Cleanup a child process by killing it and canceling its streams
 *
 * Handles the common pattern of:
 * - Killing the process (which may have already exited)
 * - Canceling stdout stream (which may already be closed)
 * - Canceling stderr stream (which may already be closed)
 *
 * All errors are silently caught since the process/streams may already be closed.
 */
export async function cleanupProcess(
  process: Deno.ChildProcess,
): Promise<void> {
  try {
    process.kill("SIGKILL");
  } catch {
    // Process may have already exited
  }
  try {
    await process.stdout.cancel();
  } catch {
    // Stream may already be closed or locked by a reader
  }
  try {
    await process.stderr.cancel();
  } catch {
    // Stream may already be closed or locked by a reader
  }
  try {
    await process.status;
  } catch {
    // Process may have already been awaited
  }
}
