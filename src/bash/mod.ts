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
export { Parser, parse } from "./parser.ts";

// Transpiler
export { Transpiler, transpile, type TranspilerOptions } from "./transpiler.ts";
