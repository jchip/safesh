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

  return ShellString.ok(output);
}

/**
 * Interpret backslash escape sequences
 */
function interpretEscapes(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\v/g, "\v")
    .replace(/\\a/g, "\x07") // alert/bell
    .replace(/\\\\/g, "\\")
    .replace(/\\0([0-7]{1,3})?/g, (_, oct) => {
      // Octal escape
      return String.fromCharCode(parseInt(oct || "0", 8));
    })
    .replace(/\\x([0-9a-fA-F]{1,2})/g, (_, hex) => {
      // Hex escape
      return String.fromCharCode(parseInt(hex, 16));
    });
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
