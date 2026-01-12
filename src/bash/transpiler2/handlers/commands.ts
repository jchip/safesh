/**
 * Command and Pipeline Handlers
 *
 * Transpiles Command and Pipeline AST nodes to TypeScript.
 * Uses fluent style for common text processing commands,
 * explicit $.cmd`` style for everything else.
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

// =============================================================================
// Command Handler
// =============================================================================

/**
 * Build a command expression (without await/semicolon)
 */
export function buildCommand(
  command: AST.Command,
  ctx: VisitorContext,
): ExpressionResult {
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

  // Check if any args contain dynamic values (template literals with ${)
  // If so, fluent command handlers can't parse them correctly at transpile-time
  const hasDynamicArgs = args.some((arg) => arg.includes("${"));

  // Use fluent style for common text processing commands (only with static args)
  if (isFluentCommand(name) && !hasDynamicArgs) {
    cmdExpr = buildFluentCommand(name, args, ctx);
  } else {
    // Use explicit $.cmd`` style
    const argsStr = args.length > 0 ? " " + args.join(" ") : "";
    cmdExpr = `$.cmd\`${name}${argsStr}\``;
  }

  // Apply redirections
  for (const redirect of command.redirects) {
    cmdExpr = applyRedirection(cmdExpr, redirect, ctx);
  }

  return { code: cmdExpr, async: isAsync };
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

    case "tr": {
      // $.tr(from, to)
      const from = args[0] ?? "";
      const to = args[1] ?? "";
      return `$.tr("${escapeForQuotes(from)}", "${escapeForQuotes(to)}")`;
    }

    case "cut": {
      // $.cut(options)
      const options: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "-d" && args[i + 1]) {
          options.push(`delimiter: "${escapeForQuotes(args[i + 1] ?? "")}"`);
          i++;
        } else if (arg?.startsWith("-d")) {
          options.push(`delimiter: "${escapeForQuotes(arg.slice(2))}"`);
        } else if (arg === "-f" && args[i + 1]) {
          options.push(`fields: [${args[i + 1]}]`);
          i++;
        } else if (arg?.startsWith("-f")) {
          options.push(`fields: [${arg.slice(2)}]`);
        }
      }
      return `$.cut({ ${options.join(", ")} })`;
    }

    case "sed":
    case "awk": {
      // Fall back to explicit style for complex commands
      const argsStr = args.length > 0 ? " " + args.join(" ") : "";
      return `$.cmd\`${name}${argsStr}\``;
    }

    default: {
      const argsStr = args.length > 0 ? " " + args.join(" ") : "";
      return `$.cmd\`${name}${argsStr}\``;
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

  if (result.async) {
    return { lines: [`${indent}await ${result.code};`] };
  }
  return { lines: [`${indent}${result.code};`] };
}

// =============================================================================
// Pipeline Handler
// =============================================================================

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
    // For other statement types, we need to wrap them
    return { code: "/* unsupported statement in pipeline */", async: true };
  }

  // Build pipeline chain by flattening nested pipelines
  const parts: string[] = [];
  const operators: (string | null)[] = [];

  // Flatten the pipeline tree into a list
  flattenPipeline(pipeline, parts, operators, ctx);

  // Build the chained expression
  if (parts.length === 0) return { code: "", async: false };

  let result = parts[0] ?? "";
  for (let i = 1; i < parts.length; i++) {
    const op = operators[i - 1];
    const part = parts[i];
    if (!part) continue;

    if (op === "&&") {
      result = `${result}.then(() => ${part})`;
    } else if (op === "||") {
      result = `${result}.catch(() => ${part})`;
    } else if (op === "|") {
      result = `${result}.pipe(${part})`;
    } else if (op === ";") {
      // Sequential execution - wrap in async IIFE
      result = `(async () => { await ${result}; return ${part}; })()`;
    } else {
      // Default: pipe
      result = `${result}.pipe(${part})`;
    }
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
  parts: string[],
  operators: (string | null)[],
  ctx: VisitorContext,
): void {
  // Process left side (first command)
  const left = pipeline.commands[0];
  if (left) {
    if (left.type === "Command") {
      parts.push(buildCommand(left, ctx).code);
    } else if (left.type === "Pipeline") {
      flattenPipeline(left, parts, operators, ctx);
    }
  }

  // For each subsequent command, add operator then command
  for (let i = 1; i < pipeline.commands.length; i++) {
    // Add the operator that connects to this command
    operators.push(pipeline.operator);

    const cmd = pipeline.commands[i];
    if (!cmd) continue;

    if (cmd.type === "Command") {
      parts.push(buildCommand(cmd, ctx).code);
    } else if (cmd.type === "Pipeline") {
      flattenPipeline(cmd, parts, operators, ctx);
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

  const result = buildPipeline(pipeline, ctx);

  if (pipeline.background) {
    return { lines: [`${indent}${result.code}; // background`] };
  }
  return { lines: [`${indent}await ${result.code};`] };
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
  if (stmt.value.type === "ArithmeticExpansion") {
    value = ctx.visitArithmetic(stmt.value.expression);
  } else {
    value = escapeForQuotes(ctx.visitWord(stmt.value as AST.Word));
  }

  // SSH-306: Handle exported variables
  if (stmt.exported) {
    // Exported variables need to be set in both local scope and environment
    if (ctx.isDeclared(stmt.name)) {
      // Already declared, just update value and export
      return `${stmt.name} = "${value}"; Deno.env.set("${stmt.name}", ${stmt.name})`;
    } else {
      // First assignment - declare, set value, and export
      ctx.declareVariable(stmt.name, "let");
      return `let ${stmt.name} = "${value}"; Deno.env.set("${stmt.name}", ${stmt.name})`;
    }
  }

  // Check if variable is already declared
  if (ctx.isDeclared(stmt.name)) {
    // Reassignment - no declaration keyword needed
    return `${stmt.name} = "${value}"`;
  } else {
    // First assignment - declare with let (bash variables are mutable)
    ctx.declareVariable(stmt.name, "let");
    return `let ${stmt.name} = "${value}"`;
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
