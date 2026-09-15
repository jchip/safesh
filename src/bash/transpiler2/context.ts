/**
 * Transpiler Context
 *
 * Manages transpiler state including indentation, variable scopes,
 * and temporary variable generation.
 */

import type { ResolvedOptions } from "./types.ts";
import type * as AST from "../ast.ts";

// =============================================================================
// Diagnostic Interface
// =============================================================================

export interface Diagnostic {
  level: 'error' | 'warning' | 'info';
  message: string;
  location?: { line?: number; column?: number };
}

// =============================================================================
// Variable Scope
// =============================================================================

interface VariableScope {
  /** Variables declared in this scope */
  variables: Map<string, { type: "const" | "let"; initialized: boolean }>;
  /** Parent scope (null for global) */
  parent: VariableScope | null;
}

interface FunctionRegistry {
  /** Set of user-defined function names */
  functions: Set<string>;
  /**
   * SSH-698: each declared function's body, so a call in a VALUE position (a
   * pipe stage, a redirect, a `$( )` capture) can re-emit it in stdout-capture
   * mode. The emitted `async function` prints straight to stdout and returns
   * nothing, so there is no other way to get at its output.
   */
  bodies: Map<string, AST.Statement[]>;
}

// =============================================================================
// Transpiler Context
// =============================================================================

export class TranspilerContext {
  private readonly options: ResolvedOptions;
  private indentLevel = 0;
  private tempVarCounter = 0;
  private currentScope: VariableScope;
  private diagnostics: Diagnostic[] = [];
  private functionRegistry: FunctionRegistry;
  private stdoutCaptureVar: string | null = null;
  private readonly rootScope: VariableScope;
  private readonly hoistedVariables = new Set<string>();

  constructor(options: ResolvedOptions) {
    this.options = options;
    this.currentScope = { variables: new Map(), parent: null };
    this.rootScope = this.currentScope;
    this.functionRegistry = { functions: new Set(), bodies: new Map() };
  }

  // ===========================================================================
  // Options
  // ===========================================================================

  /** Get resolved options */
  getOptions(): ResolvedOptions {
    return this.options;
  }

  // ===========================================================================
  // Indentation
  // ===========================================================================

  /** Increase indent level */
  indent(): void {
    this.indentLevel++;
  }

  /** Decrease indent level */
  dedent(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  /** Get current indentation string */
  getIndent(): string {
    return this.options.indent.repeat(this.indentLevel);
  }

  /** Get current indent level */
  getIndentLevel(): number {
    return this.indentLevel;
  }

  /** Set indent level directly */
  setIndentLevel(level: number): void {
    this.indentLevel = Math.max(0, level);
  }

  // ===========================================================================
  // Temporary Variables
  // ===========================================================================

  /** Generate a unique temporary variable name */
  getTempVar(prefix = "_tmp"): string {
    return `${prefix}$${this.tempVarCounter++}`;
  }

  /** Reset temp variable counter (useful for tests) */
  resetTempVars(): void {
    this.tempVarCounter = 0;
  }

  // ===========================================================================
  // Variable Scopes
  // ===========================================================================

  /** Push a new variable scope */
  pushScope(): void {
    this.currentScope = {
      variables: new Map(),
      parent: this.currentScope,
    };
  }

  /** Pop current variable scope */
  popScope(): void {
    if (this.currentScope.parent) {
      this.currentScope = this.currentScope.parent;
    }
  }

  /** Declare a variable in current scope */
  declareVariable(
    name: string,
    type: "const" | "let" = "const",
    initialized = true,
  ): void {
    this.currentScope.variables.set(name, { type, initialized });
  }

  /** Check if a variable is declared in any scope */
  isDeclared(name: string): boolean {
    let scope: VariableScope | null = this.currentScope;
    while (scope) {
      if (scope.variables.has(name)) {
        return true;
      }
      scope = scope.parent;
    }
    return false;
  }

  /** Get variable info from any scope */
  getVariable(name: string): { type: "const" | "let"; initialized: boolean } | undefined {
    let scope: VariableScope | null = this.currentScope;
    while (scope) {
      const variable = scope.variables.get(name);
      if (variable) {
        return variable;
      }
      scope = scope.parent;
    }
    return undefined;
  }

  /** Get visible variable names, preferring the nearest declaration. */
  getVisibleVariables(): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    let scope: VariableScope | null = this.currentScope;
    while (scope) {
      for (const name of scope.variables.keys()) {
        if (!seen.has(name)) {
          names.push(name);
          seen.add(name);
        }
      }
      scope = scope.parent;
    }
    return names;
  }

  /** Check if variable is in current scope (not parent) */
  isInCurrentScope(name: string): boolean {
    return this.currentScope.variables.has(name);
  }

  /**
   * SSH-690: Request a function-scoped declaration for a shell variable whose
   * lowering needs a real assignable binding — an arithmetic write target such
   * as `((i++))` or the `i = 0` of a C-style for.
   *
   * The declaration is emitted once at the top of the generated IIFE rather
   * than at the use site, because arithmetic can appear in expression position
   * (`echo $((v = 7))`) where there is no statement to prepend to. Declaring at
   * the root also matches bash, where an assignment inside a function body is
   * global unless `local`.
   */
  hoistVariable(name: string): void {
    this.hoistedVariables.add(name);
    // Record in the root scope, not the current one: the emitted `var` lives at
    // the top of the IIFE and must stay visible after any scope here is popped.
    // Keyed on the raw shell name so isDeclared(stmt.name) sees it — callers
    // sanitize only for emission.
    if (!this.rootScope.variables.has(name)) {
      this.rootScope.variables.set(name, { type: "let", initialized: false });
    }
  }

  /** Raw shell names needing a hoisted declaration, in first-requested order */
  getHoistedVariables(): string[] {
    return [...this.hoistedVariables];
  }

  // ===========================================================================
  // Function Registry
  // ===========================================================================

  /** Register a user-defined function, with its body when available (SSH-698) */
  declareFunction(name: string, body?: AST.Statement[]): void {
    this.functionRegistry.functions.add(name);
    if (body) this.functionRegistry.bodies.set(name, body);
  }

  /** Check if a name is a declared user-defined function */
  isFunction(name: string): boolean {
    return this.functionRegistry.functions.has(name);
  }

  /** A declared function's body, for re-emitting it in capture mode (SSH-698) */
  getFunctionBody(name: string): AST.Statement[] | undefined {
    return this.functionRegistry.bodies.get(name);
  }

  // ===========================================================================
  // Stdout Capture
  // ===========================================================================

  /** Get the current stdout capture variable name (null if not in capture mode) */
  getStdoutCapture(): string | null {
    return this.stdoutCaptureVar;
  }

  /** Set stdout capture variable name; null to disable */
  setStdoutCapture(varName: string | null): void {
    this.stdoutCaptureVar = varName;
  }

  // ===========================================================================
  // Diagnostics
  // ===========================================================================

  /** Add a diagnostic message */
  addDiagnostic(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  /** Get all diagnostics */
  getDiagnostics(): Diagnostic[] {
    return [...this.diagnostics];
  }

  /** Clear all diagnostics */
  clearDiagnostics(): void {
    this.diagnostics = [];
  }

  // ===========================================================================
  // State Snapshot
  // ===========================================================================

  /** Create a snapshot of current state */
  snapshot(): { indentLevel: number; tempVarCounter: number } {
    return {
      indentLevel: this.indentLevel,
      tempVarCounter: this.tempVarCounter,
    };
  }

  /** Restore state from snapshot */
  restore(snapshot: { indentLevel: number; tempVarCounter: number }): void {
    this.indentLevel = snapshot.indentLevel;
    this.tempVarCounter = snapshot.tempVarCounter;
  }
}
