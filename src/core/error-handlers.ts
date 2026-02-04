/**
 * Error Handlers Module
 *
 * Provides unified logic for detecting and handling errors, especially path violations.
 * Eliminates ~400 lines duplicated 3 times across bash-prehook.ts.
 */

import { getTempRoot } from "./temp.ts";
import { getErrorLogPath } from "./temp.ts";
import type { PendingPathRequest } from "./pending.ts";
import { writeJsonFileSync } from "./io-utils.ts";

/**
 * Information about a detected path violation
 */
export interface PathViolationInfo {
  isPathViolation: boolean;
  path?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Detect if an error is a path violation (SafeShell or Deno)
 *
 * Recognizes these error types:
 * - SafeShell PATH_VIOLATION
 * - SafeShell SYMLINK_VIOLATION
 * - Deno NotCapable errors
 *
 * @param error - The error to check
 * @returns Detection result with extracted information
 */
export function detectPathViolation(error: unknown): PathViolationInfo {
  const err = error as any;
  const errorMessage = err?.message || String(error);
  const errorCode = err?.code || "";

  const isPathViolation =
    errorCode === "PATH_VIOLATION" ||
    errorCode === "SYMLINK_VIOLATION" ||
    errorCode === "NotCapable" ||
    err?.name === "NotCapable" ||
    errorMessage.includes("is outside allowed directories") ||
    errorMessage.includes("outside allowed directories") ||
    errorMessage.includes("Requires read access to") ||
    errorMessage.includes("Requires write access to");

  if (isPathViolation) {
    const path = extractPathFromError(errorMessage, errorCode);
    return {
      isPathViolation: true,
      path,
      errorCode,
      errorMessage,
    };
  }

  return { isPathViolation: false };
}

/**
 * Extract path from error message
 * Handles both SafeShell and Deno error formats
 *
 * SafeShell formats:
 * - PATH_VIOLATION: "Path '/etc/hosts' is outside allowed directories"
 * - SYMLINK_VIOLATION: "Symlink '/etc/hosts' points to '/private/etc/hosts' which is outside..."
 *
 * Deno format:
 * - NotCapable: "Requires read access to \"/etc/hosts\", run again with --allow-read"
 *
 * @param errorMessage - The error message to parse
 * @param errorCode - Optional error code to determine format
 * @returns Extracted path or "unknown"
 */
export function extractPathFromError(
  errorMessage: string,
  errorCode?: string,
): string {
  // Try Deno format first: Requires read/write access to "path"
  const denoMatch = errorMessage.match(/Requires (?:read|write) access to "([^"]+)"/);
  if (denoMatch) {
    return denoMatch[1]!;
  }

  // Try SafeShell format: Path/Symlink 'path'
  const pathMatch = errorMessage.match(/(?:Path|Symlink) '([^']+)'/);
  if (pathMatch) {
    let path = pathMatch[1]!;

    // For symlink violations, extract the real path instead
    if (errorCode === "SYMLINK_VIOLATION") {
      const realPathMatch = errorMessage.match(/points to '([^']+)'/);
      if (realPathMatch) {
        path = realPathMatch[1]!;
      }
    }

    return path;
  }

  return "unknown";
}

/**
 * Generate the permission prompt message for path violations
 *
 * Shows file and directory permission options with retry command
 *
 * @param path - The blocked path
 * @param pendingId - The pending request ID for retry
 * @returns Formatted permission prompt message
 */
export function generatePathPromptMessage(
  path: string,
  pendingId: string,
): string {
  const pathParts = path.split("/");
  const dirPath = pathParts.slice(0, -1).join("/") || "/";

  return `[SAFESH] PATH BLOCKED: ${path}

Choose permission (r=read, w=write, rw=both):
File only (add nothing):
  1. Allow once (r1, w1, rw1)
  2. Allow for session (r2, w2, rw2)
  3. Always allow (r3, w3, rw3)

Entire directory ${dirPath}/ (add 'd'):
  1. Allow once (r1d, w1d, rw1d)
  2. Allow for session (r2d, w2d, rw2d)
  3. Always allow (r3d, w3d, rw3d)

4. Deny

AFTER USER RESPONDS: desh retry-path --id=${pendingId} --choice=<user's choice>`;
}

/**
 * Handle path violation and exit
 * Creates pending file and shows permission prompt
 *
 * This function never returns (calls Deno.exit(1))
 *
 * @param error - The error object
 * @param options - Options including scriptHash and cwd
 */
export function handlePathViolationAndExit(
  error: unknown,
  options: { scriptHash?: string; cwd?: string },
): never {
  const violation = detectPathViolation(error);

  if (!violation.isPathViolation || !violation.path) {
    // Shouldn't happen if caller checked, but handle gracefully
    console.error("[SAFESH] Error detecting path violation");
    Deno.exit(1);
  }

  // Create pending path request
  const pendingId = `${Date.now()}-${Deno.pid}`;
  const pendingFile = `${getTempRoot()}/pending-path-${pendingId}.json`;
  const pending: PendingPathRequest = {
    id: pendingId,
    path: violation.path,
    operation: "read",
    cwd: options.cwd || Deno.cwd(),
    scriptHash: options.scriptHash || "",
    createdAt: new Date().toISOString(),
  };

  try {
    writeJsonFileSync(pendingFile, pending);
  } catch (e) {
    console.error("Warning: Could not write pending path file:", e);
  }

  // Show permission prompt
  const message = generatePathPromptMessage(violation.path, pendingId);
  console.error(message);
  Deno.exit(1);
}

/**
 * Options for creating an error handler
 */
export interface ErrorHandlerOptions {
  /** Prefix for the error message (e.g., "TypeScript Error", "Bash Command Error") */
  prefix: string;

  /** Path to error log file (optional, won't log to file if not provided) */
  errorLogPath?: string;

  /** Whether to include original command in error message */
  includeCommand?: boolean;

  /** Original command text (required if includeCommand is true) */
  originalCommand?: string;

  /** Transpiled TypeScript code (for detailed error logs) - SSH-475 */
  transpiledCode?: string;
}

/**
 * Create a reusable error handler function
 * Returns a function that handles errors consistently
 *
 * The returned function never returns (calls Deno.exit(1))
 *
 * @param options - Configuration for the error handler
 * @returns Error handler function
 */
export function createErrorHandler(
  options: ErrorHandlerOptions,
): (error: unknown) => never {
  return (error: unknown): never => {
    const err = error as any;
    const errorMessage = err?.message || String(error);
    const errorCode = err?.code || "";

    // Check if this is a path violation
    const violation = detectPathViolation(error);
    if (violation.isPathViolation && violation.path) {
      handlePathViolationAndExit(error, {
        scriptHash: Deno.env.get("SAFESH_SCRIPT_HASH"),
        cwd: Deno.cwd(),
      });
    }

    // Check if this is a command execution failure (not a SafeShell error)
    const isCommandFailure =
      errorMessage.includes("Pipeline failed: upstream command exited with code") ||
      errorMessage.includes("command exited with code") ||
      errorMessage.includes("Command failed with exit code");

    // Build error message
    const messageParts = [`=== ${options.prefix} ===`];

    if (options.includeCommand && options.originalCommand) {
      messageParts.push(`Command: ${options.originalCommand}`);
    }

    messageParts.push(`\nError: ${errorMessage}`);

    if (err?.stack) {
      messageParts.push(`\nStack trace:\n${err.stack}`);
    }

    const separator = "=".repeat(options.prefix.length + 8);
    messageParts.push(`${separator}\n`);

    const errorMsg = messageParts.join("\n");

    // Only log to file if it's a genuine SafeShell error and path provided
    if (!isCommandFailure && options.errorLogPath) {
      try {
        Deno.writeTextFileSync(options.errorLogPath, errorMsg);
        console.error(`\nError log: ${options.errorLogPath}`);
      } catch (e) {
        console.error("Warning: Could not write error log:", e);
      }
    }

    // Always output error to console
    console.error(errorMsg);
    Deno.exit(1);
  };
}

/**
 * Generate inline error handler code for embedding in scripts
 * Returns JavaScript code as a string that can be injected
 *
 * @param options - Options for the error handler
 * @param includeListeners - Whether to include global error listeners (default: true)
 * @returns JavaScript code as string
 */
export function generateInlineErrorHandler(
  options: ErrorHandlerOptions,
  includeListeners = true,
): string {
  // Escape command for embedding in template literal
  const escapedCommand = options.originalCommand?.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  // SSH-475: Escape transpiled code for embedding
  const escapedTranspiledCode = options.transpiledCode?.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

  const includeCommandCheck = options.includeCommand
    ? `  const fullCommand = ${escapedCommand ? `\`${escapedCommand}\`` : "__ORIGINAL_BASH_COMMAND__"};\n`
    : "";

  const commandInMessage = options.includeCommand
    ? `    "Command: " + ${escapedCommand ? `\`${escapedCommand}\`` : "fullCommand"},\n`
    : "";

  // SSH-475: Include transpiled code constant if provided
  const transpiledCodeConst = escapedTranspiledCode
    ? `const __TRANSPILED_CODE__ = \`${escapedTranspiledCode}\`;\n`
    : "";

  const handlerCode = `${transpiledCodeConst}const __handleError = (error) => {
${includeCommandCheck}  const errorMessage = error.message || String(error);
  const errorCode = error.code || "";

  // Check if this is a path permission error (SafeShell or Deno)
  const isPathViolation =
    errorCode === "PATH_VIOLATION" ||
    errorCode === "SYMLINK_VIOLATION" ||
    errorCode === "NotCapable" ||
    error?.name === "NotCapable" ||
    errorMessage.includes("is outside allowed directories") ||
    errorMessage.includes("outside allowed directories") ||
    errorMessage.includes("Requires read access to") ||
    errorMessage.includes("Requires write access to");

  if (isPathViolation) {
    let path = "unknown";
    const denoMatch = errorMessage.match(/Requires (?:read|write) access to "([^"]+)"/);
    if (denoMatch) {
      path = denoMatch[1];
    } else {
      const pathMatch = errorMessage.match(/(?:Path|Symlink) '([^']+)'/);
      if (pathMatch) {
        path = pathMatch[1];
        if (errorCode === "SYMLINK_VIOLATION") {
          const realPathMatch = errorMessage.match(/points to '([^']+)'/);
          if (realPathMatch) path = realPathMatch[1];
        }
      }
    }

    const pendingId = \`\${Date.now()}-\${Deno.pid}\`;
    const pendingFile = \`${getTempRoot()}/pending-path-\${pendingId}.json\`;
    const pending = {
      id: pendingId,
      path: path,
      operation: "read",
      cwd: Deno.cwd(),
      ${options.includeCommand ? "command: fullCommand," : 'scriptHash: Deno.env.get("SAFESH_SCRIPT_HASH") || "",'}
      createdAt: new Date().toISOString()
    };

    try {
      writeJsonFileSync(pendingFile, pending);
    } catch (e) {
      console.error("Warning: Could not write pending path file:", e);
    }

    const pathParts = path.split('/');
    const dirPath = pathParts.slice(0, -1).join('/') || '/';
    const message = \`[SAFESH] PATH BLOCKED: \${path}

Choose permission (r=read, w=write, rw=both):
File only (add nothing):
  1. Allow once (r1, w1, rw1)
  2. Allow for session (r2, w2, rw2)
  3. Always allow (r3, w3, rw3)

Entire directory \${dirPath}/ (add 'd'):
  1. Allow once (r1d, w1d, rw1d)
  2. Allow for session (r2d, w2d, rw2d)
  3. Always allow (r3d, w3d, rw3d)

4. Deny

AFTER USER RESPONDS: desh retry-path --id=\${pendingId} --choice=<user's choice>\`;

    console.error(message);
    Deno.exit(1);
  }

  const isCommandFailure =
    errorMessage.includes("Pipeline failed: upstream command exited with code") ||
    errorMessage.includes("command exited with code") ||
    errorMessage.includes("Command failed with exit code");

  // SSH-475: Build detailed error log with transpiled code if available
  const errorLogParts = [
    "=== Execution Error ===",
    ${options.includeCommand ? `"Original Bash Command:\\n" + ${escapedCommand ? `\`${escapedCommand}\`` : "fullCommand"}` : '""'},
    ${escapedTranspiledCode ? '"\\nTranspiled TypeScript:\\n" + __TRANSPILED_CODE__' : '""'},
    \`\\nError: \${errorMessage}\`,
    error.stack ? \`\\nStack trace:\\n\${error.stack}\` : "",
    "=========================\\n"
  ].filter(Boolean).join("\\n");

  // Console message is shorter
  const consoleMsg = [
    "=== ${options.prefix} ===",
${commandInMessage}    \`\\nError: \${errorMessage}\`,
    error.stack ? \`\\nStack trace:\\n\${error.stack}\` : "",
    "${"=".repeat(options.prefix.length + 8)}\\n"
  ].join("\\n");

  if (!isCommandFailure${options.errorLogPath ? ` && "${options.errorLogPath}"` : ""}) {
    ${options.errorLogPath ? `const errorFile = \`${options.errorLogPath}\`;` : ""}
    try {
      ${options.errorLogPath ? 'Deno.writeTextFileSync(errorFile, errorLogParts);' : ""}
      ${options.errorLogPath ? 'console.error(\`\\nFull details saved to: \${errorFile}\`);' : ""}
    } catch (e) {
      console.error("Warning: Could not write error log:", e);
    }
  }

  console.error(consoleMsg);
  Deno.exit(1);
};`;

  // Append global error listeners if requested
  if (includeListeners) {
    return handlerCode + `

// Global error handlers for uncaught errors
globalThis.addEventListener("error", (event) => {
  event.preventDefault();
  __handleError(event.error);
});

globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  __handleError(event.reason);
});
`;
  }

  return handlerCode;
}
