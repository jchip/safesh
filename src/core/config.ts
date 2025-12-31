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
  SafeshLocalConfig,
  SecurityPreset,
} from "./types.ts";
import { configError } from "./errors.ts";
import { resolveWorkspace } from "./permissions.ts";

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
    run: ["lsof", "ps"],
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
    run: [
      // Build tools (excluding deno/node which execute arbitrary code)
      "git", "npm", "pnpm", "yarn", "fyn", "nvx", "xrun",
      "docker", "make", "cargo",
      // Process/system inspection (read-only)
      "ps", "lsof", "netstat", "ss", "pgrep", "pidof", "fuser",
      "top", "htop", "uptime", "uname", "hostname", "whoami", "id", "groups",
      // File/directory inspection (read-only)
      "ls", "file", "stat", "du", "df", "find", "locate", "tree",
      "which", "whereis", "type", "realpath", "dirname", "basename",
      // Text processing (read-only, excluding sed -i, xargs)
      "cat", "head", "tail", "sort", "uniq", "wc", "grep", "cut",
      "awk", "tr", "column", "comm", "join", "paste",
      // Encoding/hashing (read-only)
      "md5", "md5sum", "shasum", "sha256sum", "base64", "xxd", "od", "hexdump",
      // Compression (read-only - zcat/bzcat/xzcat/zipinfo only)
      "zcat", "bzcat", "xzcat", "zipinfo",
      // Network inspection
      "ping", "host", "dig", "nslookup", "traceroute", "ifconfig", "ip", "arp", "route",
      "curl", "wget",
      // Date/time
      "date", "cal",
      // Misc (read-only, excluding tee which writes)
      "env", "printenv", "echo", "printf", "timeout", "time",
    ],
    env: ["HOME", "PATH", "TERM", "USER", "LANG", "EDITOR", "SHELL"],
  },
  external: {
    // Build tools (deno/node excluded - they execute arbitrary code)
    git: { allow: true },
    npm: { allow: true },
    pnpm: { allow: true },
    yarn: { allow: true },
    fyn: { allow: true },
    nvx: { allow: true },
    xrun: { allow: true },
    docker: {
      allow: true,
      pathArgs: { autoDetect: true, validateSandbox: true },
    },
    make: { allow: true },
    cargo: { allow: true },
    // Process/system inspection
    ps: { allow: true },
    lsof: { allow: true },
    netstat: { allow: true },
    ss: { allow: true },
    pgrep: { allow: true },
    pidof: { allow: true },
    fuser: { allow: true },
    top: { allow: true },
    htop: { allow: true },
    uptime: { allow: true },
    uname: { allow: true },
    hostname: { allow: true },
    whoami: { allow: true },
    id: { allow: true },
    groups: { allow: true },
    // File/directory inspection (read-only)
    ls: { allow: true },
    file: { allow: true },
    stat: { allow: true },
    du: { allow: true },
    df: { allow: true },
    find: { allow: true },
    locate: { allow: true },
    tree: { allow: true },
    which: { allow: true },
    whereis: { allow: true },
    type: { allow: true },
    realpath: { allow: true },
    dirname: { allow: true },
    basename: { allow: true },
    // Text processing (read-only)
    cat: { allow: true },
    head: { allow: true },
    tail: { allow: true },
    sort: { allow: true },
    uniq: { allow: true },
    wc: { allow: true },
    grep: { allow: true },
    cut: { allow: true },
    awk: { allow: true },
    tr: { allow: true },
    column: { allow: true },
    comm: { allow: true },
    join: { allow: true },
    paste: { allow: true },
    // Encoding/hashing (read-only)
    md5: { allow: true },
    md5sum: { allow: true },
    shasum: { allow: true },
    sha256sum: { allow: true },
    base64: { allow: true },
    xxd: { allow: true },
    od: { allow: true },
    hexdump: { allow: true },
    // Compression (read-only)
    zcat: { allow: true },
    bzcat: { allow: true },
    xzcat: { allow: true },
    zipinfo: { allow: true },
    // Network inspection
    ping: { allow: true },
    host: { allow: true },
    dig: { allow: true },
    nslookup: { allow: true },
    traceroute: { allow: true },
    ifconfig: { allow: true },
    ip: { allow: true },
    arp: { allow: true },
    route: { allow: true },
    curl: { allow: true },
    wget: { allow: true },
    // Date/time
    date: { allow: true },
    cal: { allow: true },
    // Misc (read-only)
    env: { allow: true },
    printenv: { allow: true },
    echo: { allow: true },
    printf: { allow: true },
    timeout: { allow: true },
    time: { allow: true },
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
    workspace: override.workspace ?? base.workspace,
    projectDir: override.projectDir ?? base.projectDir,
    allowProjectCommands: override.allowProjectCommands ?? base.allowProjectCommands,
    allowProjectFiles: override.allowProjectFiles ?? base.allowProjectFiles,
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
 * Load a TypeScript config file if it exists
 */
async function loadTsConfigFile(path: string): Promise<SafeShellConfig | null> {
  try {
    // Convert file:// URL to path for stat
    const filePath = path.startsWith("file://") ? fromFileUrl(path) : path;
    await Deno.stat(filePath);
  } catch {
    // Config file doesn't exist, which is normal
    return null;
  }

  try {
    // Dynamic import the config file (needs file:// URL)
    const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
    const module = await import(fileUrl);
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
 * Load a JSON config file if it exists
 */
async function loadJsonConfigFile(path: string): Promise<SafeShellConfig | null> {
  try {
    await Deno.stat(path);
  } catch {
    // JSON config file doesn't exist, which is normal
    return null;
  }

  try {
    const content = await Deno.readTextFile(path);
    return JSON.parse(content) as SafeShellConfig;
  } catch (error) {
    throw configError(
      `Failed to load config from ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Load config with JSON-overrides-TS logic
 * Tries JSON first, falls back to TS if JSON doesn't exist
 */
async function loadConfigWithJsonOverride(
  tsPath: string,
  jsonPath: string,
): Promise<SafeShellConfig | null> {
  // Try JSON first (higher priority)
  const jsonConfig = await loadJsonConfigFile(jsonPath);
  if (jsonConfig) {
    return jsonConfig;
  }

  // Fall back to TS
  return await loadTsConfigFile(tsPath);
}

/**
 * Get the global config directory
 */
export function getGlobalConfigDir(): string {
  const home = Deno.env.get("HOME") ?? "";
  return join(home, ".config", "safesh");
}

/**
 * Get the global config path (TS)
 */
export function getGlobalConfigPath(): string {
  return join(getGlobalConfigDir(), "config.ts");
}

/**
 * Get the global config path (JSON) - overrides TS
 */
export function getGlobalConfigJsonPath(): string {
  return join(getGlobalConfigDir(), "config.json");
}

/**
 * Get the project config directory
 */
export function getProjectConfigDir(cwd: string): string {
  return join(cwd, ".config", "safesh");
}

/**
 * Get the project config path (TS)
 */
export function getProjectConfigPath(cwd: string): string {
  return join(getProjectConfigDir(cwd), "config.ts");
}

/**
 * Get the project config path (JSON) - overrides TS
 */
export function getProjectConfigJsonPath(cwd: string): string {
  return join(getProjectConfigDir(cwd), "config.json");
}

/**
 * Get the local config path (TS) - .config/safesh/config.local.ts
 */
export function getLocalConfigPath(cwd: string): string {
  return join(getProjectConfigDir(cwd), "config.local.ts");
}

/**
 * Get the local JSON config path - .config/safesh/config.local.json
 * This file has precedence over config.local.ts and is machine-writable
 */
export function getLocalJsonConfigPath(cwd: string): string {
  return join(getProjectConfigDir(cwd), "config.local.json");
}

/**
 * Load local config from .config/safesh/config.local.ts and convert to SafeShellConfig
 * Local config adds allowedCommands to both external and permissions.run
 */
async function loadLocalConfig(cwd: string): Promise<{ config: SafeShellConfig | null }> {
  const localPath = getLocalConfigPath(cwd);

  try {
    // Convert to file path for stat check
    const filePath = localPath.startsWith("file://") ? fromFileUrl(localPath) : localPath;
    await Deno.stat(filePath);
  } catch {
    // Local config file doesn't exist, which is normal
    return { config: null };
  }

  try {
    // Dynamic import the config file
    const module = await import(`file://${localPath}`);
    const localConfig = module.default as SafeshLocalConfig;

    // Convert SafeshLocalConfig to SafeShellConfig
    if (!localConfig.allowedCommands || localConfig.allowedCommands.length === 0) {
      return { config: null };
    }

    const external: Record<string, ExternalCommandConfig> = {};
    const runPermissions: string[] = [];

    for (const cmd of localConfig.allowedCommands) {
      if (typeof cmd === "string") {
        // Simple string: allow all subcommands
        external[cmd] = { allow: true };
        runPermissions.push(cmd);
      } else if ("name" in cmd && "path" in cmd) {
        // Command with name and path - add path to permissions
        external[cmd.path] = { allow: true };
        runPermissions.push(cmd.path);
      } else if ("command" in cmd) {
        // Object with command, subcommands, flags
        const { command, subcommands } = cmd;
        external[command] = {
          allow: subcommands && subcommands.length > 0 ? subcommands : true,
        };
        runPermissions.push(command);
      }
    }

    return {
      config: {
        external,
        permissions: { run: runPermissions },
      },
    };
  } catch (error) {
    console.warn(`⚠️  Failed to load local config from ${localPath}: ${error instanceof Error ? error.message : String(error)}`);
    return { config: null };
  }
}

/** JSON format for config.local.json */
interface LocalJsonConfig {
  allowedCommands?: string[];
}

/**
 * Load local JSON config from .config/safesh/config.local.json
 * Returns the config or null if file doesn't exist
 */
async function loadLocalJsonConfig(cwd: string): Promise<LocalJsonConfig | null> {
  const jsonPath = getLocalJsonConfigPath(cwd);

  try {
    await Deno.stat(jsonPath);
  } catch {
    // Local JSON config doesn't exist, which is normal
    return null;
  }

  try {
    const content = await Deno.readTextFile(jsonPath);
    return JSON.parse(content) as LocalJsonConfig;
  } catch (error) {
    console.warn(
      `⚠️  Failed to load local JSON config from ${jsonPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Save commands to .config/safesh/config.local.json
 * Creates the .config/safesh directory if it doesn't exist
 * Merges with existing commands (adds new, doesn't remove existing)
 */
export async function saveToLocalJson(cwd: string, commands: string[]): Promise<void> {
  const jsonPath = getLocalJsonConfigPath(cwd);
  const configDir = getProjectConfigDir(cwd);

  // Ensure .config/safesh directory exists
  try {
    await Deno.mkdir(configDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }

  // Load existing and merge
  const existing = await loadLocalJsonConfig(cwd);
  const allCommands = new Set<string>(existing?.allowedCommands?.filter((c): c is string => typeof c === "string") ?? []);

  for (const cmd of commands) {
    allCommands.add(cmd);
  }

  const config: LocalJsonConfig = {
    allowedCommands: Array.from(allCommands).sort(),
  };

  await Deno.writeTextFile(jsonPath, JSON.stringify(config, null, 2) + "\n");
}

/** Options for loading config */
export interface LoadConfigOptions {
  /** Skip validation (default: false) */
  skipValidation?: boolean;
  /** Throw on validation errors (default: true) */
  throwOnErrors?: boolean;
  /** Log warnings to stderr (default: true) */
  logWarnings?: boolean;
}

/**
 * Load and merge all config files
 *
 * By default, validates the config and:
 * - Logs warnings to stderr
 * - Throws on critical errors (like write:['/'])
 *
 * Use skipValidation: true for performance-critical paths or when
 * validation is handled separately.
 */
export async function loadConfig(
  cwd: string,
  options: LoadConfigOptions = {},
): Promise<SafeShellConfig> {
  const {
    skipValidation = false,
    throwOnErrors = true,
    logWarnings = true,
  } = options;

  let config = { ...DEFAULT_CONFIG };

  // Load global config (JSON overrides TS)
  const globalConfig = await loadConfigWithJsonOverride(
    getGlobalConfigPath(),
    getGlobalConfigJsonPath(),
  );
  if (globalConfig) {
    // If global config specifies a preset, start from that preset
    if (globalConfig.preset) {
      config = mergeConfigs(getPreset(globalConfig.preset), globalConfig);
    } else {
      config = mergeConfigs(config, globalConfig);
    }
  }

  // Load project config (JSON overrides TS)
  const projectConfig = await loadConfigWithJsonOverride(
    getProjectConfigPath(cwd),
    getProjectConfigJsonPath(cwd),
  );
  if (projectConfig) {
    // If project config specifies a preset, it takes precedence
    if (projectConfig.preset) {
      config = mergeConfigs(getPreset(projectConfig.preset), projectConfig);
    } else {
      config = mergeConfigs(config, projectConfig);
    }
  }

  // Load local config (JSON overrides TS)
  // config.local.json has highest priority - machine-writable for "always allow"
  const localJsonConfig = await loadLocalJsonConfig(cwd);
  if (localJsonConfig?.allowedCommands && localJsonConfig.allowedCommands.length > 0) {
    const commands = localJsonConfig.allowedCommands.filter((c): c is string => typeof c === "string");
    if (commands.length > 0) {
      config = mergeConfigs(config, {
        external: Object.fromEntries(commands.map((cmd) => [cmd, { allow: true }])),
        permissions: { run: commands },
      });
    }
  } else {
    // Fall back to config.local.ts if no JSON
    const localResult = await loadLocalConfig(cwd);
    if (localResult.config) {
      config = mergeConfigs(config, localResult.config);
    }
  }

  // Resolve workspace path if provided
  if (config.workspace) {
    config.workspace = resolveWorkspace(config.workspace);
  }

  // Resolve projectDir path if provided
  if (config.projectDir) {
    config.projectDir = resolveWorkspace(config.projectDir);
  }

  // Validate config by default
  if (!skipValidation) {
    const validation = validateConfig(config);

    // Throw on critical errors
    if (throwOnErrors && validation.errors.length > 0) {
      throw configError(
        `Config validation failed:\n${validation.errors.join("\n")}`,
      );
    }

    // Log warnings
    if (logWarnings && validation.warnings.length > 0) {
      console.error("⚠️  Config warnings:");
      validation.warnings.forEach((w) => console.error(`   ${w}`));
    }
  }

  return config;
}

/**
 * MCP initialization args that can override config
 */
export interface McpInitArgs {
  /** Project directory (base for relative paths and auto-allow) */
  projectDir?: string;
  /** Current working directory (takes precedence over projectDir for cwd) */
  cwd?: string;
  /** Allow any command under projectDir */
  allowProjectCommands?: boolean;
  /** Allow read/write under projectDir */
  allowProjectFiles?: boolean;
}

/**
 * Load config with MCP args override
 * MCP args take precedence over file-based config
 */
export async function loadConfigWithArgs(
  baseCwd: string,
  mcpArgs?: McpInitArgs,
): Promise<{ config: SafeShellConfig; effectiveCwd: string }> {
  // Load base config from files
  let config = await loadConfig(baseCwd);

  // Apply MCP args overrides
  if (mcpArgs) {
    const overrides: SafeShellConfig = {};

    if (mcpArgs.projectDir) {
      overrides.projectDir = resolveWorkspace(mcpArgs.projectDir);
    }

    if (mcpArgs.allowProjectCommands !== undefined) {
      overrides.allowProjectCommands = mcpArgs.allowProjectCommands;
    }

    if (mcpArgs.allowProjectFiles !== undefined) {
      overrides.allowProjectFiles = mcpArgs.allowProjectFiles;
    }

    if (Object.keys(overrides).length > 0) {
      config = mergeConfigs(config, overrides);
    }
  }

  // Determine effective cwd: mcpArgs.cwd > mcpArgs.projectDir > baseCwd
  let effectiveCwd = baseCwd;
  if (mcpArgs?.cwd) {
    effectiveCwd = resolveWorkspace(mcpArgs.cwd);
  } else if (mcpArgs?.projectDir) {
    effectiveCwd = resolveWorkspace(mcpArgs.projectDir);
  }

  return { config, effectiveCwd };
}

/**
 * Load and validate config - throws on validation errors
 *
 * @deprecated Use loadConfig() instead, which validates by default.
 * This function is kept for backwards compatibility.
 */
export async function loadAndValidateConfig(
  cwd: string,
): Promise<SafeShellConfig> {
  // loadConfig now validates by default with throwOnErrors: true
  return await loadConfig(cwd);
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
