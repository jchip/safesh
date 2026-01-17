/**
 * Consolidated default values and magic numbers
 *
 * This file centralizes all default values used across the codebase
 * to ensure consistency and make them easy to find and modify.
 */

import { getScriptsDir } from "./temp.ts";

// ============================================================================
// Timeout Defaults
// ============================================================================

/** Default timeout for script execution in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Default timeout for waiting on scripts in milliseconds */
export const DEFAULT_WAIT_TIMEOUT_MS = 30000;

/** Polling interval when waiting for script completion in milliseconds */
export const SCRIPT_POLL_INTERVAL_MS = 100;

// ============================================================================
// Output Limits
// ============================================================================

/** Maximum output size per stdout/stderr in bytes (1MB) */
export const SCRIPT_OUTPUT_LIMIT = 1024 * 1024;

/** Maximum shell memory limit in bytes (50MB) */
export const SHELL_MEMORY_LIMIT = 50 * 1024 * 1024;

/** Maximum length for code/command preview in responses */
export const CODE_PREVIEW_LENGTH = 100;

/** Minimum retention time for completed scripts in milliseconds (5 minutes) */
export const SCRIPT_RETENTION_MS = 5 * 60 * 1000;

// ============================================================================
// Retry Management
// ============================================================================

/** Time-to-live for pending retry requests in milliseconds (5 minutes) */
export const PENDING_RETRY_TTL_MS = 5 * 60 * 1000;

/** Maximum number of pending retry requests */
export const MAX_PENDING_RETRIES = 100;

// ============================================================================
// Temp Directories
// ============================================================================

// NOTE: Temp directory paths are managed by src/core/temp.ts
// This re-export maintains backwards compatibility

/** Default temp directory for script files */
export const TEMP_SCRIPT_DIR = getScriptsDir();
