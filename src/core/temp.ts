/**
 * Centralized temporary directory management for SafeShell
 *
 * All temporary files are organized under /tmp/safesh/
 */

const SAFESH_TMP_ROOT = "/tmp/safesh";

/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDir(path: string): void {
  try {
    Deno.mkdirSync(path, { recursive: true });
  } catch (error) {
    // Ignore if already exists
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

/**
 * Get the root temporary directory for safesh
 */
export function getTempRoot(): string {
  ensureDir(SAFESH_TMP_ROOT);
  return SAFESH_TMP_ROOT;
}

/**
 * Get the errors directory path
 */
export function getErrorsDir(): string {
  const dir = `${SAFESH_TMP_ROOT}/errors`;
  ensureDir(dir);
  return dir;
}

/**
 * Get the scripts directory path (for transpiled TypeScript files)
 */
export function getScriptsDir(): string {
  const dir = `${SAFESH_TMP_ROOT}/scripts`;
  ensureDir(dir);
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
  const dir = getTempRoot();
  return `${dir}/pending-${id}.json`;
}

/**
 * Generate a unique script file path for transpiled code
 */
export function getScriptFilePath(id: string): string {
  const dir = getScriptsDir();
  return `${dir}/file_${id}.ts`;
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
    ensureDir(dir);
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
  ensureDir(dir);
  return dir;
}
