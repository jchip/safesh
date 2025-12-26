/**
 * SafeShell error types with AI-friendly messages
 */

export type ErrorCode =
  | "PERMISSION_DENIED"
  | "COMMAND_NOT_WHITELISTED"
  | "SUBCOMMAND_NOT_ALLOWED"
  | "FLAG_NOT_ALLOWED"
  | "PATH_VIOLATION"
  | "SYMLINK_VIOLATION"
  | "TIMEOUT"
  | "EXECUTION_ERROR"
  | "CONFIG_ERROR"
  | "IMPORT_NOT_ALLOWED";

export interface ErrorDetails {
  command?: string;
  subcommand?: string;
  flag?: string;
  path?: string;
  realPath?: string;
  allowed?: string[];
  denied?: string[];
  import?: string;
}

export class SafeShellError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetails,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "SafeShellError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      suggestion: this.suggestion,
    };
  }
}

// Factory functions for common errors

export function permissionDenied(
  permission: string,
  path?: string,
  allowed?: string[],
): SafeShellError {
  return new SafeShellError(
    "PERMISSION_DENIED",
    `Permission denied: ${permission}${path ? ` for '${path}'` : ""}`,
    { path, allowed },
    allowed?.length
      ? `Allowed paths: ${allowed.join(", ")}`
      : "Check your safesh.config.ts permissions",
  );
}

export function commandNotWhitelisted(command: string): SafeShellError {
  return new SafeShellError(
    "COMMAND_NOT_WHITELISTED",
    `Command '${command}' is not whitelisted`,
    { command },
    `Add '${command}' to external commands in safesh.config.ts, or use exec() with JS/TS code instead`,
  );
}

export function subcommandNotAllowed(
  command: string,
  subcommand: string,
  allowed: string[],
): SafeShellError {
  return new SafeShellError(
    "SUBCOMMAND_NOT_ALLOWED",
    `Subcommand '${subcommand}' is not allowed for '${command}'`,
    { command, subcommand, allowed },
    `Allowed subcommands: ${allowed.join(", ")}`,
  );
}

export function flagNotAllowed(
  command: string,
  flag: string,
  denied: string[],
): SafeShellError {
  return new SafeShellError(
    "FLAG_NOT_ALLOWED",
    `Flag '${flag}' is not allowed for '${command}'`,
    { command, flag, denied },
    `Denied flags: ${denied.join(", ")}. Remove the flag or ask user for approval.`,
  );
}

export function pathViolation(
  path: string,
  allowed: string[],
  realPath?: string,
): SafeShellError {
  const msg = realPath && realPath !== path
    ? `Path '${path}' resolves to '${realPath}' which is outside allowed directories`
    : `Path '${path}' is outside allowed directories`;

  return new SafeShellError(
    "PATH_VIOLATION",
    msg,
    { path, realPath, allowed },
    `Allowed directories: ${allowed.join(", ")}`,
  );
}

export function symlinkViolation(
  path: string,
  realPath: string,
  allowed: string[],
): SafeShellError {
  return new SafeShellError(
    "SYMLINK_VIOLATION",
    `Symlink '${path}' points to '${realPath}' which is outside allowed directories`,
    { path, realPath, allowed },
    "Symlinks must resolve to paths within allowed directories",
  );
}

export function timeout(ms: number, command?: string): SafeShellError {
  return new SafeShellError(
    "TIMEOUT",
    `Execution timed out after ${ms}ms${command ? ` for '${command}'` : ""}`,
    { command },
    "Increase timeout or optimize the operation",
  );
}

export function executionError(message: string, details?: ErrorDetails): SafeShellError {
  return new SafeShellError(
    "EXECUTION_ERROR",
    message,
    details,
  );
}

export function configError(message: string): SafeShellError {
  return new SafeShellError(
    "CONFIG_ERROR",
    message,
    undefined,
    "Check your safesh.config.ts file",
  );
}

export function importNotAllowed(importPath: string, blocked: string[]): SafeShellError {
  return new SafeShellError(
    "IMPORT_NOT_ALLOWED",
    `Import '${importPath}' is not allowed`,
    { import: importPath, denied: blocked },
    "Use imports from jsr:@std/* or safesh:* instead",
  );
}

export function importError(
  importPath: string,
  blocked: string[],
  allowed: string[],
): SafeShellError {
  return new SafeShellError(
    "IMPORT_NOT_ALLOWED",
    `Import '${importPath}' matches blocked pattern and is not in the allowed list`,
    { import: importPath, denied: blocked, allowed },
    `Blocked patterns: ${blocked.join(", ")}. Allowed patterns: ${allowed.join(", ")}. Add to imports.allowed in safesh.config.ts if needed.`,
  );
}
