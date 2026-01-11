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
      case "TestCommand":
        this.transpileTestCommand(statement);
        break;
      case "ArithmeticCommand":
        this.transpileArithmeticCommand(statement);
        break;
      case "CStyleForStatement":
        this.transpileCStyleForStatement(statement);
        break;
      default: {
        // Exhaustiveness check: this ensures all statement types are handled
        const _exhaustive: never = statement;
        throw new Error(`Unknown statement type: ${JSON.stringify(statement)}`);
      }
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
    this.transpileLoop(stmt, false);
  }

  private transpileUntilStatement(stmt: AST.UntilStatement): void {
    this.transpileLoop(stmt, true);
  }

  /**
   * Shared helper for transpiling while and until loops
   * @param breakOnSuccess - true for until (break when code === 0), false for while (break when code !== 0)
   */
  private transpileLoop(
    stmt: AST.WhileStatement | AST.UntilStatement,
    breakOnSuccess: boolean,
  ): void {
    this.emit("while (true) {");
    this.indentLevel++;

    const testVar = this.getTempVar();
    this.emit(`const ${testVar} = await ${this.buildTestExpression(stmt.test)};`);

    // Break condition differs: while breaks on failure (!== 0), until breaks on success (=== 0)
    const breakCondition = breakOnSuccess ? `${testVar}.code === 0` : `${testVar}.code !== 0`;
    this.emit(`if (${breakCondition}) break;`);
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
      // Arithmetic expansion not yet fully implemented
      // Emit a comment warning and use placeholder
      this.emit(`// WARNING: Arithmetic expansion not yet supported, using placeholder value`);
      value = "0";
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
  // Test Command ([[ ... ]])
  // ===========================================================================

  private transpileTestCommand(stmt: AST.TestCommand): void {
    const condition = this.transpileTestCondition(stmt.expression);
    this.emit(`if (${condition}) { /* test passed */ }`);
  }

  private transpileTestCondition(test: AST.TestCondition): string {
    switch (test.type) {
      case "UnaryTest":
        return this.transpileUnaryTest(test);
      case "BinaryTest":
        return this.transpileBinaryTest(test);
      case "LogicalTest":
        return this.transpileLogicalTest(test);
      case "StringTest":
        return this.transpileStringTest(test);
      default: {
        const _exhaustive: never = test;
        return "false";
      }
    }
  }

  private transpileUnaryTest(test: AST.UnaryTest): string {
    const arg = this.transpileWord(test.argument);

    switch (test.operator) {
      // File existence tests
      case "-e":
        return `await $.fs.exists(\`${arg}\`)`;
      case "-f":
        return `(await $.fs.stat(\`${arg}\`))?.isFile ?? false`;
      case "-d":
        return `(await $.fs.stat(\`${arg}\`))?.isDirectory ?? false`;
      case "-L":
      case "-h":
        return `(await $.fs.stat(\`${arg}\`))?.isSymlink ?? false`;
      case "-b":
        return `(await $.fs.stat(\`${arg}\`))?.isBlockDevice ?? false`;
      case "-c":
        return `(await $.fs.stat(\`${arg}\`))?.isCharDevice ?? false`;
      case "-p":
        return `(await $.fs.stat(\`${arg}\`))?.isFifo ?? false`;
      case "-S":
        return `(await $.fs.stat(\`${arg}\`))?.isSocket ?? false`;
      case "-t":
        return `Deno.isatty(Number(\`${arg}\`))`;

      // File permission tests
      case "-r":
        return `await $.fs.readable(\`${arg}\`)`;
      case "-w":
        return `await $.fs.writable(\`${arg}\`)`;
      case "-x":
        return `await $.fs.executable(\`${arg}\`)`;
      case "-s":
        return `((await $.fs.stat(\`${arg}\`))?.size ?? 0) > 0`;

      // File attribute tests
      case "-g":
        return `(((await $.fs.stat(\`${arg}\`))?.mode ?? 0) & 0o2000) !== 0`;
      case "-u":
        return `(((await $.fs.stat(\`${arg}\`))?.mode ?? 0) & 0o4000) !== 0`;
      case "-k":
        return `(((await $.fs.stat(\`${arg}\`))?.mode ?? 0) & 0o1000) !== 0`;
      case "-O":
        return `(await $.fs.stat(\`${arg}\`))?.uid === Deno.uid()`;
      case "-G":
        return `(await $.fs.stat(\`${arg}\`))?.gid === Deno.gid()`;
      case "-N":
        return `(await $.fs.stat(\`${arg}\`))?.mtime > (await $.fs.stat(\`${arg}\`))?.atime`;

      // String tests
      case "-z":
        return `(\`${arg}\`).length === 0`;
      case "-n":
        return `(\`${arg}\`).length > 0`;

      default: {
        const _exhaustive: never = test.operator;
        return "false";
      }
    }
  }

  private transpileBinaryTest(test: AST.BinaryTest): string {
    const left = this.transpileWord(test.left);
    const right = this.transpileWord(test.right);

    switch (test.operator) {
      // String comparison
      case "=":
      case "==":
        return `\`${left}\` === \`${right}\``;
      case "!=":
        return `\`${left}\` !== \`${right}\``;
      case "<":
        return `\`${left}\` < \`${right}\``;
      case ">":
        return `\`${left}\` > \`${right}\``;

      // Numeric comparison
      case "-eq":
        return `Number(\`${left}\`) === Number(\`${right}\`)`;
      case "-ne":
        return `Number(\`${left}\`) !== Number(\`${right}\`)`;
      case "-lt":
        return `Number(\`${left}\`) < Number(\`${right}\`)`;
      case "-le":
        return `Number(\`${left}\`) <= Number(\`${right}\`)`;
      case "-gt":
        return `Number(\`${left}\`) > Number(\`${right}\`)`;
      case "-ge":
        return `Number(\`${left}\`) >= Number(\`${right}\`)`;

      // File comparison
      case "-nt":
        return `(await $.fs.stat(\`${left}\`))?.mtime > (await $.fs.stat(\`${right}\`))?.mtime`;
      case "-ot":
        return `(await $.fs.stat(\`${left}\`))?.mtime < (await $.fs.stat(\`${right}\`))?.mtime`;
      case "-ef":
        return `(await $.fs.stat(\`${left}\`))?.ino === (await $.fs.stat(\`${right}\`))?.ino`;

      // Regex match
      case "=~":
        return `new RegExp(\`${right}\`).test(\`${left}\`)`;

      default: {
        const _exhaustive: never = test.operator;
        return "false";
      }
    }
  }

  private transpileLogicalTest(test: AST.LogicalTest): string {
    if (test.operator === "!") {
      return `!(${this.transpileTestCondition(test.right)})`;
    }

    const left = test.left ? this.transpileTestCondition(test.left) : "";
    const right = this.transpileTestCondition(test.right);

    if (test.operator === "&&") {
      return `(${left} && ${right})`;
    } else {
      return `(${left} || ${right})`;
    }
  }

  private transpileStringTest(test: AST.StringTest): string {
    const value = this.transpileWord(test.value);
    return `(\`${value}\`).length > 0`;
  }

  // ===========================================================================
  // Arithmetic Command ((( ... )))
  // ===========================================================================

  private transpileArithmeticCommand(stmt: AST.ArithmeticCommand): void {
    const expr = this.transpileArithmeticExpr(stmt.expression);
    this.emit(`${expr};`);
  }

  // ===========================================================================
  // C-Style For Statement
  // ===========================================================================

  private transpileCStyleForStatement(stmt: AST.CStyleForStatement): void {
    const init = stmt.init ? this.transpileArithmeticExpr(stmt.init) : "";
    const test = stmt.test ? this.transpileArithmeticExpr(stmt.test) : "true";
    const update = stmt.update ? this.transpileArithmeticExpr(stmt.update) : "";

    this.emit(`for (${init}; ${test}; ${update}) {`);
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
      // Build from parts if they contain expansions
      if (word.parts.length > 0) {
        return word.parts.map((part) => this.transpileWordPart(part)).join("");
      }
      // Fallback to escaped value
      return this.escapeForTemplate(word.value);
    } else if (word.type === "ParameterExpansion") {
      return this.transpileParameterExpansion(word);
    } else if (word.type === "CommandSubstitution") {
      return this.transpileCommandSubstitution(word);
    }

    // This should never be reached due to TypeScript's exhaustiveness checking
    const _exhaustive: never = word;
    return "";
  }

  private transpileWordPart(part: AST.WordPart): string {
    switch (part.type) {
      case "LiteralPart":
        return this.escapeForTemplate(part.value);
      case "ParameterExpansion":
        return this.transpileParameterExpansion(part);
      case "CommandSubstitution":
        return this.transpileCommandSubstitution(part);
      case "ArithmeticExpansion":
        return this.transpileArithmeticExpansion(part);
      case "ProcessSubstitution":
        return this.transpileProcessSubstitution(part);
      case "GlobPattern":
        // Glob patterns are passed through as literals
        return this.escapeForTemplate(part.pattern);
      default: {
        const _exhaustive: never = part;
        return "";
      }
    }
  }

  private transpileParameterExpansion(expansion: AST.ParameterExpansion): string {
    const param = expansion.parameter;
    const modifier = expansion.modifier;

    if (!modifier) {
      // Simple expansion: ${VAR} or $VAR
      return `\${${param}}`;
    }

    // Handle modifiers
    const modifierArg = expansion.modifierArg
      ? this.transpileWord(expansion.modifierArg)
      : "";

    switch (modifier) {
      case "length":
        // ${#VAR} - length of variable
        return `\${${param}.length}`;
      case ":-":
        // ${VAR:-default} - use default if unset or null
        return `\${${param} ?? "${this.escapeForQuotes(modifierArg)}"}`;
      case "-":
        // ${VAR-default} - use default if unset
        return `\${${param} !== undefined ? ${param} : "${this.escapeForQuotes(modifierArg)}"}`;
      case ":=":
      case "=":
        // ${VAR:=default} - assign default if unset
        return `\${${param} ??= "${this.escapeForQuotes(modifierArg)}"}`;
      case ":?":
      case "?":
        // ${VAR:?error} - error if unset
        return `\${${param} ?? (() => { throw new Error("${this.escapeForQuotes(modifierArg)}"); })()}`;
      case ":+":
      case "+":
        // ${VAR:+alternate} - use alternate if set
        return `\${${param} ? "${this.escapeForQuotes(modifierArg)}" : ""}`;
      case "#":
        // ${VAR#pattern} - remove shortest prefix
        return `\${${param}.replace(/^${this.escapeRegex(modifierArg)}/, "")}`;
      case "##":
        // ${VAR##pattern} - remove longest prefix
        return `\${${param}.replace(/^${this.escapeRegex(modifierArg)}.*?/, "")}`;
      case "%":
        // ${VAR%pattern} - remove shortest suffix
        return `\${${param}.replace(/${this.escapeRegex(modifierArg)}$/, "")}`;
      case "%%":
        // ${VAR%%pattern} - remove longest suffix
        return `\${${param}.replace(/.*?${this.escapeRegex(modifierArg)}$/, "")}`;
      case "^":
        // ${VAR^} - uppercase first char
        return `\${${param}.charAt(0).toUpperCase() + ${param}.slice(1)}`;
      case "^^":
        // ${VAR^^} - uppercase all
        return `\${${param}.toUpperCase()}`;
      case ",":
        // ${VAR,} - lowercase first char
        return `\${${param}.charAt(0).toLowerCase() + ${param}.slice(1)}`;
      case ",,":
        // ${VAR,,} - lowercase all
        return `\${${param}.toLowerCase()}`;
      case "/":
        // ${VAR/pattern/replacement} - replace first
        const [pattern, replacement] = modifierArg.split("/");
        return `\${${param}.replace("${this.escapeForQuotes(pattern || "")}", "${this.escapeForQuotes(replacement || "")}")}`;
      case "//":
        // ${VAR//pattern/replacement} - replace all
        const [pat, rep] = modifierArg.split("/");
        return `\${${param}.replaceAll("${this.escapeForQuotes(pat || "")}", "${this.escapeForQuotes(rep || "")}")}`;
      default:
        // Unknown modifier, just use simple expansion
        return `\${${param}}`;
    }
  }

  private transpileCommandSubstitution(cs: AST.CommandSubstitution): string {
    // Transpile the inner commands and wrap in an async IIFE that captures output
    const innerStatements = cs.command
      .map((stmt) => {
        // Create a temporary transpiler instance for inner commands
        const innerOutput: string[] = [];
        const saveOutput = this.output;
        const saveLevel = this.indentLevel;
        this.output = innerOutput;
        this.indentLevel = 0;
        this.transpileStatement(stmt);
        this.output = saveOutput;
        this.indentLevel = saveLevel;
        return innerOutput.join(" ");
      })
      .join(" ");

    // Generate inline command substitution that captures stdout
    return `\${await (async () => { const __result = ${innerStatements.replace(/^await /, "").replace(/;$/, "")}; return (await __result.text()).trim(); })()}`;
  }

  private transpileArithmeticExpansion(arith: AST.ArithmeticExpansion): string {
    return `\${${this.transpileArithmeticExpr(arith.expression)}}`;
  }

  private transpileArithmeticExpr(expr: AST.ArithmeticExpression): string {
    switch (expr.type) {
      case "NumberLiteral":
        return expr.value.toString();
      case "VariableReference":
        return `Number(${expr.name})`;
      case "BinaryArithmeticExpression": {
        const left = this.transpileArithmeticExpr(expr.left);
        const right = this.transpileArithmeticExpr(expr.right);
        // Handle assignment operators specially
        if (expr.operator.endsWith("=") && expr.operator !== "==" && expr.operator !== "!=") {
          // Assignment: a += b, etc.
          return `(${left} ${expr.operator} ${right})`;
        }
        return `(${left} ${expr.operator} ${right})`;
      }
      case "UnaryArithmeticExpression": {
        const arg = this.transpileArithmeticExpr(expr.argument);
        if (expr.prefix) {
          return `(${expr.operator}${arg})`;
        } else {
          return `(${arg}${expr.operator})`;
        }
      }
      case "ConditionalArithmeticExpression": {
        const test = this.transpileArithmeticExpr(expr.test);
        const cons = this.transpileArithmeticExpr(expr.consequent);
        const alt = this.transpileArithmeticExpr(expr.alternate);
        return `(${test} ? ${cons} : ${alt})`;
      }
      case "AssignmentExpression": {
        const right = this.transpileArithmeticExpr(expr.right);
        return `(${expr.left.name} ${expr.operator} ${right})`;
      }
      case "GroupedArithmeticExpression":
        return `(${this.transpileArithmeticExpr(expr.expression)})`;
      default: {
        const _exhaustive: never = expr;
        return "0";
      }
    }
  }

  private transpileProcessSubstitution(ps: AST.ProcessSubstitution): string {
    // Process substitution creates a temp file and returns its path
    // The inner command writes to (>()) or reads from (<()) the file
    const innerStatements = ps.command
      .map((stmt) => {
        const innerOutput: string[] = [];
        const saveOutput = this.output;
        const saveLevel = this.indentLevel;
        this.output = innerOutput;
        this.indentLevel = 0;
        this.transpileStatement(stmt);
        this.output = saveOutput;
        this.indentLevel = saveLevel;
        return innerOutput.join(" ");
      })
      .join(" ");

    if (ps.operator === "<(") {
      // Input process substitution: command writes to temp file, we return path
      return `\${await (async () => { const __tmpFile = await Deno.makeTempFile(); const __cmd = ${innerStatements.replace(/^await /, "").replace(/;$/, "")}; await Deno.writeTextFile(__tmpFile, await __cmd.text()); return __tmpFile; })()}`;
    } else {
      // Output process substitution: we return temp file path, command will read from it
      return `\${await (async () => { const __tmpFile = await Deno.makeTempFile(); return __tmpFile; })()}`;
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
