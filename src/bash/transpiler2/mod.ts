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
  TranspilerOptions,
  ResolvedOptions,
  ExpressionResult,
  StatementResult,
  VisitorContext,
} from "./types.ts";
export { resolveOptions, isFluentCommand, FLUENT_COMMANDS } from "./types.ts";
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
      emitter.emitLines(result.lines.map((l) => l.replace(ctx.getIndent(), "")));
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

    return {
      getIndent: () => ctx.getIndent(),
      indent: () => ctx.indent(),
      dedent: () => ctx.dedent(),
      getTempVar: (prefix?: string) => ctx.getTempVar(prefix),
      getOptions: () => ctx.getOptions(),
      isDeclared: (name: string) => ctx.isDeclared(name),
      declareVariable: (name: string, type?: "const" | "let") =>
        ctx.declareVariable(name, type),
      pushScope: () => ctx.pushScope(),
      popScope: () => ctx.popScope(),
      addDiagnostic: (diagnostic) => ctx.addDiagnostic(diagnostic),
      getDiagnostics: () => ctx.getDiagnostics(),

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

      buildCommand(cmd: AST.Command): ExpressionResult {
        return handlers.buildCommand(cmd, this);
      },

      buildTestExpression(test: AST.Pipeline | AST.Command): ExpressionResult {
        if (test.type === "Pipeline") {
          // For now, build the first command
          if (test.commands[0]?.type === "Command") {
            return handlers.buildCommand(test.commands[0], this);
          }
        } else {
          return handlers.buildCommand(test, this);
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
