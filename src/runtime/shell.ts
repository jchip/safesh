/**
 * Shell management for SafeShell
 *
 * Shells provide persistent state between MCP tool calls:
 * - Working directory (cwd)
 * - Environment variables
 * - Persisted JS variables
 * - Background jobs
 *
 * Shells are stored in-memory and tied to the MCP server lifecycle.
 *
 * @module
 */

import type { Shell, Job } from "../core/types.ts";
import {
  JOB_OUTPUT_LIMIT,
  SESSION_MEMORY_LIMIT,
  MAX_SESSIONS,
} from "../core/types.ts";

/**
 * Shell manager - stores and manages shells
 */
export class ShellManager {
  private shells: Map<string, Shell> = new Map();
  private defaultCwd: string;

  constructor(defaultCwd: string) {
    this.defaultCwd = defaultCwd;
  }

  /**
   * Create a new shell
   *
   * @param options - Initial shell options
   * @returns New shell
   */
  create(options: { cwd?: string; env?: Record<string, string>; description?: string } = {}): Shell {
    // Enforce shell limit with LRU eviction
    if (this.shells.size >= MAX_SESSIONS) {
      this.evictLeastRecentShell();
    }

    const now = new Date();
    const shell: Shell = {
      id: crypto.randomUUID(),
      description: options.description,
      cwd: options.cwd ?? this.defaultCwd,
      env: options.env ?? {},
      vars: {},
      jobs: new Map(),
      jobsByPid: new Map(),
      jobSequence: 0,
      createdAt: now,
      lastActivityAt: now,
    };

    this.shells.set(shell.id, shell);
    return shell;
  }

  /**
   * Get an existing shell by ID
   *
   * @param id - Shell ID
   * @returns Shell or undefined
   */
  get(id: string): Shell | undefined {
    return this.shells.get(id);
  }

  /**
   * Get shell or create temporary one
   *
   * @param id - Shell ID or undefined
   * @param fallback - Fallback options for temporary shell
   * @returns Shell
   */
  getOrTemp(
    id: string | undefined,
    fallback: { cwd?: string; env?: Record<string, string> } = {},
  ): { shell: Shell; isTemporary: boolean } {
    if (id) {
      const shell = this.get(id);
      if (shell) {
        return { shell, isTemporary: false };
      }
    }

    // Create temporary shell (not stored)
    const now = new Date();
    const shell: Shell = {
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

    return { shell, isTemporary: true };
  }

  /**
   * Update shell properties
   *
   * @param id - Shell ID
   * @param updates - Properties to update
   * @returns Updated shell or undefined if not found
   */
  update(
    id: string,
    updates: {
      cwd?: string;
      env?: Record<string, string>;
      vars?: Record<string, unknown>;
      description?: string;
    },
  ): Shell | undefined {
    const shell = this.shells.get(id);
    if (!shell) return undefined;

    if (updates.cwd !== undefined) {
      shell.cwd = updates.cwd;
    }

    if (updates.env !== undefined) {
      // Merge env vars
      shell.env = { ...shell.env, ...updates.env };
    }

    if (updates.vars !== undefined) {
      // Merge vars
      shell.vars = { ...shell.vars, ...updates.vars };
    }

    if (updates.description !== undefined) {
      shell.description = updates.description;
    }

    return shell;
  }

  /**
   * Set a single environment variable
   */
  setEnv(id: string, key: string, value: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.env[key] = value;
    return true;
  }

  /**
   * Unset an environment variable
   */
  unsetEnv(id: string, key: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    delete shell.env[key];
    return true;
  }

  /**
   * Change working directory
   */
  cd(id: string, path: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.cwd = path;
    return true;
  }

  /**
   * Store a persisted variable
   */
  setVar(id: string, key: string, value: unknown): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.vars[key] = value;
    return true;
  }

  /**
   * Get a persisted variable
   */
  getVar(id: string, key: string): unknown {
    const shell = this.shells.get(id);
    return shell?.vars[key];
  }

  /**
   * Touch shell (update lastActivityAt)
   */
  touch(id: string): void {
    const shell = this.shells.get(id);
    if (shell) {
      shell.lastActivityAt = new Date();
    }
  }

  /**
   * Add a job to the shell
   */
  addJob(shellId: string, job: Job): boolean {
    const shell = this.shells.get(shellId);
    if (!shell) return false;

    shell.jobs.set(job.id, job);
    shell.jobsByPid.set(job.pid, job.id);
    shell.lastActivityAt = new Date();

    // Check memory and trim if needed
    this.trimShellIfNeeded(shell);

    return true;
  }

  /**
   * Get a job from a shell
   */
  getJob(shellId: string, jobId: string): Job | undefined {
    const shell = this.shells.get(shellId);
    return shell?.jobs.get(jobId);
  }

  /**
   * Get a job by PID
   */
  getJobByPid(shellId: string, pid: number): Job | undefined {
    const shell = this.shells.get(shellId);
    if (!shell) return undefined;
    const jobId = shell.jobsByPid.get(pid);
    return jobId ? shell.jobs.get(jobId) : undefined;
  }

  /**
   * Update job with comprehensive fields
   */
  updateJob(
    shellId: string,
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
    const job = this.getJob(shellId, jobId);
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
   * List jobs in a shell with optional filter
   */
  listJobs(
    shellId: string,
    filter?: {
      status?: "running" | "completed" | "failed";
      background?: boolean;
      limit?: number;
    },
  ): Job[] {
    const shell = this.shells.get(shellId);
    if (!shell) return [];

    let jobs = Array.from(shell.jobs.values());

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
   * Estimate memory usage of a shell
   */
  estimateShellMemory(shell: Shell): number {
    let size = 0;
    for (const job of shell.jobs.values()) {
      size += job.stdout.length + job.stderr.length + job.code.length + 200; // overhead
    }
    size += JSON.stringify(shell.vars).length;
    return size;
  }

  /**
   * Trim oldest completed jobs if shell exceeds memory limit
   */
  private trimShellIfNeeded(shell: Shell): void {
    const memoryUsage = this.estimateShellMemory(shell);
    if (memoryUsage <= SESSION_MEMORY_LIMIT) return;

    // Get completed jobs sorted by startedAt (oldest first)
    const completedJobs = Array.from(shell.jobs.values())
      .filter((j) => j.status !== "running")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    // Remove oldest jobs until under limit
    for (const job of completedJobs) {
      shell.jobs.delete(job.id);
      shell.jobsByPid.delete(job.pid);

      if (this.estimateShellMemory(shell) <= SESSION_MEMORY_LIMIT) {
        break;
      }
    }
  }

  /**
   * Evict the least recently used shell
   */
  private evictLeastRecentShell(): void {
    let oldest: Shell | undefined;
    let oldestTime = Infinity;

    for (const shell of this.shells.values()) {
      const activityTime = shell.lastActivityAt.getTime();
      if (activityTime < oldestTime) {
        oldestTime = activityTime;
        oldest = shell;
      }
    }

    if (oldest) {
      this.end(oldest.id);
    }
  }

  /**
   * End a shell and clean up
   *
   * @param id - Shell ID
   * @returns True if shell was found and ended
   */
  end(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;

    // Clean up any running jobs
    for (const job of shell.jobs.values()) {
      if (job.status === "running" && job.process) {
        try {
          job.process.kill("SIGTERM");
          job.status = "failed";
        } catch {
          // Process may have already exited
        }
      }
    }

    this.shells.delete(id);
    return true;
  }

  /**
   * List all active shells
   */
  list(): Shell[] {
    return Array.from(this.shells.values());
  }

  /**
   * Get shell count
   */
  count(): number {
    return this.shells.size;
  }

  /**
   * Clean up expired shells (older than maxAge)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, shell] of this.shells) {
      if (now - shell.createdAt.getTime() > maxAgeMs) {
        this.end(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Serialize shell for response
   */
  serialize(shell: Shell): {
    shellId: string;
    description?: string;
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
      shellId: shell.id,
      description: shell.description,
      cwd: shell.cwd,
      env: shell.env,
      vars: shell.vars,
      jobs: Array.from(shell.jobs.values()).map((j) => ({
        id: j.id,
        code: j.code.length > 100 ? j.code.slice(0, 100) + "..." : j.code,
        status: j.status,
        background: j.background,
        startedAt: j.startedAt.toISOString(),
        duration: j.duration,
      })),
      createdAt: shell.createdAt.toISOString(),
      lastActivityAt: shell.lastActivityAt.toISOString(),
    };
  }
}

/**
 * Create a shell manager
 */
export function createShellManager(defaultCwd: string): ShellManager {
  return new ShellManager(defaultCwd);
}
