/**
 * Session management for SafeShell
 *
 * Sessions provide persistent state between MCP tool calls:
 * - Working directory (cwd)
 * - Environment variables
 * - Persisted JS variables
 * - Background jobs
 *
 * Sessions are stored in-memory and tied to the MCP server lifecycle.
 *
 * @module
 */

import type { Session, Job } from "../core/types.ts";
import {
  JOB_OUTPUT_LIMIT,
  SESSION_MEMORY_LIMIT,
  MAX_SESSIONS,
} from "../core/types.ts";

/**
 * Session manager - stores and manages sessions
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private defaultCwd: string;

  constructor(defaultCwd: string) {
    this.defaultCwd = defaultCwd;
  }

  /**
   * Create a new session
   *
   * @param options - Initial session options
   * @returns New session
   */
  create(options: { cwd?: string; env?: Record<string, string> } = {}): Session {
    // Enforce session limit with LRU eviction
    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictLeastRecentSession();
    }

    const now = new Date();
    const session: Session = {
      id: crypto.randomUUID(),
      cwd: options.cwd ?? this.defaultCwd,
      env: options.env ?? {},
      vars: {},
      jobs: new Map(),
      jobsByPid: new Map(),
      jobSequence: 0,
      createdAt: now,
      lastActivityAt: now,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get an existing session by ID
   *
   * @param id - Session ID
   * @returns Session or undefined
   */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get session or create temporary one
   *
   * @param id - Session ID or undefined
   * @param fallback - Fallback options for temporary session
   * @returns Session
   */
  getOrTemp(
    id: string | undefined,
    fallback: { cwd?: string; env?: Record<string, string> } = {},
  ): { session: Session; isTemporary: boolean } {
    if (id) {
      const session = this.get(id);
      if (session) {
        return { session, isTemporary: false };
      }
    }

    // Create temporary session (not stored)
    const now = new Date();
    const session: Session = {
      id: crypto.randomUUID(),
      cwd: fallback.cwd ?? this.defaultCwd,
      env: fallback.env ?? {},
      vars: {},
      jobs: new Map(),
      jobsByPid: new Map(),
      jobSequence: 0,
      createdAt: now,
      lastActivityAt: now,
    };

    return { session, isTemporary: true };
  }

  /**
   * Update session properties
   *
   * @param id - Session ID
   * @param updates - Properties to update
   * @returns Updated session or undefined if not found
   */
  update(
    id: string,
    updates: {
      cwd?: string;
      env?: Record<string, string>;
      vars?: Record<string, unknown>;
    },
  ): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    if (updates.cwd !== undefined) {
      session.cwd = updates.cwd;
    }

    if (updates.env !== undefined) {
      // Merge env vars
      session.env = { ...session.env, ...updates.env };
    }

    if (updates.vars !== undefined) {
      // Merge vars
      session.vars = { ...session.vars, ...updates.vars };
    }

    return session;
  }

  /**
   * Set a single environment variable
   */
  setEnv(id: string, key: string, value: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.env[key] = value;
    return true;
  }

  /**
   * Unset an environment variable
   */
  unsetEnv(id: string, key: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    delete session.env[key];
    return true;
  }

  /**
   * Change working directory
   */
  cd(id: string, path: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.cwd = path;
    return true;
  }

  /**
   * Store a persisted variable
   */
  setVar(id: string, key: string, value: unknown): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.vars[key] = value;
    return true;
  }

  /**
   * Get a persisted variable
   */
  getVar(id: string, key: string): unknown {
    const session = this.sessions.get(id);
    return session?.vars[key];
  }

  /**
   * Touch session (update lastActivityAt)
   */
  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivityAt = new Date();
    }
  }

  /**
   * Add a job to the session
   */
  addJob(sessionId: string, job: Job): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.jobs.set(job.id, job);
    session.jobsByPid.set(job.pid, job.id);
    session.lastActivityAt = new Date();

    // Check memory and trim if needed
    this.trimSessionIfNeeded(session);

    return true;
  }

  /**
   * Get a job from a session
   */
  getJob(sessionId: string, jobId: string): Job | undefined {
    const session = this.sessions.get(sessionId);
    return session?.jobs.get(jobId);
  }

  /**
   * Get a job by PID
   */
  getJobByPid(sessionId: string, pid: number): Job | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const jobId = session.jobsByPid.get(pid);
    return jobId ? session.jobs.get(jobId) : undefined;
  }

  /**
   * Update job with comprehensive fields
   */
  updateJob(
    sessionId: string,
    jobId: string,
    updates: Partial<
      Pick<
        Job,
        | "status"
        | "exitCode"
        | "stdout"
        | "stderr"
        | "stdoutTruncated"
        | "stderrTruncated"
        | "completedAt"
        | "duration"
        | "process"
      >
    >,
  ): boolean {
    const job = this.getJob(sessionId, jobId);
    if (!job) return false;

    if (updates.status !== undefined) {
      job.status = updates.status;
    }
    if (updates.exitCode !== undefined) {
      job.exitCode = updates.exitCode;
    }
    if (updates.stdout !== undefined) {
      job.stdout = updates.stdout;
    }
    if (updates.stderr !== undefined) {
      job.stderr = updates.stderr;
    }
    if (updates.stdoutTruncated !== undefined) {
      job.stdoutTruncated = updates.stdoutTruncated;
    }
    if (updates.stderrTruncated !== undefined) {
      job.stderrTruncated = updates.stderrTruncated;
    }
    if (updates.completedAt !== undefined) {
      job.completedAt = updates.completedAt;
    }
    if (updates.duration !== undefined) {
      job.duration = updates.duration;
    }
    if (updates.process !== undefined) {
      job.process = updates.process;
    }

    return true;
  }

  /**
   * List jobs in a session with optional filter
   */
  listJobs(
    sessionId: string,
    filter?: {
      status?: "running" | "completed" | "failed";
      background?: boolean;
      limit?: number;
    },
  ): Job[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    let jobs = Array.from(session.jobs.values());

    // Apply filters
    if (filter?.status !== undefined) {
      jobs = jobs.filter((j) => j.status === filter.status);
    }
    if (filter?.background !== undefined) {
      jobs = jobs.filter((j) => j.background === filter.background);
    }

    // Sort by startedAt descending (newest first)
    jobs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    // Apply limit
    if (filter?.limit !== undefined && filter.limit > 0) {
      jobs = jobs.slice(0, filter.limit);
    }

    return jobs;
  }

  /**
   * Estimate memory usage of a session
   */
  estimateSessionMemory(session: Session): number {
    let size = 0;
    for (const job of session.jobs.values()) {
      size += job.stdout.length + job.stderr.length + job.code.length + 200; // overhead
    }
    size += JSON.stringify(session.vars).length;
    return size;
  }

  /**
   * Trim oldest completed jobs if session exceeds memory limit
   */
  private trimSessionIfNeeded(session: Session): void {
    const memoryUsage = this.estimateSessionMemory(session);
    if (memoryUsage <= SESSION_MEMORY_LIMIT) return;

    // Get completed jobs sorted by startedAt (oldest first)
    const completedJobs = Array.from(session.jobs.values())
      .filter((j) => j.status !== "running")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    // Remove oldest jobs until under limit
    for (const job of completedJobs) {
      session.jobs.delete(job.id);
      session.jobsByPid.delete(job.pid);

      if (this.estimateSessionMemory(session) <= SESSION_MEMORY_LIMIT) {
        break;
      }
    }
  }

  /**
   * Evict the least recently used session
   */
  private evictLeastRecentSession(): void {
    let oldest: Session | undefined;
    let oldestTime = Infinity;

    for (const session of this.sessions.values()) {
      const activityTime = session.lastActivityAt.getTime();
      if (activityTime < oldestTime) {
        oldestTime = activityTime;
        oldest = session;
      }
    }

    if (oldest) {
      this.end(oldest.id);
    }
  }

  /**
   * End a session and clean up
   *
   * @param id - Session ID
   * @returns True if session was found and ended
   */
  end(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Clean up any running jobs
    for (const job of session.jobs.values()) {
      if (job.status === "running" && job.process) {
        try {
          job.process.kill("SIGTERM");
          job.status = "failed";
        } catch {
          // Process may have already exited
        }
      }
    }

    this.sessions.delete(id);
    return true;
  }

  /**
   * List all active sessions
   */
  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  count(): number {
    return this.sessions.size;
  }

  /**
   * Clean up expired sessions (older than maxAge)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.createdAt.getTime() > maxAgeMs) {
        this.end(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Serialize session for response
   */
  serialize(session: Session): {
    sessionId: string;
    cwd: string;
    env: Record<string, string>;
    vars: Record<string, unknown>;
    jobs: {
      id: string;
      code: string;
      status: string;
      background: boolean;
      startedAt: string;
      duration?: number;
    }[];
    createdAt: string;
    lastActivityAt: string;
  } {
    return {
      sessionId: session.id,
      cwd: session.cwd,
      env: session.env,
      vars: session.vars,
      jobs: Array.from(session.jobs.values()).map((j) => ({
        id: j.id,
        code: j.code.length > 100 ? j.code.slice(0, 100) + "..." : j.code,
        status: j.status,
        background: j.background,
        startedAt: j.startedAt.toISOString(),
        duration: j.duration,
      })),
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
    };
  }
}

/**
 * Create a session manager
 */
export function createSessionManager(defaultCwd: string): SessionManager {
  return new SessionManager(defaultCwd);
}
