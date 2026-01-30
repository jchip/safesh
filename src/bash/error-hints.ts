/**
 * Lookahead Error Hints for Bash Parser
 *
 * Provides contextual error messages based on lookahead tokens.
 * Helps users understand syntax errors by suggesting common fixes.
 */

import { TokenType, type Token } from "./lexer.ts";
import type { ParserState } from "./combinators.ts";
import { currentToken } from "./combinators.ts";

/**
 * Hint suggestion for an error.
 */
export interface ErrorHint {
  message: string;
  suggestion?: string;
}

/**
 * Check if next token matches and provide hint.
 * Does NOT consume the token.
 */
export function hintIfNext(
  state: ParserState,
  type: TokenType,
  hint: ErrorHint
): ErrorHint | null {
  const tok = currentToken(state);
  if (tok && tok.type === type) {
    return hint;
  }
  return null;
}

/**
 * Check if next token matches any of the types and provide hint.
 */
export function hintIfNextAny(
  state: ParserState,
  types: TokenType[],
  hint: ErrorHint
): ErrorHint | null {
  const tok = currentToken(state);
  if (tok && types.includes(tok.type)) {
    return hint;
  }
  return null;
}

/**
 * Common error hint patterns.
 */
export const COMMON_HINTS = {
  /**
   * When expecting 'then' but got something else
   */
  missingThen: (state: ParserState): ErrorHint | null => {
    const tok = currentToken(state);
    if (!tok) return null;

    // Common mistake: forgetting 'then' after condition
    if (tok.type === TokenType.WORD || tok.type === TokenType.NAME) {
      return {
        message: "Expected 'then' keyword",
        suggestion: "Add 'then' after the condition",
      };
    }
    // Common mistake: using { instead of then
    if (tok.type === TokenType.LBRACE) {
      return {
        message: "Bash uses 'then' keyword, not '{'",
        suggestion: "Replace '{' with 'then'",
      };
    }
    return null;
  },

  /**
   * When expecting 'do' but got something else
   */
  missingDo: (state: ParserState): ErrorHint | null => {
    const tok = currentToken(state);
    if (!tok) return null;

    if (tok.type === TokenType.LBRACE) {
      return {
        message: "Bash loops use 'do' keyword, not '{'",
        suggestion: "Replace '{' with 'do'",
      };
    }
    if (tok.type === TokenType.WORD || tok.type === TokenType.NAME) {
      return {
        message: "Expected 'do' keyword",
        suggestion: "Add 'do' before loop body",
      };
    }
    return null;
  },

  /**
   * When expecting 'fi' but got something else
   */
  missingFi: (state: ParserState): ErrorHint | null => {
    const tok = currentToken(state);
    if (!tok) return null;

    if (tok.type === TokenType.RBRACE) {
      return {
        message: "Bash if-statements end with 'fi', not '}'",
        suggestion: "Replace '}' with 'fi'",
      };
    }
    if (tok.type === TokenType.EOF) {
      return {
        message: "Unterminated if-statement",
        suggestion: "Add 'fi' to close the if-statement",
      };
    }
    return null;
  },

  /**
   * When expecting 'done' but got something else
   */
  missingDone: (state: ParserState): ErrorHint | null => {
    const tok = currentToken(state);
    if (!tok) return null;

    if (tok.type === TokenType.RBRACE) {
      return {
        message: "Bash loops end with 'done', not '}'",
        suggestion: "Replace '}' with 'done'",
      };
    }
    if (tok.type === TokenType.EOF) {
      return {
        message: "Unterminated loop",
        suggestion: "Add 'done' to close the loop",
      };
    }
    return null;
  },

  /**
   * When expecting ']' but got ']]'
   */
  bracketMismatch: (state: ParserState): ErrorHint | null => {
    const tok = currentToken(state);
    if (!tok) return null;

    if (tok.type === TokenType.DBRACK_END) {
      return {
        message: "Mismatched brackets",
        suggestion: "Use ']' for [ ] tests, ']]' for [[ ]] tests",
      };
    }
    return null;
  },

  /**
   * When expecting word but got operator
   */
  unexpectedOperator: (state: ParserState): ErrorHint | null => {
    const tok = currentToken(state);
    if (!tok) return null;

    const operators = [
      TokenType.PIPE, TokenType.AND_AND, TokenType.OR_OR,
      TokenType.SEMICOLON, TokenType.AMP,
    ];

    if (operators.includes(tok.type)) {
      return {
        message: `Unexpected operator '${tok.value}'`,
        suggestion: "Check for missing command before operator",
      };
    }
    return null;
  },
};

/**
 * Get best error hint for current position.
 * Tries multiple hint patterns and returns the first match.
 */
export function getBestHint(
  state: ParserState,
  context: "if" | "for" | "while" | "case" | "general"
): ErrorHint | null {
  switch (context) {
    case "if":
      return COMMON_HINTS.missingThen(state) ??
             COMMON_HINTS.missingFi(state);
    case "for":
    case "while":
      return COMMON_HINTS.missingDo(state) ??
             COMMON_HINTS.missingDone(state);
    case "general":
    default:
      return COMMON_HINTS.unexpectedOperator(state) ??
             COMMON_HINTS.bracketMismatch(state);
  }
}

/**
 * Format an error message with hint.
 */
export function formatErrorWithHint(
  baseMessage: string,
  hint: ErrorHint | null
): string {
  if (!hint) return baseMessage;
  let result = baseMessage;
  result += `\n  Hint: ${hint.message}`;
  if (hint.suggestion) {
    result += `\n  Suggestion: ${hint.suggestion}`;
  }
  return result;
}
