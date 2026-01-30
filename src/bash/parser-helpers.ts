/**
 * Parser Helper Functions for SafeShell
 *
 * Utilities for the "accept but warn" pattern where parsing succeeds
 * but emits diagnostics for potentially problematic code.
 */

import type { DiagnosticCodeType } from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";
import { DiagnosticCollector } from "./diagnostic-collector.ts";

/**
 * Result of an "accept but warn" operation.
 * Parsing succeeds, but a diagnostic is recorded.
 */
export interface AcceptResult<T> {
  value: T;
  warned: boolean;
}

/**
 * Accept a value but emit a warning diagnostic.
 * Used when parsing succeeds but the code has issues.
 *
 * @param collector - The diagnostic collector to add warnings to
 * @param value - The value to accept
 * @param code - The diagnostic code
 * @param message - The warning message
 * @param loc - The source location
 * @param options - Optional context and fix hint
 * @returns The accepted result with warned flag
 *
 * @example
 * ```typescript
 * const result = acceptButWarn(
 *   collector,
 *   node,
 *   "SSH_2001" as DiagnosticCodeType,
 *   "Variable should be quoted",
 *   loc,
 *   { fixHint: 'Use "$variable" instead of $variable' }
 * );
 * ```
 */
export function acceptButWarn<T>(
  collector: DiagnosticCollector,
  value: T,
  code: DiagnosticCodeType,
  message: string,
  loc: SourceLocation,
  options?: { context?: string; fixHint?: string },
): AcceptResult<T> {
  collector.warning(code, message, loc, options);
  return { value, warned: true };
}

/**
 * Accept a value but emit an info diagnostic.
 *
 * @param collector - The diagnostic collector to add info to
 * @param value - The value to accept
 * @param code - The diagnostic code
 * @param message - The info message
 * @param loc - The source location
 * @param options - Optional context and fix hint
 * @returns The accepted result with warned flag
 *
 * @example
 * ```typescript
 * const result = acceptButInfo(
 *   collector,
 *   node,
 *   "SSH_2002" as DiagnosticCodeType,
 *   "Consider adding a shebang",
 *   loc
 * );
 * ```
 */
export function acceptButInfo<T>(
  collector: DiagnosticCollector,
  value: T,
  code: DiagnosticCodeType,
  message: string,
  loc: SourceLocation,
  options?: { context?: string; fixHint?: string },
): AcceptResult<T> {
  collector.info(code, message, loc, options);
  return { value, warned: true };
}

/**
 * Accept a value but emit a hint diagnostic.
 *
 * @param collector - The diagnostic collector to add hint to
 * @param value - The value to accept
 * @param code - The diagnostic code
 * @param message - The hint message
 * @param loc - The source location
 * @param options - Optional context and fix hint
 * @returns The accepted result with warned flag
 *
 * @example
 * ```typescript
 * const result = acceptButHint(
 *   collector,
 *   node,
 *   "SSH_4001" as DiagnosticCodeType,
 *   "Consider using [[ ]] instead of [ ]",
 *   loc
 * );
 * ```
 */
export function acceptButHint<T>(
  collector: DiagnosticCollector,
  value: T,
  code: DiagnosticCodeType,
  message: string,
  loc: SourceLocation,
  options?: { context?: string; fixHint?: string },
): AcceptResult<T> {
  collector.hint(code, message, loc, options);
  return { value, warned: true };
}

/**
 * Conditionally accept with warning if condition is true.
 *
 * @param collector - The diagnostic collector to add warning to
 * @param value - The value to accept
 * @param condition - Whether to emit the warning
 * @param code - The diagnostic code
 * @param message - The warning message
 * @param loc - The source location
 * @param options - Optional context and fix hint
 * @returns The accepted result with warned flag
 *
 * @example
 * ```typescript
 * const result = acceptIf(
 *   collector,
 *   node,
 *   !isQuoted,
 *   "SSH_2001" as DiagnosticCodeType,
 *   "Variable should be quoted",
 *   loc
 * );
 * ```
 */
export function acceptIf<T>(
  collector: DiagnosticCollector,
  value: T,
  condition: boolean,
  code: DiagnosticCodeType,
  message: string,
  loc: SourceLocation,
  options?: { context?: string; fixHint?: string },
): AcceptResult<T> {
  if (condition) {
    return acceptButWarn(collector, value, code, message, loc, options);
  }
  return { value, warned: false };
}

/**
 * Example usage pattern for compatibility warnings.
 * Warns when using a feature not supported by target shell.
 *
 * @param collector - The diagnostic collector to add warning to
 * @param value - The value to accept
 * @param featureSupported - Whether the feature is supported
 * @param featureName - Name of the feature
 * @param loc - The source location
 * @returns The accepted result with warned flag
 *
 * @example
 * ```typescript
 * const result = acceptWithCompatibilityCheck(
 *   collector,
 *   node,
 *   shellConfig.supportsArrays,
 *   "bash arrays",
 *   loc
 * );
 * ```
 */
export function acceptWithCompatibilityCheck<T>(
  collector: DiagnosticCollector,
  value: T,
  featureSupported: boolean,
  featureName: string,
  loc: SourceLocation,
): AcceptResult<T> {
  if (!featureSupported) {
    return acceptButWarn(
      collector,
      value,
      "SSH_3001" as DiagnosticCodeType,
      `Feature '${featureName}' may not be supported in target shell`,
      loc,
      { fixHint: `Consider using POSIX-compatible alternatives` },
    );
  }
  return { value, warned: false };
}
