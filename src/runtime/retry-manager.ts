/**
 * Retry management for SafeShell
 *
 * Handles pending retries for the permission retry workflow.
 * When a command is blocked, the context is stored so Claude can retry
 * after getting user approval.
 *
 * @module
 */

import type { PendingRetry } from "../core/types.ts";
import { PENDING_RETRY_TTL, MAX_PENDING_RETRIES } from "../core/types.ts";

/**
 * Generate a unique retry ID using timestamp and process ID.
 * Format: {timestamp}-{pid} to ensure uniqueness across multiple SafeShell instances.
 */
function generateRetryId(): string {
  return `${Date.now()}-${Deno.pid}`;
}

/**
 * RetryManager - manages pending retries for permission workflow
 */
export class RetryManager {
  /** Pending retries by ID */
  private pendingRetries: Map<string, PendingRetry> = new Map();

  /**
   * Create a retry record with common boilerplate: cleanup, eviction, and registration.
   * Callers provide extra fields to merge into the base retry object.
   */
  private createRetryBase(
    code: string,
    context: PendingRetry["context"],
    extra: Partial<PendingRetry>,
    shellId?: string,
    scriptHash?: string,
  ): PendingRetry {
    this.cleanupExpiredRetries();

    // Enforce limit with FIFO eviction
    if (this.pendingRetries.size >= MAX_PENDING_RETRIES) {
      const oldest = this.pendingRetries.keys().next().value;
      if (oldest) this.pendingRetries.delete(oldest);
    }

    const retry: PendingRetry = {
      id: generateRetryId(),
      code,
      scriptHash,
      shellId,
      context,
      createdAt: new Date(),
      ...extra,
    };

    this.pendingRetries.set(retry.id, retry);
    return retry;
  }

  /**
   * Create a pending retry for a blocked command (legacy single command)
   */
  createPendingRetry(
    code: string,
    blockedCommand: string,
    context: PendingRetry["context"],
    shellId?: string,
    scriptHash?: string,
  ): PendingRetry {
    return this.createRetryBase(code, context, { blockedCommand }, shellId, scriptHash);
  }

  /**
   * Create a pending retry for multiple blocked commands (from init())
   */
  createPendingRetryMulti(
    code: string,
    blockedCommands: string[],
    notFoundCommands: string[],
    context: PendingRetry["context"],
    shellId?: string,
    scriptHash?: string,
  ): PendingRetry {
    return this.createRetryBase(code, context, { blockedCommands, notFoundCommands }, shellId, scriptHash);
  }

  /**
   * Create a pending retry for a blocked network host
   */
  createPendingRetryNetwork(
    code: string,
    blockedHost: string,
    context: PendingRetry["context"],
    shellId?: string,
    scriptHash?: string,
  ): PendingRetry {
    return this.createRetryBase(code, context, { blockedHost }, shellId, scriptHash);
  }

  /**
   * Get a pending retry by ID
   */
  getPendingRetry(id: string): PendingRetry | undefined {
    const retry = this.pendingRetries.get(id);
    if (!retry) return undefined;

    // Check TTL
    if (Date.now() - retry.createdAt.getTime() > PENDING_RETRY_TTL) {
      this.pendingRetries.delete(id);
      return undefined;
    }

    return retry;
  }

  /**
   * Consume (get and delete) a pending retry
   */
  consumePendingRetry(id: string): PendingRetry | undefined {
    const retry = this.getPendingRetry(id);
    if (retry) {
      this.pendingRetries.delete(id);
    }
    return retry;
  }

  /**
   * Cleanup expired pending retries
   */
  cleanupExpiredRetries(): void {
    const now = Date.now();
    for (const [id, retry] of this.pendingRetries) {
      if (now - retry.createdAt.getTime() > PENDING_RETRY_TTL) {
        this.pendingRetries.delete(id);
      }
    }
  }

  /**
   * Get the number of pending retries
   */
  size(): number {
    return this.pendingRetries.size;
  }
}
