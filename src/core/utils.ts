/**
 * Shared utility functions for SafeShell
 *
 * @module
 */

import type { SafeShellConfig, Shell } from "./types.ts";
import { getProjectCommands } from "./config.ts";

/**
 * Hash code string using SHA-256
 *
 * Used for caching script files by content hash.
 */
export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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

  // Add shell and script context for job tracking
  if (shell) {
    result["SAFESH_SHELL_ID"] = shell.id;
  }
  if (scriptId) {
    result["SAFESH_SCRIPT_ID"] = scriptId;
  }

  // Add project commands for init() validation
  const projectCommands = getProjectCommands();
  if (projectCommands.length > 0) {
    result["SAFESH_PROJECT_COMMANDS"] = JSON.stringify(projectCommands);
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

  // Concatenate all chunks
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
 * Collect a readable stream into a string
 */
export async function collectStreamText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const bytes = await collectStreamBytes(stream);
  return new TextDecoder().decode(bytes);
}
