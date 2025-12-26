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
    const session: Session = {
      id: crypto.randomUUID(),
      cwd: options.cwd ?? this.defaultCwd,
      env: options.env ?? {},
      vars: {},
      jobs: new Map(),
      createdAt: new Date(),
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
    const session: Session = {
      id: crypto.randomUUID(),
      cwd: fallback.cwd ?? this.defaultCwd,
      env: fallback.env ?? {},
      vars: {},
      jobs: new Map(),
      createdAt: new Date(),
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
   * Add a job to the session
   */
  addJob(sessionId: string, job: Job): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.jobs.set(job.id, job);
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
   * Update job status
   */
  updateJob(
    sessionId: string,
    jobId: string,
    updates: Partial<Pick<Job, "status" | "exitCode">>,
  ): boolean {
    const job = this.getJob(sessionId, jobId);
    if (!job) return false;

    if (updates.status !== undefined) {
      job.status = updates.status;
    }
    if (updates.exitCode !== undefined) {
      job.exitCode = updates.exitCode;
    }
    return true;
  }

  /**
   * List all jobs in a session
   */
  listJobs(sessionId: string): Job[] {
    const session = this.sessions.get(sessionId);
    return session ? Array.from(session.jobs.values()) : [];
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
      if (job.status === "running") {
        // Job cleanup would go here in full implementation
        job.status = "stopped";
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
    jobs: { id: string; command: string; status: string }[];
    createdAt: string;
  } {
    return {
      sessionId: session.id,
      cwd: session.cwd,
      env: session.env,
      vars: session.vars,
      jobs: Array.from(session.jobs.values()).map((j) => ({
        id: j.id,
        command: j.command,
        status: j.status,
      })),
      createdAt: session.createdAt.toISOString(),
    };
  }
}

/**
 * Create a session manager
 */
export function createSessionManager(defaultCwd: string): SessionManager {
  return new SessionManager(defaultCwd);
}
