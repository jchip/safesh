/**
 * jq - JSON Query Command
 *
 * A command-line JSON processor inspired by jq.
 * Query and manipulate JSON data using a simple query language.
 *
 * @module
 */

import type { Transform } from "../../stdlib/stream.ts";
import { executeQuery, isIterationResult, type JsonValue, type QueryResult } from "./query-engine.ts";

// =============================================================================
// Options and Result Types
// =============================================================================

/**
 * Options for jq execution
 */
export interface JqOptions {
  /** Raw output (no JSON encoding for strings) */
  raw?: boolean;
  /** Compact output (no pretty printing) */
  compact?: boolean;
  /** Exit with error if query fails */
  exitOnError?: boolean;
  /** Null input (don't read input, just execute query) */
  nullInput?: boolean;
  /** Slurp mode (read entire input as array) */
  slurp?: boolean;
  /** Sort object keys in output */
  sortKeys?: boolean;
}

/**
 * Result from jq execution
 */
export interface JqResult {
  /** Output text */
  output: string;
  /** Exit code (0 for success, non-zero for errors) */
  exitCode: number;
  /** Error message if any */
  error?: string;
}

// =============================================================================
// Core Processing
// =============================================================================

/**
 * Format a JSON value for output
 */
function formatOutput(
  value: JsonValue,
  options: JqOptions = {},
): string {
  // Raw output for strings
  if (options.raw && typeof value === "string") {
    return value;
  }

  // JSON output
  if (options.compact) {
    return JSON.stringify(value, options.sortKeys ? sortKeysReplacer : undefined);
  } else {
    return JSON.stringify(value, options.sortKeys ? sortKeysReplacer : undefined, 2);
  }
}

/**
 * Replacer function for sorting object keys
 */
function sortKeysReplacer(_key: string, value: JsonValue): JsonValue {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const val = (value as Record<string, JsonValue>)[key];
      if (val !== undefined) {
        sorted[key] = val;
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Execute jq query on input string
 *
 * @param query - jq query expression
 * @param input - JSON input string
 * @param options - Execution options
 * @returns Execution result
 */
export async function jqExec(
  query: string,
  input: string,
  options: JqOptions = {},
): Promise<JqResult> {
  try {
    let data: JsonValue;

    // Handle null input mode
    if (options.nullInput) {
      data = null;
    } else {
      // Parse input JSON
      const trimmedInput = input.trim();
      if (!trimmedInput) {
        return {
          output: "",
          exitCode: 0,
        };
      }

      // Handle slurp mode - collect all JSON values into array
      if (options.slurp) {
        let values: JsonValue[];
        try {
          const parsed = JSON.parse(trimmedInput);
          values = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          values = [];
          const lines = trimmedInput.split("\n");
          for (const line of lines) {
            if (line.trim()) {
              try {
                values.push(JSON.parse(line));
              } catch { /* skip */ }
            }
          }
        }
        data = values;
      } else {
        data = JSON.parse(trimmedInput);
      }
    }

    // Execute query
    const result = executeQuery(data, query);

    // Format output
    let output: string;
    if (isIterationResult(result)) {
      // Iteration result - output each value on a separate line
      if (result.values.length === 0) {
        output = "";
      } else {
        const lines = result.values.map((item) => formatOutput(item, options));
        output = lines.join("\n");
      }
    } else {
      // Single value (including arrays that are single values like keys, slice, etc.)
      output = formatOutput(result as JsonValue, options);
    }

    return {
      output,
      exitCode: 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (options.exitOnError) {
      return {
        output: "",
        exitCode: 1,
        error: errorMsg,
      };
    }

    return {
      output: `jq error: ${errorMsg}`,
      exitCode: 1,
      error: errorMsg,
    };
  }
}

// =============================================================================
// Stream API
// =============================================================================

/**
 * Create a jq transform for stream processing
 *
 * Processes each line of input as JSON and applies the query.
 * If a line produces multiple results, each is yielded separately.
 *
 * @param query - jq query expression
 * @param options - Execution options
 * @returns Transform function
 *
 * @example
 * ```ts
 * // Extract names from JSON objects
 * await cat("users.json")
 *   .pipe(lines())
 *   .pipe(jq(".name"))
 *   .collect();
 *
 * // Filter and transform
 * await cat("data.json")
 *   .pipe(lines())
 *   .pipe(jq('select(.age > 18) | .name'))
 *   .collect();
 * ```
 */
export function jq(
  query: string,
  options: JqOptions = {},
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    let buffer = "";

    for await (const chunk of stream) {
      buffer += chunk;
    }

    // Process the accumulated input
    const result = await jqExec(query, buffer, options);

    if (result.exitCode !== 0 && options.exitOnError) {
      throw new Error(result.error || "jq execution failed");
    }

    // Yield output lines
    if (result.output) {
      const lines = result.output.split("\n");
      for (const line of lines) {
        if (line || lines.length === 1) {
          yield line;
        }
      }
    }
  };
}

/**
 * Create a jq transform that yields each result line separately
 *
 * Similar to jq() but ensures each output line is yielded individually,
 * suitable for line-by-line processing pipelines.
 *
 * @param query - jq query expression
 * @param options - Execution options
 * @returns Transform function
 */
export function jqTransform(
  query: string,
  options: JqOptions = {},
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    // Collect all input
    let content = "";
    for await (const chunk of stream) {
      content += chunk;
    }

    // Execute jq
    const result = await jqExec(query, content, options);

    if (result.exitCode !== 0 && options.exitOnError) {
      throw new Error(result.error || "jq execution failed");
    }

    // Yield each line separately
    const lines = result.output.split("\n");
    for (const line of lines) {
      if (line !== "") {
        yield line;
      }
    }
  };
}

/**
 * Process JSON lines - convenience function for line-by-line JSON processing
 *
 * @param query - jq query expression
 * @param options - Execution options
 * @returns Transform function
 */
export function jqLines(
  query: string,
  options: JqOptions = {},
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    for await (const line of stream) {
      if (!line.trim()) continue;

      try {
        const result = await jqExec(query, line, options);

        if (result.exitCode !== 0) {
          if (options.exitOnError) {
            throw new Error(result.error || "jq execution failed");
          }
          continue;
        }

        if (result.output) {
          yield result.output;
        }
      } catch (error) {
        if (options.exitOnError) {
          throw error;
        }
        // Skip invalid JSON lines in non-strict mode
      }
    }
  };
}

/**
 * Default export for convenient usage
 */
export default {
  jq,
  jqExec,
  jqTransform,
  jqLines,
};
