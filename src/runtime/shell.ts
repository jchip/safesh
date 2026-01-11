/**
 * Shell management for SafeShell
 *
 * Shells provide persistent state between MCP tool calls:
 * - Working directory (cwd)
 * - Environment variables
 * - Persisted JS variables
 * - Background scripts and jobs
 *
 * Shells are stored in-memory and tied to the MCP server lifecycle.
 *
 * @module
 */

import type { Shell, Script, Job, PendingRetry } from "../core/types.ts";
import {
  SCRIPT_OUTPUT_LIMIT,
  SHELL_MEMORY_LIMIT,
  MAX_SHELLS,
} from "../core/types.ts";
import { SCRIPT_RETENTION_MS } from "../core/defaults.ts";
import { RetryManager } from "./retry-manager.ts";
import { JobManager } from "./job-manager.ts";
import {
  StatePersistence,
  getStatePersistence,
  type PersistedShell,
  type PersistedScript,
} from "./state-persistence.ts";

/**
 * Shell manager - stores and manages shells
 *
 * Uses composition to delegate specialized concerns:
 * - RetryManager: handles pending retries for permission workflow
 * - JobManager: handles job lifecycle within shells
 */
export class ShellManager {
  private shells: Map<string, Shell> = new Map();
  private defaultCwd: string;
  private shellSequence = 0;
  /** Session-level allowed commands (persists across shells within the MCP session) */
  private sessionAllowedCommands: Set<string> = new Set();

  /** Delegated retry management */
  private retryManager: RetryManager;
  /** Delegated job management */
  private jobManager: JobManager;
  /** State persistence (optional, enabled when projectDir provided) */
  private persistence: StatePersistence | null = null;

  constructor(defaultCwd: string, projectDir?: string) {
    this.defaultCwd = defaultCwd;
    this.retryManager = new RetryManager();
    this.jobManager = new JobManager();
    if (projectDir) {
      this.persistence = getStatePersistence(projectDir);
    }
  }

  /**
   * Initialize from persisted state
   * Call this after construction to restore shells from disk
   */
  async initFromPersistence(): Promise<void> {
    if (!this.persistence) return;

    const state = await this.persistence.load();

    // Restore session allowed commands
    for (const cmd of state.sessionAllowedCommands) {
      this.sessionAllowedCommands.add(cmd);
    }

    // Restore shells (but not scripts - those have stale PIDs)
    for (const persisted of Object.values(state.shells)) {
      const shell = this.createShellObject({
        id: persisted.id,
        cwd: persisted.cwd,
        env: persisted.env,
        description: persisted.description,
      });
      shell.vars = persisted.vars as Record<string, unknown>;
      shell.createdAt = new Date(persisted.createdAt);
      shell.lastActivityAt = new Date(persisted.lastActivityAt);
      this.shells.set(shell.id, shell);

      // Update shell sequence to avoid ID collisions
      const match = shell.id.match(/^sh(\d+)$/);
      if (match && match[1]) {
        const seq = parseInt(match[1], 10);
        if (seq >= this.shellSequence) {
          this.shellSequence = seq;
        }
      }
    }

    console.log(`[ShellManager] Restored ${this.shells.size} shell(s) from persistence`);
  }

  /**
   * Flush persistence to disk (call on shutdown)
   */
  async flushPersistence(): Promise<void> {
    if (this.persistence) {
      await this.persistence.flush();
    }
  }

  /**
   * Convert Shell to PersistedShell for storage
   */
  private toPersistedShell(shell: Shell): PersistedShell {
    return {
      id: shell.id,
      cwd: shell.cwd,
      env: shell.env,
      vars: shell.vars,
      createdAt: shell.createdAt.toISOString(),
      lastActivityAt: shell.lastActivityAt.toISOString(),
      description: shell.description,
    };
  }

  /**
   * Convert Script to PersistedScript for storage
   */
  private toPersistedScript(script: Script, shellId: string): PersistedScript {
    return {
      id: script.id,
      shellId,
      status: script.status,
      pid: script.pid,
      background: script.background,
      startedAt: script.startedAt.toISOString(),
      completedAt: script.completedAt?.toISOString(),
      exitCode: script.exitCode,
      command: script.code?.slice(0, 100), // Brief preview
    };
  }

  /**
   * Add commands to the session-level allowlist
   * Used when userChoice=2 (allow for session)
   */
  addSessionAllowedCommands(commands: string[]): void {
    for (const cmd of commands) {
      this.sessionAllowedCommands.add(cmd);
    }
    // Persist session commands
    this.persistence?.addSessionAllowedCommands(commands);
  }

  /**
   * Get all session-level allowed commands
   */
  getSessionAllowedCommands(): string[] {
    return Array.from(this.sessionAllowedCommands);
  }

  /**
   * Check if a command is allowed at the session level
   */
  isSessionAllowed(command: string): boolean {
    return this.sessionAllowedCommands.has(command);
  }

  /**
   * Create a Shell object with default values
   */
  private createShellObject(options: {
    id?: string;
    cwd?: string;
    env?: Record<string, string>;
    description?: string;
  } = {}): Shell {
    const now = new Date();
    // Default env: inherit from parent process, then merge any provided env vars
    const parentEnv = Deno.env.toObject();
    const env = Object.assign({}, parentEnv, options.env);

    return {
      id: options.id ?? `sh${++this.shellSequence}`,
      description: options.description,
      cwd: options.cwd ?? this.defaultCwd,
      env,
      vars: {},
      scripts: new Map(),
      scriptsByPid: new Map(),
      scriptSequence: 0,
      jobs: new Map(),
      createdAt: now,
      lastActivityAt: now,
    };
  }

  /**
   * Create a new shell
   *
   * @param options - Initial shell options
   * @returns New shell
   */
  create(options: { cwd?: string; env?: Record<string, string>; description?: string } = {}): Shell {
    // Enforce shell limit with LRU eviction
    if (this.shells.size >= MAX_SHELLS) {
      this.evictLeastRecentShell();
    }

    const shell = this.createShellObject(options);
    this.shells.set(shell.id, shell);

    // Persist shell
    this.persistence?.updateShell(this.toPersistedShell(shell));

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
   * Get shell by ID, or create a new persisted shell
   *
   * @param id - Shell ID or undefined (auto-generates ID if undefined)
   * @param fallback - Fallback options for new shell
   * @returns Shell and whether it was newly created
   */
  getOrCreate(
    id: string | undefined,
    fallback: { cwd?: string; env?: Record<string, string> } = {},
  ): { shell: Shell; created: boolean } {
    if (id) {
      const existing = this.get(id);
      if (existing) {
        return { shell: existing, created: false };
      }
    }

    // Create and persist new shell (with provided ID or auto-generated)
    if (this.shells.size >= MAX_SHELLS) {
      this.evictLeastRecentShell();
    }
    const shell = this.createShellObject({ id, ...fallback });
    this.shells.set(shell.id, shell);
    this.persistence?.updateShell(this.toPersistedShell(shell));
    return { shell, created: true };
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

    // Persist shell changes
    this.persistence?.updateShell(this.toPersistedShell(shell));

    return shell;
  }

  /**
   * Set a single environment variable
   */
  setEnv(id: string, key: string, value: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.env[key] = value;
    this.persistence?.updateShell(this.toPersistedShell(shell));
    return true;
  }

  /**
   * Unset an environment variable
   */
  unsetEnv(id: string, key: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    delete shell.env[key];
    this.persistence?.updateShell(this.toPersistedShell(shell));
    return true;
  }

  /**
   * Change working directory
   */
  cd(id: string, path: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.cwd = path;
    this.persistence?.updateShell(this.toPersistedShell(shell));
    return true;
  }

  /**
   * Store a persisted variable
   */
  setVar(id: string, key: string, value: unknown): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.vars[key] = value;
    this.persistence?.updateShell(this.toPersistedShell(shell));
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
      // Note: Don't persist on every touch - it's too frequent
      // Persistence happens on actual state changes
    }
  }

  /**
   * Add a script to the shell
   */
  addScript(shellId: string, script: Script): boolean {
    const shell = this.shells.get(shellId);
    if (!shell) return false;

    shell.scripts.set(script.id, script);
    shell.scriptsByPid.set(script.pid, script.id);
    shell.lastActivityAt = new Date();

    // Check memory and trim if needed
    this.trimShellIfNeeded(shell);

    // Persist script (especially important for background scripts)
    this.persistence?.updateScript(this.toPersistedScript(script, shellId));

    return true;
  }

  /**
   * Get a script from a shell
   */
  getScript(shellId: string, scriptId: string): Script | undefined {
    const shell = this.shells.get(shellId);
    return shell?.scripts.get(scriptId);
  }

  /**
   * Get a script by PID
   */
  getScriptByPid(shellId: string, pid: number): Script | undefined {
    const shell = this.shells.get(shellId);
    if (!shell) return undefined;
    const scriptId = shell.scriptsByPid.get(pid);
    return scriptId ? shell.scripts.get(scriptId) : undefined;
  }

  /**
   * Update script with comprehensive fields
   */
  updateScript(
    shellId: string,
    scriptId: string,
    updates: Partial<
      Pick<
        Script,
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
    const script = this.getScript(shellId, scriptId);
    if (!script) return false;

    if (updates.status !== undefined) {
      script.status = updates.status;
    }
    if (updates.exitCode !== undefined) {
      script.exitCode = updates.exitCode;
    }
    if (updates.stdout !== undefined) {
      script.stdout = updates.stdout;
    }
    if (updates.stderr !== undefined) {
      script.stderr = updates.stderr;
    }
    if (updates.stdoutTruncated !== undefined) {
      script.stdoutTruncated = updates.stdoutTruncated;
    }
    if (updates.stderrTruncated !== undefined) {
      script.stderrTruncated = updates.stderrTruncated;
    }
    if (updates.completedAt !== undefined) {
      script.completedAt = updates.completedAt;
    }
    if (updates.duration !== undefined) {
      script.duration = updates.duration;
    }
    if (updates.process !== undefined) {
      script.process = updates.process;
    }

    // Persist script on status change
    if (updates.status !== undefined || updates.exitCode !== undefined) {
      this.persistence?.updateScript(this.toPersistedScript(script, shellId));
    }

    return true;
  }

  /**
   * List scripts in a shell with optional filter
   */
  listScripts(
    shellId: string,
    filter?: {
      status?: "running" | "completed" | "failed";
      background?: boolean;
      limit?: number;
    },
  ): Script[] {
    const shell = this.shells.get(shellId);
    if (!shell) return [];

    let scripts = Array.from(shell.scripts.values());

    // Apply filters
    if (filter?.status !== undefined) {
      scripts = scripts.filter((s) => s.status === filter.status);
    }
    if (filter?.background !== undefined) {
      scripts = scripts.filter((s) => s.background === filter.background);
    }

    // Sort by startedAt descending (newest first)
    scripts.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    // Apply limit
    if (filter?.limit !== undefined && filter.limit > 0) {
      scripts = scripts.slice(0, filter.limit);
    }

    return scripts;
  }

  // ==========================================================================
  // Pending Retry Management (delegated to RetryManager)
  // ==========================================================================

  /**
   * Create a pending retry for a blocked command (legacy single command)
   */
  createPendingRetry(
    code: string,
    blockedCommand: string,
    context: PendingRetry["context"],
    shellId?: string,
  ): PendingRetry {
    return this.retryManager.createPendingRetry(code, blockedCommand, context, shellId);
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
    return this.retryManager.createPendingRetryMulti(code, blockedCommands, notFoundCommands, context, shellId);
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
    return this.retryManager.createPendingRetryNetwork(code, blockedHost, context, shellId);
  }

  /**
   * Get a pending retry by ID
   */
  getPendingRetry(id: string): PendingRetry | undefined {
    return this.retryManager.getPendingRetry(id);
  }

  /**
   * Consume (get and delete) a pending retry
   */
  consumePendingRetry(id: string): PendingRetry | undefined {
    return this.retryManager.consumePendingRetry(id);
  }

  // ==========================================================================
  // Job Management (delegated to JobManager)
  // ==========================================================================

  /**
   * Generate a unique job ID for a shell
   */
  generateJobId(shellId: string): string {
    return this.jobManager.generateJobId(shellId);
  }

  /**
   * Add a job to a shell and link it to its parent script
   */
  addJob(shellId: string, job: Job): boolean {
    const shell = this.shells.get(shellId);
    if (!shell) return false;
    return this.jobManager.addJob(shell, job);
  }

  /**
   * Get a job by ID
   */
  getJob(shellId: string, jobId: string): Job | undefined {
    const shell = this.shells.get(shellId);
    if (!shell) return undefined;
    return this.jobManager.getJob(shell, jobId);
  }

  /**
   * Update a job's status and output
   */
  updateJob(
    shellId: string,
    jobId: string,
    updates: Partial<Pick<Job, "status" | "exitCode" | "stdout" | "stderr" | "completedAt" | "duration">>,
  ): boolean {
    const shell = this.shells.get(shellId);
    if (!shell) return false;
    return this.jobManager.updateJob(shell, jobId, updates);
  }

  /**
   * List jobs in a shell, optionally filtered by script
   */
  listJobs(
    shellId: string,
    filter?: {
      scriptId?: string;
      status?: "running" | "completed" | "failed";
      limit?: number;
    },
  ): Job[] {
    const shell = this.shells.get(shellId);
    if (!shell) return [];
    return this.jobManager.listJobs(shell, filter);
  }

  // ==========================================================================
  // Memory Management
  // ==========================================================================

  /**
   * Estimate memory usage of a shell
   */
  estimateShellMemory(shell: Shell): number {
    let size = 0;
    for (const script of shell.scripts.values()) {
      size += script.stdout.length + script.stderr.length + script.code.length + 200; // overhead
    }
    size += JSON.stringify(shell.vars).length;
    return size;
  }

  /**
   * Trim oldest completed scripts if shell exceeds memory limit
   *
   * SSH-223: Scripts are retained for at least SCRIPT_RETENTION_MS after completion
   * to allow users to retrieve output from short-lived background tasks.
   */
  private trimShellIfNeeded(shell: Shell): void {
    const memoryUsage = this.estimateShellMemory(shell);
    if (memoryUsage <= SHELL_MEMORY_LIMIT) return;

    const now = Date.now();
    const retentionMs = SCRIPT_RETENTION_MS;

    // Get completed scripts sorted by completion time (oldest first)
    // Only consider scripts that have passed the retention period
    const eligibleScripts = Array.from(shell.scripts.values())
      .filter((s) => {
        // Only completed/failed scripts are eligible for trimming
        if (s.status === "running") return false;

        // Scripts must have a completion time
        if (!s.completedAt) return false;

        // Script must be older than retention period
        const age = now - s.completedAt.getTime();
        return age >= retentionMs;
      })
      .sort((a, b) => {
        // Sort by completion time (oldest first)
        const aTime = a.completedAt?.getTime() ?? 0;
        const bTime = b.completedAt?.getTime() ?? 0;
        return aTime - bTime;
      });

    // Remove oldest eligible scripts until under limit
    for (const script of eligibleScripts) {
      shell.scripts.delete(script.id);
      shell.scriptsByPid.delete(script.pid);

      // Remove from persistence
      this.persistence?.removeScript(script.id);

      if (this.estimateShellMemory(shell) <= SHELL_MEMORY_LIMIT) {
        break;
      }
    }

    // If still over limit and no eligible scripts, log warning
    const stillOverLimit = this.estimateShellMemory(shell) > SHELL_MEMORY_LIMIT;
    if (stillOverLimit && eligibleScripts.length === 0) {
      console.warn(
        `[ShellManager] Shell ${shell.id} exceeds memory limit (${(memoryUsage / 1024 / 1024).toFixed(2)} MB) ` +
        `but no scripts are eligible for trimming (all within ${retentionMs}ms retention period)`
      );
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

    // Clean up any running scripts
    for (const script of shell.scripts.values()) {
      if (script.status === "running" && script.process) {
        try {
          script.process.kill("SIGTERM");
          script.status = "failed";
        } catch {
          // Process may have already exited
        }
      }
    }

    // Clean up job sequence for this shell
    this.jobManager.resetSequence(id);

    // Remove from persistence
    this.persistence?.removeShell(id);

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
    scripts: {
      id: string;
      code: string;
      status: string;
      background: boolean;
      startedAt: string;
      duration?: number;
      jobIds: string[];
    }[];
    jobs: {
      id: string;
      scriptId: string;
      command: string;
      args: string[];
      status: string;
      exitCode?: number;
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
      scripts: Array.from(shell.scripts.values()).map((s) => ({
        id: s.id,
        code: s.code.length > 100 ? s.code.slice(0, 100) + "..." : s.code,
        status: s.status,
        background: s.background,
        startedAt: s.startedAt.toISOString(),
        duration: s.duration,
        jobIds: s.jobIds,
      })),
      jobs: Array.from(shell.jobs.values()).map((j) => ({
        id: j.id,
        scriptId: j.scriptId,
        command: j.command,
        args: j.args,
        status: j.status,
        exitCode: j.exitCode,
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
 * @param defaultCwd - Default working directory
 * @param projectDir - Optional project directory for state persistence
 */
export function createShellManager(defaultCwd: string, projectDir?: string): ShellManager {
  return new ShellManager(defaultCwd, projectDir);
}
