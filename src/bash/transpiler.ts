/**
 * Bash to TypeScript Transpiler for SafeShell
 *
 * Converts a bash AST into TypeScript code using SafeShell's $ APIs.
 * Produces executable TypeScript that can be run in Deno.
 */

import type * as AST from "./ast.ts";

// =============================================================================
// Transpiler Options
// =============================================================================

export interface TranspilerOptions {
  /** Indent string (default: "  ") */
  indent?: string;
  /** Add type annotations (default: true) */
  types?: boolean;
  /** Use strict mode (default: true) */
  strict?: boolean;
  /** Generate imports (default: true) */
  imports?: boolean;
}

// =============================================================================
// Transpiler Class
// =============================================================================

export class Transpiler {
  private options: Required<TranspilerOptions>;
  private indentLevel = 0;
  private output: string[] = [];
  private variableCounter = 0;

  constructor(options: TranspilerOptions = {}) {
    this.options = {
      indent: options.indent ?? "  ",
      types: options.types ?? true,
      strict: options.strict ?? true,
      imports: options.imports ?? true,
    };
  }

  // ===========================================================================
  // Main Entry Point
  // ===========================================================================

  public transpile(program: AST.Program): string {
    this.output = [];
    this.indentLevel = 0;

    // Add imports
    if (this.options.imports) {
      this.emit('import { $ } from "./mod.ts";');
      this.emit("");
    }

    // Add strict mode
    if (this.options.strict) {
      this.emit('"use strict";');
      this.emit("");
    }

    // Wrap in async IIFE
    this.emit("(async () => {");
    this.indentLevel++;

    // Transpile statements
    for (const statement of program.body) {
      this.transpileStatement(statement);
    }

    this.indentLevel--;
    this.emit("})();");

    return this.output.join("\n");
  }

  // ===========================================================================
  // Statements
  // ===========================================================================

  private transpileStatement(statement: AST.Statement): void {
    switch (statement.type) {
      case "Pipeline":
        this.transpilePipeline(statement);
        break;
      case "Command":
        this.transpileCommand(statement);
        break;
      case "IfStatement":
        this.transpileIfStatement(statement);
        break;
      case "ForStatement":
        this.transpileForStatement(statement);
        break;
      case "WhileStatement":
        this.transpileWhileStatement(statement);
        break;
      case "UntilStatement":
        this.transpileUntilStatement(statement);
        break;
      case "CaseStatement":
        this.transpileCaseStatement(statement);
        break;
      case "FunctionDeclaration":
        this.transpileFunctionDeclaration(statement);
        break;
      case "VariableAssignment":
        this.transpileVariableAssignment(statement);
        break;
      case "Subshell":
        this.transpileSubshell(statement);
        break;
      case "BraceGroup":
        this.transpileBraceGroup(statement);
        break;
      default:
        throw new Error(`Unknown statement type: ${(statement as any).type}`);
    }
  }

  // ===========================================================================
  // Pipeline
  // ===========================================================================

  private transpilePipeline(pipeline: AST.Pipeline): void {
    if (pipeline.commands.length === 1 && !pipeline.background) {
      // Single command, no pipeline
      const cmd = pipeline.commands[0];
      if (!cmd) return;

      if (cmd.type === "Command") {
        this.emit(`await ${this.buildCommand(cmd)};`);
      } else {
        this.transpileStatement(cmd);
      }
      return;
    }

    // Build pipeline chain
    const parts: string[] = [];

    for (let i = 0; i < pipeline.commands.length; i++) {
      const cmd = pipeline.commands[i];
      if (!cmd) continue;

      if (cmd.type === "Command") {
        const cmdExpr = this.buildCommand(cmd, i > 0); // Skip await for piped commands

        if (i === 0) {
          parts.push(cmdExpr);
        } else if (pipeline.operator === "&&") {
          parts.push(`.then(() => ${cmdExpr})`);
        } else if (pipeline.operator === "||") {
          parts.push(`.catch(() => ${cmdExpr})`);
        } else {
          parts.push(`.pipe(${cmdExpr})`);
        }
      } else {
        throw new Error("Nested pipelines not yet supported");
      }
    }

    const pipelineExpr = parts.join("");

    if (pipeline.background) {
      this.emit(`${pipelineExpr}; // background`);
    } else {
      this.emit(`await ${pipelineExpr};`);
    }
  }

  // ===========================================================================
  // Command
  // ===========================================================================

  private transpileCommand(command: AST.Command): void {
    this.emit(`await ${this.buildCommand(command)};`);
  }

  private buildCommand(command: AST.Command, skipAwait = false): string {
    // Handle variable assignments
    const hasNoCommand = command.name.type === "Word" && command.name.value === "";
    if (command.assignments.length > 0 && hasNoCommand) {
      // Pure assignment
      return command.assignments
        .map((a) => this.buildVariableAssignment(a))
        .join(", ");
    }

    const name = this.transpileWord(command.name);
    const args = command.args.map((arg) => this.transpileWord(arg)).join(" ");

    let cmdExpr = `$.cmd\`${name}${args ? " " + args : ""}\``;

    // Handle redirections
    for (const redirect of command.redirects) {
      cmdExpr = this.applyRedirection(cmdExpr, redirect);
    }

    return cmdExpr;
  }

  // ===========================================================================
  // Control Flow
  // ===========================================================================

  private transpileIfStatement(stmt: AST.IfStatement): void {
    // Build test condition
    const testVar = this.getTempVar();
    this.emit(`const ${testVar} = await ${this.buildTestExpression(stmt.test)};`);

    this.emit(`if (${testVar}.code === 0) {`);
    this.indentLevel++;

    for (const s of stmt.consequent) {
      this.transpileStatement(s);
    }

    this.indentLevel--;

    if (stmt.alternate) {
      if (Array.isArray(stmt.alternate)) {
        this.emit("} else {");
        this.indentLevel++;

        for (const s of stmt.alternate) {
          this.transpileStatement(s);
        }

        this.indentLevel--;
        this.emit("}");
      } else {
        this.emit("} else ");
        // Inline the else-if
        this.indentLevel++;
        this.transpileIfStatement(stmt.alternate);
        this.indentLevel--;
      }
    } else {
      this.emit("}");
    }
  }

  private transpileForStatement(stmt: AST.ForStatement): void {
    const items = stmt.iterable.map((item) => this.transpileWord(item));
    const itemsExpr = `[${items.map((i) => `"${i}"`).join(", ")}]`;

    this.emit(`for (const ${stmt.variable} of ${itemsExpr}) {`);
    this.indentLevel++;

    for (const s of stmt.body) {
      this.transpileStatement(s);
    }

    this.indentLevel--;
    this.emit("}");
  }

  private transpileWhileStatement(stmt: AST.WhileStatement): void {
    this.emit("while (true) {");
    this.indentLevel++;

    const testVar = this.getTempVar();
    this.emit(`const ${testVar} = await ${this.buildTestExpression(stmt.test)};`);
    this.emit(`if (${testVar}.code !== 0) break;`);
    this.emit("");

    for (const s of stmt.body) {
      this.transpileStatement(s);
    }

    this.indentLevel--;
    this.emit("}");
  }

  private transpileUntilStatement(stmt: AST.UntilStatement): void {
    this.emit("while (true) {");
    this.indentLevel++;

    const testVar = this.getTempVar();
    this.emit(`const ${testVar} = await ${this.buildTestExpression(stmt.test)};`);
    this.emit(`if (${testVar}.code === 0) break;`);
    this.emit("");

    for (const s of stmt.body) {
      this.transpileStatement(s);
    }

    this.indentLevel--;
    this.emit("}");
  }

  private transpileCaseStatement(stmt: AST.CaseStatement): void {
    const wordVar = this.getTempVar();
    const word = this.transpileWord(stmt.word);
    this.emit(`const ${wordVar} = "${word}";`);

    let first = true;

    for (const caseClause of stmt.cases) {
      const patterns = caseClause.patterns
        .map((p) => this.transpileWord(p))
        .map((p) => `${wordVar} === "${p}"`)
        .join(" || ");

      if (first) {
        this.emit(`if (${patterns}) {`);
        first = false;
      } else {
        this.emit(`} else if (${patterns}) {`);
      }

      this.indentLevel++;

      for (const s of caseClause.body) {
        this.transpileStatement(s);
      }

      this.indentLevel--;
    }

    this.emit("}");
  }

  private transpileFunctionDeclaration(stmt: AST.FunctionDeclaration): void {
    this.emit(`async function ${stmt.name}() {`);
    this.indentLevel++;

    for (const s of stmt.body) {
      this.transpileStatement(s);
    }

    this.indentLevel--;
    this.emit("}");
  }

  // ===========================================================================
  // Variables
  // ===========================================================================

  private transpileVariableAssignment(stmt: AST.VariableAssignment): void {
    this.emit(this.buildVariableAssignment(stmt) + ";");
  }

  private buildVariableAssignment(stmt: AST.VariableAssignment): string {
    let value: string;
    if (stmt.value.type === "ArithmeticExpansion") {
      value = "0"; // Simplified arithmetic handling
    } else {
      value = this.escapeForQuotes(this.transpileWord(stmt.value));
    }
    return `const ${stmt.name} = "${value}"`;
  }

  // ===========================================================================
  // Grouping
  // ===========================================================================

  private transpileSubshell(stmt: AST.Subshell): void {
    this.emit("(async () => {");
    this.indentLevel++;

    for (const s of stmt.body) {
      this.transpileStatement(s);
    }

    this.indentLevel--;
    this.emit("})();");
  }

  private transpileBraceGroup(stmt: AST.BraceGroup): void {
    this.emit("{");
    this.indentLevel++;

    for (const s of stmt.body) {
      this.transpileStatement(s);
    }

    this.indentLevel--;
    this.emit("}");
  }

  // ===========================================================================
  // Words and Expansions
  // ===========================================================================

  private transpileWord(
    word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  ): string {
    if (word.type === "Word") {
      // Escape the value to prevent injection in template literals
      return this.escapeForTemplate(word.value);
    } else if (word.type === "ParameterExpansion") {
      // Variable expansion - keep the syntax
      return `\${${word.parameter}}`;
    } else if (word.type === "CommandSubstitution") {
      // TODO: Handle command substitution properly
      return "$(...)";
    }

    return "";
  }

  // ===========================================================================
  // Redirections
  // ===========================================================================

  private applyRedirection(cmdExpr: string, redirect: AST.Redirection): string {
    const target = typeof redirect.target === "number"
      ? redirect.target.toString()
      : `"${this.escapeForQuotes(this.transpileWord(redirect.target))}"`;

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
      default:
        return cmdExpr;
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Escape a string for safe inclusion in template literals
   * Prevents injection attacks by escaping backticks, backslashes, and ${
   */
  private escapeForTemplate(str: string): string {
    return str
      .replace(/\\/g, "\\\\")  // Escape backslashes
      .replace(/`/g, "\\`")     // Escape backticks
      .replace(/\$\{/g, "\\${") // Escape template literal interpolation
      .replace(/\$/g, "\\$");   // Escape dollar signs
  }

  /**
   * Escape a string for safe inclusion in double-quoted strings
   * Used for redirect targets and variable values
   */
  private escapeForQuotes(str: string): string {
    return str
      .replace(/\\/g, "\\\\")   // Escape backslashes
      .replace(/"/g, '\\"')     // Escape double quotes
      .replace(/\n/g, "\\n")    // Escape newlines
      .replace(/\r/g, "\\r")    // Escape carriage returns
      .replace(/\t/g, "\\t");   // Escape tabs
  }

  private buildTestExpression(test: AST.Pipeline | AST.Command): string {
    if (test.type === "Pipeline") {
      // For now, build the first command
      if (test.commands[0]?.type === "Command") {
        return this.buildCommand(test.commands[0]);
      }
    } else {
      return this.buildCommand(test);
    }

    throw new Error("Invalid test expression");
  }

  private emit(line: string): void {
    const indent = this.options.indent.repeat(this.indentLevel);
    this.output.push(indent + line);
  }

  private getTempVar(): string {
    return `_tmp${this.variableCounter++}`;
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

export function transpile(
  program: AST.Program,
  options?: TranspilerOptions,
): string {
  const transpiler = new Transpiler(options);
  return transpiler.transpile(program);
}
