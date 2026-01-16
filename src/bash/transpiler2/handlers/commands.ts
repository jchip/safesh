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
 * @returns The parsed count, or the default value if not found
 */
function parseCountArg(args: string[], defaultValue = 10): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-n" && args[i + 1]) {
      // -n 20 (with space)
      return parseInt(args[i + 1] ?? "") || defaultValue;
    } else if (arg?.startsWith("-n")) {
      // -n20 (without space)
      return parseInt(arg.slice(2)) || defaultValue;
    } else if (arg?.startsWith("-") && /^-\d+$/.test(arg)) {
      // -20 shorthand
      return parseInt(arg.slice(1)) || defaultValue;
    }
  }
  return defaultValue;
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
export function buildCommand(
  command: AST.Command,
  ctx: VisitorContext,
): ExpressionResult & { isUserFunction?: boolean } {
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

  // Check if command has environment variable assignments
  const hasAssignments = command.assignments.length > 0 && !hasNoCommand;

  // Check if this is a user-defined function call
  if (ctx.isFunction(name)) {
    // Call the function directly
    cmdExpr = `${name}()`;
    isAsync = true;
    isUserFunction = true;
  } else {
    // Check if any args contain dynamic values (template literals with ${)
    // If so, fluent command handlers can't parse them correctly at transpile-time
    const hasDynamicArgs = args.some((arg) => arg.includes("${"));

    // SSH-359: Check if command has heredoc redirections
    // Fluent API ($.cat, etc.) doesn't support .stdin() method, so use $.cmd() style
    const hasHeredoc = command.redirects.some(
      (r) => r.operator === "<<" || r.operator === "<<-"
    );

    // Use fluent style for common text processing commands (only with static args)
    // BUT: env assignments and heredocs force explicit $.cmd() style
    if (isFluentCommand(name) && !hasDynamicArgs && !hasAssignments && !hasHeredoc) {
      cmdExpr = buildFluentCommand(name, args, ctx);
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
      // $.cmd() returns a CommandFn that needs to be called to get a Command
      const argsArray = args.length > 0 ? args.map(formatArg).join(", ") : "";
      cmdExpr = `(await $.cmd("${escapeForQuotes(name)}"))(${argsArray})`;
    }
  }

  // Apply redirections
  for (const redirect of command.redirects) {
    cmdExpr = applyRedirection(cmdExpr, redirect, ctx);
  }

  return { code: cmdExpr, async: isAsync, isUserFunction };
}

/**
 * Build a fluent-style command (cat, grep, etc.)
 */
function buildFluentCommand(
  name: string,
  args: string[],
  _ctx: VisitorContext,
): string {
  switch (name) {
    case "cat": {
      // $.cat(file) or $.cat(file1, file2, ...)
      if (args.length === 0) {
        return '$.cat("-")'; // Read from stdin
      }
      const files = args.map((a) => `"${escapeForQuotes(a)}"`).join(", ");
      return `$.cat(${files})`;
    }

    case "grep": {
      // $.grep(pattern) as transform or $.grep(pattern, file)
      // Parse grep options
      let pattern = "";
      let files: string[] = [];
      let invert = false;
      let ignoreCase = false;
      let lineNumber = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-v") {
          invert = true;
        } else if (arg === "-i") {
          ignoreCase = true;
        } else if (arg === "-n") {
          lineNumber = true;
        } else if (arg?.startsWith("-")) {
          // Skip other options
        } else if (!pattern) {
          pattern = arg ?? "";
        } else {
          files.push(arg ?? "");
        }
      }

      const escapedPattern = escapeForQuotes(pattern);
      const flags = ignoreCase ? "i" : "";
      const regexPattern = `/${escapedPattern}/${flags}`;

      if (files.length > 0) {
        // grep pattern file -> $.cat(file).grep(pattern)
        const file = `"${escapeForQuotes(files[0] ?? "")}"`;
        let result = `$.cat(${file}).grep(${regexPattern})`;
        if (invert) result += ".filter(x => !x.match)";
        if (lineNumber) result += '.map(m => `${m.line}:${m.content}`)';
        return result;
      }

      // grep as a transform
      return `$.grep(${regexPattern})`;
    }

    case "head": {
      // $.head(n) as transform
      const n = parseCountArg(args);
      return `$.head(${n})`;
    }

    case "tail": {
      // $.tail(n) as transform
      const n = parseCountArg(args);
      return `$.tail(${n})`;
    }

    case "sort": {
      // $.sort(options) as transform
      const options = collectFlagOptions(args, {
        "-n": "numeric: true",
        "-r": "reverse: true",
        "-u": "unique: true",
      });
      return options.length > 0 ? `$.sort({ ${options.join(", ")} })` : "$.sort()";
    }

    case "uniq": {
      // $.uniq(options) as transform
      const options = collectFlagOptions(args, {
        "-c": "count: true",
        "-i": "ignoreCase: true",
      });
      return options.length > 0 ? `$.uniq({ ${options.join(", ")} })` : "$.uniq()";
    }

    case "wc": {
      // $.wc() or $.wc(options)
      const options = collectFlagOptions(args, {
        "-l": "lines: true",
        "-w": "words: true",
        "-c": "bytes: true",
        "-m": "chars: true",
      });
      return options.length > 0 ? `$.wc({ ${options.join(", ")} })` : "$.wc()";
    }

    case "tee": {
      // $.tee(file)
      const file = args[0] ?? "-";
      return `$.tee("${escapeForQuotes(file)}")`;
    }

    // tr, cut, sed, awk are not fluent commands - they fall through to default
    default: {
      const argsArray = args.length > 0 ? args.map(a => `"${escapeForQuotes(a)}"`).join(", ") : "";
      return `(await $.cmd("${escapeForQuotes(name)}"))(${argsArray})`;
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
}

/**
 * Build a pipeline expression (without await/semicolon)
 */
export function buildPipeline(
  pipeline: AST.Pipeline,
  ctx: VisitorContext,
): ExpressionResult {
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

  let result = parts[0]?.code ?? "";
  let resultIsPrintable = parts[0]?.isPrintable ?? false;

  for (let i = 1; i < parts.length; i++) {
    const op = operators[i - 1];
    const part = parts[i];
    if (!part) continue;

    if (op === "&&") {
      // SSH-361: Only wrap with __printCmd if the part produces command output
      // Variable assignments (isPrintable: false) should just be executed
      if (resultIsPrintable) {
        result = `(async () => { await __printCmd(${result}); return ${part.code}; })()`;
      } else {
        result = `(async () => { ${result}; return ${part.code}; })()`;
      }
      resultIsPrintable = part.isPrintable;
    } else if (op === "||") {
      // SSH-361: Only wrap with __printCmd if the part produces command output
      if (resultIsPrintable) {
        result = `(async () => { try { await __printCmd(${result}); return { code: 0, stdout: '', stderr: '', success: true }; } catch { return ${part.code}; } })()`;
      } else {
        result = `(async () => { try { ${result}; return { code: 0, stdout: '', stderr: '', success: true }; } catch { return ${part.code}; } })()`;
      }
      resultIsPrintable = part.isPrintable;
    } else if (op === "|") {
      result = `${result}.pipe(${part.code})`;
      resultIsPrintable = true; // Pipes always produce output
    } else if (op === ";") {
      // Sequential execution - wrap in async IIFE
      if (resultIsPrintable) {
        result = `(async () => { await __printCmd(${result}); return ${part.code}; })()`;
      } else {
        result = `(async () => { ${result}; return ${part.code}; })()`;
      }
      resultIsPrintable = part.isPrintable;
    } else {
      // Default: pipe
      result = `${result}.pipe(${part.code})`;
      resultIsPrintable = true;
    }
  }

  // Handle negation (! operator)
  if (pipeline.negated) {
    result = `${result}.negate()`;
  }

  return { code: result, async: true };
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
  // Process left side (first command)
  const left = pipeline.commands[0];
  if (left) {
    if (left.type === "Command") {
      const result = buildCommand(left, ctx);
      // SSH-361: Track whether the command produces output that should be printed
      // async: true means it's a command that returns CommandResult
      // async: false means it's a variable assignment (no output to print)
      parts.push({ code: result.code, isPrintable: result.async });
    } else if (left.type === "Pipeline") {
      flattenPipeline(left, parts, operators, ctx);
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      parts.push({ code: buildStatementAsExpression(left, ctx), isPrintable: true });
    }
  }

  // For each subsequent command, add operator then command
  for (let i = 1; i < pipeline.commands.length; i++) {
    // Add the operator that connects to this command
    operators.push(pipeline.operator);

    const cmd = pipeline.commands[i];
    if (!cmd) continue;

    if (cmd.type === "Command") {
      const result = buildCommand(cmd, ctx);
      // SSH-361: Track whether the command produces output that should be printed
      parts.push({ code: result.code, isPrintable: result.async });
    } else if (cmd.type === "Pipeline") {
      flattenPipeline(cmd, parts, operators, ctx);
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      parts.push({ code: buildStatementAsExpression(cmd, ctx), isPrintable: true });
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
    return { lines: [`${indent}${result.code}; // background`] };
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
