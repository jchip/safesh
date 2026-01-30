/**
 * Error Recovery Utilities for Bash Parser
 *
 * Provides mechanisms to recover from parse errors by skipping to
 * synchronization points (statement boundaries) and inserting missing tokens.
 */

import { type Token, TokenType } from "./lexer.ts";
import type { ParseResult, ParserState } from "./combinators.ts";
import { advanceState, currentToken, isAtEnd } from "./combinators.ts";

/**
 * Tokens that mark statement boundaries (synchronization points).
 * These are safe places to resume parsing after an error.
 */
export const SYNC_TOKENS: readonly TokenType[] = [
  TokenType.NEWLINE,
  TokenType.SEMICOLON,
  TokenType.EOF,
  TokenType.FI,
  TokenType.DONE,
  TokenType.ESAC,
  TokenType.RBRACE,
  TokenType.RPAREN,
] as const;

/**
 * Check if a token type is a sync token.
 *
 * @param type Token type to check
 * @returns True if the token type marks a synchronization point
 */
export function isSyncToken(type: TokenType): boolean {
  return SYNC_TOKENS.includes(type);
}

/**
 * Skip tokens until reaching a synchronization point.
 * Returns the new state and the tokens that were skipped.
 *
 * @param state Current parser state
 * @returns Object with new state and array of skipped tokens
 */
export function skipToSync(state: ParserState): {
  state: ParserState;
  skipped: Token[];
} {
  const skipped: Token[] = [];
  let current = state;

  while (!isAtEnd(current)) {
    const tok = currentToken(current);
    if (!tok || isSyncToken(tok.type)) {
      break;
    }
    skipped.push(tok);
    current = advanceState(current);
  }

  return { state: current, skipped };
}

/**
 * Skip tokens until reaching one of the specified token types.
 *
 * @param state Current parser state
 * @param stopTypes Array of token types to stop at
 * @returns Object with new state and array of skipped tokens
 */
export function skipUntil(
  state: ParserState,
  stopTypes: TokenType[],
): { state: ParserState; skipped: Token[] } {
  const skipped: Token[] = [];
  let current = state;

  while (!isAtEnd(current)) {
    const tok = currentToken(current);
    if (!tok || stopTypes.includes(tok.type)) {
      break;
    }
    skipped.push(tok);
    current = advanceState(current);
  }

  return { state: current, skipped };
}

/**
 * Skip tokens until reaching a token that matches the predicate.
 *
 * @param state Current parser state
 * @param predicate Function to test each token
 * @returns Object with new state and array of skipped tokens
 */
export function skipWhile(
  state: ParserState,
  predicate: (token: Token) => boolean,
): { state: ParserState; skipped: Token[] } {
  const skipped: Token[] = [];
  let current = state;

  while (!isAtEnd(current)) {
    const tok = currentToken(current);
    if (!tok || !predicate(tok)) {
      break;
    }
    skipped.push(tok);
    current = advanceState(current);
  }

  return { state: current, skipped };
}

/**
 * Result of a parse attempt with recovery information.
 */
export interface RecoveryResult<T> {
  /** Whether the parse succeeded */
  success: boolean;
  /** Parsed value if successful */
  value?: T;
  /** Whether error recovery was performed */
  recovered: boolean;
  /** Tokens skipped during recovery */
  skipped: Token[];
  /** Parser state after parse/recovery */
  state: ParserState;
}

/**
 * Try a parser, recovering to sync point on failure.
 * Returns result with recovery info.
 *
 * @param parser Parser function to try
 * @param state Current parser state
 * @returns Recovery result with success/failure info and recovery details
 */
export function tryWithRecovery<T>(
  parser: (state: ParserState) => ParseResult<T>,
  state: ParserState,
): RecoveryResult<T> {
  const result = parser(state);

  if (result.success) {
    return {
      success: true,
      value: result.value,
      recovered: false,
      skipped: [],
      state: result.state,
    };
  }

  // Recovery: skip to sync point
  const { state: recoveredState, skipped } = skipToSync(result.state);

  return {
    success: false,
    recovered: true,
    skipped,
    state: recoveredState,
  };
}

/**
 * Insert a missing token for error recovery.
 * Returns a synthetic token that can be used to continue parsing.
 *
 * @param type Type of token to insert
 * @param afterToken Optional token to insert after (for position info)
 * @returns Synthetic token with generated position information
 */
export function insertMissing(type: TokenType, afterToken?: Token): Token {
  const line = afterToken?.line ?? 1;
  const column = afterToken ? afterToken.column + afterToken.value.length : 1;
  const offset = afterToken?.end ?? 0;

  return {
    type,
    value: `<missing ${type}>`,
    start: offset,
    end: offset,
    line,
    column,
  };
}
