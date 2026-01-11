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
 * RetryManager - manages pending retries for permission workflow
 */
export class RetryManager {
  /** Pending retries by ID */
  private pendingRetries: Map<string, PendingRetry> = new Map();
  /** Sequence counter for retry IDs */
  private retrySequence = 0;

  /**
   * Create a pending retry for a blocked command (legacy single command)
   */
  createPendingRetry(
    code: string,
    blockedCommand: string,
    context: PendingRetry["context"],
    shellId?: string,
  ): PendingRetry {
    // Cleanup expired retries first
    this.cleanupExpiredRetries();

    // Enforce limit with FIFO eviction
    if (this.pendingRetries.size >= MAX_PENDING_RETRIES) {
      const oldest = this.pendingRetries.keys().next().value;
      if (oldest) this.pendingRetries.delete(oldest);
    }

    const retry: PendingRetry = {
      id: `rt${++this.retrySequence}`,
      code,
      shellId,
      context,
      blockedCommand,
      createdAt: new Date(),
    };

    this.pendingRetries.set(retry.id, retry);
    return retry;
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
  ): PendingRetry {
    // Cleanup expired retries first
    this.cleanupExpiredRetries();

    // Enforce limit with FIFO eviction
    if (this.pendingRetries.size >= MAX_PENDING_RETRIES) {
      const oldest = this.pendingRetries.keys().next().value;
      if (oldest) this.pendingRetries.delete(oldest);
    }

    const retry: PendingRetry = {
      id: `rt${++this.retrySequence}`,
      code,
      shellId,
      context,
      blockedCommands,
      notFoundCommands,
      createdAt: new Date(),
    };

    this.pendingRetries.set(retry.id, retry);
    return retry;
  }

  /**
   * Create a pending retry for a blocked network host
   */
  createPendingRetryNetwork(
    code: string,
    blockedHost: string,
    context: PendingRetry["context"],
    shellId?: string,
  ): PendingRetry {
    // Cleanup expired retries first
    this.cleanupExpiredRetries();

    // Enforce limit with FIFO eviction
    if (this.pendingRetries.size >= MAX_PENDING_RETRIES) {
      const oldest = this.pendingRetries.keys().next().value;
      if (oldest) this.pendingRetries.delete(oldest);
    }

    const retry: PendingRetry = {
      id: `rt${++this.retrySequence}`,
      code,
      shellId,
      context,
      blockedHost,
      createdAt: new Date(),
    };

    this.pendingRetries.set(retry.id, retry);
    return retry;
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
