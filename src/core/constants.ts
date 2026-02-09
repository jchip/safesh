/**
 * Centralized constants for SafeShell
 *
 * This file defines all magic strings, markers, and error types used throughout
 * the codebase. Centralizing them here makes it easier to find usages and
 * prevents typos.
 *
 * @module
 */

// ============================================================================
// Stderr Markers (for subprocess communication)
// ============================================================================

/**
 * Job tracking marker - used to communicate job start/end events from
 * subprocess to main process via stderr.
 */
export const JOB_MARKER = "__SAFESH_JOB__:";

/**
 * Command permission error marker - emitted when a single command
 * (via cmd(), git(), etc.) is blocked by Deno permissions.
 */
export const CMD_ERROR_MARKER = "__SAFESH_CMD_ERROR__:";

/**
 * Init error marker - emitted by initCmds() when commands are blocked
 * during upfront permission check.
 */
export const INIT_ERROR_MARKER = "__SAFESH_INIT_ERROR__:";

/**
 * Network permission error marker - emitted when network access is blocked.
 */
export const NET_ERROR_MARKER = "__SAFESH_NET_ERROR__:";

/**
 * Shell state marker - used to sync shell state (CWD, ENV, VARS) back
 * from subprocess to main process via stdout.
 */
export const SHELL_STATE_MARKER = "__SAFESH_STATE__:";

// ============================================================================
// Environment Variable Names
// ============================================================================

/**
 * Shell ID environment variable - passed to subprocess for job tracking.
 */
export const ENV_SHELL_ID = "SAFESH_SHELL_ID";

/**
 * Script ID environment variable - passed to subprocess for job tracking.
 */
export const ENV_SCRIPT_ID = "SAFESH_SCRIPT_ID";

/**
 * Project commands environment variable (reserved for future use).
 */
export const ENV_PROJECT_COMMANDS = "SAFESH_PROJECT_COMMANDS";

// ============================================================================
// Error Types (used in error events and responses)
// ============================================================================

/**
 * Error type for single command not allowed.
 */
export const ERROR_COMMAND_NOT_ALLOWED = "COMMAND_NOT_ALLOWED";

/**
 * Error type for multiple commands blocked (from initCmds).
 */
export const ERROR_COMMANDS_BLOCKED = "COMMANDS_BLOCKED";

/**
 * Error type for command not found.
 */
export const ERROR_COMMAND_NOT_FOUND = "COMMAND_NOT_FOUND";

/**
 * Error type for network access blocked.
 */
export const ERROR_NETWORK_BLOCKED = "NETWORK_BLOCKED";

// ============================================================================
// Version
// ============================================================================

/**
 * SafeShell version string - single source of truth.
 * Used by CLI (desh, safesh) and MCP server.
 */
export const VERSION = "0.1.0";
