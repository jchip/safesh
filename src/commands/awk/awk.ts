/**
 * AWK - Text Processing Language Implementation
 *
 * A pure TypeScript implementation of the AWK programming language.
 * Supports pattern-action rules, built-in variables, functions, and more.
 */

import { createStream, type Stream, type Transform } from "../../stdlib/stream.ts";
import { AwkParser } from "./parser.ts";
import { AwkInterpreter } from "./interpreter/interpreter.ts";
import { createRuntimeContext, type CreateContextOptions } from "./interpreter/context.ts";

// =============================================================================
// Options and Result Types
// =============================================================================

/**
 * Options for AWK execution
 */
export interface AwkOptions {
  /** Field separator (default: whitespace) (-F flag) */
  fieldSeparator?: string | RegExp;
  /** Output field separator (default: space) */
  ofs?: string;
  /** Output record separator (default: newline) */
  ors?: string;
  /** Record separator (default: newline) */
  rs?: string;
  /** Variable assignments (-v var=value) */
  variables?: Record<string, string | number>;
  /** Execution limits */
  limits?: CreateContextOptions["limits"];
  /** File system interface (for getline, etc.) */
  fileSystem?: CreateContextOptions["fs"];
}

/**
 * Result from AWK execution
 */
export interface AwkResult {
  /** Output text */
  output: string;
  /** Exit code (0 for success, non-zero for errors) */
  exitCode: number;
}

// =============================================================================
// Core Processing
// =============================================================================

/**
 * Execute AWK program on input string
 */
export async function awkExec(
  script: string,
  input: string,
  options: AwkOptions = {},
): Promise<AwkResult> {
  try {
    // Parse the AWK program
    const parser = new AwkParser();
    const program = parser.parse(script);

    // Create runtime context
    const ctx = createRuntimeContext({
      limits: options.limits,
      fs: options.fileSystem,
    });

    // Apply options
    if (options.fieldSeparator !== undefined) {
      ctx.FS = options.fieldSeparator;
    }
    if (options.ofs !== undefined) {
      ctx.OFS = options.ofs;
    }
    if (options.ors !== undefined) {
      ctx.ORS = options.ors;
    }
    if (options.rs !== undefined) {
      ctx.RS = options.rs;
    }

    // Set user variables
    if (options.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        ctx.vars.set(key, value);
      }
    }

    // Create interpreter and execute
    const interpreter = new AwkInterpreter(ctx);
    interpreter.execute(program);

    // Execute BEGIN blocks
    await interpreter.executeBegin();

    // Process input lines
    const lines = input.split(typeof ctx.RS === "string" ? ctx.RS : /\n/);

    for (const line of lines) {
      if (ctx.shouldExit) break;

      // Skip empty lines at end
      if (line === "" && lines.indexOf(line) === lines.length - 1) {
        continue;
      }

      await interpreter.executeLine(line);

      if (ctx.shouldNextFile) {
        ctx.shouldNextFile = false;
        break;
      }
    }

    // Execute END blocks
    await interpreter.executeEnd();

    // Get output
    const output = interpreter.getOutput();

    return {
      output,
      exitCode: ctx.exitCode ?? 0,
    };
  } catch (error) {
    return {
      output: `AWK error: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

// =============================================================================
// Stream API
// =============================================================================

/**
 * Create an AWK transform for stream processing
 */
export function awk(
  script: string,
  options: AwkOptions = {},
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    // Collect all input
    let content = "";
    for await (const chunk of stream) {
      content += chunk;
    }

    // Execute AWK
    const result = await awkExec(script, content, options);

    // Yield output lines
    const lines = result.output.split("\n");
    for (const line of lines) {
      if (line !== "" || lines.indexOf(line) !== lines.length - 1) {
        yield line;
      }
    }
  };
}

/**
 * Create an AWK transform that yields each line separately
 */
export function awkTransform(
  script: string,
  options: AwkOptions = {},
): Transform<string, string> {
  let buffer = "";

  return async function* (stream: AsyncIterable<string>) {
    for await (const chunk of stream) {
      buffer += chunk;
    }

    const result = await awkExec(script, buffer, options);
    const lines = result.output.split("\n");

    for (const line of lines) {
      if (line !== "") {
        yield line;
      }
    }
  };
}

/**
 * Default export for convenient usage
 */
export default {
  awk,
  awkExec,
  awkTransform,
};
