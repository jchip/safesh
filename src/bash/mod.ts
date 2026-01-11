/**
 * Bash Parser and Transpiler Module
 *
 * Provides tools for parsing bash scripts and transpiling them to TypeScript
 * using SafeShell's $ APIs.
 *
 * @example
 * ```ts
 * import { parse, transpile } from "./bash/mod.ts";
 *
 * const script = "ls -la | grep .ts";
 * const ast = parse(script);
 * const typescript = transpile(ast);
 * ```
 *
 * @module
 */

// Lexer
export { Lexer, TokenType, type Token, type Position } from "./lexer.ts";

// AST Types
export type * as AST from "./ast.ts";

// Parser
export { Parser, parse, parseWithRecovery } from "./parser.ts";

// Arithmetic Expression Parser
export { ArithmeticParser, parseArithmetic } from "./arithmetic-parser.ts";

// Transpiler
export { Transpiler, transpile, type TranspilerOptions } from "./transpiler.ts";

// =============================================================================
// Shell Command Parser (Compatibility API)
// =============================================================================

import type * as AST from "./ast.ts";
import { parse } from "./parser.ts";
import { transpile } from "./transpiler.ts";

/**
 * Result from parsing a shell command
 */
export interface ParseResult {
  /** Generated TypeScript code */
  code: string;
  /** Whether the command should run in background */
  isBackground: boolean;
  /** The parsed AST */
  ast: AST.Program;
}

/**
 * Parse a shell command and generate TypeScript code
 *
 * This is a convenience function that combines parsing and transpilation.
 * It's designed to be a drop-in replacement for the legacy shell parser.
 *
 * @param input - Shell command string
 * @returns Parse result with generated code and metadata
 *
 * @example
 * ```ts
 * const result = parseShellCommand("ls -la | grep .ts");
 * console.log(result.code); // Generated TypeScript
 * console.log(result.isBackground); // false
 * ```
 */
export function parseShellCommand(input: string): ParseResult {
  // Parse the shell command
  const ast = parse(input);

  // Transpile to TypeScript
  const code = transpile(ast, {
    imports: true,
    strict: false,
  });

  // Check if any command in the AST is marked as background
  const isBackground = hasBackgroundCommand(ast);

  return { code, isBackground, ast };
}

/**
 * Check if the AST contains any background commands
 */
function hasBackgroundCommand(ast: AST.Program): boolean {
  for (const stmt of ast.body) {
    if (stmt.type === "Pipeline" && stmt.background) {
      return true;
    }
  }
  return false;
}
