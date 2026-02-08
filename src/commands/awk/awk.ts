/**
 * AWK - Text Processing Language Implementation
 *
 * A pure TypeScript implementation of the AWK programming language.
 * Supports pattern-action rules, built-in variables, functions, and more.
 */

import type { Transform } from "../../stdlib/stream.ts";
import { AwkParser } from "./parser.ts";
import { AwkInterpreter } from "./interpreter/interpreter.ts";
import { ExecutionLimitError } from "./interpreter/expressions.ts";
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
  /** Max iterations for loops */
  maxIterations?: number;
  /** Max recursion depth */
  maxRecursionDepth?: number;
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
      maxIterations: options.maxIterations,
      maxRecursionDepth: options.maxRecursionDepth,
      fs: options.fileSystem,
      fieldSep: typeof options.fieldSeparator === "string"
        ? new RegExp(options.fieldSeparator)
        : options.fieldSeparator,
    });

    // Apply options
    if (options.fieldSeparator !== undefined) {
      ctx.FS = typeof options.fieldSeparator === "string"
        ? options.fieldSeparator
        : options.fieldSeparator.source;
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
        ctx.vars[key] = value;
      }
    }

    // Create interpreter and initialize
    const interpreter = new AwkInterpreter(ctx);
    interpreter.initialize(program);

    // Execute BEGIN blocks
    await interpreter.executeBegin();

    // After BEGIN blocks, read RS from context (may have been changed in BEGIN)
    const rs = ctx.RS;
    const lines = input.split(rs);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (ctx.shouldExit) break;

      // Skip empty trailing line from split
      if (line === "" && i === lines.length - 1) {
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
    if (error instanceof ExecutionLimitError) {
      return {
        output: error.partialOutput,
        exitCode: 2,
      };
    }
    return {
      output: "AWK error: " + (error instanceof Error ? error.message : String(error)),
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
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line !== "" || i !== lines.length - 1) {
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

    // Only skip the very last empty line from split, not all empty lines
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== "" || i !== lines.length - 1) {
        yield lines[i]!;
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
