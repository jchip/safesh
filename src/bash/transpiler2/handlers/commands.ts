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
import { escapeForQuotes } from "../utils/escape.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse the -n count argument from head/tail style commands.
 * Supports: -n 20, -n20, -20
 * @returns The parsed count and remaining non-flag arguments (files)
 */
function parseCountArg(args: string[], defaultValue = 10): { count: number; files: string[] } {
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
 * @param args - Command arguments
 * @param flagMap - Map of flag to option string (e.g., { "-n": "numeric: true" })
 * @returns Array of option strings
 */
function collectFlagOptions(args: string[], flagMap: Record<string, string>): string[] {
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
 * @param args - Command arguments
 * @param flagMap - Map of flag to option string (e.g., { "-l": "lines: true" })
 * @returns Object with options array and files array
 */
function collectFlagOptionsAndFiles(
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

// =============================================================================
// Command Handler
// =============================================================================

/**
 * Build a command expression (without await/semicolon)
 */
/**
 * Shell builtins that should use preamble imports instead of $.cmd()
 *
 * Categories:
 * - silent: Side-effect only, no output (cd, pushd, popd)
 * - prints: Already prints output, don't wrap (echo)
 * - output: Returns value that should be printed (pwd, dirs, ls)
 * - async: Async operations that return results (which, test, chmod, etc.)
 */
const SHELL_BUILTINS: Record<string, { fn: string; type: "silent" | "prints" | "output" | "async" }> = {
  cd: { fn: "__cd", type: "silent" },
  pushd: { fn: "__pushd", type: "silent" },
  popd: { fn: "__popd", type: "silent" },
  echo: { fn: "__echo", type: "prints" },
  pwd: { fn: "__pwd", type: "output" },
  dirs: { fn: "__dirs", type: "output" },
  ls: { fn: "__ls", type: "output" },
  test: { fn: "__test", type: "async" },
  which: { fn: "__which", type: "async" },
  chmod: { fn: "__chmod", type: "async" },
  ln: { fn: "__ln", type: "async" },
  rm: { fn: "__rm", type: "async" },
  rmdir: { fn: "__rmdir", type: "async" },
  cp: { fn: "__cp", type: "async" },
  mv: { fn: "__mv", type: "async" },
  mkdir: { fn: "__mkdir", type: "async" },
  touch: { fn: "__touch", type: "async" },
};

export function buildCommand(
  command: AST.Command,
  ctx: VisitorContext,
  options?: { inPipeline?: boolean },
): ExpressionResult & { isUserFunction?: boolean; isTransform?: boolean; isStream?: boolean } {
  // Handle pure variable assignments (no command name)
  const hasNoCommand =
    command.name.type === "Word" && command.name.value === "";
  if (command.assignments.length > 0 && hasNoCommand) {
    const assignments = command.assignments
      .map((a) => buildVariableAssignment(a, ctx))
      .join(", ");
    return { code: assignments, async: false };
  }

  const name = ctx.visitWord(command.name);
  const args = command.args.map((arg) => ctx.visitWord(arg));

  let cmdExpr: string;
  let isAsync = true;
  let isUserFunction = false;
  let isTransform = false;
  let isStream = false;

  // Check if command has environment variable assignments
  const hasAssignments = command.assignments.length > 0 && !hasNoCommand;

  // Check if command has redirections - builtins can't handle redirections
  const hasRedirects = command.redirects.length > 0;

  // Check if this is a user-defined function call
  if (ctx.isFunction(name)) {
    // Call the function directly
    cmdExpr = `${name}()`;
    isAsync = true;
    isUserFunction = true;
  } else if (SHELL_BUILTINS[name] && !hasAssignments && !hasRedirects && !options?.inPipeline) {
    // SSH-372: Use preamble builtins for cd, pwd, echo, etc.
    // But NOT when in a pipeline, since builtins don't return Command objects that support piping
    const builtin = SHELL_BUILTINS[name];
    const argsArray = args.length > 0 ? args.map(formatArg).join(", ") : "";

    if (builtin.type === "output") {
      // Output builtins should print their result (use toString() to get plain string)
      cmdExpr = `console.log(${builtin.fn}(${argsArray}).toString())`;
      isAsync = false;
    } else if (builtin.type === "prints") {
      // Prints builtins already output, just execute
      cmdExpr = `${builtin.fn}(${argsArray})`;
      isAsync = false;
    } else if (builtin.type === "async") {
      // Async builtins that need await
      cmdExpr = `${builtin.fn}(${argsArray})`;
      isAsync = true;
    } else {
      // Silent builtins (cd, pushd, popd) - just execute
      cmdExpr = `${builtin.fn}(${argsArray})`;
      isAsync = false;
    }
  } else {
    // Check if any args contain dynamic values (template literals with ${)
    // If so, fluent command handlers can't parse them correctly at transpile-time
    const hasDynamicArgs = args.some((arg) => arg.includes("${"));

    // SSH-359: Check if command has heredoc redirections
    // Fluent API ($.cat, etc.) doesn't support .stdin() method, so use $.cmd() style
    const hasHeredoc = command.redirects.some(
      (r) => r.operator === "<<" || r.operator === "<<-"
    );

    // Check if command has any redirections - fluent transforms don't support redirection methods
    const hasAnyRedirects = command.redirects.length > 0;

    // Use fluent style for common text processing commands (only with static args)
    // BUT: env assignments, redirections, and heredocs force explicit $.cmd() style
    if (isFluentCommand(name) && !hasDynamicArgs && !hasAssignments && !hasAnyRedirects) {
      const fluentResult = buildFluentCommand(name, args, ctx);
      // buildFluentCommand may return null to indicate fallback to $.cmd()
      if (fluentResult !== null) {
        cmdExpr = fluentResult.code;
        isTransform = fluentResult.isTransform;
        isStream = fluentResult.isStream;
      } else {
        // Fall back to $.cmd() style
        const argsList = args.length > 0 ? ", " + args.map(formatArg).join(", ") : "";
        cmdExpr = `$.cmd("${name}"${argsList})`;
        isAsync = true;
      }
    } else if (hasAssignments) {
      // Use function call style with env options when there are assignments
      const envEntries = command.assignments
        .map((a) => {
          const value = ctx.visitWord(a.value as AST.Word);
          // Escape quotes in the value
          const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          return `${a.name}: "${escapedValue}"`;
        })
        .join(", ");
      const argsArray = args.map(formatArg).join(", ");
      cmdExpr = `$.cmd({ env: { ${envEntries} } }, "${escapeForQuotes(name)}"${argsArray ? `, ${argsArray}` : ""})`;
    } else {
      // Use explicit $.cmd() function call style
      // $.cmd(name, ...args) returns a Command directly
      const argsArray = args.length > 0 ? args.map(formatArg).join(", ") : "";
      cmdExpr = `$.cmd("${escapeForQuotes(name)}"${argsArray ? `, ${argsArray}` : ""})`;
    }
  }

  // Apply redirections
  for (const redirect of command.redirects) {
    cmdExpr = applyRedirection(cmdExpr, redirect, ctx);
  }

  return { code: cmdExpr, async: isAsync, isUserFunction, isTransform, isStream };
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
        let result = `$.cat(${file}).grep(${regexPattern})`;
        if (invert) result += ".filter(x => !x.match)";
        if (lineNumber) result += '.map(m => `${m.line}:${m.content}`)';
        return { code: result, isTransform: false, isStream: true };
      }

      // grep as a transform
      return { code: `$.grep(${regexPattern})`, isTransform: true, isStream: false };
    }

    case "head": {
      // $.head(n) as transform, or $.cat(file).lines().pipe($.head(n)) with file
      const { count, files } = parseCountArg(args);
      if (files.length > 0) {
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        return { code: `$.cat(${file}).lines().pipe($.head(${count}))`, isTransform: false, isStream: true };
      }
      return { code: `$.head(${count})`, isTransform: true, isStream: false };
    }

    case "tail": {
      // $.tail(n) as transform, or $.cat(file).lines().pipe($.tail(n)) with file
      const { count, files } = parseCountArg(args);
      if (files.length > 0) {
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        return { code: `$.cat(${file}).lines().pipe($.tail(${count}))`, isTransform: false, isStream: true };
      }
      return { code: `$.tail(${count})`, isTransform: true, isStream: false };
    }

    case "sort": {
      // $.sort(options) as transform, or $.cat(file).lines().pipe($.sort(options)) with file
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-n": "numeric: true",
        "-r": "reverse: true",
        "-u": "unique: true",
      });
      const sortCode = options.length > 0 ? `$.sort({ ${options.join(", ")} })` : "$.sort()";
      if (files.length > 0) {
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        return { code: `$.cat(${file}).lines().pipe(${sortCode})`, isTransform: false, isStream: true };
      }
      return { code: sortCode, isTransform: true, isStream: false };
    }

    case "uniq": {
      // $.uniq(options) as transform, or $.cat(file).lines().pipe($.uniq(options)) with file
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-c": "count: true",
        "-i": "ignoreCase: true",
      });
      const uniqCode = options.length > 0 ? `$.uniq({ ${options.join(", ")} })` : "$.uniq()";
      if (files.length > 0) {
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        return { code: `$.cat(${file}).lines().pipe(${uniqCode})`, isTransform: false, isStream: true };
      }
      return { code: uniqCode, isTransform: true, isStream: false };
    }

    case "wc": {
      // $.wc() or $.wc(options) as transform, or $.cat(file).lines().pipe($.wc(options)) with file
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-l": "lines: true",
        "-w": "words: true",
        "-c": "bytes: true",
        "-m": "chars: true",
      });
      const wcCode = options.length > 0 ? `$.wc({ ${options.join(", ")} })` : "$.wc()";
      if (files.length > 0) {
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        return { code: `$.cat(${file}).lines().pipe(${wcCode})`, isTransform: false, isStream: true };
      }
      return { code: wcCode, isTransform: true, isStream: false };
    }

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

  // Look ahead: check if any && in the chain is eventually followed by a pipe
  // This affects how we transpile the entire && chain
  const hasAndThenPipe = (() => {
    for (let i = 0; i < operators.length; i++) {
      if (operators[i] === "&&") {
        // Check if this && is eventually followed by a pipe before hitting ||, ;, or end
        for (let j = i + 1; j < operators.length; j++) {
          const laterOp = operators[j];
          if (laterOp === "|") return true;
          if (laterOp === "||" || laterOp === ";") break;
        }
      }
    }
    return false;
  })();

  let result = parts[0]?.code ?? "";
  let resultIsPrintable = parts[0]?.isPrintable ?? false;
  // Track if result is a stream - either a stream producer ($.cat) or from .stdout().lines()
  let resultIsStream = parts[0]?.isStreamProducer ?? false;
  // Track if result is a Promise (from async IIFE) that needs awaiting before piping
  let resultIsPromise = false;

  for (let i = 1; i < parts.length; i++) {
    const op = operators[i - 1];
    const part = parts[i];
    if (!part) continue;

    if (op === "&&") {
      // If this && chain will eventually be piped, use comma operator for all of them
      const followedByPipe = hasAndThenPipe;

      // SSH-361/362: Handle printable vs non-printable parts correctly
      // Variable assignments (isPrintable: false) should just be executed, not returned
      if (!resultIsPrintable && !part.isPrintable) {
        // SSH-362: Both are non-printable (e.g., consecutive variable assignments)
        // Just sequence them without IIFE wrapping
        result = `${result}; ${part.code}`;
        resultIsPromise = false;
      } else if (resultIsPrintable) {
        // Await the previous result if it's a promise (from a previous IIFE)
        const resultExpr = resultIsPromise ? `await ${result}` : result;
        // If followed by pipe, don't use IIFE - sequence with semicolon and conditional
        if (followedByPipe) {
          // Use comma operator to execute first command, then return second
          result = `(await __printCmd(${resultExpr}), ${part.code})`;
          resultIsPromise = false;
        } else {
          result = `(async () => { await __printCmd(${resultExpr}); return ${part.code}; })()`;
          resultIsPromise = true; // This IIFE returns a Promise
        }
      } else {
        // result is non-printable (like cd), part is printable
        if (followedByPipe) {
          // Use comma operator to execute first, then return second Command
          result = `(${result}, ${part.code})`;
          resultIsPromise = false;
        } else {
          // Wrap in IIFE only if not followed by pipe
          result = `(async () => { ${result}; return ${part.code}; })()`;
          resultIsPromise = true; // This IIFE returns a Promise
        }
      }
      resultIsPrintable = part.isPrintable;
      resultIsStream = false; // && chain resets to command result
    } else if (op === "||") {
      // SSH-361/362: Handle printable vs non-printable parts correctly
      if (!resultIsPrintable && !part.isPrintable) {
        // Both non-printable - sequence with try/catch for || semantics
        result = `(async () => { try { ${result}; return { code: 0, stdout: '', stderr: '', success: true }; } catch { ${part.code}; return { code: 0, stdout: '', stderr: '', success: true }; } })()`;
        resultIsPromise = true;
      } else if (resultIsPrintable) {
        // Await the previous result if it's a promise
        const resultExpr = resultIsPromise ? `await ${result}` : result;
        result = `(async () => { try { await __printCmd(${resultExpr}); return { code: 0, stdout: '', stderr: '', success: true }; } catch { return ${part.code}; } })()`;
        resultIsPromise = true;
      } else {
        result = `(async () => { try { ${result}; return { code: 0, stdout: '', stderr: '', success: true }; } catch { return ${part.code}; } })()`;
        resultIsPromise = true;
      }
      resultIsPrintable = part.isPrintable;
      resultIsStream = false; // || chain resets to command result
    } else if (op === "|") {
      // SSH-364: Use appropriate method for transforms vs commands
      // If result is a Promise (from && or || IIFE), await it first
      if (resultIsPromise) {
        result = `(await ${result})`;
        resultIsPromise = false;
      }

      // Transforms (like $.head, $.grep) need the output split into lines first
      if (part.isTransform) {
        if (resultIsStream) {
          // Stream producer (like $.cat) - need .lines() to split content into lines
          result = `${result}.lines().pipe(${part.code})`;
        } else {
          // Command - convert to line stream first, then apply transform
          result = `${result}.stdout().lines().pipe(${part.code})`;
        }
        resultIsStream = true; // Result is now a stream
      } else if (part.isStreamProducer) {
        // Part is a stream producer (like $.cat) - it can receive piped input
        result = `${result}.pipe(${part.code})`;
        resultIsStream = true;
      } else {
        // Part is a command - pipe to it
        if (resultIsStream) {
          // When piping from a stream to a command, need to use toCmdLines transform
          result = `${result}.pipe($.toCmdLines(${part.code}))`;
          resultIsStream = false;
        } else {
          // When piping from a command to a command, can pipe directly
          result = `${result}.pipe(${part.code})`;
          resultIsStream = false;
        }
      }
      resultIsPrintable = true; // Pipes always produce output
    } else if (op === ";") {
      // Sequential execution
      // SSH-362: Handle non-printable parts correctly
      if (!resultIsPrintable && !part.isPrintable) {
        // Both non-printable - just sequence them
        result = `${result}; ${part.code}`;
        resultIsPromise = false;
      } else if (resultIsPrintable) {
        // Await the previous result if it's a promise
        const resultExpr = resultIsPromise ? `await ${result}` : result;
        result = `(async () => { await __printCmd(${resultExpr}); return ${part.code}; })()`;
        resultIsPromise = true;
      } else {
        result = `(async () => { ${result}; return ${part.code}; })()`;
        resultIsPromise = true;
      }
      resultIsPrintable = part.isPrintable;
      resultIsStream = false; // ; resets to command result
    } else {
      // Default: pipe
      // If result is a Promise (from && or || IIFE), await it first
      if (resultIsPromise) {
        result = `(await ${result})`;
        resultIsPromise = false;
      }
      // Check if we need toCmdLines transform when piping from stream to command
      if (resultIsStream && !part.isTransform && !part.isStreamProducer) {
        result = `${result}.pipe($.toCmdLines(${part.code}))`;
      } else {
        result = `${result}.pipe(${part.code})`;
      }
      resultIsPrintable = true;
      resultIsStream = part.isStreamProducer || part.isTransform;
    }
  }

  // Handle negation (! operator)
  if (pipeline.negated) {
    result = `${result}.negate()`;
  }

  return { code: result, async: true, isStream: resultIsStream, isPrintable: resultIsPrintable };
}

/**
 * Flatten a nested pipeline tree into arrays of commands and operators
 * For "cmd1 && cmd2 || cmd3" which parses as Pipeline(Pipeline(cmd1 && cmd2) || cmd3),
 * we want: parts=[cmd1, cmd2, cmd3], operators=[&&, ||]
 */
function flattenPipeline(
  pipeline: AST.Pipeline,
  parts: PipelinePart[],
  operators: (string | null)[],
  ctx: VisitorContext,
): void {
  // Check if this pipeline uses pipe operator (|) - only then we're in a "true" pipeline
  const hasPipeOperator = pipeline.operator === "|";

  // Process left side (first command)
  const left = pipeline.commands[0];
  if (left) {
    if (left.type === "Command") {
      const result = buildCommand(left, ctx, { inPipeline: hasPipeOperator });
      // SSH-361: Track whether the command produces output that should be printed
      // async: true means it's a command that returns CommandResult
      // async: false means it's a variable assignment (no output to print)
      // SSH-364: Track if it's a transform or stream producer for proper pipeline handling
      parts.push({
        code: result.code,
        isPrintable: result.async,
        isTransform: result.isTransform ?? false,
        isStreamProducer: result.isStream ?? false,
      });
    } else if (left.type === "Pipeline") {
      flattenPipeline(left, parts, operators, ctx);
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      parts.push({ code: buildStatementAsExpression(left, ctx), isPrintable: true, isTransform: false, isStreamProducer: false });
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
      // SSH-364: Track if it's a transform or stream producer for proper pipeline handling
      parts.push({
        code: result.code,
        isPrintable: result.async,
        isTransform: result.isTransform ?? false,
        isStreamProducer: result.isStream ?? false,
      });
    } else if (cmd.type === "Pipeline") {
      flattenPipeline(cmd, parts, operators, ctx);
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      parts.push({ code: buildStatementAsExpression(cmd, ctx), isPrintable: true, isTransform: false, isStreamProducer: false });
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
    return { lines: [`${indent}for await (const __line of ${result.code}) { console.log(__line); }`] };
  }

  // SSH-372: Don't wrap non-printable results (like shell builtins) in __printCmd
  if (!result.isPrintable) {
    return { lines: [`${indent}${result.code};`] };
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
    if (ctx.isDeclared(stmt.name)) {
      // Already declared, just update value and export
      return `${stmt.name} = ${value}; Deno.env.set("${stmt.name}", ${stmt.name})`;
    } else {
      // First assignment - declare, set value, and export
      ctx.declareVariable(stmt.name, "let");
      return `let ${stmt.name} = ${value}; Deno.env.set("${stmt.name}", ${stmt.name})`;
    }
  }

  // Check if variable is already declared
  if (ctx.isDeclared(stmt.name)) {
    // Reassignment - no declaration keyword needed
    return `${stmt.name} = ${value}`;
  } else {
    // First assignment - declare with let (bash variables are mutable)
    ctx.declareVariable(stmt.name, "let");
    return `let ${stmt.name} = ${value}`;
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
