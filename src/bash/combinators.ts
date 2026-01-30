/**
 * Parser Combinator Primitives for Bash Parser
 *
 * A minimal foundation of parser combinators that work with lexer tokens.
 * Provides composable building blocks for constructing the bash parser.
 */

import type { Token, TokenType } from "./lexer.ts";

// =============================================================================
// Core Types
// =============================================================================

/**
 * Parser state tracks position in token stream.
 * Immutable - all operations return new state instances.
 */
export interface ParserState {
  /** Array of tokens to parse */
  tokens: Token[];
  /** Current position in token array */
  pos: number;
}

/**
 * Successful parse result with extracted value and updated state.
 */
export interface ParseSuccess<T> {
  success: true;
  value: T;
  state: ParserState;
}

/**
 * Failed parse result with expectation message and state at failure point.
 */
export interface ParseFailure {
  success: false;
  expected: string;
  state: ParserState;
}

/**
 * Parse result is either success with value or failure with error message.
 */
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * A parser is a function from state to result.
 * Pure function - does not mutate input state.
 */
export type Parser<T> = (state: ParserState) => ParseResult<T>;

// =============================================================================
// State Helper Functions
// =============================================================================

/**
 * Create initial parser state from token array.
 *
 * @param tokens Array of tokens from lexer
 * @returns Initial state positioned at start of token stream
 */
export function createState(tokens: Token[]): ParserState {
  return { tokens, pos: 0 };
}

/**
 * Check if parser state is at end of input.
 *
 * @param state Current parser state
 * @returns True if at or past end of token array
 */
export function isAtEnd(state: ParserState): boolean {
  return state.pos >= state.tokens.length;
}

/**
 * Get current token without consuming it.
 *
 * @param state Current parser state
 * @returns Current token or undefined if at end
 */
export function currentToken(state: ParserState): Token | undefined {
  return state.tokens[state.pos];
}

/**
 * Advance parser state by one position.
 * Returns new state without mutating input.
 *
 * @param state Current parser state
 * @returns New state with position incremented
 */
export function advanceState(state: ParserState): ParserState {
  return { tokens: state.tokens, pos: state.pos + 1 };
}

// =============================================================================
// Primitive Parsers
// =============================================================================

/**
 * Parser that always succeeds with the given value without consuming input.
 *
 * @param value Value to return
 * @returns Parser that succeeds with value
 *
 * @example
 * const parser = pure(42);
 * const result = parser(state);
 * // result.success === true, result.value === 42, result.state === state
 */
export function pure<T>(value: T): Parser<T> {
  return (state: ParserState): ParseResult<T> => ({
    success: true,
    value,
    state,
  });
}

/**
 * Parser that always fails with the given expectation message.
 *
 * @param expected Description of what was expected
 * @returns Parser that always fails
 *
 * @example
 * const parser = fail("valid token");
 * const result = parser(state);
 * // result.success === false, result.expected === "valid token"
 */
export function fail(expected: string): Parser<never> {
  return (state: ParserState): ParseResult<never> => ({
    success: false,
    expected,
    state,
  });
}

/**
 * Parser that matches a token satisfying the given predicate.
 * Consumes one token on success.
 *
 * @param predicate Function to test token
 * @param expected Description of expected token for error messages
 * @returns Parser that succeeds if predicate returns true
 *
 * @example
 * const parser = satisfy(
 *   (token) => token.type === TokenType.WORD,
 *   "word token"
 * );
 */
export function satisfy(
  predicate: (token: Token) => boolean,
  expected: string,
): Parser<Token> {
  return (state: ParserState): ParseResult<Token> => {
    if (isAtEnd(state)) {
      return {
        success: false,
        expected,
        state,
      };
    }

    const current = currentToken(state)!;
    if (predicate(current)) {
      return {
        success: true,
        value: current,
        state: advanceState(state),
      };
    }

    return {
      success: false,
      expected,
      state,
    };
  };
}

/**
 * Parser that matches a token of the specified type.
 * Consumes one token on success.
 *
 * @param type Token type to match
 * @returns Parser that succeeds if token type matches
 *
 * @example
 * const parser = token(TokenType.PIPE);
 * // Matches any PIPE token
 */
export function token(type: TokenType): Parser<Token> {
  return satisfy(
    (t) => t.type === type,
    `token of type ${type}`,
  );
}

/**
 * Parser that matches a token with both specific type and value.
 * Consumes one token on success.
 *
 * @param type Token type to match
 * @param value Token value to match
 * @returns Parser that succeeds if both type and value match
 *
 * @example
 * const parser = tokenValue(TokenType.WORD, "echo");
 * // Matches only WORD tokens with value "echo"
 */
export function tokenValue(type: TokenType, value: string): Parser<Token> {
  return satisfy(
    (t) => t.type === type && t.value === value,
    `token of type ${type} with value "${value}"`,
  );
}

/**
 * Parser that succeeds only at end of input.
 * Does not consume any tokens.
 *
 * @returns Parser that succeeds at EOF
 *
 * @example
 * const parser = eof();
 * // Succeeds only when at end of token stream
 */
export function eof(): Parser<void> {
  return (state: ParserState): ParseResult<void> => {
    if (isAtEnd(state)) {
      return {
        success: true,
        value: undefined,
        state,
      };
    }

    const current = currentToken(state);
    return {
      success: false,
      expected: `end of input, but got ${current?.type}`,
      state,
    };
  };
}

/**
 * Parser that tries another parser without consuming input.
 * Returns result but state is unchanged regardless of success or failure.
 *
 * @param parser Parser to try
 * @returns Parser that peeks ahead without consuming
 *
 * @example
 * const parser = lookAhead(token(TokenType.PIPE));
 * // Checks if next token is PIPE but doesn't consume it
 */
export function lookAhead<T>(parser: Parser<T>): Parser<T> {
  return (state: ParserState): ParseResult<T> => {
    const result = parser(state);
    if (result.success) {
      return {
        success: true,
        value: result.value,
        state, // Return original state, not advanced state
      };
    }
    return {
      success: false,
      expected: result.expected,
      state, // Return original state, not failed state
    };
  };
}

/**
 * Parser that tries another parser and returns null on failure.
 * Consumes input on success, returns null without consuming on failure.
 *
 * @param parser Parser to try
 * @returns Parser that succeeds with value or null
 *
 * @example
 * const parser = tryP(token(TokenType.SEMICOLON));
 * // Returns token if present, null if not present
 * // Useful for optional tokens
 */
export function tryP<T>(parser: Parser<T>): Parser<T | null> {
  return (state: ParserState): ParseResult<T | null> => {
    const result = parser(state);
    if (result.success) {
      return result;
    }
    return {
      success: true,
      value: null,
      state, // Return original state, not failed state
    };
  };
}

// =============================================================================
// Composition Functions
// =============================================================================

/**
 * Transform parser result using a function.
 * Applies function to successful parse result.
 *
 * @param parser Parser to run
 * @param fn Transformation function
 * @returns Parser with transformed result
 *
 * @example
 * const parser = map(token(TokenType.WORD), (tok) => tok.value);
 * // Extracts value from token
 */
export function map<A, B>(parser: Parser<A>, fn: (a: A) => B): Parser<B> {
  return (state: ParserState): ParseResult<B> => {
    const result = parser(state);
    if (result.success) {
      return {
        success: true,
        value: fn(result.value),
        state: result.state,
      };
    }
    return result;
  };
}

/**
 * Monadic bind for parsers (flatMap/chain).
 * Runs first parser, then uses result to determine second parser.
 *
 * @param parser First parser
 * @param fn Function that produces next parser based on result
 * @returns Parser that sequences two dependent parsers
 *
 * @example
 * const parser = bind(
 *   token(TokenType.WORD),
 *   (tok) => tok.value === "if" ? parseIf() : parseCommand()
 * );
 */
export function bind<A, B>(
  parser: Parser<A>,
  fn: (a: A) => Parser<B>,
): Parser<B> {
  return (state: ParserState): ParseResult<B> => {
    const result = parser(state);
    if (result.success) {
      const nextParser = fn(result.value);
      return nextParser(result.state);
    }
    return result;
  };
}

/**
 * Sequence two parsers, returning tuple of results.
 * Runs first parser, then second, collecting both results.
 *
 * @param p1 First parser
 * @param p2 Second parser
 * @returns Parser that returns tuple [A, B]
 *
 * @example
 * const parser = seq(
 *   token(TokenType.WORD),
 *   token(TokenType.SEMICOLON)
 * );
 * // Parses word followed by semicolon
 */
export function seq<A, B>(p1: Parser<A>, p2: Parser<B>): Parser<[A, B]> {
  return (state: ParserState): ParseResult<[A, B]> => {
    const r1 = p1(state);
    if (!r1.success) {
      return r1;
    }
    const r2 = p2(r1.state);
    if (!r2.success) {
      return r2;
    }
    return {
      success: true,
      value: [r1.value, r2.value],
      state: r2.state,
    };
  };
}

/**
 * Sequence three parsers, returning tuple of results.
 *
 * @param p1 First parser
 * @param p2 Second parser
 * @param p3 Third parser
 * @returns Parser that returns tuple [A, B, C]
 *
 * @example
 * const parser = seq3(
 *   token(TokenType.LPAREN),
 *   token(TokenType.WORD),
 *   token(TokenType.RPAREN)
 * );
 * // Parses (word)
 */
export function seq3<A, B, C>(
  p1: Parser<A>,
  p2: Parser<B>,
  p3: Parser<C>,
): Parser<[A, B, C]> {
  return (state: ParserState): ParseResult<[A, B, C]> => {
    const r1 = p1(state);
    if (!r1.success) {
      return r1;
    }
    const r2 = p2(r1.state);
    if (!r2.success) {
      return r2;
    }
    const r3 = p3(r2.state);
    if (!r3.success) {
      return r3;
    }
    return {
      success: true,
      value: [r1.value, r2.value, r3.value],
      state: r3.state,
    };
  };
}

/**
 * Try first parser, if it fails try second parser.
 * Backtracks on first parser failure and tries alternative.
 *
 * @param p1 First parser to try
 * @param p2 Alternative parser
 * @returns Parser that tries both alternatives
 *
 * @example
 * const parser = alt(
 *   token(TokenType.SEMICOLON),
 *   token(TokenType.NEWLINE)
 * );
 * // Accepts either semicolon or newline
 */
export function alt<T>(p1: Parser<T>, p2: Parser<T>): Parser<T> {
  return (state: ParserState): ParseResult<T> => {
    const r1 = p1(state);
    if (r1.success) {
      return r1;
    }
    // Backtrack and try second parser
    return p2(state);
  };
}

/**
 * Try multiple parsers in sequence until one succeeds.
 * Returns result of first successful parser.
 *
 * @param parsers Array of parsers to try
 * @returns Parser that tries all alternatives
 *
 * @example
 * const parser = choice(
 *   tokenValue(TokenType.WORD, "if"),
 *   tokenValue(TokenType.WORD, "for"),
 *   tokenValue(TokenType.WORD, "while")
 * );
 * // Accepts any of the three keywords
 */
export function choice<T>(...parsers: Parser<T>[]): Parser<T> {
  return (state: ParserState): ParseResult<T> => {
    if (parsers.length === 0) {
      return {
        success: false,
        expected: "at least one parser",
        state,
      };
    }

    for (const parser of parsers) {
      const result = parser(state);
      if (result.success) {
        return result;
      }
    }
    // All failed - return last failure
    const lastParser = parsers[parsers.length - 1]!;
    return lastParser(state);
  };
}

/**
 * Parse zero or more occurrences of parser.
 * Always succeeds, returns empty array if no matches.
 *
 * @param parser Parser to repeat
 * @returns Parser that returns array of results
 *
 * @example
 * const parser = many(token(TokenType.WORD));
 * // Parses zero or more words
 */
export function many<T>(parser: Parser<T>): Parser<T[]> {
  return (state: ParserState): ParseResult<T[]> => {
    const results: T[] = [];
    let currentState = state;

    while (true) {
      const result = parser(currentState);
      if (!result.success) {
        break;
      }

      // Prevent infinite loop on parsers that don't consume input
      if (result.state.pos === currentState.pos) {
        break;
      }

      results.push(result.value);
      currentState = result.state;
    }

    return {
      success: true,
      value: results,
      state: currentState,
    };
  };
}

/**
 * Parse one or more occurrences of parser.
 * Fails if parser doesn't match at least once.
 *
 * @param parser Parser to repeat
 * @returns Parser that returns non-empty array
 *
 * @example
 * const parser = many1(token(TokenType.WORD));
 * // Parses one or more words
 */
export function many1<T>(parser: Parser<T>): Parser<T[]> {
  return (state: ParserState): ParseResult<T[]> => {
    const first = parser(state);
    if (!first.success) {
      return first;
    }

    const rest = many(parser)(first.state);
    if (!rest.success) {
      // This shouldn't happen since many always succeeds
      return rest;
    }

    return {
      success: true,
      value: [first.value, ...rest.value],
      state: rest.state,
    };
  };
}

/**
 * Parse zero or one occurrence of parser.
 * Always succeeds, returns null if no match.
 *
 * @param parser Parser to try
 * @returns Parser that returns value or null
 *
 * @example
 * const parser = optional(token(TokenType.SEMICOLON));
 * // Parses optional semicolon
 */
export function optional<T>(parser: Parser<T>): Parser<T | null> {
  return tryP(parser);
}

/**
 * Parse items separated by delimiter.
 * Returns empty array if no items found.
 *
 * @param parser Parser for items
 * @param sep Parser for separator
 * @returns Parser that returns array of items
 *
 * @example
 * const parser = sepBy(
 *   token(TokenType.WORD),
 *   token(TokenType.COMMA)
 * );
 * // Parses "word1, word2, word3" or empty
 */
export function sepBy<T, S>(
  parser: Parser<T>,
  sep: Parser<S>,
): Parser<T[]> {
  return (state: ParserState): ParseResult<T[]> => {
    const first = parser(state);
    if (!first.success) {
      // No items - return empty array
      return {
        success: true,
        value: [],
        state,
      };
    }

    const results: T[] = [first.value];
    let currentState = first.state;

    while (true) {
      const sepResult = sep(currentState);
      if (!sepResult.success) {
        break;
      }

      const itemResult = parser(sepResult.state);
      if (!itemResult.success) {
        // Separator without item - backtrack
        break;
      }

      // Prevent infinite loop
      if (itemResult.state.pos === currentState.pos) {
        break;
      }

      results.push(itemResult.value);
      currentState = itemResult.state;
    }

    return {
      success: true,
      value: results,
      state: currentState,
    };
  };
}

/**
 * Parse one or more items separated by delimiter.
 * Fails if no items found.
 *
 * @param parser Parser for items
 * @param sep Parser for separator
 * @returns Parser that returns non-empty array
 *
 * @example
 * const parser = sepBy1(
 *   token(TokenType.WORD),
 *   token(TokenType.COMMA)
 * );
 * // Parses "word1, word2, word3" but not empty
 */
export function sepBy1<T, S>(
  parser: Parser<T>,
  sep: Parser<S>,
): Parser<T[]> {
  return (state: ParserState): ParseResult<T[]> => {
    const first = parser(state);
    if (!first.success) {
      return first;
    }

    const results: T[] = [first.value];
    let currentState = first.state;

    while (true) {
      const sepResult = sep(currentState);
      if (!sepResult.success) {
        break;
      }

      const itemResult = parser(sepResult.state);
      if (!itemResult.success) {
        // Separator without item - backtrack
        break;
      }

      // Prevent infinite loop
      if (itemResult.state.pos === currentState.pos) {
        break;
      }

      results.push(itemResult.value);
      currentState = itemResult.state;
    }

    return {
      success: true,
      value: results,
      state: currentState,
    };
  };
}

/**
 * Parse left-associative chain of operators.
 * Parses one or more items separated by operators, applying operators left-to-right.
 *
 * @param parser Parser for operands
 * @param op Parser for operator (returns combining function)
 * @returns Parser that returns combined result
 *
 * @example
 * const parser = chainl1(
 *   numberParser,
 *   map(token(TokenType.PLUS), () => (a, b) => a + b)
 * );
 * // Parses "1 + 2 + 3" as ((1 + 2) + 3)
 */
export function chainl1<T>(
  parser: Parser<T>,
  op: Parser<(left: T, right: T) => T>,
): Parser<T> {
  return (state: ParserState): ParseResult<T> => {
    const first = parser(state);
    if (!first.success) {
      return first;
    }

    let result = first.value;
    let currentState = first.state;

    while (true) {
      const opResult = op(currentState);
      if (!opResult.success) {
        break;
      }

      const rightResult = parser(opResult.state);
      if (!rightResult.success) {
        break;
      }

      // Prevent infinite loop
      if (rightResult.state.pos === currentState.pos) {
        break;
      }

      result = opResult.value(result, rightResult.value);
      currentState = rightResult.state;
    }

    return {
      success: true,
      value: result,
      state: currentState,
    };
  };
}

/**
 * Parse content between delimiters.
 * Parses left delimiter, content, right delimiter, returns only content.
 *
 * @param left Left delimiter parser
 * @param parser Content parser
 * @param right Right delimiter parser
 * @returns Parser that returns content between delimiters
 *
 * @example
 * const parser = between(
 *   token(TokenType.LPAREN),
 *   token(TokenType.WORD),
 *   token(TokenType.RPAREN)
 * );
 * // Parses "(word)" and returns the word token
 */
export function between<L, T, R>(
  left: Parser<L>,
  parser: Parser<T>,
  right: Parser<R>,
): Parser<T> {
  return (state: ParserState): ParseResult<T> => {
    const leftResult = left(state);
    if (!leftResult.success) {
      return leftResult;
    }

    const contentResult = parser(leftResult.state);
    if (!contentResult.success) {
      return contentResult;
    }

    const rightResult = right(contentResult.state);
    if (!rightResult.success) {
      return rightResult;
    }

    return {
      success: true,
      value: contentResult.value,
      state: rightResult.state,
    };
  };
}

/**
 * Create lazy parser for recursive grammars.
 * Delays parser construction until parse time, enabling mutual recursion.
 *
 * @param fn Function that returns parser
 * @returns Parser that calls fn on each parse
 *
 * @example
 * const expr: Parser<Expr> = lazy(() =>
 *   alt(numberExpr, parenExpr)
 * );
 * const parenExpr = between(lparen, expr, rparen);
 * // expr can reference parenExpr which references expr
 */
export function lazy<T>(fn: () => Parser<T>): Parser<T> {
  return (state: ParserState): ParseResult<T> => {
    const parser = fn();
    return parser(state);
  };
}
