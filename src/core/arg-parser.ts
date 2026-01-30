/**
 * Centralized Command Argument Parser
 *
 * A type-safe, flexible argument parser for command-line style arguments.
 * Handles boolean flags, value flags, short/long aliases, combined flags,
 * and positional arguments.
 *
 * @module
 */

/**
 * Type of a flag argument
 */
export type FlagType = "boolean" | "string" | "number";

/**
 * Definition of a single flag
 */
export interface FlagDefinition {
  /** Primary name for the flag (e.g., "ignoreCase") */
  name: string;

  /** Aliases for the flag (e.g., ["-i", "--ignore-case"]) */
  aliases?: string[];

  /** Type of value this flag accepts */
  type: FlagType;

  /** Default value if flag is not provided */
  default?: boolean | string | number;

  /** Human-readable description */
  description?: string;

  /** For number/string flags: allow the value to be attached (e.g., "-n10" or "-n 10") */
  allowAttached?: boolean;
}

/**
 * Result of parsing arguments
 */
export interface ParseResult<T = Record<string, unknown>> {
  /** Parsed flag values */
  flags: T;

  /** Positional arguments (non-flag arguments) */
  positional: string[];

  /** Parsing errors, if any */
  errors: string[];
}

/**
 * Options for the parser
 */
export interface ParserOptions {
  /** Allow combined short flags like "-abc" = "-a -b -c" */
  allowCombinedFlags?: boolean;

  /** Stop parsing flags after "--" */
  stopAtDoubleDash?: boolean;

  /** Allow flags after positional arguments */
  allowFlagsAfterPositional?: boolean;
}

/**
 * Parse command-line style arguments
 *
 * @param args - Array of argument strings to parse
 * @param definitions - Array of flag definitions
 * @param options - Parser options
 * @returns Parse result with flags, positional args, and errors
 *
 * @example
 * ```ts
 * const defs: FlagDefinition[] = [
 *   { name: "ignoreCase", aliases: ["-i", "--ignore-case"], type: "boolean", default: false },
 *   { name: "count", aliases: ["-n", "--count"], type: "number", default: 10, allowAttached: true },
 * ];
 *
 * const result = parseArgs(["-i", "-n", "5", "file.txt"], defs);
 * // result.flags = { ignoreCase: true, count: 5 }
 * // result.positional = ["file.txt"]
 * ```
 */
export function parseArgs<T = Record<string, unknown>>(
  args: string[],
  definitions: FlagDefinition[],
  options: ParserOptions = {},
): ParseResult<T> {
  const {
    allowCombinedFlags = true,
    stopAtDoubleDash = true,
    allowFlagsAfterPositional = true,
  } = options;

  // Build lookup maps
  const aliasToName = new Map<string, string>();
  const defsByName = new Map<string, FlagDefinition>();

  for (const def of definitions) {
    defsByName.set(def.name, def);
    if (def.aliases) {
      for (const alias of def.aliases) {
        aliasToName.set(alias, def.name);
      }
    }
  }

  // Initialize result with defaults
  const flags: Record<string, unknown> = {};
  for (const def of definitions) {
    if (def.default !== undefined) {
      flags[def.name] = def.default;
    }
  }

  const positional: string[] = [];
  const errors: string[] = [];
  let stopParsingFlags = false;
  let seenPositional = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue; // Skip undefined/empty

    // Handle double dash
    if (arg === "--") {
      if (stopAtDoubleDash) {
        stopParsingFlags = true;
        continue;
      } else {
        // Treat -- as a positional argument when stopAtDoubleDash is false
        positional.push(arg);
        seenPositional = true;
        continue;
      }
    }

    // If we've stopped parsing flags, everything is positional
    if (stopParsingFlags) {
      positional.push(arg);
      continue;
    }

    // Check if this looks like a flag
    if (arg.startsWith("-")) {
      // Don't parse flags after positional unless allowed
      if (seenPositional && !allowFlagsAfterPositional) {
        positional.push(arg);
        continue;
      }

      // Try to resolve the flag
      const parsed = parseFlag(arg, args, i, aliasToName, defsByName, allowCombinedFlags);

      if (parsed.error) {
        errors.push(parsed.error);
      }

      if (parsed.consumed > 0) {
        i += parsed.consumed - 1; // -1 because loop will increment
      }

      // Apply parsed flags
      for (const [name, value] of Object.entries(parsed.flags)) {
        flags[name] = value;
      }
    } else {
      // Positional argument
      positional.push(arg);
      seenPositional = true;
    }
  }

  return {
    flags: flags as T,
    positional,
    errors,
  };
}

/**
 * Result of parsing a single flag
 */
interface FlagParseResult {
  /** Parsed flag values */
  flags: Record<string, unknown>;

  /** Number of arguments consumed (including the flag itself) */
  consumed: number;

  /** Error message if parsing failed */
  error?: string;
}

/**
 * Parse a single flag argument
 */
function parseFlag(
  arg: string,
  allArgs: string[],
  currentIndex: number,
  aliasToName: Map<string, string>,
  defsByName: Map<string, FlagDefinition>,
  allowCombinedFlags: boolean,
): FlagParseResult {
  // Check for long flag (--foo or --foo=value)
  if (arg.startsWith("--")) {
    return parseLongFlag(arg, allArgs, currentIndex, aliasToName, defsByName);
  }

  // Short flag (single dash)
  return parseShortFlag(arg, allArgs, currentIndex, aliasToName, defsByName, allowCombinedFlags);
}

/**
 * Parse a long flag like "--ignore-case" or "--count=5"
 */
function parseLongFlag(
  arg: string,
  allArgs: string[],
  currentIndex: number,
  aliasToName: Map<string, string>,
  defsByName: Map<string, FlagDefinition>,
): FlagParseResult {
  // Check for --flag=value format
  const eqIndex = arg.indexOf("=");
  let flagPart = arg;
  let valuePart: string | undefined;

  if (eqIndex > 0) {
    flagPart = arg.slice(0, eqIndex);
    valuePart = arg.slice(eqIndex + 1);
  }

  const name = aliasToName.get(flagPart);
  if (!name) {
    return {
      flags: {},
      consumed: 1,
      error: `Unknown flag: ${flagPart}`,
    };
  }

  const def = defsByName.get(name)!;

  if (def.type === "boolean") {
    if (valuePart !== undefined) {
      return {
        flags: {},
        consumed: 1,
        error: `Boolean flag ${flagPart} does not accept a value`,
      };
    }
    return {
      flags: { [name]: true },
      consumed: 1,
    };
  }

  // String or number flag
  if (valuePart !== undefined) {
    // Value was provided with =
    const parsed = parseValue(valuePart, def.type);
    if (parsed.error) {
      return {
        flags: {},
        consumed: 1,
        error: `Invalid value for ${flagPart}: ${parsed.error}`,
      };
    }
    return {
      flags: { [name]: parsed.value },
      consumed: 1,
    };
  }

  // Value should be in next argument
  const nextArg = allArgs[currentIndex + 1];
  if (nextArg === undefined || nextArg.startsWith("-")) {
    return {
      flags: {},
      consumed: 1,
      error: `Flag ${flagPart} requires a value`,
    };
  }

  const parsed = parseValue(nextArg, def.type);
  if (parsed.error) {
    return {
      flags: {},
      consumed: 2,
      error: `Invalid value for ${flagPart}: ${parsed.error}`,
    };
  }

  return {
    flags: { [name]: parsed.value },
    consumed: 2,
  };
}

/**
 * Parse short flags like "-i", "-n5", or "-abc"
 */
function parseShortFlag(
  arg: string,
  allArgs: string[],
  currentIndex: number,
  aliasToName: Map<string, string>,
  defsByName: Map<string, FlagDefinition>,
  allowCombinedFlags: boolean,
): FlagParseResult {
  // Try exact match first (e.g., "-n", "-10")
  const name = aliasToName.get(arg);
  if (name) {
    const def = defsByName.get(name)!;

    if (def.type === "boolean") {
      return {
        flags: { [name]: true },
        consumed: 1,
      };
    }

    // Need a value
    const nextArg = allArgs[currentIndex + 1];
    if (nextArg === undefined || nextArg.startsWith("-")) {
      return {
        flags: {},
        consumed: 1,
        error: `Flag ${arg} requires a value`,
      };
    }

    const parsed = parseValue(nextArg, def.type);
    if (parsed.error) {
      return {
        flags: {},
        consumed: 2,
        error: `Invalid value for ${arg}: ${parsed.error}`,
      };
    }

    return {
      flags: { [name]: parsed.value },
      consumed: 2,
    };
  }

  // Check if it's a flag with attached value (e.g., "-n10", "-A3")
  if (arg.length > 2) {
    const prefix = arg.slice(0, 2);
    const suffix = arg.slice(2);
    const prefixName = aliasToName.get(prefix);

    if (prefixName) {
      const def = defsByName.get(prefixName)!;
      if (def.allowAttached && (def.type === "number" || def.type === "string")) {
        const parsed = parseValue(suffix, def.type);
        if (!parsed.error) {
          return {
            flags: { [prefixName]: parsed.value },
            consumed: 1,
          };
        }
      }
    }
  }

  // Check for special numeric shorthand like "-10" (common for head/tail)
  if (/^-\d+$/.test(arg)) {
    // This is a special case - just return as unknown for now
    // Commands like head/tail handle this specially
    return {
      flags: {},
      consumed: 1,
      error: `Unknown flag: ${arg} (numeric shorthand may need special handling)`,
    };
  }

  // Try combined boolean flags (e.g., "-abc" = "-a -b -c")
  if (allowCombinedFlags && arg.length > 2) {
    const flags: Record<string, unknown> = {};
    let hasError = false;

    for (let i = 1; i < arg.length; i++) {
      const char = `-${arg[i]}`;
      const charName = aliasToName.get(char);

      if (!charName) {
        return {
          flags: {},
          consumed: 1,
          error: `Unknown flag in combined flags: ${char} (from ${arg})`,
        };
      }

      const def = defsByName.get(charName)!;
      if (def.type !== "boolean") {
        return {
          flags: {},
          consumed: 1,
          error: `Non-boolean flag ${char} cannot be combined (from ${arg})`,
        };
      }

      flags[charName] = true;
    }

    if (!hasError) {
      return {
        flags,
        consumed: 1,
      };
    }
  }

  return {
    flags: {},
    consumed: 1,
    error: `Unknown flag: ${arg}`,
  };
}

/**
 * Parse a value string to the specified type
 */
function parseValue(
  value: string,
  type: FlagType,
): { value?: string | number; error?: string } {
  if (type === "string") {
    return { value };
  }

  if (type === "number") {
    const num = Number(value);
    if (Number.isNaN(num)) {
      return { error: `Expected number, got "${value}"` };
    }
    return { value: num };
  }

  return { error: `Invalid type: ${type}` };
}

/**
 * Helper to create a simple parser for common command patterns
 *
 * @example
 * ```ts
 * const parser = createParser([
 *   { name: "ignoreCase", aliases: ["-i"], type: "boolean" },
 *   { name: "count", aliases: ["-n"], type: "number", allowAttached: true },
 * ]);
 *
 * const result = parser(["-i", "-n5", "file.txt"]);
 * ```
 */
export function createParser<T = Record<string, unknown>>(
  definitions: FlagDefinition[],
  options?: ParserOptions,
) {
  return (args: string[]): ParseResult<T> => {
    return parseArgs<T>(args, definitions, options);
  };
}
