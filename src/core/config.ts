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

import { join, fromFileUrl } from "@std/path";
import type {
  EnvConfig,
  ExternalCommandConfig,
  ImportPolicy,
  PermissionsConfig,
  SafeShellConfig,
  SecurityPreset,
} from "./types.ts";
import { configError } from "./errors.ts";

// ============================================================================
// Security Presets
// ============================================================================

/**
 * Strict preset - maximum security, minimal permissions
 * Use for untrusted code or production environments
 */
export const STRICT_PRESET: SafeShellConfig = {
  permissions: {
    read: ["${CWD}", "/tmp"],
    write: ["/tmp"],
    net: [],
    run: [],
    env: ["HOME", "PATH", "TERM"],
  },
  external: {},
  env: {
    allow: ["HOME", "PATH", "TERM"],
    mask: ["*_KEY", "*_SECRET", "*_TOKEN", "*_PASSWORD", "*_API*", "AWS_*", "GITHUB_*"],
  },
  imports: {
    trusted: ["jsr:@std/*", "safesh:*"],
    allowed: [],
    blocked: ["npm:*", "http:*", "https:*", "file:*"],
  },
  tasks: {},
  timeout: 30000,
};

/**
 * Standard preset - balanced security and functionality
 * Good default for most projects
 */
export const STANDARD_PRESET: SafeShellConfig = {
  permissions: {
    read: ["${CWD}", "/tmp"],
    write: ["${CWD}", "/tmp"],
    net: [],
    run: [],
    env: ["HOME", "PATH", "TERM", "USER", "LANG"],
  },
  external: {},
  env: {
    allow: ["HOME", "PATH", "TERM", "EDITOR", "SHELL", "USER", "LANG"],
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
 * Permissive preset - more relaxed for development
 * Enables common dev tools and broader access
 */
export const PERMISSIVE_PRESET: SafeShellConfig = {
  permissions: {
    read: ["${CWD}", "/tmp", "${HOME}"],
    write: ["${CWD}", "/tmp"],
    net: true,
    run: ["git", "deno", "node", "npm", "pnpm", "yarn", "docker", "make", "cargo"],
    env: ["HOME", "PATH", "TERM", "USER", "LANG", "EDITOR", "SHELL"],
  },
  external: {
    git: { allow: true },
    deno: { allow: true },
    node: { allow: true },
    npm: { allow: true },
    pnpm: { allow: true },
    yarn: { allow: true },
    docker: {
      allow: true,
      pathArgs: { autoDetect: true, validateSandbox: true },
    },
    make: { allow: true },
    cargo: { allow: true },
  },
  env: {
    allow: [
      "HOME",
      "PATH",
      "TERM",
      "EDITOR",
      "SHELL",
      "USER",
      "LANG",
      "LC_*",
      "DENO_*",
      "NODE_*",
    ],
    mask: [
      "*_KEY",
      "*_SECRET",
      "*_TOKEN",
      "*_PASSWORD",
      "*_PRIVATE*",
      "AWS_*",
      "GITHUB_TOKEN",
    ],
  },
  imports: {
    trusted: ["jsr:@std/*", "safesh:*"],
    allowed: ["jsr:*"],
    blocked: ["http:*", "https:*"],
  },
  tasks: {},
  timeout: 60000,
};

/**
 * Default configuration - uses standard preset
 */
export const DEFAULT_CONFIG: SafeShellConfig = STANDARD_PRESET;

/**
 * Get a preset configuration by name
 */
export function getPreset(preset: SecurityPreset): SafeShellConfig {
  switch (preset) {
    case "strict":
      return { ...STRICT_PRESET };
    case "standard":
      return { ...STANDARD_PRESET };
    case "permissive":
      return { ...PERMISSIVE_PRESET };
    default:
      throw configError(`Unknown preset: ${preset}`);
  }
}

// ============================================================================
// Config Merging
// ============================================================================

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
    // Convert file:// URL to path for stat
    const filePath = path.startsWith("file://") ? fromFileUrl(path) : path;
    await Deno.stat(filePath);
  } catch {
    return null; // File doesn't exist
  }

  try {
    // Dynamic import the config file (needs file:// URL)
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
    // If global config specifies a preset, start from that preset
    if (globalConfig.preset) {
      config = mergeConfigs(getPreset(globalConfig.preset), globalConfig);
    } else {
      config = mergeConfigs(config, globalConfig);
    }
  }

  // Load project config
  const projectPath = getProjectConfigPath(cwd);
  const projectConfig = await loadConfigFile(`file://${projectPath}`);
  if (projectConfig) {
    // If project config specifies a preset, it takes precedence
    if (projectConfig.preset) {
      config = mergeConfigs(getPreset(projectConfig.preset), projectConfig);
    } else {
      config = mergeConfigs(config, projectConfig);
    }
  }

  return config;
}

/**
 * Load and validate config - throws on validation errors
 * Use this when you want strict validation (e.g., in MCP server startup)
 */
export async function loadAndValidateConfig(
  cwd: string,
): Promise<SafeShellConfig> {
  const config = await loadConfig(cwd);

  const validation = validateConfig(config);

  // Throw on errors
  if (validation.errors.length > 0) {
    throw configError(
      `Config validation failed:\n${validation.errors.join("\n")}`,
    );
  }

  // Log warnings
  if (validation.warnings.length > 0) {
    console.warn("⚠️  Config warnings:");
    validation.warnings.forEach((w) => console.warn(`   ${w}`));
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

  // ========== Permission Validation ==========

  // Check for overly permissive read
  if (perms.read?.includes("/")) {
    result.warnings.push(
      "permissions.read: ['/'] allows reading entire filesystem - consider limiting to specific directories",
    );
  }

  // Check for sensitive directories in read permissions
  const sensitiveReadDirs = ["/etc", "/var", "/usr", "/System"];
  for (const dir of sensitiveReadDirs) {
    if (perms.read?.includes(dir)) {
      result.warnings.push(
        `permissions.read: includes '${dir}' which may contain sensitive files`,
      );
    }
  }

  // Check for overly permissive write
  if (perms.write?.includes("/")) {
    result.errors.push(
      "permissions.write: ['/'] is extremely dangerous - never allow root write access",
    );
  }

  // Check for dangerous write paths
  const dangerousWriteDirs = ["/etc", "/var", "/usr", "/bin", "/sbin", "/System"];
  for (const dir of dangerousWriteDirs) {
    if (perms.write?.includes(dir)) {
      result.errors.push(
        `permissions.write: includes '${dir}' - this can compromise system security`,
      );
    }
  }

  // Check for wildcard run permission
  if (perms.run?.includes("*")) {
    result.errors.push(
      "permissions.run: ['*'] is not allowed - must explicitly list allowed commands",
    );
  }

  // Warn about unrestricted network access
  if (perms.net === true) {
    result.warnings.push(
      "permissions.net: true allows unrestricted network access - consider specifying allowed hosts",
    );
  }

  // Check for too many allowed commands (might indicate misconfiguration)
  if (Array.isArray(perms.run) && perms.run.length > 20) {
    result.warnings.push(
      `permissions.run: ${perms.run.length} commands allowed - this might be too permissive`,
    );
  }

  // ========== External Command Validation ==========

  const external = config.external ?? {};
  for (const [cmd, cmdConfig] of Object.entries(external)) {
    const deny = cmdConfig.denyFlags ?? [];
    const require = cmdConfig.requireFlags ?? [];

    // Check for conflicting flags
    for (const flag of require) {
      if (deny.includes(flag)) {
        result.errors.push(
          `external.${cmd}: flag '${flag}' is both denied and required`,
        );
      }
    }

    // Warn about commands with no restrictions
    if (
      cmdConfig.allow === true &&
      (deny.length === 0) &&
      (require.length === 0) &&
      !cmdConfig.pathArgs
    ) {
      result.warnings.push(
        `external.${cmd}: has no restrictions - consider adding flag controls or path validation`,
      );
    }
  }

  // ========== Import Policy Validation ==========

  const imports = config.imports ?? {};
  const trusted = imports.trusted ?? [];
  const allowed = imports.allowed ?? [];
  const blocked = imports.blocked ?? [];

  // Warn if no blocked patterns (too permissive)
  if (blocked.length === 0) {
    result.warnings.push(
      "imports.blocked: empty - highly recommend blocking 'npm:*', 'http:*', 'https:*' for security",
    );
  }

  // Warn if allowing npm:* entirely
  if (allowed.includes("npm:*") || trusted.includes("npm:*")) {
    result.warnings.push(
      "imports: allows 'npm:*' - permits arbitrary npm packages (security risk)",
    );
  }

  // Warn if allowing http/https imports entirely
  if (
    allowed.includes("http:*") || trusted.includes("http:*") ||
    allowed.includes("https:*") || trusted.includes("https:*")
  ) {
    result.warnings.push(
      "imports: allows 'http:*' or 'https:*' - remote code execution risk",
    );
  }

  // Error if trusted and blocked have overlapping patterns
  for (const pattern of blocked) {
    if (trusted.includes(pattern)) {
      result.errors.push(
        `imports: pattern '${pattern}' is both trusted and blocked`,
      );
    }
  }

  // Warn if allowed and blocked have overlapping patterns
  for (const pattern of blocked) {
    if (allowed.includes(pattern)) {
      result.errors.push(
        `imports: pattern '${pattern}' is both allowed and blocked`,
      );
    }
  }

  // ========== Cross-Concern Validation ==========

  // Check for dangerous combination: unrestricted net + npm imports
  if (
    perms.net === true &&
    (allowed.includes("npm:*") || trusted.includes("npm:*"))
  ) {
    result.warnings.push(
      "dangerous combination: unrestricted network + npm:* imports can allow arbitrary remote code execution",
    );
  }

  // Check for write access to CWD without import restrictions
  if (
    perms.write?.includes("${CWD}") &&
    blocked.length === 0
  ) {
    result.warnings.push(
      "write access to ${CWD} + no import blocks can allow malicious code to persist",
    );
  }

  return result;
}
