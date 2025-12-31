/**
 * Job management for SafeShell
 *
 * Jobs are spawned processes within scripts - created when cmd(), git(),
 * docker() etc. are called within a Script execution.
 *
 * @module
 */

import type { Shell, Job } from "../core/types.ts";

/**
 * JobManager - manages jobs within shells
 *
 * Note: Jobs are stored in Shell.jobs, but this manager provides
 * the API for creating, accessing, and updating them.
 */
export class JobManager {
  /** Job sequence counter per shell */
  private jobSequences: Map<string, number> = new Map();

  /**
   * Generate a unique job ID for a shell
   */
  generateJobId(shellId: string): string {
    const seq = this.jobSequences.get(shellId) ?? 0;
    this.jobSequences.set(shellId, seq + 1);
    return `job-${shellId.slice(0, 8)}-${seq}`;
  }

  /**
   * Add a job to a shell and link it to its parent script
   */
  addJob(shell: Shell, job: Job): boolean {
    // Add job to shell's job map
    shell.jobs.set(job.id, job);

    // Link job to parent script
    const script = shell.scripts.get(job.scriptId);
    if (script && !script.jobIds.includes(job.id)) {
      script.jobIds.push(job.id);
    }

    return true;
  }

  /**
   * Get a job by ID
   */
  getJob(shell: Shell, jobId: string): Job | undefined {
    return shell.jobs.get(jobId);
  }

  /**
   * Update a job's status and output
   */
  updateJob(
    shell: Shell,
    jobId: string,
    updates: Partial<Pick<Job, "status" | "exitCode" | "stdout" | "stderr" | "completedAt" | "duration">>,
  ): boolean {
    const job = this.getJob(shell, jobId);
    if (!job) return false;

    if (updates.status !== undefined) job.status = updates.status;
    if (updates.exitCode !== undefined) job.exitCode = updates.exitCode;
    if (updates.stdout !== undefined) job.stdout = updates.stdout;
    if (updates.stderr !== undefined) job.stderr = updates.stderr;
    if (updates.completedAt !== undefined) job.completedAt = updates.completedAt;
    if (updates.duration !== undefined) job.duration = updates.duration;

    return true;
  }

  /**
   * List jobs in a shell, optionally filtered by script
   */
  listJobs(
    shell: Shell,
    filter?: {
      scriptId?: string;
      status?: "running" | "completed" | "failed";
      limit?: number;
    },
  ): Job[] {
    let jobs = Array.from(shell.jobs.values());

    // Apply filters
    if (filter?.scriptId !== undefined) {
      jobs = jobs.filter((j) => j.scriptId === filter.scriptId);
    }
    if (filter?.status !== undefined) {
      jobs = jobs.filter((j) => j.status === filter.status);
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
   * Reset job sequence for a shell (called when shell is ended)
   */
  resetSequence(shellId: string): void {
    this.jobSequences.delete(shellId);
  }
}
