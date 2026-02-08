/**
 * SED - Stream Editor Implementation
 *
 * A pure TypeScript implementation of the sed stream editor.
 * Supports pattern/hold space, addresses, branching, and common commands.
 */

import { createStream, type Stream, type Transform } from "../../stdlib/stream.ts";
import {
  createInitialState,
  type ExecuteContext,
  executeCommands,
} from "./executor.ts";
import { parseMultipleScripts } from "./parser.ts";
import type {
  RangeState,
  SedCommand,
  SedExecutionLimits,
  SedState,
} from "./types.ts";

// =============================================================================
// Options and Result Types
// =============================================================================

/**
 * Options for sed execution
 */
export interface SedOptions {
  /** Suppress automatic printing of pattern space (-n flag) */
  silent?: boolean;
  /** Use extended regular expressions (-E/-r flag) */
  extendedRegex?: boolean;
  /** Execution limits */
  limits?: SedExecutionLimits;
}

/**
 * Result from sed execution
 */
export interface SedResult {
  /** Output lines */
  output: string;
  /** Exit code (0 for success, non-zero for errors) */
  exitCode: number;
}

// =============================================================================
// Core Processing
// =============================================================================

/**
 * Process content with sed commands
 */
async function processContent(
  content: string,
  commands: SedCommand[],
  options: SedOptions = {},
): Promise<SedResult> {
  const { silent = false, limits } = options;

  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const totalLines = lines.length;
  let output = "";
  let exitCode = 0;

  // Persistent state across all lines
  let holdSpace = "";
  const rangeStates = new Map<string, RangeState>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const state: SedState = {
      ...createInitialState(totalLines, undefined, rangeStates),
      patternSpace: lines[lineIndex],
      holdSpace: holdSpace,
      lineNumber: lineIndex + 1,
      totalLines,
      substitutionMade: false,
      silentMode: silent,
    };

    const ctx: ExecuteContext = {
      lines,
      currentLineIndex: lineIndex,
    };

    let cycleIterations = 0;
    const maxCycleIterations = 10000;
    let totalLinesConsumed = 0;
    do {
      cycleIterations++;
      if (cycleIterations > maxCycleIterations) {
        break;
      }

      state.restartCycle = false;

      const linesConsumed = executeCommands(commands, state, ctx, limits);
      totalLinesConsumed += linesConsumed;

      ctx.currentLineIndex += linesConsumed;
    } while (
      state.restartCycle &&
      !state.deleted &&
      !state.quit &&
      !state.quitSilent
    );

    lineIndex += totalLinesConsumed;
    holdSpace = state.holdSpace;

    for (const ln of state.lineNumberOutput) {
      output += ln + "\n";
    }

    const inserts: string[] = [];
    const appends: string[] = [];
    for (const item of state.appendBuffer) {
      if (item.type === "insert") {
        inserts.push(item.text);
      } else {
        appends.push(item.text);
      }
    }

    for (const text of inserts) {
      output += text + "\n";
    }

    if (!state.deleted && !state.quitSilent) {
      if (silent) {
        if (state.printed) {
          output += state.patternSpace + "\n";
        }
      } else {
        output += state.patternSpace + "\n";
      }
    }

    for (const text of appends) {
      output += text + "\n";
    }

    if (state.quit || state.quitSilent) {
      if (state.exitCode !== undefined) {
        exitCode = state.exitCode;
      }
      break;
    }
  }

  return { output, exitCode };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Execute sed script on input string
 */
export async function sedExec(
  script: string | string[],
  input: string,
  options: SedOptions = {},
): Promise<SedResult> {
  const scripts = Array.isArray(script) ? script : [script];

  const { commands, error } = parseMultipleScripts(
    scripts,
    options.extendedRegex ?? false,
  );

  if (error) {
    return { output: "", exitCode: 1 };
  }

  if (commands.length === 0) {
    return { output: input, exitCode: 0 };
  }

  return processContent(input, commands, options);
}

/**
 * Create a sed transform for stream processing
 */
export function sed(
  script: string | string[],
  options: SedOptions = {},
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    let content = "";
    for await (const chunk of stream) {
      content += chunk;
    }

    const result = await sedExec(script, content, options);

    if (result.output) {
      yield result.output;
    }
  };
}

/**
 * Create a sed stream from input
 */
export function sedStream(
  script: string | string[],
  input: string | AsyncIterable<string>,
  options: SedOptions = {},
): Stream<string> {
  return createStream(
    (async function* () {
      let content: string;
      if (typeof input === "string") {
        content = input;
      } else {
        content = "";
        for await (const chunk of input) {
          content += chunk;
        }
      }

      const result = await sedExec(script, content, options);
      if (result.output) {
        yield result.output;
      }
    })(),
  );
}

// Re-export types
export type {
  SedCommand,
  SedState,
  SedExecutionLimits,
  AddressRange,
  SedAddress,
  StepAddress,
} from "./types.ts";

export { parseMultipleScripts } from "./parser.ts";
export { createInitialState, executeCommands } from "./executor.ts";
