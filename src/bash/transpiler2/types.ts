/**
 * Transpiler2 Types
 *
 * Core type definitions for the visitor-pattern based transpiler.
 */

import type * as AST from "../ast.ts";
import type { Diagnostic } from "./context.ts";
import { FLUENT_COMMAND_NAMES } from "./command-capabilities.ts";

// Re-export Diagnostic for convenience
export type { Diagnostic };

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
  /** Import path for $ (default: "./mod.ts") */
  importPath?: string;
}

export interface ResolvedOptions {
  indent: string;
  types: boolean;
  strict: boolean;
  imports: boolean;
  importPath: string;
}

export function resolveOptions(options?: TranspilerOptions): ResolvedOptions {
  return {
    indent: options?.indent ?? "  ",
    types: options?.types ?? true,
    strict: options?.strict ?? true,
    imports: options?.imports ?? true,
    importPath: options?.importPath ?? "./mod.ts",
  };
}

// =============================================================================
// Output Style
// =============================================================================

/** Commands that use fluent API style */
export const FLUENT_COMMANDS = FLUENT_COMMAND_NAMES;

/** Check if a command should use fluent style */
export function isFluentCommand(name: string): boolean {
  return FLUENT_COMMANDS.has(name);
}

// =============================================================================
// Handler Result Types
// =============================================================================

/** Result from visiting a node that produces an expression */
export interface ExpressionResult {
  /** The generated TypeScript expression */
  code: string;
  /** Whether the expression is async (needs await) */
  async: boolean;
}

/** Result from visiting a statement node */
export interface StatementResult {
  /** Lines of generated code (already formatted with indent) */
  lines: string[];
}

// =============================================================================
// Visitor Context Interface
// =============================================================================

/**
 * Context passed to all visitor methods.
 * Provides access to indentation, temp variables, and child visiting.
 */
export interface VisitorContext {
  /** Get current indentation string */
  getIndent(): string;

  /** Increase indent level */
  indent(): void;

  /** Decrease indent level */
  dedent(): void;

  /** Generate a unique temp variable name */
  getTempVar(prefix?: string): string;

  /** Get resolved options */
  getOptions(): ResolvedOptions;

  /** Check if a variable is declared */
  isDeclared(name: string): boolean;

  /** Declare a variable in current scope */
  declareVariable(name: string, type?: "const" | "let"): void;

  /** Push a new variable scope */
  pushScope(): void;

  /** Pop current variable scope */
  popScope(): void;

  /** Register a user-defined function */
  declareFunction(name: string): void;

  /** Check if a name is a declared user-defined function */
  isFunction(name: string): boolean;

  /** Get stdout capture variable name (null if not in capture mode) */
  getStdoutCapture(): string | null;

  /** Set stdout capture variable name; null to disable */
  setStdoutCapture(varName: string | null): void;

  /** True while emitting inside a subshell body — `exit` must only leave the
   * subshell, not the process (SSH-584) */
  isInSubshell(): boolean;

  /** Mark subshell scope entry (SSH-584) */
  enterSubshell(): void;

  /** Mark subshell scope exit (SSH-584) */
  exitSubshell(): void;

  /** Add a diagnostic message */
  addDiagnostic(diagnostic: Diagnostic): void;

  /** Get all diagnostics */
  getDiagnostics(): Diagnostic[];

  /** Visit a statement node */
  visitStatement(stmt: AST.Statement): StatementResult;

  /** Visit a word/expansion and get expression */
  visitWord(
    word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  ): string;

  /** Visit a test condition */
  visitTestCondition(test: AST.TestCondition): string;

  /** Visit an arithmetic expression */
  visitArithmetic(expr: AST.ArithmeticExpression): string;

  /** Build a command expression (without await) */
  buildCommand(
    cmd: AST.Command,
    options?: { inPipeline?: boolean; captureOutput?: boolean },
  ): ExpressionResult;

  /** Build a command or pipeline expression (for command substitution) */
  buildCommandExpression(stmt: AST.Command | AST.Pipeline): ExpressionResult;

  /** Build test expression for if/while conditions */
  buildTestExpression(
    test: AST.Pipeline | AST.Command | AST.TestCommand | AST.ArithmeticCommand,
  ): ExpressionResult;
}
