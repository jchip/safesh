/**
 * Config Persistence Module
 *
 * Provides utilities for updating config.local.json with permissions.
 * Consolidates the addToConfigLocal and addPathsToConfigLocal patterns.
 */

import { getProjectConfigDir, getLocalJsonConfigPath } from "./config.ts";
import { readJsonFile, writeJsonFile } from "./io-utils.ts";

/**
 * Configuration update to be applied
 */
export interface ConfigUpdate {
  /** Commands to add to allowedCommands */
  commands?: string[];
  /** Paths to add to permissions.read */
  readPaths?: string[];
  /** Paths to add to permissions.write */
  writePaths?: string[];
}

/**
 * Options for config update
 */
export interface ConfigUpdateOptions {
  /** Whether to merge with existing values (default: true) */
  merge?: boolean;
  /** Whether to log changes to stderr (default: true) */
  silent?: boolean;
}

/**
 * Structure of config.local.json
 */
interface LocalConfig {
  allowedCommands?: string[];
  permissions?: {
    read?: string[];
    write?: string[];
  };
}

/**
 * Update config.local.json with new permissions
 *
 * This consolidates the pattern of:
 * 1. Ensuring .config/safesh directory exists
 * 2. Loading existing config.local.json
 * 3. Merging new values with existing
 * 4. Writing back to disk
 * 5. Logging changes
 *
 * @param projectDir - The project directory containing .config/safesh
 * @param update - The configuration updates to apply
 * @param options - Options for the update operation
 */
export async function updateConfigLocal(
  projectDir: string,
  update: ConfigUpdate,
  options: ConfigUpdateOptions = {},
): Promise<void> {
  const { merge = true, silent = false } = options;

  const configPath = getLocalJsonConfigPath(projectDir);

  // Load existing config or create new
  let config: LocalConfig = {};
  try {
    config = await readJsonFile<LocalConfig>(configPath);
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  const messages: string[] = [];

  // Update commands
  if (update.commands && update.commands.length > 0) {
    if (merge) {
      const existing = new Set(config.allowedCommands ?? []);
      for (const cmd of update.commands) {
        existing.add(cmd);
      }
      config.allowedCommands = [...existing];
    } else {
      config.allowedCommands = update.commands;
    }
    messages.push(`commands: ${update.commands.join(", ")}`);
  }

  // Initialize permissions if needed
  if (update.readPaths || update.writePaths) {
    config.permissions = config.permissions ?? {};
  }

  // Update read paths
  if (update.readPaths && update.readPaths.length > 0) {
    if (merge) {
      const existing = new Set(config.permissions!.read ?? []);
      for (const path of update.readPaths) {
        existing.add(path);
      }
      config.permissions!.read = [...existing];
    } else {
      config.permissions!.read = update.readPaths;
    }
    messages.push(`read: ${update.readPaths.join(", ")}`);
  }

  // Update write paths
  if (update.writePaths && update.writePaths.length > 0) {
    if (merge) {
      const existing = new Set(config.permissions!.write ?? []);
      for (const path of update.writePaths) {
        existing.add(path);
      }
      config.permissions!.write = [...existing];
    } else {
      config.permissions!.write = update.writePaths;
    }
    messages.push(`write: ${update.writePaths.join(", ")}`);
  }

  // Write back to disk
  await writeJsonFile(configPath, config);

  // Log changes unless silent
  if (!silent && messages.length > 0) {
    console.error(`[safesh] Added to always-allow: ${messages.join("; ")}`);
  }
}

/**
 * Add commands to config.local.json
 *
 * Convenience wrapper for updating only commands.
 *
 * @param commands - Commands to add
 * @param projectDir - Project directory
 */
export async function addCommandsToConfig(
  commands: string[],
  projectDir: string,
): Promise<void> {
  await updateConfigLocal(projectDir, { commands });
}

/**
 * Add paths to config.local.json
 *
 * Convenience wrapper for updating only paths.
 *
 * @param readPaths - Paths to add to permissions.read
 * @param writePaths - Paths to add to permissions.write
 * @param projectDir - Project directory
 */
export async function addPathsToConfig(
  readPaths: string[],
  writePaths: string[],
  projectDir: string,
): Promise<void> {
  await updateConfigLocal(projectDir, { readPaths, writePaths });
}
