/**
 * Single-use records that correlate a SafeShell PreToolUse rewrite with the
 * subsequent Codex PermissionRequest event for that exact generated command.
 */

import { ensureDirSync } from "../core/io-utils.ts";
import { getTempRoot } from "../core/temp.ts";

const APPROVAL_MAX_AGE_MS = 60_000;

export interface SafeShellApprovalRecord {
  sessionId: string;
  turnId: string;
  cwd: string;
  command: string;
  createdAt: number;
}

export interface SafeShellApprovalRequest {
  sessionId: string;
  turnId: string;
  cwd: string;
  command: string;
}

function getApprovalDir(): string {
  const dir = `${getTempRoot()}/approvals`;
  ensureDirSync(dir);
  try {
    Deno.chmodSync(dir, 0o700);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  return dir;
}

function removeQuietly(path: string): void {
  try {
    Deno.removeSync(path);
  } catch {
    // Another process may already have consumed or cleaned the record.
  }
}

function isExpired(record: SafeShellApprovalRecord, now: number): boolean {
  return !Number.isFinite(record.createdAt) ||
    record.createdAt > now + APPROVAL_MAX_AGE_MS ||
    now - record.createdAt > APPROVAL_MAX_AGE_MS;
}

function readRecord(path: string): SafeShellApprovalRecord | null {
  try {
    const info = Deno.lstatSync(path);
    if (!info.isFile || info.isSymlink) return null;
    return JSON.parse(Deno.readTextFileSync(path)) as SafeShellApprovalRecord;
  } catch {
    return null;
  }
}

function matches(record: SafeShellApprovalRecord, request: SafeShellApprovalRequest): boolean {
  return record.sessionId === request.sessionId &&
    record.turnId === request.turnId &&
    record.cwd === request.cwd &&
    record.command === request.command;
}

export function writeSafeShellApprovalRecord(
  request: SafeShellApprovalRequest,
  now = Date.now(),
): void {
  cleanupSafeShellApprovalRecords(now);
  const path = `${getApprovalDir()}/approval-${crypto.randomUUID()}.json`;
  const record: SafeShellApprovalRecord = { ...request, createdAt: now };
  Deno.writeTextFileSync(path, JSON.stringify(record), {
    createNew: true,
    mode: 0o600,
  });
}

export function consumeSafeShellApprovalRecord(
  request: SafeShellApprovalRequest,
  now = Date.now(),
): boolean {
  const dir = getApprovalDir();

  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.isFile || !entry.name.startsWith("approval-") || !entry.name.endsWith(".json")) {
      continue;
    }

    const path = `${dir}/${entry.name}`;
    const record = readRecord(path);
    if (!record) {
      removeQuietly(path);
      continue;
    }
    if (isExpired(record, now)) {
      removeQuietly(path);
      continue;
    }
    if (!matches(record, request)) continue;

    const claimedPath = `${path}.claimed-${crypto.randomUUID()}`;
    try {
      Deno.renameSync(path, claimedPath);
    } catch {
      continue;
    }
    removeQuietly(claimedPath);
    return true;
  }

  return false;
}

export function cleanupSafeShellApprovalRecords(now = Date.now()): void {
  const dir = getApprovalDir();
  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.isFile || !entry.name.startsWith("approval-")) continue;
    const path = `${dir}/${entry.name}`;
    const record = readRecord(path);
    if (!record || isExpired(record, now)) removeQuietly(path);
  }
}
