/**
 * External command whitelist registry
 *
 * Manages whitelisted external commands with their configurations.
 * Commands must be explicitly whitelisted to be executed.
 */

import type { ExternalCommandConfig, SafeShellConfig } from "../core/types.ts";
import { isCommandWithinProjectDir } from "../core/permissions.ts";

/**
 * Default configurations for common commands
 * These provide sensible security defaults while allowing common operations
 */
export const DEFAULT_COMMAND_CONFIGS: Record<string, ExternalCommandConfig> = {
  git: {
    allow: true,
    denyFlags: ["--force", "-f", "--hard"],
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  docker: {
    allow: ["ps", "logs", "images", "build", "exec", "run", "stop", "start"],
    denyFlags: ["--privileged", "--cap-add", "--security-opt"],
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  fyn: {
    allow: true,
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  nvx: {
    allow: true,
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  deno: {
    allow: ["run", "test", "check", "lint", "fmt", "compile", "doc", "info"],
    denyFlags: ["--allow-all", "-A"],
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  node: {
    allow: true,
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  curl: {
    allow: true,
    denyFlags: ["--upload-file", "-T"],
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
  wget: {
    allow: true,
    pathArgs: { autoDetect: true, validateSandbox: true },
  },
};

/**
 * Registry for managing external command whitelist
 */
export class CommandRegistry {
  private commands: Map<string, ExternalCommandConfig> = new Map();
  private projectDir?: string;
  private allowProjectCommands?: boolean;
  private cwd?: string;

  constructor(config?: SafeShellConfig, cwd?: string) {
    this.projectDir = config?.projectDir;
    this.allowProjectCommands = config?.allowProjectCommands;
    this.cwd = cwd;

    if (config?.external) {
      for (const [command, cmdConfig] of Object.entries(config.external)) {
        this.register(command, cmdConfig);
      }
    }
  }

  /**
   * Register a command with its configuration
   */
  register(command: string, config: ExternalCommandConfig): void {
    this.commands.set(command, config);
  }

  /**
   * Unregister a command
   */
  unregister(command: string): boolean {
    return this.commands.delete(command);
  }

  /**
   * Get command configuration
   * Returns undefined if command is not whitelisted
   */
  get(command: string): ExternalCommandConfig | undefined {
    // Check explicit registration first
    const registered = this.commands.get(command);
    if (registered) {
      return registered;
    }

    // If allowProjectCommands is true, auto-allow commands within projectDir
    if (this.allowProjectCommands && this.projectDir) {
      if (isCommandWithinProjectDir(command, this.projectDir, this.cwd)) {
        // Return a permissive config for project commands
        return {
          allow: true,
          pathArgs: { autoDetect: true, validateSandbox: true },
        };
      }
    }

    return undefined;
  }

  /**
   * Check if a command is whitelisted
   */
  isWhitelisted(command: string): boolean {
    return this.get(command) !== undefined;
  }

  /**
   * Get all registered commands
   */
  list(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Get all command configurations
   */
  entries(): [string, ExternalCommandConfig][] {
    return Array.from(this.commands.entries());
  }

  /**
   * Clear all registered commands
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * Load default command configurations
   * Only loads commands that are also in the Deno --allow-run permission list
   */
  loadDefaults(allowedRun: string[]): void {
    for (const [command, config] of Object.entries(DEFAULT_COMMAND_CONFIGS)) {
      if (allowedRun.includes(command)) {
        // Only set if not already configured
        if (!this.commands.has(command)) {
          this.commands.set(command, config);
        }
      }
    }
  }

  /**
   * Merge user config with defaults
   * User config takes precedence over defaults
   */
  mergeWithDefaults(
    userConfig: Record<string, ExternalCommandConfig>,
    allowedRun: string[],
  ): void {
    // First, load defaults for allowed commands
    this.loadDefaults(allowedRun);

    // Then, override with user config
    for (const [command, config] of Object.entries(userConfig)) {
      if (allowedRun.includes(command)) {
        this.commands.set(command, config);
      }
    }
  }
}

/**
 * Create a registry from a SafeShell config
 */
export function createRegistry(config: SafeShellConfig, cwd?: string): CommandRegistry {
  const registry = new CommandRegistry(config, cwd);

  // Get allowed run commands from permissions
  const allowedRun = config.permissions?.run ?? [];

  // Merge defaults with user config
  registry.mergeWithDefaults(config.external ?? {}, allowedRun);

  return registry;
}

/**
 * Normalize command name (handle path-based commands)
 * e.g., "/usr/bin/git" -> "git"
 */
export function normalizeCommand(command: string): string {
  // Get basename of the command
  const parts = command.split("/");
  return parts[parts.length - 1] ?? command;
}
