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

export interface Session {
  /** Unique session ID */
  id: string;
  /** Current working directory */
  cwd: string;
  /** Session environment variables */
  env: Record<string, string>;
  /** Persisted JS variables */
  vars: Record<string, unknown>;
  /** Background jobs */
  jobs: Map<string, Job>;
  /** Creation timestamp */
  createdAt: Date;
}

export interface Job {
  /** Unique job ID */
  id: string;
  /** Process ID */
  pid: number;
  /** External command (if any) */
  command?: string;
  /** JS/TS code (if any) */
  code?: string;
  /** Current status */
  status: "running" | "completed" | "failed";
  /** Buffered stdout */
  stdout: string;
  /** Buffered stderr */
  stderr: string;
  /** Start timestamp */
  startedAt: number;
  /** Exit code if completed/failed */
  exitCode?: number;
  /** Child process handle (internal use) */
  process?: Deno.ChildProcess;
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
}

export interface RunOptions extends ExecOptions {
  /** Additional environment variables */
  env?: Record<string, string>;
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
