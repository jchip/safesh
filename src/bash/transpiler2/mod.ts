/**
 * Bash to TypeScript Transpiler v2
 *
 * Visitor-pattern based transpiler with hybrid output style.
 * - Fluent style for common text processing commands (cat, grep, etc.)
 * - Explicit style for complex logic and control flow
 */

import type * as AST from "../ast.ts";
import {
  type ExpressionResult,
  type ResolvedOptions,
  resolveOptions,
  type StatementResult,
  type TranspilerOptions,
  type VisitorContext,
} from "./types.ts";
import { TranspilerContext } from "./context.ts";
import { OutputEmitter } from "./emitter.ts";
import * as handlers from "./handlers/mod.ts";

// Re-exports
export type {
  ExpressionResult,
  ResolvedOptions,
  StatementResult,
  TranspilerOptions,
  VisitorContext,
} from "./types.ts";
export { FLUENT_COMMANDS, isFluentCommand, resolveOptions } from "./types.ts";
export {
  FLUENT_COMMAND_CAPABILITIES,
  FLUENT_COMMAND_NAMES,
  getFluentCommandCapability,
  getGrepCommandCapability,
  getSimpleTransformCapability,
} from "./command-capabilities.ts";
export type {
  CommandDataMode,
  CommandOutputMode,
  FluentCommandCapability,
  GrepCommandCapability,
  SimpleTransformCapability,
} from "./command-capabilities.ts";
export { lowerShellBuiltin } from "./builtin-lowering.ts";
export type { BuiltinLoweringOptions, BuiltinLoweringResult } from "./builtin-lowering.ts";
export type { ASTVisitor } from "./visitor.ts";
export { TranspilerContext } from "./context.ts";
export { OutputEmitter } from "./emitter.ts";

// =============================================================================
// BashTranspiler2 Class
// =============================================================================

/**
 * Main transpiler class that coordinates context, emitter, and handlers.
 */
export class BashTranspiler2 {
  private readonly options: ResolvedOptions;

  constructor(options?: TranspilerOptions) {
    this.options = resolveOptions(options);
  }

  /**
   * Transpile a bash AST program to TypeScript code.
   */
  transpile(program: AST.Program): string {
    const ctx = new TranspilerContext(this.options);
    const emitter = new OutputEmitter(ctx);

    // Create visitor context that bridges handlers
    const visitorCtx = this.createVisitorContext(ctx, emitter);

    // Add import for $
    if (this.options.imports) {
      emitter.addImport(this.options.importPath, "$");
    }

    // Add strict mode
    if (this.options.strict) {
      emitter.emit('"use strict";');
      emitter.emitBlank();
    }

    // Wrap in async IIFE
    emitter.emit("(async () => {");
    ctx.indent();

    // Transpile statements
    for (const statement of program.body) {
      const result = this.visitStatement(statement, visitorCtx);
      // SSH-507: Use startsWith+slice instead of String.replace to only strip
      // leading indentation. String.replace removes the first occurrence anywhere
      // in the line, which corrupts code if the indent string appears in content.
      const indent = ctx.getIndent();
      emitter.emitLines(result.lines.map((l) => l.startsWith(indent) ? l.slice(indent.length) : l));
    }

    ctx.dedent();
    emitter.emit("})();");

    return emitter.toString();
  }

  /**
   * Create a VisitorContext that provides the interface for handlers.
   */
  private createVisitorContext(
    ctx: TranspilerContext,
    _emitter: OutputEmitter,
  ): VisitorContext {
    const self = this;
    // SSH-584: depth of subshell scopes currently being emitted
    let subshellDepth = 0;

    return {
      getIndent: () => ctx.getIndent(),
      indent: () => ctx.indent(),
      dedent: () => ctx.dedent(),
      getTempVar: (prefix?: string) => ctx.getTempVar(prefix),
      getOptions: () => ctx.getOptions(),
      isDeclared: (name: string) => ctx.isDeclared(name),
      declareVariable: (name: string, type?: "const" | "let") => ctx.declareVariable(name, type),
      pushScope: () => ctx.pushScope(),
      popScope: () => ctx.popScope(),
      declareFunction: (name: string) => ctx.declareFunction(name),
      isFunction: (name: string) => ctx.isFunction(name),
      addDiagnostic: (diagnostic) => ctx.addDiagnostic(diagnostic),
      getDiagnostics: () => ctx.getDiagnostics(),
      getStdoutCapture: () => ctx.getStdoutCapture(),
      setStdoutCapture: (varName) => ctx.setStdoutCapture(varName),
      isInSubshell: () => subshellDepth > 0,
      enterSubshell: () => {
        subshellDepth++;
      },
      exitSubshell: () => {
        subshellDepth--;
      },

      visitStatement(stmt: AST.Statement): StatementResult {
        return self.visitStatement(stmt, this);
      },

      visitWord(
        word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
      ): string {
        return handlers.visitWord(word, this);
      },

      visitTestCondition(test: AST.TestCondition): string {
        return handlers.visitTestCondition(test, this);
      },

      visitArithmetic(expr: AST.ArithmeticExpression): string {
        return handlers.visitArithmeticExpression(expr, this);
      },

      buildCommand(
        cmd: AST.Command,
        options?: { inPipeline?: boolean; captureOutput?: boolean },
      ): ExpressionResult {
        return handlers.buildCommand(cmd, this, options);
      },

      buildCommandExpression(stmt: AST.Command | AST.Pipeline): ExpressionResult {
        if (stmt.type === "Command") {
          return handlers.buildCommand(stmt, this, { captureOutput: true });
        } else {
          return handlers.buildPipeline(stmt, this);
        }
      },

      buildTestExpression(
        test: AST.Pipeline | AST.Command | AST.TestCommand | AST.ArithmeticCommand,
      ): ExpressionResult {
        if (test.type === "TestCommand") {
          // For [[ ... ]] test commands, return the expression result directly
          const expr = handlers.visitTestCondition(test.expression, this);
          return { code: `{ code: (${expr}) ? 0 : 1, stdout: '', stderr: '' }`, async: true };
        }
        if (test.type === "ArithmeticCommand") {
          // For (( ... )) arithmetic commands, evaluate and return result
          const expr = this.visitArithmetic(test.expression);
          return { code: `{ code: (${expr}) ? 0 : 1, stdout: '', stderr: '' }`, async: false };
        }
        // SSH-645: a fluent pipeline/command used as a test condition
        // (`until cmd | grep -q x`, `while grep -q x file`) lowers to a
        // FluentStream. Awaiting it yields the stream object itself (no `.code`),
        // so every if/while/until break test silently read `undefined` — `until`
        // never terminated (infinite loop) and `while`/`if` never entered. Route
        // stream-typed conditions through __captureCmd so the stream is consumed
        // and its exit status (grep's getEmptyExitCode: empty→1, non-empty→0)
        // becomes a real `.code`. Non-stream commands (e.g. `if echo hi`) are
        // left untouched so their side-effect stdout still prints, as in bash.
        const captureIfStream = (
          r: ExpressionResult & { isStream?: boolean },
        ): ExpressionResult => (r.isStream ? { code: `__captureCmd(${r.code})`, async: true } : r);

        if (test.type === "Pipeline") {
          // Handle && and || chains (e.g., [ $x -gt 0 ] && [ $x -lt 10 ])
          // The chain-level `negated` flag mirrors the LEADING operand's flag
          // (parser convention, see SSH-594 notes in handlers/commands.ts) and
          // the operand applies it itself, so it is intentionally ignored here.
          if (test.commands.length > 1 && (test.operator === "&&" || test.operator === "||")) {
            const jsOp = test.operator === "&&" ? "&&" : "||";
            const parts: string[] = [];
            for (const cmd of test.commands) {
              const inner = this.buildTestExpression(
                cmd as AST.Pipeline | AST.Command | AST.TestCommand | AST.ArithmeticCommand,
              );
              parts.push(`(await ${inner.code}).code === 0`);
            }
            return {
              code: `{ code: (${parts.join(` ${jsOp} `)}) ? 0 : 1, stdout: '', stderr: '' }`,
              async: true,
            };
          }
          if (test.operator === "|") {
            return captureIfStream(handlers.buildPipeline(test, this));
          }

          // For single-command pipeline wrappers, check the wrapped command.
          const firstCmd = test.commands[0];
          if (firstCmd?.type === "TestCommand") {
            // SSH-603: `! [[ ... ]]` — flip the condition inline
            const expr = handlers.visitTestCondition(firstCmd.expression, this);
            const ternary = test.negated ? "? 1 : 0" : "? 0 : 1";
            return { code: `{ code: (${expr}) ${ternary}, stdout: '', stderr: '' }`, async: true };
          } else if (firstCmd?.type === "ArithmeticCommand") {
            // SSH-603: `! (( ... ))` — flip the condition inline
            const expr = this.visitArithmetic(firstCmd.expression);
            const ternary = test.negated ? "? 1 : 0" : "? 0 : 1";
            return { code: `{ code: (${expr}) ${ternary}, stdout: '', stderr: '' }`, async: false };
          } else if (test.negated) {
            // SSH-603: `if ! cmd` / `while ! cmd` — unwrapping to buildCommand
            // would drop the negation; buildPipeline applies the exit-status
            // flip (SSH-594) and dedupes a doubled flag on nested pipelines.
            return captureIfStream(handlers.buildPipeline(test, this));
          } else if (firstCmd?.type === "Command") {
            return captureIfStream(handlers.buildCommand(firstCmd, this));
          } else if (firstCmd?.type === "Pipeline") {
            // Handle nested Pipeline (common when single commands are wrapped)
            return this.buildTestExpression(firstCmd);
          } else if (firstCmd?.type === "Subshell") {
            // SSH-620: `if (cmd); then` / `while (cmd); do` — subshell condition.
            return {
              code: handlers.buildSubshellTestExpression(firstCmd as AST.Subshell, this),
              async: true,
            };
          } else if (firstCmd?.type === "BraceGroup") {
            // SSH-620: `if { cmd; }; then` — brace-group condition.
            return {
              code: handlers.buildBraceGroupTestExpression(firstCmd as AST.BraceGroup, this),
              async: true,
            };
          }
        } else if (test.type === "Command") {
          return captureIfStream(handlers.buildCommand(test, this));
        }
        throw new Error("Invalid test expression");
      },
    };
  }

  /**
   * Visit a statement node and return generated lines.
   */
  private visitStatement(
    stmt: AST.Statement,
    ctx: VisitorContext,
  ): StatementResult {
    switch (stmt.type) {
      case "Pipeline":
        return handlers.visitPipeline(stmt, ctx);
      case "Command":
        return handlers.visitCommand(stmt, ctx);
      case "IfStatement":
        return handlers.visitIfStatement(stmt, ctx);
      case "ForStatement":
        return handlers.visitForStatement(stmt, ctx);
      case "CStyleForStatement":
        return handlers.visitCStyleForStatement(stmt, ctx);
      case "WhileStatement":
        return handlers.visitWhileStatement(stmt, ctx);
      case "UntilStatement":
        return handlers.visitUntilStatement(stmt, ctx);
      case "CaseStatement":
        return handlers.visitCaseStatement(stmt, ctx);
      case "FunctionDeclaration":
        return handlers.visitFunctionDeclaration(stmt, ctx);
      case "VariableAssignment":
        return handlers.visitVariableAssignment(stmt, ctx);
      case "Subshell":
        return handlers.visitSubshell(stmt, ctx);
      case "BraceGroup":
        return handlers.visitBraceGroup(stmt, ctx);
      case "TestCommand":
        return handlers.visitTestCommand(stmt, ctx);
      case "ArithmeticCommand":
        return handlers.visitArithmeticCommand(stmt, ctx);
      case "ReturnStatement":
        return handlers.visitReturnStatement(stmt, ctx);
      case "BreakStatement":
        return handlers.visitBreakStatement(stmt, ctx);
      case "ContinueStatement":
        return handlers.visitContinueStatement(stmt, ctx);
      default: {
        const _exhaustive: never = stmt;
        throw new Error(`Unknown statement type: ${JSON.stringify(stmt)}`);
      }
    }
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Transpile a bash AST program to TypeScript code.
 */
export function transpile(
  program: AST.Program,
  options?: TranspilerOptions,
): string {
  const transpiler = new BashTranspiler2(options);
  return transpiler.transpile(program);
}
