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
} from "./types.ts";
import { configError } from "./errors.ts";
import { resolveWorkspace } from "./permissions.ts";
import { DEFAULT_TIMEOUT_MS } from "./defaults.ts";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Merge two optional arrays using union (deduplication) strategy.
 * Returns a new array containing unique elements from both inputs.
 */
function unionArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

// ============================================================================
// Default Safe Commands
// ============================================================================

/**
 * Commands that are safe for general use.
 *
 * Note: Many file operations (ls, mkdir, rm, cp, mv, touch, chmod, ln, cd, pwd,
 * echo, test, which) are implemented as INTERNAL BUILTINS in shelljs and bypass
 * permission checks entirely. This list is for EXTERNAL commands only.
 */
const SAFE_COMMANDS = [
  // ============================================================================
  // Text Processing
  // ============================================================================
  "cat", "head", "tail", "wc", "sort", "uniq", "cut", "tr", "tee", "xargs",
  "sed", "awk", "grep", "egrep", "fgrep",
  "diff", "cmp", "comm", "paste", "join", "column",
  "fold", "fmt", "nl", "rev", "tac", "expand", "unexpand",
  "strings", "jq", "yq",

  // ============================================================================
  // File/Directory Inspection (read-only)
  // ============================================================================
  "ls", "find", "tree", "du", "df", "file", "stat", "pwd",
  "locate", "whereis", "type",
  "readlink", "realpath", "basename", "dirname",

  // ============================================================================
  // Encoding & Hashing
  // ============================================================================
  "base64", "xxd", "od", "hexdump",
  "md5", "md5sum", "shasum", "sha256sum", "sha512sum", "cksum", "sum",

  // ============================================================================
  // Compression (read-only operations)
  // ============================================================================
  "zcat", "bzcat", "xzcat", "lzcat",
  "gzip", "gunzip", "bzip2", "bunzip2", "xz", "unxz", "lz4", "zstd",
  "tar", "zip", "unzip", "zipinfo",

  // ============================================================================
  // Process & System Info
  // ============================================================================
  "ps", "pgrep", "pkill", "lsof", "fuser",
  "top", "htop", "uptime", "w", "who", "users", "last", "lastlog",
  "uname", "hostname", "hostnamectl", "arch", "nproc", "lscpu", "lsmem",
  "free", "vmstat", "iostat", "mpstat", "sar",
  "lsblk", "lsusb", "lspci", "lsmod",

  // ============================================================================
  // User & Group Info
  // ============================================================================
  "whoami", "id", "groups", "getent", "finger",

  // ============================================================================
  // Date, Time & Locale
  // ============================================================================
  "date", "cal", "ncal", "timedatectl",
  "locale", "localectl",

  // ============================================================================
  // Math & Sequences
  // ============================================================================
  "seq", "bc", "dc", "expr", "factor", "numfmt",

  // ============================================================================
  // Help & Documentation
  // ============================================================================
  "man", "info", "apropos", "whatis", "help",

  // ============================================================================
  // Version Control
  // ============================================================================
  "git", "hg", "svn",

  // ============================================================================
  // Network Info (read-only)
  // ============================================================================
  "ping", "host", "dig", "nslookup", "whois",
  "netstat", "ss", "ip", "ifconfig", "route", "arp",
  "traceroute", "tracepath", "mtr",
  "curl", "wget", "fetch",

  // ============================================================================
  // Shell Utilities
  // ============================================================================
  "echo", "printf", "yes", "true", "false", "test", "[",
  "env", "printenv", "getconf",
  "sleep", "timeout", "time", "watch",
  "xargs", "parallel",
  "which", "whereis", "command", "type", "hash",
  "tput", "clear", "reset",

  // ============================================================================
  // File Creation (requires write permission to target)
  // ============================================================================
  "touch", "mkdir", "mktemp", "mkfifo",

  // ============================================================================
  // Package Managers (read-only operations like list/search)
  // ============================================================================
  "brew", "apt", "apt-cache", "dpkg", "rpm", "yum", "dnf", "pacman", "apk",
  "pip", "pip3", "gem", "cargo", "go", "rustc", "rustup",
  "fyn", "nvx", "xrun", "npm", "pnpm", "yarn",
  // NOTE: node, deno, bun removed - can execute arbitrary code, require explicit permission
] as const;

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default configuration
 *
 * These are sensible defaults that get merged with user/project configs.
 * Config files can add more allowed commands or modify these settings.
 */
/**
 * Sensitive paths that should never be readable
 */
const SENSITIVE_READ_PATHS = [
  "${HOME}/.ssh",
  "${HOME}/.gnupg",
  "${HOME}/.gpg",
  "${HOME}/.aws/credentials",
  "${HOME}/.config/gh",
  "${HOME}/.netrc",
  "${HOME}/.npmrc",
  "${HOME}/.pypirc",
  "${HOME}/.docker/config.json",
  "${HOME}/.kube/config",
] as const;

/**
 * Sensitive paths that should never be writable
 */
const SENSITIVE_WRITE_PATHS = [
  "${HOME}/.ssh",
  "${HOME}/.gnupg",
  "${HOME}/.gpg",
  "${HOME}/.aws",
  "${HOME}/.config/gh",
  "${HOME}/.netrc",
  "${HOME}/.npmrc",
  "${HOME}/.pypirc",
  "${HOME}/.bashrc",
  "${HOME}/.bash_profile",
  "${HOME}/.zshrc",
  "${HOME}/.profile",
] as const;

export const DEFAULT_CONFIG: SafeShellConfig = {
  permissions: {
    read: ["${CWD}", "${HOME}", "/tmp", "${HOME}/.claude"],
    denyRead: [...SENSITIVE_READ_PATHS],
    write: ["/tmp", "/dev/null", "${HOME}/.claude"],
    denyWrite: [...SENSITIVE_WRITE_PATHS],
    net: [],
    run: [...SAFE_COMMANDS],
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
  timeout: DEFAULT_TIMEOUT_MS,
  alwaysTranspile: true,
};

// ============================================================================
// Config Merging
// ============================================================================

/**
 * Merges two PermissionsConfig objects using union strategy for all array fields.
 *
 * All fields use array union (deduplicated):
 * - `read`: Combined read paths from both configs
 * - `write`: Combined write paths from both configs
 * - `run`: Combined allowed commands from both configs
 * - `env`: Combined allowed env vars from both configs
 * - `net`: Special handling via mergeNetPermissions()
 *
 * @param base - The base permissions config (lower priority)
 * @param override - The override permissions config (higher priority)
 * @returns Merged PermissionsConfig with deduplicated arrays
 */
function mergePermissions(
  base: PermissionsConfig,
  override: PermissionsConfig,
): PermissionsConfig {
  return {
    read: unionArrays(base.read, override.read),
    denyRead: unionArrays(base.denyRead, override.denyRead),
    write: unionArrays(base.write, override.write),
    denyWrite: unionArrays(base.denyWrite, override.denyWrite),
    net: mergeNetPermissions(base.net, override.net),
    run: unionArrays(base.run, override.run),
    env: unionArrays(base.env, override.env),
  };
}

/**
 * Merges network permission values with special boolean handling.
 *
 * Network permissions can be:
 * - `boolean true`: Allow all network access (most permissive)
 * - `string[]`: Allow only specific hosts/patterns
 * - `undefined`: No network access
 *
 * Merge logic:
 * - If EITHER is `true`, result is `true` (allow-all wins)
 * - Otherwise, arrays are merged with deduplication
 *
 * @param base - Base network permission
 * @param override - Override network permission
 * @returns Merged network permission (true or string[])
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
 * Merges external command configurations with deep per-command merging.
 *
 * For each command:
 * - If command exists in both: Deep merge the config fields
 * - If command only in override: Add to result
 * - If command only in base: Keep in result
 *
 * Per-command field merge strategy:
 * - `allow`: Override wins (boolean or string[])
 * - `denyFlags`: Union (arrays combined, deduplicated)
 * - `requireFlags`: Override wins
 * - `pathArgs`: Override wins
 *
 * @param base - Base external commands config
 * @param override - Override external commands config
 * @returns Merged external commands config
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
 * Merges environment variable configurations using union strategy.
 *
 * Both fields use array union (deduplicated):
 * - `allow`: Combined allowed env var patterns
 * - `mask`: Combined mask patterns (vars matching these are hidden/redacted)
 *
 * @param base - Base env config
 * @param override - Override env config
 * @returns Merged EnvConfig with deduplicated arrays
 */
function mergeEnvConfig(
  base: EnvConfig,
  override: EnvConfig,
): EnvConfig {
  return {
    allow: unionArrays(base.allow, override.allow),
    mask: unionArrays(base.mask, override.mask),
  };
}

/**
 * Merges import policies using union strategy for all fields.
 *
 * All fields use array union (deduplicated):
 * - `trusted`: Combined trusted import patterns (highest privilege)
 * - `allowed`: Combined allowed import patterns
 * - `blocked`: Combined blocked import patterns (always denied)
 *
 * Note: If a pattern appears in both `blocked` and `trusted`/`allowed`,
 * this creates a conflict that will be caught by validateConfig().
 *
 * @param base - Base import policy
 * @param override - Override import policy
 * @returns Merged ImportPolicy with deduplicated arrays
 */
function mergeImportPolicy(
  base: ImportPolicy,
  override: ImportPolicy,
): ImportPolicy {
  return {
    trusted: unionArrays(base.trusted, override.trusted),
    allowed: unionArrays(base.allowed, override.allowed),
    blocked: unionArrays(base.blocked, override.blocked),
  };
}

/**
 * Merges two SafeShellConfig objects with field-specific strategies.
 *
 * ## Merge Order
 *
 * Configs are loaded and merged in this order (later overrides earlier):
 *
 * 1. **Built-in** - `DEFAULT_CONFIG` (hardcoded defaults)
 * 2. **Global** - `~/.config/safesh/config.[ts|json]` (user preferences)
 * 3. **Project** - `.config/safesh/config.[ts|json]` (project settings)
 * 4. **Local** - `.config/safesh/config.local.[ts|json]` (machine-specific)
 * 5. **MCP args** - Runtime arguments from MCP initialization
 *
 * At each level, JSON files take precedence over TS files if both exist.
 *
 * ## Field Merge Strategies
 *
 * | Field                 | Strategy          | Notes                                              |
 * |-----------------------|-------------------|---------------------------------------------------|
 * | `workspace`           | override          | Later value replaces earlier                       |
 * | `projectDir`          | override          | Later value replaces earlier (auto full r/w access)|
 * | `blockProjectDirWrite`| override          | Later value replaces earlier                       |
 * | `allowProjectCommands`| override          | Later value replaces earlier                       |
 * | `permissions.read`    | union             | Arrays combined, deduplicated                      |
 * | `permissions.write`   | union             | Arrays combined, deduplicated                      |
 * | `permissions.run`     | union             | Arrays combined, deduplicated                      |
 * | `permissions.env`     | union             | Arrays combined, deduplicated                      |
 * | `permissions.net`     | special           | `true` wins; otherwise arrays merged               |
 * | `external`            | deep merge        | Per-command: allow/requireFlags/pathArgs override; denyFlags union |
 * | `env.allow`           | union             | Arrays combined, deduplicated                      |
 * | `env.mask`            | union             | Arrays combined, deduplicated                      |
 * | `imports.trusted`     | union             | Arrays combined, deduplicated                      |
 * | `imports.allowed`     | union             | Arrays combined, deduplicated                      |
 * | `imports.blocked`     | union             | Arrays combined, deduplicated                      |
 * | `tasks`               | shallow merge     | Object.assign (later keys override)                |
 * | `timeout`             | override          | Later value replaces earlier                       |
 * | `denoFlags`           | union             | Arrays combined, deduplicated                      |
 *
 * ## Examples
 *
 * ```typescript
 * // Base config
 * const base = { permissions: { read: ["/tmp"] }, timeout: 30000 };
 * // Project config
 * const project = { permissions: { read: ["${CWD}"] }, timeout: 60000 };
 * // Result
 * const merged = mergeConfigs(base, project);
 * // merged.permissions.read = ["/tmp", "${CWD}"]  (union)
 * // merged.timeout = 60000  (override)
 * ```
 *
 * @param base - The base config (lower priority)
 * @param override - The override config (higher priority)
 * @returns Merged SafeShellConfig
 *
 * @see mergePermissions - Handles permissions field merging
 * @see mergeExternalCommands - Handles external commands deep merge
 * @see mergeEnvConfig - Handles env config merging
 * @see mergeImportPolicy - Handles import policy merging
 * @see mergeNetPermissions - Handles special net permission logic
 */
export function mergeConfigs(
  base: SafeShellConfig,
  override: SafeShellConfig,
): SafeShellConfig {
  // Start with spread merge (handles all simple override fields automatically)
  // This ensures new fields don't break - they just use "last wins" strategy
  const merged: SafeShellConfig = {
    ...base,
    ...override,
    // Now override specific fields that need custom merge strategies
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
    denoFlags: unionArrays(base.denoFlags, override.denoFlags),
  };

  return merged;
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

  // Load global config (~/.config/safesh/) - JSON overrides TS
  const globalConfig = await loadConfigWithJsonOverride(
    getGlobalConfigPath(),
    getGlobalConfigJsonPath(),
  );
  if (globalConfig) {
    config = mergeConfigs(config, globalConfig);
  }

  // Load project config (.config/safesh/) - JSON overrides TS
  const projectConfig = await loadConfigWithJsonOverride(
    getProjectConfigPath(cwd),
    getProjectConfigJsonPath(cwd),
  );
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
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
  /** Project directory (base for relative paths, auto full read/write) */
  projectDir?: string;
  /** Current working directory (takes precedence over projectDir for cwd) */
  cwd?: string;
  /** Allow any command under projectDir */
  allowProjectCommands?: boolean;
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

  // ========== Project Directory Validation ==========

  if (!config.projectDir) {
    result.warnings.push(
      "projectDir: not set - file permissions will be limited to /tmp and explicit paths",
    );
  }

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
