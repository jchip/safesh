/**
 * SafeShell core type definitions
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface PermissionsConfig {
  /** Paths allowed for reading (supports ${CWD}, ${HOME}, /tmp) */
  read?: string[];
  /** Paths allowed for writing */
  write?: string[];
  /** Allowed network hosts/domains */
  net?: string[] | boolean;
  /** Allowed external commands */
  run?: string[];
  /** Allowed environment variables */
  env?: string[];
}

export interface ExternalCommandConfig {
  /** Allow all subcommands (true) or specific list */
  allow: boolean | string[];
  /** Flags that are explicitly denied */
  denyFlags?: string[];
  /** Flags that must be present */
  requireFlags?: string[];
  /** Validate path arguments against sandbox */
  pathArgs?: {
    /** Auto-detect path-like arguments */
    autoDetect?: boolean;
    /** Validate paths against allowed directories */
    validateSandbox?: boolean;
    /** Specific argument positions that are paths (0-indexed) */
    positions?: number[];
  };
}

export interface EnvConfig {
  /** Environment variables to pass through */
  allow?: string[];
  /** Patterns to mask (never expose) - supports wildcards */
  mask?: string[];
}

export interface ImportPolicy {
  /** Always allowed imports (e.g., "jsr:@std/*", "safesh:*") */
  trusted?: string[];
  /** User-allowed imports */
  allowed?: string[];
  /** Blocked import patterns (e.g., "npm:*", "http:*") */
  blocked?: string[];
}

export interface TaskConfig {
  /** Simple command string */
  cmd?: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables for this task */
  env?: Record<string, string>;
  /** Tasks to run in parallel */
  parallel?: string[];
  /** Tasks to run in series */
  serial?: string[];
  /** Working directory */
  cwd?: string;
}

export type SecurityPreset = "strict" | "standard" | "permissive";

export interface SafeShellConfig {
  /** Security preset to start from (optional) */
  preset?: SecurityPreset;

  /** Deno permission configuration */
  permissions?: PermissionsConfig;

  /** External command whitelist with fine-grained control */
  external?: Record<string, ExternalCommandConfig>;

  /** Environment variable handling */
  env?: EnvConfig;

  /** Import security policy */
  imports?: ImportPolicy;

  /** Task definitions */
  tasks?: Record<string, string | TaskConfig>;

  /** Default timeout in milliseconds */
  timeout?: number;
}

// ============================================================================
// Runtime Types
// ============================================================================

/** Memory limits for shell/script management */
export const SCRIPT_OUTPUT_LIMIT = 1024 * 1024; // 1MB per stdout/stderr
export const SHELL_MEMORY_LIMIT = 50 * 1024 * 1024; // 50MB per shell
export const MAX_SHELLS = 10; // LRU eviction when exceeded

// Legacy aliases for backwards compatibility during migration
export const JOB_OUTPUT_LIMIT = SCRIPT_OUTPUT_LIMIT;
export const SESSION_MEMORY_LIMIT = SHELL_MEMORY_LIMIT;
export const MAX_SESSIONS = MAX_SHELLS;

export interface Shell {
  /** Unique shell ID */
  id: string;
  /** Human-readable description for context recovery */
  description?: string;
  /** Current working directory */
  cwd: string;
  /** Shell environment variables */
  env: Record<string, string>;
  /** Persisted JS variables */
  vars: Record<string, unknown>;
  /** Scripts by ID (primary index) - code executions */
  scripts: Map<string, Script>;
  /** Script ID lookup by PID */
  scriptsByPid: Map<number, string>;
  /** Auto-increment counter for script IDs */
  scriptSequence: number;
  /** Jobs by ID - spawned processes within scripts */
  jobs: Map<string, Job>;
  /** Creation timestamp */
  createdAt: Date;
  /** Last activity timestamp (updated on each run, used for LRU) */
  lastActivityAt: Date;
}

/**
 * Script - a code execution record created by the `run` tool.
 * May spawn multiple Jobs (processes with PIDs).
 */
export interface Script {
  /** Unique script ID: script-{shellId}-{seq} */
  id: string;
  /** Code that was executed */
  code: string;
  /** Process ID of the deno subprocess running this script */
  pid: number;
  /** Current status */
  status: "running" | "completed" | "failed";
  /** Exit code if completed/failed */
  exitCode?: number;
  /** Buffered stdout (capped at SCRIPT_OUTPUT_LIMIT) */
  stdout: string;
  /** Buffered stderr (capped at SCRIPT_OUTPUT_LIMIT) */
  stderr: string;
  /** True if stdout exceeded SCRIPT_OUTPUT_LIMIT */
  stdoutTruncated: boolean;
  /** True if stderr exceeded SCRIPT_OUTPUT_LIMIT */
  stderrTruncated: boolean;
  /** Start timestamp */
  startedAt: Date;
  /** Completion timestamp */
  completedAt?: Date;
  /** Duration in milliseconds */
  duration?: number;
  /** Whether script runs in background */
  background: boolean;
  /** Child process handle (cleared after completion to allow GC) */
  process?: Deno.ChildProcess;
  /** IDs of jobs spawned by this script */
  jobIds: string[];
}

/**
 * Job - a spawned process with a PID.
 * Created when cmd(), git(), docker() etc. are called within a Script.
 */
export interface Job {
  /** Unique job ID: job-{shellId}-{seq} */
  id: string;
  /** Parent script ID */
  scriptId: string;
  /** Command that was executed (e.g., "git", "docker") */
  command: string;
  /** Command arguments */
  args: string[];
  /** Process ID */
  pid: number;
  /** Current status */
  status: "running" | "completed" | "failed";
  /** Exit code if completed/failed */
  exitCode?: number;
  /** Buffered stdout */
  stdout: string;
  /** Buffered stderr */
  stderr: string;
  /** Start timestamp */
  startedAt: Date;
  /** Completion timestamp */
  completedAt?: Date;
  /** Duration in milliseconds */
  duration?: number;
}

// ============================================================================
// Execution Types
// ============================================================================

export interface ExecOptions {
  /** Session ID to use */
  sessionId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Stream output in real-time */
  stream?: boolean;
  /** Working directory override */
  cwd?: string;
}

export interface ExecResult {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code */
  code: number;
  /** Whether execution succeeded (code === 0) */
  success: boolean;
  /** Script ID if tracked in a shell */
  scriptId?: string;
}

export interface RunOptions extends ExecOptions {
  /** Additional environment variables */
  env?: Record<string, string>;

  /** Standard input data to write to the command */
  stdin?: string | Uint8Array | ReadableStream<Uint8Array>;
}

export interface StreamChunk {
  type: "stdout" | "stderr" | "exit";
  data?: string;
  code?: number;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface ExecRequest {
  code: string;
  sessionId?: string;
  timeout?: number;
  stream?: boolean;
}

export interface RunRequest {
  command: string;
  args?: string[];
  sessionId?: string;
  cwd?: string;
  timeout?: number;
  stream?: boolean;
}

export interface TaskRequest {
  name: string;
  args?: string[];
  sessionId?: string;
}

export interface StartSessionRequest {
  cwd?: string;
  env?: Record<string, string>;
}

export interface SessionResponse {
  sessionId: string;
  cwd: string;
  env: Record<string, string>;
}

// ============================================================================
// Helper function for config
// ============================================================================

export function defineConfig(config: SafeShellConfig): SafeShellConfig {
  return config;
}
