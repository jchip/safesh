/**
 * Transpiler Context
 *
 * Manages transpiler state including indentation, variable scopes,
 * and temporary variable generation.
 */

import type { ResolvedOptions } from "./types.ts";

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

// =============================================================================
// Transpiler Context
// =============================================================================

export class TranspilerContext {
  private readonly options: ResolvedOptions;
  private indentLevel = 0;
  private tempVarCounter = 0;
  private currentScope: VariableScope;
  private diagnostics: Diagnostic[] = [];

  constructor(options: ResolvedOptions) {
    this.options = options;
    this.currentScope = { variables: new Map(), parent: null };
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
    return `${prefix}${this.tempVarCounter++}`;
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

  /** Check if variable is in current scope (not parent) */
  isInCurrentScope(name: string): boolean {
    return this.currentScope.variables.has(name);
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
