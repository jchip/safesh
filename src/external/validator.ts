/**
 * Command and flag validation for external commands
 *
 * Validates external commands against the whitelist registry.
 * Checks subcommands, flags, and required arguments.
 */

import type { ExternalCommandConfig, SafeShellConfig } from "../core/types.ts";
import {
  commandNotWhitelisted,
  flagNotAllowed,
  SafeShellError,
  subcommandNotAllowed,
} from "../core/errors.ts";
import { CommandRegistry, normalizeCommand } from "./registry.ts";
import { validatePathArgs } from "./path_validator.ts";

/**
 * Result of command validation
 */
export interface ValidationResult {
  /** Whether the command is valid */
  valid: boolean;
  /** Error if validation failed */
  error?: SafeShellError;
  /** The normalized command name */
  command: string;
  /** The detected subcommand (if any) */
  subcommand?: string;
  /** Flags found in the arguments */
  flags: string[];
}

/**
 * Parse flags from command arguments
 * Returns both short (-f) and long (--flag) flags
 */
export function parseFlags(args: string[]): string[] {
  const flags: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      // Long flag: --flag or --flag=value
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        flags.push(arg.substring(0, eqIndex));
      } else {
        flags.push(arg);
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // Short flag: -f or combined -abc
      // For combined flags like -abc, we add each character as a flag
      if (arg.length === 2) {
        flags.push(arg);
      } else {
        // Could be combined flags or a value like -o123
        // We'll treat -abc as -a, -b, -c
        for (let i = 1; i < arg.length; i++) {
          const char = arg[i];
          if (char && /[a-zA-Z]/.test(char)) {
            flags.push(`-${char}`);
          } else {
            // Non-letter means it's probably a value, stop
            break;
          }
        }
      }
    }
  }

  return flags;
}

/**
 * Get the subcommand from arguments
 * Subcommand is the first non-flag argument
 */
export function getSubcommand(args: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return undefined;
}

/**
 * Check if a flag is denied
 */
export function isFlagDenied(flag: string, denyFlags: string[]): boolean {
  // Normalize flag for comparison
  const normalizedFlag = flag.toLowerCase();

  for (const denied of denyFlags) {
    const normalizedDenied = denied.toLowerCase();

    // Exact match
    if (normalizedFlag === normalizedDenied) {
      return true;
    }

    // Handle --flag and -f equivalence for common patterns
    // e.g., --force matches -f if both are in denyFlags
  }

  return false;
}

/**
 * Check if all required flags are present
 */
export function hasRequiredFlags(
  flags: string[],
  requireFlags: string[],
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const required of requireFlags) {
    const normalizedRequired = required.toLowerCase();
    const found = flags.some((f) => f.toLowerCase() === normalizedRequired);

    if (!found) {
      missing.push(required);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Validate an external command
 */
export function validateCommand(
  command: string,
  args: string[],
  registry: CommandRegistry,
): ValidationResult {
  const normalizedCmd = normalizeCommand(command);

  // Check if command is whitelisted
  const config = registry.get(normalizedCmd);
  if (!config) {
    return {
      valid: false,
      error: commandNotWhitelisted(normalizedCmd),
      command: normalizedCmd,
      flags: [],
    };
  }

  // Parse flags and subcommand
  const flags = parseFlags(args);
  const subcommand = getSubcommand(args);

  // Check subcommand if allow is a list
  if (Array.isArray(config.allow)) {
    if (!subcommand) {
      return {
        valid: false,
        error: subcommandNotAllowed(normalizedCmd, "(none)", config.allow),
        command: normalizedCmd,
        flags,
      };
    }

    if (!config.allow.includes(subcommand)) {
      return {
        valid: false,
        error: subcommandNotAllowed(normalizedCmd, subcommand, config.allow),
        command: normalizedCmd,
        subcommand,
        flags,
      };
    }
  }

  // Check for denied flags
  if (config.denyFlags && config.denyFlags.length > 0) {
    for (const flag of flags) {
      if (isFlagDenied(flag, config.denyFlags)) {
        return {
          valid: false,
          error: flagNotAllowed(normalizedCmd, flag, config.denyFlags),
          command: normalizedCmd,
          subcommand,
          flags,
        };
      }
    }
  }

  // Check for required flags
  if (config.requireFlags && config.requireFlags.length > 0) {
    const { valid, missing } = hasRequiredFlags(flags, config.requireFlags);
    if (!valid) {
      return {
        valid: false,
        error: new SafeShellError(
          "FLAG_NOT_ALLOWED",
          `Required flag(s) missing for '${normalizedCmd}': ${missing.join(", ")}`,
          { command: normalizedCmd, allowed: config.requireFlags },
          `Add the required flag(s): ${missing.join(", ")}`,
        ),
        command: normalizedCmd,
        subcommand,
        flags,
      };
    }
  }

  return {
    valid: true,
    command: normalizedCmd,
    subcommand,
    flags,
  };
}

/**
 * Full validation including path arguments
 * Combines command validation with path argument validation
 */
export async function validateExternal(
  command: string,
  args: string[],
  registry: CommandRegistry,
  config: SafeShellConfig,
  cwd: string,
): Promise<ValidationResult> {
  // First validate the command itself
  const result = validateCommand(command, args, registry);

  if (!result.valid) {
    return result;
  }

  // Then validate path arguments
  const cmdConfig = registry.get(result.command);
  try {
    await validatePathArgs(args, command, config, cwd, cmdConfig);
  } catch (error) {
    if (error instanceof SafeShellError) {
      return {
        ...result,
        valid: false,
        error,
      };
    }
    throw error;
  }

  return result;
}
