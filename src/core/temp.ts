/**
 * Centralized temporary directory management for SafeShell
 *
 * All temporary files are organized under /tmp/safesh/
 */

import { ensureDirSync } from "./io-utils.ts";

const SAFESH_TMP_ROOT = "/tmp/safesh";

/**
 * Get the root temporary directory for safesh
 */
export function getTempRoot(): string {
  ensureDirSync(SAFESH_TMP_ROOT);
  return SAFESH_TMP_ROOT;
}

/**
 * Get the errors directory path
 */
export function getErrorsDir(): string {
  const dir = `${SAFESH_TMP_ROOT}/errors`;
  ensureDirSync(dir);
  return dir;
}

/**
 * Get the scripts directory path (for transpiled TypeScript files)
 */
export function getScriptsDir(): string {
  const dir = `${SAFESH_TMP_ROOT}/scripts`;
  ensureDirSync(dir);
  return dir;
}

/**
 * Get the pending files directory path (for retry workflow metadata)
 */
export function getPendingDir(): string {
  const dir = `${SAFESH_TMP_ROOT}/pending`;
  ensureDirSync(dir);
  return dir;
}

/**
 * Generate a unique error log file path
 */
export function getErrorLogPath(): string {
  const dir = getErrorsDir();
  return `${dir}/${Date.now()}-${Deno.pid}.log`;
}

/**
 * Generate a pending command file path
 */
export function getPendingFilePath(id: string): string {
  const dir = getPendingDir();
  return `${dir}/pending-${id}.json`;
}

/**
 * Generate a pending path request file path
 */
export function getPendingPathFilePath(id: string): string {
  const dir = getPendingDir();
  return `${dir}/pending-path-${id}.json`;
}

/**
 * Generate a unique script file path for transpiled code
 */
export function getScriptFilePath(id: string): string {
  const dir = getScriptsDir();
  return `${dir}/file_${id}.ts`;
}

/**
 * Find an existing script file by hash, trying multiple naming conventions
 * Returns the path if found, null otherwise
 */
export async function findScriptFilePath(hash: string): Promise<string | null> {
  const scriptsDir = getScriptsDir();
  const possiblePaths = [
    `${scriptsDir}/tx-script-${hash}.ts`,
    `${scriptsDir}/script-${hash}.ts`,
    `${scriptsDir}/file_${hash}.ts`,
  ];

  for (const path of possiblePaths) {
    try {
      await Deno.stat(path);
      return path;
    } catch {
      // Try next path
    }
  }

  return null;
}

/**
 * Generate a unique ID for temporary files
 */
export function generateTempId(): string {
  return `${Date.now()}-${Deno.pid}`;
}

/**
 * Get the session file path for storing session-allowed commands.
 * Stored under {projectDir}/.temp/safesh/ if projectDir is provided,
 * otherwise falls back to /tmp/safesh/
 */
export function getSessionFilePath(projectDir?: string, sessionId?: string): string {
  const id = sessionId ?? Deno.env.get("CLAUDE_SESSION_ID") ?? "default";

  if (projectDir) {
    const dir = `${projectDir}/.temp/safesh`;
    ensureDirSync(dir);
    return `${dir}/session-${id}.json`;
  }

  // Fallback to /tmp/safesh if no projectDir
  const dir = getTempRoot();
  return `${dir}/session-${id}.json`;
}

/**
 * Get the import policy directory path
 */
export function getImportPolicyDir(): string {
  const dir = `${SAFESH_TMP_ROOT}/import-policy`;
  ensureDirSync(dir);
  return dir;
}
