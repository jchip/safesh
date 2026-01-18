/**
 * Pending Command/Path Management Module
 *
 * Provides unified logic for managing pending commands and path requests.
 * Eliminates ~20 lines of interface duplication.
 */

import { generateTempId, getPendingFilePath as getTempFilePath, getPendingPathFilePath as getTempPathFilePath } from "./temp.ts";

/**
 * Pending command structure - created when a command is blocked
 * The script is stored separately using scriptHash as the key
 */
export interface PendingCommand {
  id: string;
  scriptHash: string;  // Hash of script content for finding cached script file
  commands: string[];  // Disallowed commands (filled by initCmds)
  cwd: string;
  timeout?: number;
  runInBackground?: boolean;
  createdAt: string;
  // Note: tsCode removed - read from script file using scriptHash
}

/**
 * Pending path request structure - created when a path access is blocked
 */
export interface PendingPathRequest {
  id: string;
  path: string;
  operation: "read" | "write";
  cwd: string;
  scriptHash: string;
  createdAt: string;
}

/**
 * Generate a unique ID for pending files
 * Format: {timestamp}-{pid}
 */
export function generatePendingId(): string {
  return generateTempId();
}

/**
 * Write a pending command to disk
 * Creates file at: /tmp/safesh/pending-{id}.json
 */
export function writePendingCommand(pending: PendingCommand): void {
  const filePath = getTempFilePath(pending.id);
  const content = JSON.stringify(pending, null, 2);
  Deno.writeTextFileSync(filePath, content);
}

/**
 * Write a pending path request to disk
 * Creates file at: /tmp/safesh/pending-path-{id}.json
 */
export function writePendingPath(pending: PendingPathRequest): void {
  const filePath = getTempPathFilePath(pending.id);
  const content = JSON.stringify(pending, null, 2);
  Deno.writeTextFileSync(filePath, content);
}

/**
 * Read a pending command from disk
 * Returns null if file doesn't exist or can't be parsed
 */
export function readPendingCommand(id: string): PendingCommand | null {
  try {
    const filePath = getTempFilePath(id);
    const content = Deno.readTextFileSync(filePath);
    return JSON.parse(content) as PendingCommand;
  } catch {
    return null;
  }
}

/**
 * Read a pending path request from disk
 * Returns null if file doesn't exist or can't be parsed
 */
export function readPendingPath(id: string): PendingPathRequest | null {
  try {
    const filePath = getTempPathFilePath(id);
    const content = Deno.readTextFileSync(filePath);
    return JSON.parse(content) as PendingPathRequest;
  } catch {
    return null;
  }
}

/**
 * Delete a pending file from disk
 * Handles both command and path pending files
 * Silently ignores if file doesn't exist
 */
export function deletePending(id: string, type: "command" | "path"): void {
  try {
    const filePath = type === "command"
      ? getTempFilePath(id)
      : getTempPathFilePath(id);
    Deno.removeSync(filePath);
  } catch {
    // Silently ignore - file may have already been deleted
  }
}
