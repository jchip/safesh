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

  // Use fluent style for common text processing commands
  if (isFluentCommand(name)) {
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
      let n = 10; // default
      for (const arg of args) {
        if (arg?.startsWith("-n")) {
          n = parseInt(arg.slice(2)) || 10;
        } else if (arg?.startsWith("-")) {
          n = parseInt(arg.slice(1)) || 10;
        }
      }
      return `$.head(${n})`;
    }

    case "tail": {
      // $.tail(n) as transform
      let n = 10; // default
      for (const arg of args) {
        if (arg?.startsWith("-n")) {
          n = parseInt(arg.slice(2)) || 10;
        } else if (arg?.startsWith("-")) {
          n = parseInt(arg.slice(1)) || 10;
        }
      }
      return `$.tail(${n})`;
    }

    case "sort": {
      // $.sort(options) as transform
      const options: string[] = [];
      for (const arg of args) {
        if (arg === "-n") options.push("numeric: true");
        if (arg === "-r") options.push("reverse: true");
        if (arg === "-u") options.push("unique: true");
      }
      if (options.length > 0) {
        return `$.sort({ ${options.join(", ")} })`;
      }
      return "$.sort()";
    }

    case "uniq": {
      // $.uniq(options) as transform
      const options: string[] = [];
      for (const arg of args) {
        if (arg === "-c") options.push("count: true");
        if (arg === "-i") options.push("ignoreCase: true");
      }
      if (options.length > 0) {
        return `$.uniq({ ${options.join(", ")} })`;
      }
      return "$.uniq()";
    }

    case "wc": {
      // $.wc() or $.wc(options)
      const options: string[] = [];
      for (const arg of args) {
        if (arg === "-l") options.push("lines: true");
        if (arg === "-w") options.push("words: true");
        if (arg === "-c") options.push("bytes: true");
        if (arg === "-m") options.push("chars: true");
      }
      if (options.length > 0) {
        return `$.wc({ ${options.join(", ")} })`;
      }
      return "$.wc()";
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
      return `${cmdExpr}.stdout(${target})`;
    case ">>":
      return `${cmdExpr}.stdout(${target}, { append: true })`;
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

  // Build pipeline chain
  const parts: string[] = [];

  for (let i = 0; i < pipeline.commands.length; i++) {
    const cmd = pipeline.commands[i];
    if (!cmd) continue;

    if (cmd.type === "Command") {
      const cmdResult = buildCommand(cmd, ctx);

      if (i === 0) {
        parts.push(cmdResult.code);
      } else if (pipeline.operator === "&&") {
        parts.push(`.then(() => ${cmdResult.code})`);
      } else if (pipeline.operator === "||") {
        parts.push(`.catch(() => ${cmdResult.code})`);
      } else {
        // Pipe operator |
        parts.push(`.pipe(${cmdResult.code})`);
      }
    } else if (cmd.type === "Pipeline") {
      // Nested pipeline - recursively process
      const nested = visitPipeline(cmd, ctx);
      // Extract the expression from nested (this is a simplification)
      parts.push(`/* nested pipeline */`);
    }
  }

  const pipelineExpr = parts.join("");

  if (pipeline.background) {
    return { lines: [`${indent}${pipelineExpr}; // background`] };
  }
  return { lines: [`${indent}await ${pipelineExpr};`] };
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
  return `const ${stmt.name} = "${value}"`;
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
