/**
 * State Persistence for SafeShell
 *
 * Persists shell and script metadata to disk for visibility across
 * MCP server restarts. Processes themselves don't survive restarts,
 * but their metadata is preserved for history and cleanup.
 *
 * Storage location: .local/state/safesh/state.json (XDG-aligned)
 *
 * @module
 */

import { join, dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import { getRealPath } from "../core/utils.ts";

/**
 * Persisted shell metadata
 */
export interface PersistedShell {
  id: string;
  cwd: string;
  env: Record<string, string>;
  vars: Record<string, unknown>;
  createdAt: string;
  lastActivityAt: string;
  description?: string;
}

/**
 * Persisted script metadata
 */
export interface PersistedScript {
  id: string;
  shellId: string;
  status: "running" | "completed" | "failed";
  pid?: number;
  background: boolean;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  command?: string; // Brief description of what was run
}

/**
 * Root state structure
 */
export interface PersistedState {
  version: 1;
  updatedAt: string;
  projectDir: string;
  shells: Record<string, PersistedShell>;
  scripts: Record<string, PersistedScript>;
  sessionAllowedCommands: string[];
}

/**
 * Default empty state
 */
function createEmptyState(projectDir: string): PersistedState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    projectDir,
    shells: {},
    scripts: {},
    sessionAllowedCommands: [],
  };
}

/**
 * Get the state file path for a project
 */
export function getStateFilePath(projectDir: string): string {
  return join(projectDir, ".local", "state", "safesh", "state.json");
}

/**
 * Check if a PID is still running
 */
function isPidRunning(pid: number): boolean {
  try {
    // Signal 0 doesn't kill but checks if process exists
    Deno.kill(pid, "SIGCONT"); // Use SIGCONT as it's harmless
    return true;
  } catch {
    return false;
  }
}

/**
 * State persistence manager
 *
 * Handles loading, saving, and updating persisted state with atomic writes.
 */
export class StatePersistence {
  private state: PersistedState;
  private stateFilePath: string;
  private saveTimeout: number | null = null;
  private readonly debounceMs = 500; // Debounce saves to avoid excessive writes

  constructor(private projectDir: string) {
    this.stateFilePath = getStateFilePath(projectDir);
    this.state = createEmptyState(projectDir);
  }

  /**
   * Load state from disk
   * Creates empty state if file doesn't exist
   * Cleans up stale PIDs on load
   */
  async load(): Promise<PersistedState> {
    try {
      const content = await Deno.readTextFile(this.stateFilePath);
      const loaded = JSON.parse(content) as PersistedState;

      // Validate version
      if (loaded.version !== 1) {
        console.warn(`[StatePersistence] Unknown state version ${loaded.version}, starting fresh`);
        this.state = createEmptyState(this.projectDir);
      } else {
        this.state = loaded;
        // Update project dir in case it moved
        this.state.projectDir = this.projectDir;
      }

      // Clean up stale PIDs
      await this.cleanupStalePids();

      return this.state;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // No state file yet, start fresh
        this.state = createEmptyState(this.projectDir);
        return this.state;
      }
      console.error(`[StatePersistence] Error loading state: ${error}`);
      this.state = createEmptyState(this.projectDir);
      return this.state;
    }
  }

  /**
   * Save state to disk atomically
   * Writes to temp file first, then renames
   */
  async save(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.stateFilePath);
      await ensureDir(dir);

      // Update timestamp
      this.state.updatedAt = new Date().toISOString();

      // Write to temp file first
      const tempPath = `${this.stateFilePath}.tmp`;
      const content = JSON.stringify(this.state, null, 2);
      await Deno.writeTextFile(tempPath, content);

      // Atomic rename
      await Deno.rename(tempPath, this.stateFilePath);
    } catch (error) {
      console.error(`[StatePersistence] Error saving state: ${error}`);
    }
  }

  /**
   * Schedule a debounced save
   * Multiple rapid updates will be batched into one save
   */
  scheduleSave(): void {
    if (this.saveTimeout !== null) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.save();
      this.saveTimeout = null;
    }, this.debounceMs);
  }

  /**
   * Force immediate save (for shutdown)
   */
  async flush(): Promise<void> {
    if (this.saveTimeout !== null) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  /**
   * Get current state (read-only view)
   */
  getState(): Readonly<PersistedState> {
    return this.state;
  }

  // --- Shell operations ---

  /**
   * Update or create a shell entry
   */
  updateShell(shell: PersistedShell): void {
    this.state.shells[shell.id] = shell;
    this.scheduleSave();
  }

  /**
   * Remove a shell entry
   */
  removeShell(shellId: string): void {
    delete this.state.shells[shellId];
    // Also remove associated scripts
    for (const [scriptId, script] of Object.entries(this.state.scripts)) {
      if (script.shellId === shellId) {
        delete this.state.scripts[scriptId];
      }
    }
    this.scheduleSave();
  }

  /**
   * Get a shell by ID
   */
  getShell(shellId: string): PersistedShell | undefined {
    return this.state.shells[shellId];
  }

  /**
   * List all shells
   */
  listShells(): PersistedShell[] {
    return Object.values(this.state.shells);
  }

  // --- Script operations ---

  /**
   * Update or create a script entry
   */
  updateScript(script: PersistedScript): void {
    this.state.scripts[script.id] = script;
    this.scheduleSave();
  }

  /**
   * Remove a script entry
   */
  removeScript(scriptId: string): void {
    delete this.state.scripts[scriptId];
    this.scheduleSave();
  }

  /**
   * Get a script by ID
   */
  getScript(scriptId: string): PersistedScript | undefined {
    return this.state.scripts[scriptId];
  }

  /**
   * List scripts, optionally filtered
   */
  listScripts(filter?: {
    shellId?: string;
    status?: "running" | "completed" | "failed";
    background?: boolean;
  }): PersistedScript[] {
    let scripts = Object.values(this.state.scripts);

    if (filter?.shellId) {
      scripts = scripts.filter((s) => s.shellId === filter.shellId);
    }
    if (filter?.status) {
      scripts = scripts.filter((s) => s.status === filter.status);
    }
    if (filter?.background !== undefined) {
      scripts = scripts.filter((s) => s.background === filter.background);
    }

    return scripts.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  // --- Session commands ---

  /**
   * Add commands to session allowed list
   */
  addSessionAllowedCommands(commands: string[]): void {
    const existing = new Set(this.state.sessionAllowedCommands);
    for (const cmd of commands) {
      existing.add(cmd);
    }
    this.state.sessionAllowedCommands = [...existing];
    this.scheduleSave();
  }

  /**
   * Get session allowed commands
   */
  getSessionAllowedCommands(): string[] {
    return [...this.state.sessionAllowedCommands];
  }

  /**
   * Clear session allowed commands
   */
  clearSessionAllowedCommands(): void {
    this.state.sessionAllowedCommands = [];
    this.scheduleSave();
  }

  // --- Cleanup ---

  /**
   * Clean up scripts with dead PIDs
   * Marks running scripts with dead PIDs as failed
   */
  async cleanupStalePids(): Promise<number> {
    let cleanedCount = 0;

    for (const script of Object.values(this.state.scripts)) {
      if (script.status === "running" && script.pid) {
        if (!isPidRunning(script.pid)) {
          script.status = "failed";
          script.completedAt = new Date().toISOString();
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      await this.save();
      console.log(`[StatePersistence] Cleaned up ${cleanedCount} stale script(s)`);
    }

    return cleanedCount;
  }

  /**
   * Remove old completed/failed scripts (keep last N)
   */
  pruneOldScripts(keepCount: number = 100): number {
    const scripts = this.listScripts();
    const toRemove = scripts.slice(keepCount);

    for (const script of toRemove) {
      if (script.status !== "running") {
        delete this.state.scripts[script.id];
      }
    }

    if (toRemove.length > 0) {
      this.scheduleSave();
    }

    return toRemove.length;
  }

  /**
   * Clear all state (for testing or reset)
   */
  async clear(): Promise<void> {
    this.state = createEmptyState(this.projectDir);
    await this.save();
  }
}

// --- Singleton management ---

const instances = new Map<string, StatePersistence>();

/**
 * Get or create a StatePersistence instance for a project
 */
export function getStatePersistence(projectDir: string): StatePersistence {
  const normalized = getRealPath(projectDir);
  let instance = instances.get(normalized);
  if (!instance) {
    instance = new StatePersistence(normalized);
    instances.set(normalized, instance);
  }
  return instance;
}

/**
 * Close all StatePersistence instances (for shutdown)
 */
export async function closeAllStatePersistence(): Promise<void> {
  for (const instance of instances.values()) {
    await instance.flush();
  }
  instances.clear();
}
