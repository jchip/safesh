/**
 * Diagnostic Collector for SafeShell Parser
 *
 * Collects parser diagnostics with separate channels for errors, warnings, infos, and hints.
 */

import type { ParseNote, DiagnosticSeverity, DiagnosticCodeType } from "./diagnostics.ts";
import { createNote } from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";

/**
 * Collects parser diagnostics with separate channels for errors and warnings.
 */
export class DiagnosticCollector {
  private _errors: ParseNote[] = [];
  private _warnings: ParseNote[] = [];
  private _infos: ParseNote[] = [];
  private _hints: ParseNote[] = [];

  /**
   * Add a diagnostic.
   */
  add(note: ParseNote): void {
    switch (note.severity) {
      case "error":
        this._errors.push(note);
        break;
      case "warning":
        this._warnings.push(note);
        break;
      case "info":
        this._infos.push(note);
        break;
      case "hint":
        this._hints.push(note);
        break;
    }
  }

  /**
   * Add an error diagnostic.
   */
  error(
    code: DiagnosticCodeType,
    message: string,
    loc: SourceLocation,
    options?: { context?: string; fixHint?: string },
  ): void {
    this.add(createNote("error", code, message, loc, options));
  }

  /**
   * Add a warning diagnostic.
   */
  warning(
    code: DiagnosticCodeType,
    message: string,
    loc: SourceLocation,
    options?: { context?: string; fixHint?: string },
  ): void {
    this.add(createNote("warning", code, message, loc, options));
  }

  /**
   * Add an info diagnostic.
   */
  info(
    code: DiagnosticCodeType,
    message: string,
    loc: SourceLocation,
    options?: { context?: string; fixHint?: string },
  ): void {
    this.add(createNote("info", code, message, loc, options));
  }

  /**
   * Add a hint diagnostic.
   */
  hint(
    code: DiagnosticCodeType,
    message: string,
    loc: SourceLocation,
    options?: { context?: string; fixHint?: string },
  ): void {
    this.add(createNote("hint", code, message, loc, options));
  }

  /** Get all errors. */
  get errors(): readonly ParseNote[] {
    return this._errors;
  }

  /** Get all warnings. */
  get warnings(): readonly ParseNote[] {
    return this._warnings;
  }

  /** Get all infos. */
  get infos(): readonly ParseNote[] {
    return this._infos;
  }

  /** Get all hints. */
  get hints(): readonly ParseNote[] {
    return this._hints;
  }

  /** Check if there are any errors. */
  hasErrors(): boolean {
    return this._errors.length > 0;
  }

  /** Check if there are any warnings. */
  hasWarnings(): boolean {
    return this._warnings.length > 0;
  }

  /** Get all diagnostics combined. */
  all(): ParseNote[] {
    return [...this._errors, ...this._warnings, ...this._infos, ...this._hints];
  }

  /** Get count of all diagnostics. */
  get count(): number {
    return this._errors.length + this._warnings.length +
      this._infos.length + this._hints.length;
  }

  /** Clear all diagnostics. */
  clear(): void {
    this._errors = [];
    this._warnings = [];
    this._infos = [];
    this._hints = [];
  }
}
