/**
 * echo command - display a line of text
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { parseOptions } from "./common.ts";

/**
 * Options for echo command
 */
export interface EchoOptions {
  /** Do not output trailing newline */
  noNewline?: boolean;
  /** Interpret backslash escapes */
  escapes?: boolean;
}

/**
 * Display text
 *
 * @param args - Text to display
 * @returns ShellString with the text
 *
 * @example
 * ```ts
 * echo("Hello, World!");
 * echo("No newline", { noNewline: true });
 * echo("Tab:\\there", { escapes: true });
 * ```
 */
export function echo(
  ...args: string[]
): ShellString;
export function echo(
  options: EchoOptions,
  ...args: string[]
): ShellString;
export function echo(
  first: string | EchoOptions,
  ...rest: string[]
): ShellString {
  let options: EchoOptions = {};
  let text: string[];

  if (typeof first === "object" && first !== null && !Array.isArray(first)) {
    options = first;
    text = rest;
  } else {
    text = [first as string, ...rest];
  }

  let output = text.join(" ");

  // Handle escape sequences if requested
  if (options.escapes) {
    output = interpretEscapes(output);
  }

  // Add newline unless -n is specified
  if (!options.noNewline) {
    output += "\n";
  }

  // Actually print to stdout (like real echo)
  if (options.noNewline) {
    Deno.stdout.writeSync(new TextEncoder().encode(output));
  } else {
    console.log(output.slice(0, -1)); // remove trailing newline, console.log adds one
  }

  return ShellString.ok(output);
}

/**
 * Interpret backslash escape sequences
 */
function interpretEscapes(str: string): string {
  // Single-pass replacement to handle ordering correctly
  // (e.g., \\\\ must be consumed before \\n can match the second \\)
  return str.replace(
    /\\\\|\\n|\\t|\\r|\\b|\\f|\\v|\\a|\\0([0-7]{1,3})?|\\x([0-9a-fA-F]{1,2})/g,
    (match, oct?: string, hex?: string) => {
      switch (match) {
        case "\\\\": return "\\";
        case "\\n": return "\n";
        case "\\t": return "\t";
        case "\\r": return "\r";
        case "\\b": return "\b";
        case "\\f": return "\f";
        case "\\v": return "\v";
        case "\\a": return "\x07";
        default:
          if (hex !== undefined) {
            return String.fromCharCode(parseInt(hex, 16));
          }
          // Octal: \0 or \0NNN
          return String.fromCharCode(parseInt(oct || "0", 8));
      }
    },
  );
}

/**
 * Parse echo options from command-line style
 */
export function parseEchoOptions(
  opts: string | Record<string, unknown>,
): EchoOptions {
  const parsed = parseOptions(opts, {
    n: "noNewline",
    e: "escapes",
    E: "!escapes", // disable escapes (default)
  });

  return {
    noNewline: parsed.noNewline as boolean,
    escapes: parsed.escapes as boolean,
  };
}
