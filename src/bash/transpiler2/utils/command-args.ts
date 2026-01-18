/**
 * Command Argument Parsing Utilities
 *
 * Functions for parsing and processing command-line arguments in the transpiler.
 * These utilities help standardize argument parsing across different command handlers.
 */

/**
 * Parse the -n count argument from head/tail style commands.
 * Supports: -n 20, -n20, -20
 * @param args - Command arguments to parse
 * @param defaultValue - Default count value if no -n flag found
 * @returns The parsed count and remaining non-flag arguments (files)
 *
 * @example
 * parseCountArg(["-n", "20", "file.txt"]) // => { count: 20, files: ["file.txt"] }
 * parseCountArg(["-20", "file.txt"]) // => { count: 20, files: ["file.txt"] }
 * parseCountArg(["file.txt"]) // => { count: 10, files: ["file.txt"] }
 */
export function parseCountArg(args: string[], defaultValue = 10): { count: number; files: string[] } {
  let count = defaultValue;
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-n" && args[i + 1]) {
      // -n 20 (with space)
      count = parseInt(args[i + 1] ?? "") || defaultValue;
      i++; // Skip the next arg (the number)
    } else if (arg?.startsWith("-n")) {
      // -n20 (without space)
      count = parseInt(arg.slice(2)) || defaultValue;
    } else if (arg?.startsWith("-") && /^-\d+$/.test(arg)) {
      // -20 shorthand
      count = parseInt(arg.slice(1)) || defaultValue;
    } else if (arg && !arg.startsWith("-")) {
      // Non-flag argument - it's a file
      files.push(arg);
    }
  }
  return { count, files };
}

/**
 * Collect boolean flag options from command arguments.
 * Maps command-line flags to TypeScript option strings.
 *
 * @param args - Command arguments
 * @param flagMap - Map of flag to option string (e.g., { "-n": "numeric: true" })
 * @returns Array of option strings
 *
 * @example
 * collectFlagOptions(["-n", "-r"], { "-n": "numeric: true", "-r": "reverse: true" })
 * // => ["numeric: true", "reverse: true"]
 */
export function collectFlagOptions(args: string[], flagMap: Record<string, string>): string[] {
  const options: string[] = [];
  for (const arg of args) {
    if (arg && flagMap[arg]) {
      options.push(flagMap[arg]);
    }
  }
  return options;
}

/**
 * Collect boolean flag options and file arguments from command arguments.
 * Separates flags (which map to options) from file arguments.
 *
 * @param args - Command arguments
 * @param flagMap - Map of flag to option string (e.g., { "-l": "lines: true" })
 * @returns Object with options array and files array
 *
 * @example
 * collectFlagOptionsAndFiles(["-l", "file.txt"], { "-l": "lines: true" })
 * // => { options: ["lines: true"], files: ["file.txt"] }
 */
export function collectFlagOptionsAndFiles(
  args: string[],
  flagMap: Record<string, string>,
): { options: string[]; files: string[] } {
  const options: string[] = [];
  const files: string[] = [];
  for (const arg of args) {
    if (arg && flagMap[arg]) {
      options.push(flagMap[arg]);
    } else if (arg && !arg.startsWith("-")) {
      files.push(arg);
    }
  }
  return { options, files };
}
