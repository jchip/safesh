/**
 * Configuration loading and merging
 *
 * Loads config from:
 * 1. Default built-in config
 * 2. Global ~/.config/safesh/config.ts
 * 3. Project ./safesh.config.ts
 *
 * Later configs override earlier ones.
 * Permissions merge as union, deny rules also merge as union.
 */

import { join } from "@std/path";
import type {
  EnvConfig,
  ExternalCommandConfig,
  ImportPolicy,
  PermissionsConfig,
  SafeShellConfig,
} from "./types.ts";
import { configError } from "./errors.ts";

/**
 * Default configuration - minimal safe defaults
 */
export const DEFAULT_CONFIG: SafeShellConfig = {
  permissions: {
    read: ["${CWD}", "/tmp"],
    write: ["${CWD}", "/tmp"],
    net: [],
    run: [],
    env: ["HOME", "PATH", "TERM"],
  },
  external: {},
  env: {
    allow: ["HOME", "PATH", "TERM", "EDITOR", "SHELL"],
    mask: ["*_KEY", "*_SECRET", "*_TOKEN", "*_PASSWORD", "AWS_*", "GITHUB_TOKEN"],
  },
  imports: {
    trusted: ["jsr:@std/*", "safesh:*"],
    allowed: [],
    blocked: ["npm:*", "http:*", "https:*"],
  },
  tasks: {},
  timeout: 30000,
};

/**
 * Merge two permission configs (union)
 */
function mergePermissions(
  base: PermissionsConfig,
  override: PermissionsConfig,
): PermissionsConfig {
  return {
    read: [...new Set([...(base.read ?? []), ...(override.read ?? [])])],
    write: [...new Set([...(base.write ?? []), ...(override.write ?? [])])],
    net: mergeNetPermissions(base.net, override.net),
    run: [...new Set([...(base.run ?? []), ...(override.run ?? [])])],
    env: [...new Set([...(base.env ?? []), ...(override.env ?? [])])],
  };
}

/**
 * Merge network permissions
 */
function mergeNetPermissions(
  base: string[] | boolean | undefined,
  override: string[] | boolean | undefined,
): string[] | boolean {
  // If either is true (allow all), result is true
  if (base === true || override === true) return true;

  // Otherwise merge arrays
  const baseArr = Array.isArray(base) ? base : [];
  const overrideArr = Array.isArray(override) ? override : [];
  return [...new Set([...baseArr, ...overrideArr])];
}

/**
 * Merge external command configs
 */
function mergeExternalCommands(
  base: Record<string, ExternalCommandConfig>,
  override: Record<string, ExternalCommandConfig>,
): Record<string, ExternalCommandConfig> {
  const result = { ...base };

  for (const [cmd, config] of Object.entries(override)) {
    if (result[cmd]) {
      // Merge with existing
      const existing = result[cmd];
      result[cmd] = {
        allow: config.allow ?? existing.allow,
        denyFlags: [...new Set([
          ...(existing.denyFlags ?? []),
          ...(config.denyFlags ?? []),
        ])],
        requireFlags: config.requireFlags ?? existing.requireFlags,
        pathArgs: config.pathArgs ?? existing.pathArgs,
      };
    } else {
      result[cmd] = config;
    }
  }

  return result;
}

/**
 * Merge env configs
 */
function mergeEnvConfig(
  base: EnvConfig,
  override: EnvConfig,
): EnvConfig {
  return {
    allow: [...new Set([...(base.allow ?? []), ...(override.allow ?? [])])],
    mask: [...new Set([...(base.mask ?? []), ...(override.mask ?? [])])],
  };
}

/**
 * Merge import policies
 */
function mergeImportPolicy(
  base: ImportPolicy,
  override: ImportPolicy,
): ImportPolicy {
  return {
    trusted: [...new Set([...(base.trusted ?? []), ...(override.trusted ?? [])])],
    allowed: [...new Set([...(base.allowed ?? []), ...(override.allowed ?? [])])],
    blocked: [...new Set([...(base.blocked ?? []), ...(override.blocked ?? [])])],
  };
}

/**
 * Merge two configs (later overrides earlier, but some fields merge)
 */
export function mergeConfigs(
  base: SafeShellConfig,
  override: SafeShellConfig,
): SafeShellConfig {
  return {
    permissions: mergePermissions(
      base.permissions ?? {},
      override.permissions ?? {},
    ),
    external: mergeExternalCommands(
      base.external ?? {},
      override.external ?? {},
    ),
    env: mergeEnvConfig(base.env ?? {}, override.env ?? {}),
    imports: mergeImportPolicy(base.imports ?? {}, override.imports ?? {}),
    tasks: { ...base.tasks, ...override.tasks },
    timeout: override.timeout ?? base.timeout,
  };
}

/**
 * Load a config file if it exists
 */
async function loadConfigFile(path: string): Promise<SafeShellConfig | null> {
  try {
    await Deno.stat(path);
  } catch {
    return null; // File doesn't exist
  }

  try {
    // Dynamic import the config file
    const module = await import(path);
    return module.default as SafeShellConfig;
  } catch (error) {
    throw configError(
      `Failed to load config from ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Get the global config path
 */
export function getGlobalConfigPath(): string {
  const home = Deno.env.get("HOME") ?? "";
  return join(home, ".config", "safesh", "config.ts");
}

/**
 * Get the project config path
 */
export function getProjectConfigPath(cwd: string): string {
  return join(cwd, "safesh.config.ts");
}

/**
 * Load and merge all config files
 */
export async function loadConfig(cwd: string): Promise<SafeShellConfig> {
  let config = { ...DEFAULT_CONFIG };

  // Load global config
  const globalPath = getGlobalConfigPath();
  const globalConfig = await loadConfigFile(`file://${globalPath}`);
  if (globalConfig) {
    config = mergeConfigs(config, globalConfig);
  }

  // Load project config
  const projectPath = getProjectConfigPath(cwd);
  const projectConfig = await loadConfigFile(`file://${projectPath}`);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  return config;
}

/**
 * Validate config for security issues
 */
export interface ConfigValidation {
  errors: string[];
  warnings: string[];
}

export function validateConfig(config: SafeShellConfig): ConfigValidation {
  const result: ConfigValidation = { errors: [], warnings: [] };
  const perms = config.permissions ?? {};

  // Check for overly permissive read
  if (perms.read?.includes("/")) {
    result.warnings.push("read: ['/'] allows reading entire filesystem");
  }

  // Check for overly permissive write
  if (perms.write?.includes("/")) {
    result.errors.push("write: ['/'] is extremely dangerous - not allowed");
  }

  // Check for wildcard run permission
  if (perms.run?.includes("*")) {
    result.errors.push("run: ['*'] is not allowed - explicitly list commands");
  }

  // Check for conflicting external command settings
  const external = config.external ?? {};
  for (const [cmd, cmdConfig] of Object.entries(external)) {
    const deny = cmdConfig.denyFlags ?? [];
    const require = cmdConfig.requireFlags ?? [];

    for (const flag of require) {
      if (deny.includes(flag)) {
        result.errors.push(
          `${cmd}: flag '${flag}' is both denied and required`,
        );
      }
    }
  }

  return result;
}
