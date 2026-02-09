/**
 * Command and Pipeline Handlers
 *
 * Transpiles Command and Pipeline AST nodes to TypeScript.
 * Uses fluent style for common text processing commands,
 * explicit $.cmd() function call style for everything else.
 */

import type * as AST from "../../ast.ts";
import type {
  ExpressionResult,
  StatementResult,
  VisitorContext,
} from "../types.ts";
import { isFluentCommand } from "../types.ts";
import {
  escapeForQuotes,
  parseCountArg,
  collectFlagOptions,
  collectFlagOptionsAndFiles,
  sanitizeVarName,
} from "../utils/mod.ts";
import { SHELL_BUILTINS, type BuiltinConfig } from "../builtins.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format argument for TypeScript output.
 * Args containing ${} are template interpolations and need backticks, not double quotes.
 */
function formatArg(arg: string): string {
  if (arg.includes("${")) {
    // Template interpolation - use backticks to evaluate
    return `\`${arg}\``;
  }
  return `"${escapeForQuotes(arg)}"`;
}

/**
 * specialized command wrappers that provide enhanced functionality
 * These commands use dedicated wrapper functions instead of generic $.cmd()
 */
const SPECIALIZED_COMMANDS = new Set([
  "git",
  "docker",
  "tmux",
]);

// =============================================================================
// Command Builder Strategies
// =============================================================================

function handleUserFunction(name: string): string {
  return `${name}()`;
}

function handleShellBuiltin(
  name: string,
  args: string[],
  builtin: { fn: string; type: string }
): { code: string; async: boolean } {
  const argsArray = args.length > 0 ? args.map(formatArg).join(", ") : "";

  if (builtin.type === "output") {
    // Output builtins should print their result
    return {
      code: `console.log(${builtin.fn}(${argsArray}).toString())`,
      async: false,
    };
  } else if (builtin.type === "prints") {
    // Prints builtins already output, just execute
    return {
      code: `${builtin.fn}(${argsArray})`,
      async: false,
    };
  } else if (builtin.type === "async") {
    // Async builtins that need await
    return {
      code: `${builtin.fn}(${argsArray})`,
      async: true,
    };
  } else {
    // Silent builtins (cd, pushd, popd) - just execute
    return {
      code: `${builtin.fn}(${argsArray})`,
      async: false,
    };
  }
}

function handleTmuxSendKeys(args: string[]): string | null {
  // Check for pattern: tmux send-keys -t <target> [-c <client>] <text> C-m
  if (args.length > 0 && args[0] === "send-keys" && args[args.length - 1] === "C-m") {
    let target: string | null = null;
    let client: string | null = null;
    const textArgs: string[] = [];

    // Parse arguments (skip first "send-keys" and last "C-m")
    for (let i = 1; i < args.length - 1; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      if (arg === "-t" && nextArg) {
        target = formatArg(nextArg);
        i++; // skip next arg
      } else if (arg === "-c" && nextArg) {
        client = formatArg(nextArg);
        i++; // skip next arg
      } else if (arg) {
        textArgs.push(formatArg(arg));
      }
    }

    if (target && textArgs.length > 0) {
      const text = textArgs.join(" + \" \" + ");
      if (client) {
        return `$.tmuxSubmit(${target}, ${text}, ${client})`;
      } else {
        return `$.tmuxSubmit(${target}, ${text})`;
      }
    }
  }
  return null;
}

/**
 * SSH-426: Handle timeout command
 * Parses "timeout DURATION COMMAND [ARG...]" and generates code with timeout option
 * @returns Transpiled command with timeout, or null if not a valid timeout command
 */
function handleTimeoutCommand(args: string[], ctx: VisitorContext): { code: string; async: boolean } | null {
  if (args.length < 2) return null;

  const duration = args[0];
  if (!duration) return null;

  // Parse duration: NUMBER, NUMBERs, NUMBERm, NUMBERh, NUMBERd
  let timeoutMs: number;
  const match = duration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
  if (!match) return null;

  const value = parseFloat(match[1] ?? "0");
  const unit = match[2] ?? "s"; // default to seconds

  switch (unit) {
    case "s":
      timeoutMs = value * 1000;
      break;
    case "m":
      timeoutMs = value * 60 * 1000;
      break;
    case "h":
      timeoutMs = value * 60 * 60 * 1000;
      break;
    case "d":
      timeoutMs = value * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }

  // Extract command and its arguments
  const cmdName = args[1];
  if (!cmdName) return null;
  const cmdArgs = args.slice(2);

  // Build the command with timeout option
  const argsArray = cmdArgs.length > 0 ? cmdArgs.map(formatArg).join(", ") : "";
  const code = `$.cmd({ timeout: ${timeoutMs} }, ${formatArg(cmdName)}${argsArray ? `, ${argsArray}` : ""})`;

  return { code, async: true };
}

function handleSpecializedCommand(
  name: string,
  args: string[],
  hasMergeStreams: boolean
): string {
  // Special handling for tmux send-keys
  if (name === "tmux") {
    const tmuxResult = handleTmuxSendKeys(args);
    if (tmuxResult) return tmuxResult;
  }

  const argsArray = args.length > 0 ? args.map(formatArg).join(", ") : "";
  if (hasMergeStreams) {
    return `$.${name}({ mergeStreams: true }${argsArray ? `, ${argsArray}` : ""})`;
  }
  return `$.${name}(${argsArray})`;
}

function handleStandardCommand(
  name: string,
  args: string[],
  hasAssignments: boolean,
  assignments: AST.VariableAssignment[],
  hasMergeStreams: boolean,
  ctx: VisitorContext
): string {
  // SSH-484: Use formatArg for command name to support variable expansion
  const formattedName = formatArg(name);

  if (hasAssignments) {
    const envEntries = assignments
      .map((a) => {
        const value = ctx.visitWord(a.value as AST.Word);
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `${a.name}: "${escapedValue}"`;
      })
      .join(", ");
    const argsArray = args.map(formatArg).join(", ");
    return `$.cmd({ env: { ${envEntries} } }, ${formattedName}${argsArray ? `, ${argsArray}` : ""})`;
  }

  const argsArray = args.length > 0 ? args.map(formatArg).join(", ") : "";
  if (hasMergeStreams) {
    return `$.cmd({ mergeStreams: true }, ${formattedName}${argsArray ? `, ${argsArray}` : ""})`;
  }
  return `$.cmd(${formattedName}${argsArray ? `, ${argsArray}` : ""})`;
}

// =============================================================================
// Command Handler - Phase-Based Decomposition
// =============================================================================

/**
 * Analysis result for a command
 */
interface CommandAnalysis {
  name: string;
  args: string[];
  hasAssignments: boolean;
  hasRedirects: boolean;
  hasMergeStreams: boolean;
  hasDynamicArgs: boolean;
  isVariableAssignmentOnly: boolean;
}

/**
 * Command strategy types
 */
type CommandStrategy =
  | { type: 'variable-assignment'; assignments: AST.VariableAssignment[] }
  | { type: 'user-function'; name: string }
  | { type: 'shell-builtin'; name: string; args: string[]; builtin: BuiltinConfig }
  | { type: 'timeout'; args: string[] }
  | { type: 'fluent'; name: string; args: string[] }
  | { type: 'specialized'; name: string; args: string[]; hasMergeStreams: boolean }
  | { type: 'standard'; name: string; args: string[]; hasAssignments: boolean; assignments: AST.VariableAssignment[]; hasMergeStreams: boolean };

/**
 * Phase 1: Analyze command structure
 * Parses and analyzes the command to extract relevant metadata
 */
function analyzeCommand(
  command: AST.Command,
  ctx: VisitorContext
): CommandAnalysis {
  const hasNoCommand = command.name.type === "Word" && command.name.value === "";
  const isVariableAssignmentOnly = command.assignments.length > 0 && hasNoCommand;

  const name = ctx.visitWord(command.name);
  const args = command.args.map((arg) => ctx.visitWord(arg));

  const hasAssignments = command.assignments.length > 0;
  const hasRedirects = command.redirects.length > 0;
  const hasMergeStreams = command.redirects.some(
    (r) => (r.operator === ">&" || r.operator === "<&") &&
           typeof r.target === "number" && r.target === 1 &&
           r.fd === 2
  );
  const hasDynamicArgs = args.some((arg) => arg.includes("${"));

  return {
    name,
    args,
    hasAssignments,
    hasRedirects,
    hasMergeStreams,
    hasDynamicArgs,
    isVariableAssignmentOnly,
  };
}

/**
 * Phase 2: Select appropriate command strategy
 * Determines which strategy to use based on command analysis
 */
function selectCommandStrategy(
  command: AST.Command,
  analysis: CommandAnalysis,
  ctx: VisitorContext,
  options?: { inPipeline?: boolean }
): CommandStrategy {
  // Variable assignment only
  if (analysis.isVariableAssignmentOnly) {
    return { type: 'variable-assignment', assignments: command.assignments };
  }

  // User function
  if (ctx.isFunction(analysis.name)) {
    return { type: 'user-function', name: analysis.name };
  }

  // Shell builtin
  const builtin = SHELL_BUILTINS[analysis.name];
  if (builtin && !analysis.hasAssignments && !analysis.hasRedirects && !options?.inPipeline) {
    return {
      type: 'shell-builtin',
      name: analysis.name,
      args: analysis.args,
      builtin
    };
  }

  // Timeout command
  if (analysis.name === "timeout") {
    return { type: 'timeout', args: analysis.args };
  }

  // Fluent command (with constraint checking)
  // SSH-482: cat with no args or stdin (-) in pipeline should not use fluent
  // because $.cat("-") returns a Stream which cannot be piped from a Command
  const isCatReadingStdin = analysis.name === "cat" &&
    (analysis.args.length === 0 || (analysis.args.length === 1 && analysis.args[0] === "-"));
  if (isFluentCommand(analysis.name) && !analysis.hasDynamicArgs && !analysis.hasAssignments &&
      !analysis.hasRedirects && !(options?.inPipeline && isCatReadingStdin)) {
    return { type: 'fluent', name: analysis.name, args: analysis.args };
  }

  // Specialized command
  if (!analysis.hasAssignments && SPECIALIZED_COMMANDS.has(analysis.name)) {
    return {
      type: 'specialized',
      name: analysis.name,
      args: analysis.args,
      hasMergeStreams: analysis.hasMergeStreams
    };
  }

  // Standard command
  return {
    type: 'standard',
    name: analysis.name,
    args: analysis.args,
    hasAssignments: analysis.hasAssignments,
    assignments: command.assignments,
    hasMergeStreams: analysis.hasMergeStreams
  };
}

/**
 * Phase 3: Execute the selected command strategy
 * Generates the transpiled code based on the strategy
 */
function executeCommandStrategy(
  strategy: CommandStrategy,
  ctx: VisitorContext
): ExpressionResult & { isUserFunction?: boolean; isTransform?: boolean; isStream?: boolean } {
  switch (strategy.type) {
    case 'variable-assignment': {
      const assignments = strategy.assignments
        .map((a) => buildVariableAssignment(a, ctx))
        .join(", ");
      return { code: assignments, async: false };
    }

    case 'user-function': {
      const cmdExpr = handleUserFunction(strategy.name);
      return { code: cmdExpr, async: true, isUserFunction: true };
    }

    case 'shell-builtin': {
      const result = handleShellBuiltin(strategy.name, strategy.args, strategy.builtin);
      return { code: result.code, async: result.async };
    }

    case 'timeout': {
      const timeoutResult = handleTimeoutCommand(strategy.args, ctx);
      if (timeoutResult) {
        return { code: timeoutResult.code, async: timeoutResult.async };
      }
      // Invalid timeout syntax - fall through to standard command handling
      // Extract command name and args from timeout args
      const cmdName = strategy.args[1] ?? "";
      const cmdArgs = strategy.args.slice(2);
      const cmdExpr = handleStandardCommand(cmdName, cmdArgs, false, [], false, ctx);
      return { code: cmdExpr, async: true };
    }

    case 'fluent': {
      const fluentResult = buildFluentCommand(strategy.name, strategy.args, ctx);
      if (fluentResult !== null) {
        // SSH-424: Fluent commands return Command objects synchronously (no await needed)
        return {
          code: fluentResult.code,
          async: false,
          isTransform: fluentResult.isTransform,
          isStream: fluentResult.isStream
        };
      }
      // Fallback to standard if fluent returns null
      const cmdExpr = handleStandardCommand(strategy.name, strategy.args, false, [], false, ctx);
      return { code: cmdExpr, async: true };
    }

    case 'specialized': {
      const cmdExpr = handleSpecializedCommand(strategy.name, strategy.args, strategy.hasMergeStreams);
      return { code: cmdExpr, async: true };
    }

    case 'standard': {
      const cmdExpr = handleStandardCommand(
        strategy.name,
        strategy.args,
        strategy.hasAssignments,
        strategy.assignments,
        strategy.hasMergeStreams,
        ctx
      );
      return { code: cmdExpr, async: true };
    }
  }
}

/**
 * Phase 4: Apply command redirections
 * Applies redirection operators to the command expression
 */
function applyCommandRedirections(
  cmdExpr: string,
  redirects: AST.Redirection[],
  ctx: VisitorContext
): string {
  let result = cmdExpr;

  // Apply redirections (except 2>&1 which is handled via mergeStreams option)
  for (const redirect of redirects) {
    if ((redirect.operator === ">&" || redirect.operator === "<&") &&
        typeof redirect.target === "number" && redirect.target === 1 &&
        redirect.fd === 2) {
      continue;
    }
    result = applyRedirection(result, redirect, ctx);
  }

  return result;
}

/**
 * Build command - Main orchestrator
 * Coordinates the 4 phases to transpile a command
 */
export function buildCommand(
  command: AST.Command,
  ctx: VisitorContext,
  options?: { inPipeline?: boolean },
): ExpressionResult & { isUserFunction?: boolean; isTransform?: boolean; isStream?: boolean } {
  // Phase 1: Analyze command
  const analysis = analyzeCommand(command, ctx);

  // Phase 2: Select strategy
  const strategy = selectCommandStrategy(command, analysis, ctx, options);

  // Phase 3: Execute strategy
  const result = executeCommandStrategy(strategy, ctx);

  // Phase 4: Apply redirections
  const finalCode = applyCommandRedirections(result.code, command.redirects, ctx);

  return { ...result, code: finalCode };
}

/**
 * Result from building a fluent command
 */
interface FluentCommandResult {
  code: string;
  /** True if this is a transform function (like $.head, $.grep), false if it's a data source (like $.cat) */
  isTransform: boolean;
  /** True if this produces a stream (like $.cat), false if it's a Command */
  isStream: boolean;
}

/**
 * Configuration for building a simple fluent transform command
 */
interface SimpleFluentConfig {
  /** Parse arguments into options and files */
  parseArgs: (args: string[]) => { options?: string; files: string[] };
  /** Build the transform code (e.g., "$.head(10)") */
  buildTransform: (options?: string) => string;
}

/**
 * Registry of simple fluent commands that follow the pattern:
 * 1. Parse args into options and files
 * 2. If files present: $.cat(file).lines().pipe(transform)
 * 3. Otherwise: return transform
 */
const SIMPLE_FLUENT_COMMANDS: Record<string, SimpleFluentConfig> = {
  head: {
    parseArgs: (args) => {
      const { count, files } = parseCountArg(args);
      return { options: count.toString(), files };
    },
    buildTransform: (count) => `$.head(${count})`,
  },
  tail: {
    parseArgs: (args) => {
      const { count, files } = parseCountArg(args);
      return { options: count.toString(), files };
    },
    buildTransform: (count) => `$.tail(${count})`,
  },
  sort: {
    parseArgs: (args) => {
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-n": "numeric: true",
        "-r": "reverse: true",
        "-u": "unique: true",
      });
      return { options: options.length > 0 ? options.join(", ") : undefined, files };
    },
    buildTransform: (opts) => opts ? `$.sort({ ${opts} })` : "$.sort()",
  },
  uniq: {
    parseArgs: (args) => {
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-c": "count: true",
        "-i": "ignoreCase: true",
      });
      return { options: options.length > 0 ? options.join(", ") : undefined, files };
    },
    buildTransform: (opts) => opts ? `$.uniq({ ${opts} })` : "$.uniq()",
  },
  wc: {
    parseArgs: (args) => {
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-l": "lines: true",
        "-w": "words: true",
        "-c": "bytes: true",
        "-m": "chars: true",
      });
      return { options: options.length > 0 ? options.join(", ") : undefined, files };
    },
    buildTransform: (opts) => opts ? `$.wc({ ${opts} })` : "$.wc()",
  },
};

/**
 * Build a simple fluent command using the registry pattern
 */
function buildSimpleFluentCommand(name: string, args: string[]): FluentCommandResult {
  const config = SIMPLE_FLUENT_COMMANDS[name];
  if (!config) {
    throw new Error(`Unknown simple fluent command: ${name}`);
  }

  const { options, files } = config.parseArgs(args);
  const transformCode = config.buildTransform(options);

  if (files.length > 0) {
    const file = `"${escapeForQuotes(files[0] ?? "")}"`;
    return { code: `$.cat(${file}).lines().pipe(${transformCode})`, isTransform: false, isStream: true };
  }

  return { code: transformCode, isTransform: true, isStream: false };
}

/**
 * Build a fluent-style command (cat, grep, etc.)
 */
function buildFluentCommand(
  name: string,
  args: string[],
  _ctx: VisitorContext,
): FluentCommandResult | null {
  switch (name) {
    case "cat": {
      // $.cat(file) or $.cat(file1, file2, ...)
      // cat is a stream producer, not a transform
      if (args.length === 0) {
        return { code: '$.cat("-")', isTransform: false, isStream: true }; // Read from stdin
      }
      const files = args.map((a) => `"${escapeForQuotes(a)}"`).join(", ");
      return { code: `$.cat(${files})`, isTransform: false, isStream: true };
    }

    case "grep": {
      // $.grep(pattern) as transform or $.grep(pattern, file)
      // Parse grep options
      let pattern = "";
      let files: string[] = [];
      let invert = false;
      let ignoreCase = false;
      let lineNumber = false;
      let recursive = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-v") {
          invert = true;
        } else if (arg === "-i") {
          ignoreCase = true;
        } else if (arg === "-n") {
          lineNumber = true;
        } else if (arg === "-r" || arg === "-R" || arg?.includes("r") && arg.startsWith("-")) {
          // Check for -r, -R, or combined flags like -rn, -rin, etc.
          recursive = true;
        } else if (arg?.startsWith("-")) {
          // Skip other options
        } else if (!pattern) {
          pattern = arg ?? "";
        } else {
          files.push(arg ?? "");
        }
      }

      // If recursive flag is present, fall back to $.cmd()
      // Fluent grep doesn't support directory recursion
      if (recursive) {
        return null;
      }

      const escapedPattern = escapeForQuotes(pattern);
      const flags = ignoreCase ? "i" : "";
      const regexPattern = `/${escapedPattern}/${flags}`;

      if (files.length > 0) {
        // grep pattern file -> $.cat(file).grep(pattern) - this is a stream chain
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        if (invert) {
          // SSH-503: grep -v with file - skip .grep() since it filters FOR the pattern,
          // then .filter(x => !x.match) on the result would produce nothing.
          // Instead, read lines and filter out matches directly.
          let result = `$.cat(${file}).lines().filter(line => !${regexPattern}.test(line))`;
          if (lineNumber) result += '.map((line, i) => `${i + 1}:${line}`)';
          return { code: result, isTransform: false, isStream: true };
        }
        let result = `$.cat(${file}).grep(${regexPattern})`;
        if (lineNumber) result += '.map(m => `${m.line}:${m.content}`)';
        return { code: result, isTransform: false, isStream: true };
      }

      // grep as a transform
      if (invert) {
        return { code: `$.filter((line) => !${regexPattern}.test(line))`, isTransform: true, isStream: false };
      }
      return { code: `$.grep(${regexPattern})`, isTransform: true, isStream: false };
    }

    case "head":
    case "tail":
    case "sort":
    case "uniq":
    case "wc":
      return buildSimpleFluentCommand(name, args);

    case "tee": {
      // $.tee(file) as transform
      const file = args[0] ?? "-";
      return { code: `$.tee("${escapeForQuotes(file)}")`, isTransform: true, isStream: false };
    }

    // tr, cut, sed, awk are not fluent commands - they fall through to default
    default: {
      const argsArray = args.length > 0 ? args.map(a => `"${escapeForQuotes(a)}"`).join(", ") : "";
      return { code: `$.cmd("${escapeForQuotes(name)}"${argsArray ? `, ${argsArray}` : ""})`, isTransform: false, isStream: false };
    }
  }
}

/**
 * Apply a redirection to a command expression
 */
export function applyRedirection(
  cmdExpr: string,
  redirect: AST.Redirection,
  ctx: VisitorContext,
): string {
  const target =
    typeof redirect.target === "number"
      ? redirect.target.toString()
      : `"${escapeForQuotes(ctx.visitWord(redirect.target))}"`;

  switch (redirect.operator) {
    case "<":
      return `${cmdExpr}.stdin(${target})`;
    case ">":
      // SSH-308: Check fd field - if fd=2, redirect stderr instead of stdout
      if (redirect.fd === 2) {
        return `${cmdExpr}.stderr(${target})`;
      }
      return `${cmdExpr}.stdout(${target})`;
    case ">>":
      // SSH-308: Check fd field - if fd=2, redirect stderr instead of stdout
      if (redirect.fd === 2) {
        return `${cmdExpr}.stderr(${target}, { append: true })`;
      }
      return `${cmdExpr}.stdout(${target}, { append: true })`;
    case "<>":
      // SSH-299: Read-Write mode
      return `${cmdExpr}.stdin(${target}).stdout(${target})`;
    case ">|":
      // SSH-299: Force overwrite (clobber)
      if (redirect.fd === 2) {
        return `${cmdExpr}.stderr(${target}, { force: true })`;
      }
      return `${cmdExpr}.stdout(${target}, { force: true })`;
    case "<<":
      // SSH-299: Here-document
      return `${cmdExpr}.stdin(${target})`;
    case "<<-":
      // SSH-299: Here-document with tab stripping
      return `${cmdExpr}.stdin(${target}, { stripTabs: true })`;
    case ">&":
    case "<&":
      return `${cmdExpr}.stderr(${target})`;
    case "&>":
      return `${cmdExpr}.stdout(${target}).stderr(${target})`;
    case "&>>":
      return `${cmdExpr}.stdout(${target}, { append: true }).stderr(${target}, { append: true })`;
    case "<<<":
      // Here-string
      return `${cmdExpr}.stdin(${target})`;
    default:
      return cmdExpr;
  }
}

/**
 * Visit a command as a statement
 */
export function visitCommand(
  command: AST.Command,
  ctx: VisitorContext,
): StatementResult {
  const result = buildCommand(command, ctx);
  const indent = ctx.getIndent();

  // Wrap command execution with __printCmd to print output
  // This only applies to standalone commands (statements), not commands in pipelines/expressions
  // Don't wrap user-defined functions as they don't return CommandResult
  if (result.async && !result.isUserFunction) {
    return { lines: [`${indent}await __printCmd(${result.code});`] };
  } else if (result.async) {
    return { lines: [`${indent}await ${result.code};`] };
  }
  return { lines: [`${indent}${result.code};`] };
}

// =============================================================================
// Pipeline Handler
// =============================================================================

/**
 * Represents a part in a flattened pipeline with metadata
 */
interface PipelinePart {
  code: string;
  /** Whether this part produces command output that should be printed */
  isPrintable: boolean;
  /** Whether this part is a transform function (like $.head, $.grep) vs a command/stream */
  isTransform: boolean;
  /** Whether this part produces a stream (like $.cat) vs a Command */
  isStreamProducer: boolean;
  /** Whether this part needs await (true for $.cmd(), false for fluent commands) - SSH-424 */
  isAsync: boolean;
}

/**
 * Build a pipeline expression (without await/semicolon)
 */
export function buildPipeline(
  pipeline: AST.Pipeline,
  ctx: VisitorContext,
): ExpressionResult & { isStream?: boolean; isPrintable?: boolean } {
  // Single command, no pipeline
  if (pipeline.commands.length === 1 && !pipeline.background) {
    const cmd = pipeline.commands[0];
    if (!cmd) return { code: "", async: false };

    if (cmd.type === "Command") {
      return buildCommand(cmd, ctx);
    } else if (cmd.type === "Pipeline") {
      return buildPipeline(cmd, ctx);
    }
    // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
    return { code: buildStatementAsExpression(cmd, ctx), async: true };
  }

  // Build pipeline chain by flattening nested pipelines
  const parts: PipelinePart[] = [];
  const operators: (string | null)[] = [];

  // Flatten the pipeline tree into a list
  flattenPipeline(pipeline, parts, operators, ctx);

  // Build the chained expression
  if (parts.length === 0) return { code: "", async: false };

  // Analyze pipeline structure
  const analysis = analyzePipelineStructure(operators);

  // Assemble the pipeline
  const assembled = assemblePipeline(parts, operators, analysis);

  // Handle negation (! operator)
  let result = assembled.code;
  if (pipeline.negated) {
    result = `${result}.negate()`;
  }

  // SSH-424: Preserve async=false for single fluent commands (even with background &)
  // If this is a single-command pipeline with no operators, preserve the original async value
  const isAsync = (parts.length === 1 && operators.length === 0)
    ? parts[0]!.isAsync  // Use the isAsync field we now track
    : true;  // Multi-command pipelines are always async

  return { code: result, async: isAsync, isStream: assembled.isStream, isPrintable: assembled.isPrintable };
}

/**
 * Analysis of a pipeline's structure
 */
interface PipelineAnalysis {
  hasAndThenPipe: boolean;
}

/**
 * Analyze pipeline structure to inform code generation
 * Checks if any && operator is eventually followed by a pipe operator
 */
function analyzePipelineStructure(operators: (string | null)[]): PipelineAnalysis {
  let hasAndThenPipe = false;
  for (let i = 0; i < operators.length; i++) {
    if (operators[i] === "&&") {
      // Check if this && is eventually followed by a pipe before hitting ||, ;, or end
      for (let j = i + 1; j < operators.length; j++) {
        const laterOp = operators[j];
        if (laterOp === "|") {
          hasAndThenPipe = true;
          break;
        }
        if (laterOp === "||" || laterOp === ";") break;
      }
    }
    if (hasAndThenPipe) break;
  }
  return { hasAndThenPipe };
}

// =============================================================================
// Pipeline Assembler
// =============================================================================

/**
 * PipelineAssembler orchestrates pipeline code generation.
 * Each operator (&&, ||, |, ;) has its own focused handler method.
 *
 * Responsibilities:
 * - Maintain pipeline state (code, printable, promise, stream)
 * - Delegate to operator-specific handlers
 * - Return assembled pipeline result
 */
class PipelineAssembler {
  private code: string;
  private isPrintable: boolean;
  private isPromise: boolean;
  private isStream: boolean;
  private isLineStream: boolean;

  constructor(initialPart: PipelinePart) {
    this.code = initialPart.code;
    this.isPrintable = initialPart.isPrintable;
    this.isStream = initialPart.isStreamProducer;
    this.isPromise = false;
    this.isLineStream = false;
  }

  getResult() {
    return {
      code: this.code,
      isStream: this.isStream,
      isPrintable: this.isPrintable,
    };
  }

  /**
   * Handle && operator: execute second part if first succeeds.
   * SSH-361/362: Handle printable vs non-printable parts correctly.
   *
   * @param part - The pipeline part to append
   * @param followedByPipe - Whether this && is eventually followed by a pipe
   */
  appendAnd(part: PipelinePart, followedByPipe: boolean): void {
    if (!this.isPrintable && !part.isPrintable) {
      this.handleNonPrintableAnd(part);
      this.isPrintable = part.isPrintable;
    } else if (this.isPrintable) {
      this.handlePrintableAnd(part, followedByPipe);
      // isPrintable already set by handler (false when __printCmd moved inside IIFE)
    } else {
      this.handleMixedAnd(part, followedByPipe);
      // isPrintable already set by handler (false when __printCmd moved inside IIFE)
    }
  }

  /**
   * Handle || operator: execute second part if first fails.
   * SSH-361/362: Handle printable vs non-printable parts correctly.
   */
  appendOr(part: PipelinePart): void {
    if (!this.isPrintable && !part.isPrintable) {
      this.handleNonPrintableOr(part);
      this.isPrintable = part.isPrintable;
    } else if (this.isPrintable) {
      this.handlePrintableOr(part);
      // isPrintable already set by handler (false when __printCmd moved inside IIFE)
    } else {
      this.handleMixedOr(part);
      // isPrintable already set by handler (false when __printCmd moved inside IIFE)
    }
    this.resetPromiseState();
  }

  /**
   * Handle | operator: pipe output from first to second.
   * SSH-364: Use appropriate method for transforms vs commands.
   */
  appendPipe(part: PipelinePart): void {
    this.resolvePromiseIfNeeded();

    if (part.isTransform) {
      this.handleTransformPipe(part);
    } else if (part.isStreamProducer) {
      this.handleStreamProducerPipe(part);
    } else {
      this.handleCommandPipe(part);
    }

    this.isPrintable = true;
    // SSH-409: isStream reflects whether result is actually a stream
    this.isStream = part.isStreamProducer || part.isTransform;
  }

  /**
   * Handle ; operator: execute parts sequentially.
   * SSH-362: Handle non-printable parts correctly.
   */
  appendSequential(part: PipelinePart): void {
    if (!this.isPrintable && !part.isPrintable) {
      this.code = `${this.code}; ${part.code}`;
      this.isPromise = false;
      this.updateStreamState(false, false);
    } else if (this.isPrintable) {
      // Use __printCmd inside IIFE for printable last part to enable streaming output.
      // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
      const returnExpr = (part.isPrintable && !part.isStreamProducer)
        ? `return await __printCmd(${part.code})`
        : `return ${part.code}`;
      this.wrapInAsyncIIFE(
        `await __printCmd(${this.isPromise ? `await ${this.code}` : this.code})`,
        returnExpr
      );
      // SSH-474: Preserve stream status from the returning part
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    } else {
      // Use __printCmd inside IIFE for printable last part to enable streaming output.
      // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
      const returnExpr = (part.isPrintable && !part.isStreamProducer)
        ? `return await __printCmd(${part.code})`
        : `return ${part.code}`;
      this.wrapInAsyncIIFE(this.code, returnExpr);
      // SSH-474: Preserve stream status from the returning part
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    }

    // isPrintable set to false inside branches when __printCmd moved inside IIFE
    if (!part.isPrintable) this.isPrintable = false;
  }

  // ----- Private Helper Methods -----

  /**
   * Handle && for non-printable parts (like cd && cd)
   */
  private handleNonPrintableAnd(part: PipelinePart): void {
    this.code = `${this.code}; ${part.code}`;
    this.updateStreamState(false, false);
    this.isPromise = false;
  }

  /**
   * Handle && for printable first part
   */
  private handlePrintableAnd(part: PipelinePart, followedByPipe: boolean): void {
    const resultExpr = this.isPromise ? `await ${this.code}` : this.code;
    if (followedByPipe) {
      // Use comma operator to execute first command, then return second
      this.code = `(await __printCmd(${resultExpr}), ${part.code})`;
      this.isPromise = false;
      // SSH-425: Preserve stream status from second part for subsequent piping
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    } else {
      // Use __printCmd inside IIFE for both parts to enable streaming output.
      // Returning a Command from async IIFE would auto-await its thenable, buffering output.
      // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
      const returnExpr = (part.isPrintable && !part.isStreamProducer)
        ? `return await __printCmd(${part.code})`
        : `return ${part.code}`;
      this.wrapInAsyncIIFE(
        `await __printCmd(${resultExpr})`,
        returnExpr
      );
      if (part.isPrintable) this.isPrintable = false;
      // SSH-474: Preserve stream status from the returning part
      // The IIFE returns part.code, so stream state should match
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    }
  }

  /**
   * Handle && for mixed printable/non-printable (cd && echo)
   */
  private handleMixedAnd(part: PipelinePart, followedByPipe: boolean): void {
    if (followedByPipe) {
      this.code = `(${this.code}, ${part.code})`;
      this.isPromise = false;
      // SSH-425: Preserve stream status from second part for subsequent piping
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    } else {
      // Use __printCmd inside IIFE for printable last part to enable streaming output.
      // Returning a Command from async IIFE would auto-await its thenable, buffering output.
      // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
      const returnExpr = (part.isPrintable && !part.isStreamProducer)
        ? `return await __printCmd(${part.code})`
        : `return ${part.code}`;
      this.wrapInAsyncIIFE(this.code, returnExpr);
      if (part.isPrintable) this.isPrintable = false;
      // SSH-474: Preserve stream status from the returning part
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    }
  }

  /**
   * Handle || for non-printable parts
   */
  private handleNonPrintableOr(part: PipelinePart): void {
    this.code = `(async () => { try { ${this.code}; return { code: 0, stdout: '', stderr: '', success: true }; } catch { ${part.code}; return { code: 0, stdout: '', stderr: '', success: true }; } })()`;
  }

  /**
   * Handle || for printable first part
   */
  private handlePrintableOr(part: PipelinePart): void {
    const resultExpr = this.isPromise ? `await ${this.code}` : this.code;
    // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
    const catchExpr = (part.isPrintable && !part.isStreamProducer)
      ? `return await __printCmd(${part.code})`
      : `return ${part.code}`;
    this.code = `(async () => { try { await __printCmd(${resultExpr}); return { code: 0, stdout: '', stderr: '', success: true }; } catch { ${catchExpr}; } })()`;
    if (part.isPrintable) this.isPrintable = false;
  }

  /**
   * Handle || for mixed printable/non-printable
   */
  private handleMixedOr(part: PipelinePart): void {
    // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
    const catchExpr = (part.isPrintable && !part.isStreamProducer)
      ? `return await __printCmd(${part.code})`
      : `return ${part.code}`;
    this.code = `(async () => { try { ${this.code}; return { code: 0, stdout: '', stderr: '', success: true }; } catch { ${catchExpr}; } })()`;
    if (part.isPrintable) this.isPrintable = false;
  }

  /**
   * Handle pipe to transform (like $.head, $.grep)
   */
  private handleTransformPipe(part: PipelinePart): void {
    if (this.isLineStream) {
      // SSH-408: Already a line stream, just pipe to the transform
      this.code = `${this.code}.pipe(${part.code})`;
      this.isLineStream = true;
    } else if (this.isStream) {
      // Stream producer (like $.cat) - need .lines() to split content into lines
      this.code = `${this.code}.lines().pipe(${part.code})`;
      this.isLineStream = true;
    } else {
      // Command - convert to line stream first, then apply transform
      this.code = `${this.code}.stdout().lines().pipe(${part.code})`;
      this.isLineStream = true;
    }
  }

  /**
   * Handle pipe to stream producer (like $.cat)
   */
  private handleStreamProducerPipe(part: PipelinePart): void {
    this.code = `${this.code}.pipe(${part.code})`;
    this.isLineStream = false;
  }

  /**
   * Handle pipe to command
   */
  private handleCommandPipe(part: PipelinePart): void {
    if (this.isLineStream) {
      // SSH-408: Piping from a line stream to a command needs toCmdLines
      this.code = `${this.code}.pipe($.toCmdLines(${part.code}))`;
      this.isLineStream = true;
    } else if (this.isStream) {
      // When piping from a stream to a command, need to use toCmdLines transform
      this.code = `${this.code}.pipe($.toCmdLines(${part.code}))`;
      this.isLineStream = true;
    } else {
      // When piping from a command to a command, can pipe directly
      this.code = `${this.code}.pipe(${part.code})`;
      this.isLineStream = false;
    }
  }

  /**
   * Resolve promise state if needed (await if promise)
   */
  private resolvePromiseIfNeeded(): void {
    if (this.isPromise) {
      this.code = `(await ${this.code})`;
      this.isPromise = false;
    }
  }

  /**
   * Update stream state flags
   */
  private updateStreamState(isStream: boolean, isLineStream: boolean): void {
    this.isStream = isStream;
    this.isLineStream = isLineStream;
  }

  /**
   * Reset promise state and stream flags (used by || and ; operators)
   */
  private resetPromiseState(): void {
    this.isPromise = true;
    this.updateStreamState(false, false);
  }

  /**
   * Wrap code in async IIFE
   */
  private wrapInAsyncIIFE(expr: string, returnExpr: string): void {
    this.code = `(async () => { ${expr}; ${returnExpr}; })()`;
    this.isPromise = true;
    this.updateStreamState(false, false);
  }
}

/**
 * Assemble the full pipeline by processing all parts and operators
 */
function assemblePipeline(
  parts: PipelinePart[],
  operators: (string | null)[],
  analysis: PipelineAnalysis,
): { code: string; isStream: boolean; isPrintable: boolean } {
  if (parts.length === 0) {
    return { code: "", isStream: false, isPrintable: false };
  }

  const assembler = new PipelineAssembler(parts[0]!);

  for (let i = 1; i < parts.length; i++) {
    const op = operators[i - 1];
    const part = parts[i];
    if (!part) continue;

    if (op === "&&") {
      assembler.appendAnd(part, analysis.hasAndThenPipe);
    } else if (op === "||") {
      assembler.appendOr(part);
    } else if (op === "|") {
      assembler.appendPipe(part);
    } else if (op === ";") {
      assembler.appendSequential(part);
    } else {
      // Default: pipe
      assembler.appendPipe(part);
    }
  }

  return assembler.getResult();
}

/**
 * Flatten a nested pipeline tree into arrays of commands and operators.
 *
 * SSH-472: When the current operator is || or &&, and an operand is a | pipe chain,
 * build the pipe chain as a complete expression (don't flatten it).
 * But if the operand is another &&/|| chain or a single command, flatten it normally
 * to preserve variable scoping.
 *
 * Example: "cat file | jq || cat file | head" parses as:
 *   Pipeline(operator: ||)
 *     - Pipeline(operator: |) [cat | jq]
 *     - Pipeline(operator: |) [cat | head]
 *
 * We should NOT flatten this to [cat, jq, cat, head] with operators [|, ||, |].
 * Instead, we should build each side of || as a complete pipeline expression.
 *
 * But for "A=1 && B=2 && echo $A $B", we SHOULD flatten to preserve variable scope.
 */
function flattenPipeline(
  pipeline: AST.Pipeline,
  parts: PipelinePart[],
  operators: (string | null)[],
  ctx: VisitorContext,
): void {
  // Check if this pipeline uses pipe operator (|) - only then we're in a "true" pipeline
  const hasPipeOperator = pipeline.operator === "|";

  // Helper to check if a nested pipeline should be built as a complete expression
  // Only | pipe chains should be complete expressions within ||/&& operators
  const shouldBuildAsExpression = (nested: AST.Pipeline): boolean => {
    // If current operator is || or &&, and nested pipeline is a | pipe chain, build as expression
    return (pipeline.operator === "||" || pipeline.operator === "&&") && nested.operator === "|";
  };

  // Process left side (first command)
  const left = pipeline.commands[0];
  if (left) {
    if (left.type === "Command") {
      const result = buildCommand(left, ctx, { inPipeline: hasPipeOperator });
      // SSH-361: Track whether the command produces output that should be printed
      // SSH-424: For fluent commands, async=false but they still produce output
      // isPrintable should be true for all commands except variable assignments
      const isPrintable = result.async || (result.isStream ?? false) || (result.isTransform ?? false);
      parts.push({
        code: result.code,
        isPrintable,
        isTransform: result.isTransform ?? false,
        isStreamProducer: result.isStream ?? false,
        isAsync: result.async,
      });
    } else if (left.type === "Pipeline") {
      // SSH-472: Only build as complete expression if it's a | pipe chain within ||/&&
      if (shouldBuildAsExpression(left)) {
        const result = buildPipeline(left, ctx);
        // Calculate isPrintable the same way as for commands
        const isPrintable = result.isPrintable ?? (result.async || (result.isStream ?? false));
        parts.push({
          code: result.code,
          isPrintable,
          isTransform: false,
          isStreamProducer: result.isStream ?? false,
          isAsync: result.async,
        });
      } else {
        // Flatten for &&/|| chains and single commands to preserve variable scope
        flattenPipeline(left, parts, operators, ctx);
      }
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      parts.push({ code: buildStatementAsExpression(left, ctx), isPrintable: true, isTransform: false, isStreamProducer: false, isAsync: true });
    }
  }

  // For each subsequent command, add operator then command
  for (let i = 1; i < pipeline.commands.length; i++) {
    // Add the operator that connects to this command
    operators.push(pipeline.operator);

    const cmd = pipeline.commands[i];
    if (!cmd) continue;

    if (cmd.type === "Command") {
      const result = buildCommand(cmd, ctx, { inPipeline: hasPipeOperator });
      // SSH-361: Track whether the command produces output that should be printed
      // SSH-424: For fluent commands, async=false but they still produce output
      const isPrintable = result.async || (result.isStream ?? false) || (result.isTransform ?? false);
      parts.push({
        code: result.code,
        isPrintable,
        isTransform: result.isTransform ?? false,
        isStreamProducer: result.isStream ?? false,
        isAsync: result.async,
      });
    } else if (cmd.type === "Pipeline") {
      // SSH-472: Only build as complete expression if it's a | pipe chain within ||/&&
      if (shouldBuildAsExpression(cmd)) {
        const result = buildPipeline(cmd, ctx);
        // Calculate isPrintable the same way as for commands
        const isPrintable = result.isPrintable ?? (result.async || (result.isStream ?? false));
        parts.push({
          code: result.code,
          isPrintable,
          isTransform: false,
          isStreamProducer: result.isStream ?? false,
          isAsync: result.async,
        });
      } else {
        // Flatten for &&/|| chains and single commands to preserve variable scope
        flattenPipeline(cmd, parts, operators, ctx);
      }
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      parts.push({ code: buildStatementAsExpression(cmd, ctx), isPrintable: true, isTransform: false, isStreamProducer: false, isAsync: true });
    }
  }
}

/**
 * Convert a statement (like BraceGroup, Subshell, etc.) into an expression that can be used in a pipeline
 * Wraps the statement in an async IIFE that returns a result object
 */
function buildStatementAsExpression(stmt: AST.Statement, ctx: VisitorContext): string {
  // Visit the statement to get its lines
  const result = ctx.visitStatement(stmt);
  const lines = result.lines.map(l => l.trim()).filter(l => l.length > 0);

  // Wrap in async IIFE that executes the statements and returns success
  return `(async () => { ${lines.join('; ')}; return { code: 0, stdout: '', stderr: '' }; })()`;
}

/**
 * Check if a command is a "safe" command for sequential execution in && chains.
 * Safe commands always succeed, so we can emit them sequentially without
 * breaking && semantics. This includes:
 * - Variable assignments (A=1)
 * - cd (changes directory, doesn't fail in typical use)
 *
 * Commands that might fail (test commands, regular commands) need proper
 * && handling with exit code checks.
 */
function isSafeAndOperand(cmd: AST.Statement): boolean {
  if (cmd.type === "Command") {
    // Variable-only assignment (no command name)
    if (cmd.assignments.length > 0 && cmd.name.type === "Word" && cmd.name.value === "") {
      return true;
    }
    // cd is a safe builtin that typically doesn't fail
    if (cmd.name.type === "Word" && cmd.name.value === "cd") {
      return true;
    }
    return false;
  }
  if (cmd.type === "Pipeline") {
    // Single-command pipeline - check the inner command
    if (cmd.commands.length === 1 && cmd.operator === null) {
      return isSafeAndOperand(cmd.commands[0]!);
    }
    // Nested && chain - all parts must be safe
    if (cmd.operator === "&&") {
      return cmd.commands.every(c => isSafeAndOperand(c));
    }
    return false;
  }
  // TestCommand, ArithmeticCommand, etc. might fail
  return false;
}

/**
 * Check if a pipeline is a "safe" && chain that can be emitted as sequential
 * statements without breaking && semantics.
 *
 * A safe && chain has all non-final commands as "safe" (variable assignments, cd).
 * The final command can be anything since we don't need to check its exit code.
 */
function isSafeAndChain(pipeline: AST.Pipeline): boolean {
  if (pipeline.operator !== "&&") return false;

  // Check all commands - they should be either Commands or single-command Pipelines (no pipes)
  for (const cmd of pipeline.commands) {
    if (cmd.type === "Pipeline") {
      // If it's a nested pipeline with | or ||, not a safe && chain
      if (cmd.operator === "|" || cmd.operator === "||") return false;
      // If it's a nested && chain, check recursively
      if (cmd.operator === "&&") {
        if (!isSafeAndChain(cmd)) return false;
      }
      // operator === null is fine (single command wrapped in pipeline)
    }
  }

  // Now check that all non-final commands are "safe"
  const commands: AST.Statement[] = [];
  flattenAndChain(pipeline, commands);

  // All but the last command must be safe
  for (let i = 0; i < commands.length - 1; i++) {
    if (!isSafeAndOperand(commands[i]!)) {
      return false;
    }
  }

  return true;
}

/**
 * Flatten a pure && chain into an array of statements
 */
function flattenAndChain(
  pipeline: AST.Pipeline,
  statements: Array<AST.Statement>,
): void {
  for (const cmd of pipeline.commands) {
    if (cmd.type === "Pipeline") {
      if (cmd.operator === "&&") {
        // Recursively flatten nested && chains
        flattenAndChain(cmd, statements);
      } else {
        // Single-command pipeline (operator === null)
        const inner = cmd.commands[0];
        if (inner) {
          statements.push(inner);
        }
      }
    } else {
      // Command, TestCommand, ArithmeticCommand, BraceGroup, Subshell, etc.
      statements.push(cmd);
    }
  }
}

/**
 * Visit a pipeline statement
 */
export function visitPipeline(
  pipeline: AST.Pipeline,
  ctx: VisitorContext,
): StatementResult {
  const indent = ctx.getIndent();

  // Single command, no pipeline
  if (pipeline.commands.length === 1 && !pipeline.background) {
    const cmd = pipeline.commands[0];
    if (!cmd) return { lines: [] };

    if (cmd.type === "Command") {
      return visitCommand(cmd, ctx);
    }
    return ctx.visitStatement(cmd);
  }

  // SSH-472: For && chains, we need to preserve variable scope.
  // First, check if this chain has any variable assignments that need hoisting.
  // If so, emit them as separate statements first, then emit the pipeline.
  if (pipeline.operator === "&&" && !pipeline.background) {
    const statements: Array<AST.Statement> = [];
    flattenAndChain(pipeline, statements);

    // Find variable assignments that need hoisting
    const hoistedVars: string[] = [];
    const nonVarStatements: AST.Statement[] = [];

    for (const stmt of statements) {
      if (stmt.type === "Command" &&
          stmt.assignments.length > 0 &&
          stmt.name.type === "Word" &&
          stmt.name.value === "") {
        // Pure variable assignment - hoist it
        const result = buildCommand(stmt, ctx);
        hoistedVars.push(result.code);
      } else {
        nonVarStatements.push(stmt);
      }
    }

    // If we have hoisted variables and remaining statements, emit them separately
    if (hoistedVars.length > 0) {
      const lines: string[] = [];

      // First emit all variable assignments
      for (const varCode of hoistedVars) {
        lines.push(`${indent}${varCode};`);
      }

      // If there are no remaining statements, we're done
      if (nonVarStatements.length === 0) {
        return { lines };
      }

      // If remaining statements are all safe (cd), emit them directly
      const allSafe = nonVarStatements.every(stmt => {
        if (stmt.type === "Command" && stmt.name.type === "Word" && stmt.name.value === "cd") {
          return true;
        }
        return false;
      });

      if (allSafe) {
        for (const stmt of nonVarStatements) {
          if (stmt.type === "Command") {
            const result = buildCommand(stmt, ctx);
            lines.push(`${indent}${result.code};`);
          }
        }
        return { lines };
      }

      // Otherwise, build a new pipeline from remaining statements and emit it
      if (nonVarStatements.length === 1) {
        const stmt = nonVarStatements[0]!;
        if (stmt.type === "Command") {
          const result = buildCommand(stmt, ctx);
          const isPrintable = result.async || (result.isStream ?? false) || (result.isTransform ?? false);
          if (isPrintable) {
            lines.push(`${indent}await __printCmd(${result.code});`);
          } else {
            lines.push(`${indent}${result.code};`);
          }
        } else {
          const stmtResult = ctx.visitStatement(stmt);
          lines.push(...stmtResult.lines);
        }
        return { lines };
      }

      // Multiple non-var statements: build as && chain
      // Create a synthetic pipeline from the remaining statements
      const syntheticPipeline: AST.Pipeline = {
        type: "Pipeline",
        commands: nonVarStatements.map(stmt => ({
          type: "Pipeline" as const,
          commands: [stmt],
          operator: null,
          background: false,
          negated: false,
        })),
        operator: "&&",
        background: false,
        negated: false,
      };

      const result = buildPipeline(syntheticPipeline, ctx);
      if (result.isStream) {
        // SSH-476: If the result is async (wrapped in IIFE), await it first before iterating
        const streamExpr = result.async ? `await ${result.code}` : result.code;
        lines.push(`${indent}for await (const __line of ${streamExpr}) { console.log(__line); }`);
      } else if (!result.isPrintable) {
        const prefix = result.async ? "await " : "";
        lines.push(`${indent}${prefix}${result.code};`);
      } else {
        lines.push(`${indent}await __printCmd(${result.code});`);
      }
      return { lines };
    }
  }

  const result = buildPipeline(pipeline, ctx);

  if (pipeline.background) {
    // SSH-XXX: Spawn background job and track PID for $!
    // Convert the command to a spawned child process so we can get its PID
    // If the result is async (e.g., wrapped in IIFE for cd), await it first
    const bgCode = result.async
      ? `${indent}  const __bgCmd = await (${result.code});`
      : `${indent}  const __bgCmd = ${result.code};`;

    return {
      lines: [
        `${indent}(async () => {`,
        bgCode,
        `${indent}  const __child = __bgCmd.spawnBackground();`,
        `${indent}  __LAST_BG_PID = __child.pid;`,
        `${indent}})(); // background`,
      ]
    };
  }

  // SSH-364: Handle stream vs command output differently
  if (result.isStream) {
    // For streams (from .trans()), iterate and print each line
    // SSH-476: If the result is async (wrapped in IIFE), await it first before iterating
    const streamExpr = result.async ? `await ${result.code}` : result.code;
    return { lines: [`${indent}for await (const __line of ${streamExpr}) { console.log(__line); }`] };
  }

  // SSH-372: Don't wrap non-printable results (like shell builtins) in __printCmd
  // But still await async results (IIFEs that handle their own printing)
  if (!result.isPrintable) {
    const prefix = result.async ? "await " : "";
    return { lines: [`${indent}${prefix}${result.code};`] };
  }

  // Wrap pipeline execution with __printCmd to print output
  return { lines: [`${indent}await __printCmd(${result.code});`] };
}

// =============================================================================
// Variable Assignment Handler
// =============================================================================

/**
 * Build a variable assignment expression
 */
export function buildVariableAssignment(
  stmt: AST.VariableAssignment,
  ctx: VisitorContext,
): string {
  // SSH-489: Sanitize variable names that collide with JS reserved words
  const jsName = sanitizeVarName(stmt.name);

  let value: string;
  let isArray = false;

  // SSH-327: Handle array assignments
  if (stmt.value.type === "ArrayLiteral") {
    isArray = true;
    const elements = stmt.value.elements
      .map((el) => {
        const elementValue = ctx.visitWord(el as AST.Word);
        return `"${escapeForQuotes(elementValue)}"`;
      })
      .join(", ");
    value = `[${elements}]`;
  } else if (stmt.value.type === "ArithmeticExpansion") {
    value = ctx.visitArithmetic(stmt.value.expression);
  } else {
    // SSH-330: Handle assignments with expansions
    // If the value contains expansions (like ${!ref}), we need to use template literals (backticks)
    // instead of regular strings (double quotes) so the expansions are evaluated
    const word = stmt.value as AST.Word;
    const wordValue = ctx.visitWord(word);

    // Check if the word has expansions (not just literal parts) and is not single-quoted
    // Single-quoted strings should remain literal
    const hasExpansions = word.type === "Word" && word.parts.some(part =>
      part.type !== "LiteralPart"
    );

    if (hasExpansions && !word.singleQuoted) {
      // Use template literal syntax (backticks) for expansion evaluation
      value = `\`${wordValue}\``;
    } else {
      // Use double quotes for literal values
      value = `"${escapeForQuotes(wordValue)}"`;
    }
  }

  // SSH-306: Handle exported variables
  if (stmt.exported) {
    // Exported variables need to be set in both local scope and environment
    // Use original name for Deno.env.set (env var name), sanitized for JS identifier
    if (ctx.isDeclared(stmt.name)) {
      // Already declared, just update value and export
      return `${jsName} = ${value}; Deno.env.set("${stmt.name}", ${jsName})`;
    } else {
      // First assignment - declare, set value, and export
      ctx.declareVariable(stmt.name, "let");
      return `let ${jsName} = ${value}; Deno.env.set("${stmt.name}", ${jsName})`;
    }
  }

  // Check if variable is already declared
  if (ctx.isDeclared(stmt.name)) {
    // Reassignment - no declaration keyword needed
    return `${jsName} = ${value}`;
  } else {
    // First assignment - declare with let (bash variables are mutable)
    ctx.declareVariable(stmt.name, "let");
    return `let ${jsName} = ${value}`;
  }
}

/**
 * Visit a variable assignment as a statement
 */
export function visitVariableAssignment(
  stmt: AST.VariableAssignment,
  ctx: VisitorContext,
): StatementResult {
  const indent = ctx.getIndent();
  return { lines: [`${indent}${buildVariableAssignment(stmt, ctx)};`] };
}
