/**
 * Session File Management Module
 *
 * Provides unified logic for session-based permission management.
 * Eliminates ~60 lines duplicated 5 times across bash-prehook.ts and desh.ts.
 *
 * Session files store temporary permissions that last for the duration of a
 * Claude Code session (identified by CLAUDE_SESSION_ID environment variable).
 */

import { getSessionFilePath as getTempSessionFilePath } from "./temp.ts";
import { readJsonFileSync, writeJsonFile } from "./io-utils.ts";
import type { SafeShellConfig } from "./types.ts";

/**
 * Session data structure stored in session-{id}.json
 */
export interface SessionData {
  allowedCommands?: string[];
  permissions?: {
    read?: string[];
    write?: string[];
  };
}

/**
 * Read session data from disk
 * Returns empty data structure if file doesn't exist or can't be parsed
 *
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 * @returns Session data with allowedCommands and permissions
 */
export function readSessionFile(
  projectDir?: string,
  sessionId?: string,
): SessionData {
  const sessionFile = getTempSessionFilePath(projectDir, sessionId);

  try {
    return readJsonFileSync<SessionData>(sessionFile);
  } catch {
    // File doesn't exist or invalid JSON - return empty data
    return {};
  }
}

/**
 * Write session data to disk
 * Merges with existing data if file already exists
 *
 * @param data - Partial session data to write (merges with existing)
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 */
export async function writeSessionFile(
  data: Partial<SessionData>,
  projectDir?: string,
  sessionId?: string,
): Promise<void> {
  const sessionFile = getTempSessionFilePath(projectDir, sessionId);

  // Load existing data
  const existing = readSessionFile(projectDir, sessionId);

  // Merge with new data
  const merged: SessionData = {
    ...existing,
    ...data,
  };

  // Write back
  await writeJsonFile(sessionFile, merged);
}

/**
 * Add commands to session-allowed list
 * Automatically deduplicates and merges with existing commands
 *
 * @param commands - Commands to add to session allowlist
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 */
export async function addSessionCommands(
  commands: string[],
  projectDir?: string,
  sessionId?: string,
): Promise<void> {
  const existing = readSessionFile(projectDir, sessionId);

  // Deduplicate using Set
  const allowedSet = new Set(existing.allowedCommands ?? []);
  for (const cmd of commands) {
    allowedSet.add(cmd);
  }

  await writeSessionFile(
    {
      ...existing,
      allowedCommands: [...allowedSet],
    },
    projectDir,
    sessionId,
  );
}

/**
 * Add path permissions to session
 * Automatically deduplicates and merges with existing permissions
 *
 * @param readPaths - Paths to add read permission for
 * @param writePaths - Paths to add write permission for
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 */
export async function addSessionPaths(
  readPaths: string[],
  writePaths: string[],
  projectDir?: string,
  sessionId?: string,
): Promise<void> {
  const existing = readSessionFile(projectDir, sessionId);

  const permissions = existing.permissions ?? {};

  // Merge read paths
  if (readPaths.length > 0) {
    const readSet = new Set(permissions.read ?? []);
    for (const path of readPaths) {
      readSet.add(path);
    }
    permissions.read = [...readSet];
  }

  // Merge write paths
  if (writePaths.length > 0) {
    const writeSet = new Set(permissions.write ?? []);
    for (const path of writePaths) {
      writeSet.add(path);
    }
    permissions.write = [...writeSet];
  }

  await writeSessionFile(
    {
      ...existing,
      permissions,
    },
    projectDir,
    sessionId,
  );
}

/**
 * Get session-allowed commands (backward compatibility helper)
 * Returns a Set for easy membership checking
 *
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 * @returns Set of allowed commands
 */
export function getSessionAllowedCommands(
  projectDir?: string,
  sessionId?: string,
): Set<string> {
  const session = readSessionFile(projectDir, sessionId);
  return new Set(session.allowedCommands ?? []);
}

/**
 * Get session-allowed commands as array (backward compatibility helper)
 * For code that expects an array instead of a Set
 *
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 * @returns Array of allowed commands
 */
export function getSessionAllowedCommandsArray(
  projectDir?: string,
  sessionId?: string,
): string[] {
  const session = readSessionFile(projectDir, sessionId);
  return session.allowedCommands ?? [];
}

/**
 * Get session-allowed path permissions (backward compatibility helper)
 *
 * @param projectDir - Optional project directory (determines file location)
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 * @returns Path permissions object with read and write arrays
 */
export function getSessionPathPermissions(
  projectDir?: string,
  sessionId?: string,
): { read?: string[]; write?: string[] } {
  const session = readSessionFile(projectDir, sessionId);
  return session.permissions ?? {};
}

/**
 * Merge session permissions into a config object
 * Consolidates the common pattern of loading and merging session permissions
 *
 * This function:
 * 1. Loads session data from disk (if exists)
 * 2. Merges session.permissions.read into config.permissions.read
 * 3. Merges session.permissions.write into config.permissions.write
 * 4. Merges session.allowedCommands into config.permissions.run
 *
 * @param config - The config object to merge into (will be mutated)
 * @param projectDir - Project directory to determine session file location
 * @param sessionId - Optional session ID (defaults to CLAUDE_SESSION_ID env var)
 */
export function mergeSessionPermissions(
  config: SafeShellConfig,
  projectDir: string,
  sessionId?: string,
): void {
  const sessionFile = getTempSessionFilePath(projectDir, sessionId);

  try {
    const session = readJsonFileSync<SessionData>(sessionFile);

    // Merge read permissions (deduplicated)
    if (session.permissions?.read) {
      config.permissions = config.permissions ?? {};
      config.permissions.read = [
        ...new Set([
          ...(config.permissions.read ?? []),
          ...session.permissions.read,
        ]),
      ];
    }

    // Merge write permissions (deduplicated)
    if (session.permissions?.write) {
      config.permissions = config.permissions ?? {};
      config.permissions.write = [
        ...new Set([
          ...(config.permissions.write ?? []),
          ...session.permissions.write,
        ]),
      ];
    }

    // Merge allowed commands into run permissions (deduplicated)
    if (session.allowedCommands) {
      config.permissions = config.permissions ?? {};
      config.permissions.run = [
        ...new Set([
          ...(config.permissions.run ?? []),
          ...session.allowedCommands,
        ]),
      ];
    }
  } catch {
    // Session file doesn't exist or is invalid - continue without it
  }
}
