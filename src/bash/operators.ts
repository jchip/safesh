/**
 * Centralized Operator Definitions
 *
 * Single source of truth for operator definitions used across the parser.
 * Follows the ShellCheck pattern of centralized character/operator classification.
 */

import { TokenType } from "./lexer.ts";
import type * as AST from "./ast.ts";

// =============================================================================
// Test Operators (for [[ ... ]] expressions)
// =============================================================================

/**
 * Unary test operators for file and string tests
 * Used in [[ -f file ]], [[ -z string ]], etc.
 */
export const UNARY_TEST_OPERATORS: readonly AST.UnaryTestOperator[] = [
  // File existence and type tests
  "-e", "-f", "-d", "-L", "-h", "-b", "-c", "-p", "-S", "-t",
  // File permission tests
  "-r", "-w", "-x", "-s", "-g", "-u", "-k", "-O", "-G", "-N",
  // String tests
  "-z", "-n",
] as const;

/**
 * Binary test operators for comparisons
 * Used in [[ a == b ]], [[ a -eq b ]], etc.
 */
export const BINARY_TEST_OPERATORS: Readonly<Record<string, AST.BinaryTestOperator>> = {
  // String comparison
  "=": "=",
  "==": "==",
  "!=": "!=",
  "<": "<",
  ">": ">",
  // Numeric comparison
  "-eq": "-eq",
  "-ne": "-ne",
  "-lt": "-lt",
  "-le": "-le",
  "-gt": "-gt",
  "-ge": "-ge",
  // File comparison
  "-nt": "-nt",
  "-ot": "-ot",
  "-ef": "-ef",
  // Regex matching
  "=~": "=~",
} as const;

// =============================================================================
// Redirection Operators
// =============================================================================

/**
 * Token types that are redirection operators (direct, without FD prefix)
 */
export const REDIRECTION_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.LESS,
  TokenType.GREAT,
  TokenType.DGREAT,
  TokenType.LESSAND,
  TokenType.GREATAND,
  TokenType.LESSGREAT,
  TokenType.CLOBBER,
  TokenType.DLESS,
  TokenType.DLESSDASH,
  TokenType.TLESS,
  TokenType.AND_GREAT,
  TokenType.AND_DGREAT,
] as const;

/**
 * Token types that can follow an FD number or {var} for redirection
 * Subset of REDIRECTION_TOKEN_TYPES that support FD prefix
 */
export const FD_PREFIXABLE_REDIRECTIONS: readonly TokenType[] = [
  TokenType.LESS,
  TokenType.GREAT,
  TokenType.DGREAT,
  TokenType.LESSAND,
  TokenType.GREATAND,
  TokenType.LESSGREAT,
  TokenType.CLOBBER,
] as const;

/**
 * Map from redirection token type to AST operator string
 */
export const REDIRECTION_OPERATOR_MAP: Readonly<Partial<Record<TokenType, AST.RedirectionOperator>>> = {
  [TokenType.LESS]: "<",
  [TokenType.GREAT]: ">",
  [TokenType.DGREAT]: ">>",
  [TokenType.LESSAND]: "<&",
  [TokenType.GREATAND]: ">&",
  [TokenType.LESSGREAT]: "<>",
  [TokenType.CLOBBER]: ">|",
  [TokenType.DLESS]: "<<",
  [TokenType.DLESSDASH]: "<<-",
  [TokenType.TLESS]: "<<<",
  [TokenType.AND_GREAT]: "&>",
  [TokenType.AND_DGREAT]: "&>>",
} as const;

// =============================================================================
// Process Substitution Operators
// =============================================================================

/**
 * Token types for process substitution
 */
export const PROCESS_SUBSTITUTION_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.LESS_LPAREN,
  TokenType.GREAT_LPAREN,
] as const;

// =============================================================================
// Pipeline Operators
// =============================================================================

/**
 * Token types that act as pipeline/command separators
 */
export const PIPELINE_OPERATOR_TOKEN_TYPES: readonly TokenType[] = [
  TokenType.PIPE,
  TokenType.PIPE_AMP,
  TokenType.AND_AND,
  TokenType.OR_OR,
  TokenType.AMP,
  TokenType.SEMICOLON,
] as const;

// =============================================================================
// Parameter Expansion Modifiers
// =============================================================================

/**
 * Two-character parameter expansion modifiers (checked first)
 * Order matters: longer patterns first
 */
export const TWO_CHAR_PARAM_MODIFIERS: readonly [string, AST.ParameterModifier][] = [
  [":-", ":-"], [":=", ":="], [":?", ":?"], [":+", ":+"],
  ["##", "##"], ["%%", "%%"], ["^^", "^^"], [",,", ",,"],
  ["//", "//"], ["/#", "/#"], ["/%", "/%"],
] as const;

/**
 * Single-character parameter expansion modifiers
 */
export const SINGLE_CHAR_PARAM_MODIFIERS: Readonly<Record<string, AST.ParameterModifier>> = {
  "-": "-", "=": "=", "?": "?", "+": "+",
  "#": "#", "%": "%", "^": "^", ",": ",",
  "/": "/", "@": "@",
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a token type is a redirection operator
 */
export function isRedirectionTokenType(type: TokenType): boolean {
  return (REDIRECTION_TOKEN_TYPES as readonly TokenType[]).includes(type);
}

/**
 * Check if a token type can follow an FD number/variable
 */
export function isFdPrefixableRedirection(type: TokenType): boolean {
  return (FD_PREFIXABLE_REDIRECTIONS as readonly TokenType[]).includes(type);
}

/**
 * Check if a string is a unary test operator
 */
export function isUnaryTestOperator(value: string): value is AST.UnaryTestOperator {
  return (UNARY_TEST_OPERATORS as readonly string[]).includes(value);
}

/**
 * Get binary test operator from string, or undefined if not found
 */
export function getBinaryTestOperator(value: string): AST.BinaryTestOperator | undefined {
  return BINARY_TEST_OPERATORS[value];
}

/**
 * Get redirection operator string from token type
 */
export function getRedirectionOperator(type: TokenType): AST.RedirectionOperator | undefined {
  return REDIRECTION_OPERATOR_MAP[type];
}
