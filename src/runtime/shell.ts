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

import type { Shell, Script, Job } from "../core/types.ts";
import {
  SCRIPT_OUTPUT_LIMIT,
  SHELL_MEMORY_LIMIT,
  MAX_SHELLS,
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
    if (this.shells.size >= MAX_SHELLS) {
      this.evictLeastRecentShell();
    }

    const now = new Date();
    const shell: Shell = {
      id: crypto.randomUUID(),
      description: options.description,
      cwd: options.cwd ?? this.defaultCwd,
      env: options.env ?? {},
      vars: {},
      scripts: new Map(),
      scriptsByPid: new Map(),
      scriptSequence: 0,
      jobs: new Map(),
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
      scripts: new Map(),
      scriptsByPid: new Map(),
      scriptSequence: 0,
      jobs: new Map(),
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
   */
  private trimShellIfNeeded(shell: Shell): void {
    const memoryUsage = this.estimateShellMemory(shell);
    if (memoryUsage <= SHELL_MEMORY_LIMIT) return;

    // Get completed scripts sorted by startedAt (oldest first)
    const completedScripts = Array.from(shell.scripts.values())
      .filter((s) => s.status !== "running")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    // Remove oldest scripts until under limit
    for (const script of completedScripts) {
      shell.scripts.delete(script.id);
      shell.scriptsByPid.delete(script.pid);

      if (this.estimateShellMemory(shell) <= SHELL_MEMORY_LIMIT) {
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
