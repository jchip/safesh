/**
 * Tests for Parser Combinator Primitives
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Token, TokenType } from "./lexer.ts";
import {
  advanceState,
  alt,
  between,
  bind,
  chainl1,
  choice,
  createState,
  currentToken,
  eof,
  fail,
  isAtEnd,
  lazy,
  lookAhead,
  many,
  many1,
  map,
  optional,
  pure,
  satisfy,
  sepBy,
  sepBy1,
  seq,
  seq3,
  token,
  tokenValue,
  tryP,
  type ParserState,
} from "./combinators.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a simple token for testing
 */
function makeToken(
  type: TokenType,
  value: string,
  start = 0,
): Token {
  return {
    type,
    value,
    start,
    end: start + value.length,
    line: 1,
    column: 1,
  };
}

/**
 * Create a test state with given tokens
 */
function makeState(...tokens: Token[]): ParserState {
  return createState(tokens);
}

// =============================================================================
// State Helper Tests
// =============================================================================

Deno.test("createState - creates initial state with position 0", () => {
  const tokens = [
    makeToken(TokenType.WORD, "echo"),
    makeToken(TokenType.EOF, ""),
  ];
  const state = createState(tokens);

  assertEquals(state.pos, 0);
  assertEquals(state.tokens, tokens);
});

Deno.test("isAtEnd - returns false for non-empty state", () => {
  const state = makeState(
    makeToken(TokenType.WORD, "echo"),
  );

  assertEquals(isAtEnd(state), false);
});

Deno.test("isAtEnd - returns true when at end", () => {
  const state = makeState(
    makeToken(TokenType.WORD, "echo"),
  );
  const advanced = advanceState(state);

  assertEquals(isAtEnd(advanced), true);
});

Deno.test("isAtEnd - returns true when past end", () => {
  const state = createState([]);

  assertEquals(isAtEnd(state), true);
});

Deno.test("currentToken - returns current token", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  assertEquals(currentToken(state), tok);
});

Deno.test("currentToken - returns undefined at end", () => {
  const state = createState([]);

  assertEquals(currentToken(state), undefined);
});

Deno.test("advanceState - increments position", () => {
  const state = makeState(
    makeToken(TokenType.WORD, "echo"),
    makeToken(TokenType.WORD, "hello"),
  );

  const advanced = advanceState(state);

  assertEquals(advanced.pos, 1);
  assertEquals(state.pos, 0); // Original unchanged
});

Deno.test("advanceState - does not mutate original state", () => {
  const state = makeState(
    makeToken(TokenType.WORD, "echo"),
  );

  advanceState(state);

  assertEquals(state.pos, 0); // Original unchanged
});

// =============================================================================
// Primitive Parser Tests
// =============================================================================

Deno.test("pure - always succeeds with value", () => {
  const state = makeState(makeToken(TokenType.WORD, "echo"));
  const parser = pure(42);

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, 42);
    assertEquals(result.state, state);
  }
});

Deno.test("pure - does not consume input", () => {
  const state = makeState(makeToken(TokenType.WORD, "echo"));
  const parser = pure("test");

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.state.pos, state.pos);
  }
});

Deno.test("fail - always fails with expected message", () => {
  const state = makeState(makeToken(TokenType.WORD, "echo"));
  const parser = fail("something");

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.expected, "something");
    assertEquals(result.state, state);
  }
});

Deno.test("satisfy - succeeds when predicate is true", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = satisfy((t) => t.type === TokenType.WORD, "word");

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, tok);
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("satisfy - fails when predicate is false", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = satisfy((t) => t.type === TokenType.PIPE, "pipe");

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.expected, "pipe");
    assertEquals(result.state.pos, 0);
  }
});

Deno.test("satisfy - fails at end of input", () => {
  const state = createState([]);
  const parser = satisfy((t) => t.type === TokenType.WORD, "word");

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.expected, "word");
  }
});

Deno.test("token - matches token by type", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);
  const parser = token(TokenType.PIPE);

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, tok);
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("token - fails when type does not match", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = token(TokenType.PIPE);

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.expected, `token of type ${TokenType.PIPE}`);
  }
});

Deno.test("tokenValue - matches token by type and value", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = tokenValue(TokenType.WORD, "echo");

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, tok);
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("tokenValue - fails when type matches but value does not", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = tokenValue(TokenType.WORD, "ls");

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.expected, 'token of type WORD with value "ls"');
  }
});

Deno.test("tokenValue - fails when value matches but type does not", () => {
  const tok = makeToken(TokenType.NAME, "echo");
  const state = makeState(tok);
  const parser = tokenValue(TokenType.WORD, "echo");

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("eof - succeeds at end of input", () => {
  const state = createState([]);
  const parser = eof();

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.state.pos, 0);
  }
});

Deno.test("eof - fails when not at end", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = eof();

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.expected, `end of input, but got ${TokenType.WORD}`);
  }
});

Deno.test("lookAhead - returns value on success without consuming", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);
  const parser = lookAhead(token(TokenType.PIPE));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, tok);
    assertEquals(result.state.pos, 0); // Not consumed
  }
});

Deno.test("lookAhead - fails without consuming", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = lookAhead(token(TokenType.PIPE));

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.state.pos, 0); // Not consumed
  }
});

Deno.test("lookAhead - preserves original state on failure", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const state = makeState(tok1, tok2);
  const parser = lookAhead(token(TokenType.PIPE));

  const result = parser(state);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.state, state);
  }
});

Deno.test("tryP - returns value on success and consumes input", () => {
  const tok = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok);
  const parser = tryP(token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, tok);
    assertEquals(result.state.pos, 1); // Consumed
  }
});

Deno.test("tryP - returns null on failure without consuming", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = tryP(token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, null);
    assertEquals(result.state.pos, 0); // Not consumed
  }
});

Deno.test("tryP - useful for optional tokens", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok1, tok2);

  // Try to parse optional semicolon before word
  const parser = tryP(token(TokenType.SEMICOLON));
  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, null);
    assertEquals(result.state.pos, 0);
  }
});

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test("integration - parsing sequence of tokens", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const tok3 = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok1, tok2, tok3);

  // Parse first token
  const parser1 = token(TokenType.WORD);
  const result1 = parser1(state);
  assertEquals(result1.success, true);

  if (result1.success) {
    // Parse second token
    const parser2 = token(TokenType.WORD);
    const result2 = parser2(result1.state);
    assertEquals(result2.success, true);

    if (result2.success) {
      // Parse third token
      const parser3 = token(TokenType.SEMICOLON);
      const result3 = parser3(result2.state);
      assertEquals(result3.success, true);

      if (result3.success) {
        assertEquals(isAtEnd(result3.state), true);
      }
    }
  }
});

Deno.test("integration - lookahead preserves state for next parser", () => {
  const tok1 = makeToken(TokenType.PIPE, "|");
  const tok2 = makeToken(TokenType.WORD, "grep");
  const state = makeState(tok1, tok2);

  // Look ahead for pipe
  const lookaheadParser = lookAhead(token(TokenType.PIPE));
  const lookaheadResult = lookaheadParser(state);

  assertEquals(lookaheadResult.success, true);

  if (lookaheadResult.success) {
    // Now actually consume the pipe
    const consumeParser = token(TokenType.PIPE);
    const consumeResult = consumeParser(lookaheadResult.state);

    assertEquals(consumeResult.success, true);
    if (consumeResult.success) {
      assertEquals(consumeResult.state.pos, 1);
    }
  }
});

Deno.test("integration - tryP for optional trailing semicolon", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const state = makeState(tok1, tok2);

  // Parse word
  const wordParser = token(TokenType.WORD);
  const wordResult = wordParser(state);

  assertEquals(wordResult.success, true);

  if (wordResult.success) {
    // Try optional semicolon
    const semiParser = tryP(token(TokenType.SEMICOLON));
    const semiResult = semiParser(wordResult.state);

    assertEquals(semiResult.success, true);
    if (semiResult.success) {
      assertEquals(semiResult.value, null); // Not present
      assertEquals(semiResult.state.pos, 1); // Position unchanged
    }
  }
});

Deno.test("integration - state immutability through chain", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const state = makeState(tok1, tok2);

  const originalPos = state.pos;

  // Apply multiple parsers
  const parser1 = token(TokenType.WORD);
  const result1 = parser1(state);

  // Original state unchanged
  assertEquals(state.pos, originalPos);

  if (result1.success) {
    const parser2 = token(TokenType.WORD);
    parser2(result1.state);

    // First result state unchanged
    assertEquals(result1.state.pos, 1);
    // Original state still unchanged
    assertEquals(state.pos, originalPos);
  }
});

// =============================================================================
// Composition Function Tests
// =============================================================================

Deno.test("map - transforms successful result", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = map(token(TokenType.WORD), (t) => t.value);

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "echo");
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("map - propagates failure", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);
  const parser = map(token(TokenType.PIPE), (t) => t.value);

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("map - chains multiple transformations", () => {
  const tok = makeToken(TokenType.WORD, "hello");
  const state = makeState(tok);
  const parser = map(
    map(token(TokenType.WORD), (t) => t.value),
    (v) => v.toUpperCase(),
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "HELLO");
  }
});

Deno.test("bind - sequences dependent parsers", () => {
  const tok1 = makeToken(TokenType.WORD, "if");
  const tok2 = makeToken(TokenType.WORD, "then");
  const state = makeState(tok1, tok2);

  const parser = bind(
    token(TokenType.WORD),
    (tok) =>
      tok.value === "if"
        ? tokenValue(TokenType.WORD, "then")
        : fail("unexpected"),
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.value, "then");
  }
});

Deno.test("bind - propagates first parser failure", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);

  const parser = bind(
    token(TokenType.WORD),
    () => token(TokenType.WORD),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("bind - propagates second parser failure", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok1, tok2);

  const parser = bind(
    token(TokenType.WORD),
    () => token(TokenType.SEMICOLON),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("seq - sequences two parsers", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok1, tok2);

  const parser = seq(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value[0].type, TokenType.WORD);
    assertEquals(result.value[1].type, TokenType.SEMICOLON);
    assertEquals(result.state.pos, 2);
  }
});

Deno.test("seq - fails if first parser fails", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);

  const parser = seq(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("seq - fails if second parser fails", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok1, tok2);

  const parser = seq(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("seq3 - sequences three parsers", () => {
  const tok1 = makeToken(TokenType.LPAREN, "(");
  const tok2 = makeToken(TokenType.WORD, "echo");
  const tok3 = makeToken(TokenType.RPAREN, ")");
  const state = makeState(tok1, tok2, tok3);

  const parser = seq3(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value[0].type, TokenType.LPAREN);
    assertEquals(result.value[1].type, TokenType.WORD);
    assertEquals(result.value[2].type, TokenType.RPAREN);
    assertEquals(result.state.pos, 3);
  }
});

Deno.test("seq3 - fails on first parser failure", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = seq3(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("alt - returns first parser on success", () => {
  const tok = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok);

  const parser = alt(token(TokenType.SEMICOLON), token(TokenType.NEWLINE));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMICOLON);
  }
});

Deno.test("alt - tries second parser on first failure", () => {
  const tok = makeToken(TokenType.NEWLINE, "\n");
  const state = makeState(tok);

  const parser = alt(token(TokenType.SEMICOLON), token(TokenType.NEWLINE));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.NEWLINE);
  }
});

Deno.test("alt - fails if both parsers fail", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = alt(token(TokenType.SEMICOLON), token(TokenType.NEWLINE));

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("alt - backtracks on first parser failure", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = alt(token(TokenType.PIPE), token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.state.pos, 1); // Word consumed
  }
});

Deno.test("choice - returns first successful parser", () => {
  const tok = makeToken(TokenType.WORD, "for");
  const state = makeState(tok);

  const parser = choice(
    tokenValue(TokenType.WORD, "if"),
    tokenValue(TokenType.WORD, "for"),
    tokenValue(TokenType.WORD, "while"),
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.value, "for");
  }
});

Deno.test("choice - fails if all parsers fail", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = choice(
    tokenValue(TokenType.WORD, "if"),
    tokenValue(TokenType.WORD, "for"),
    tokenValue(TokenType.WORD, "while"),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("many - parses zero occurrences", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);

  const parser = many(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, []);
    assertEquals(result.state.pos, 0);
  }
});

Deno.test("many - parses one occurrence", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = many(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
    assertEquals(result.value[0]?.value, "echo");
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("many - parses multiple occurrences", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const tok3 = makeToken(TokenType.WORD, "world");
  const state = makeState(tok1, tok2, tok3);

  const parser = many(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 3);
    assertEquals(result.value[0]?.value, "echo");
    assertEquals(result.value[1]?.value, "hello");
    assertEquals(result.value[2]?.value, "world");
    assertEquals(result.state.pos, 3);
  }
});

Deno.test("many - stops at non-matching token", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const tok3 = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok1, tok2, tok3);

  const parser = many(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 2);
    assertEquals(result.state.pos, 2);
  }
});

Deno.test("many - prevents infinite loop on non-consuming parser", () => {
  const state = makeState(makeToken(TokenType.WORD, "echo"));
  const parser = many(pure(42));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, []);
  }
});

Deno.test("many1 - fails on zero occurrences", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);

  const parser = many1(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("many1 - succeeds on one occurrence", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = many1(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
    assertEquals(result.value[0]?.value, "echo");
  }
});

Deno.test("many1 - parses multiple occurrences", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const tok3 = makeToken(TokenType.WORD, "world");
  const state = makeState(tok1, tok2, tok3);

  const parser = many1(token(TokenType.WORD));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 3);
  }
});

Deno.test("optional - returns value on success", () => {
  const tok = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok);

  const parser = optional(token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value?.type, TokenType.SEMICOLON);
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("optional - returns null on failure", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = optional(token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, null);
    assertEquals(result.state.pos, 0);
  }
});

Deno.test("sepBy - parses zero items", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);

  const parser = sepBy(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, []);
    assertEquals(result.state.pos, 0);
  }
});

Deno.test("sepBy - parses one item", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = sepBy(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
    assertEquals(result.value[0]?.value, "echo");
  }
});

Deno.test("sepBy - parses multiple items with separators", () => {
  const tok1 = makeToken(TokenType.WORD, "a");
  const tok2 = makeToken(TokenType.SEMICOLON, ";");
  const tok3 = makeToken(TokenType.WORD, "b");
  const tok4 = makeToken(TokenType.SEMICOLON, ";");
  const tok5 = makeToken(TokenType.WORD, "c");
  const state = makeState(tok1, tok2, tok3, tok4, tok5);

  const parser = sepBy(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 3);
    assertEquals(result.value[0]?.value, "a");
    assertEquals(result.value[1]?.value, "b");
    assertEquals(result.value[2]?.value, "c");
  }
});

Deno.test("sepBy - stops at trailing separator", () => {
  const tok1 = makeToken(TokenType.WORD, "a");
  const tok2 = makeToken(TokenType.SEMICOLON, ";");
  const tok3 = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok1, tok2, tok3);

  const parser = sepBy(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
    assertEquals(result.state.pos, 1); // Doesn't consume trailing separator
  }
});

Deno.test("sepBy1 - fails on zero items", () => {
  const tok = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok);

  const parser = sepBy1(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("sepBy1 - succeeds on one item", () => {
  const tok = makeToken(TokenType.WORD, "echo");
  const state = makeState(tok);

  const parser = sepBy1(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
  }
});

Deno.test("sepBy1 - parses multiple items", () => {
  const tok1 = makeToken(TokenType.WORD, "a");
  const tok2 = makeToken(TokenType.SEMICOLON, ";");
  const tok3 = makeToken(TokenType.WORD, "b");
  const state = makeState(tok1, tok2, tok3);

  const parser = sepBy1(token(TokenType.WORD), token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 2);
  }
});

Deno.test("chainl1 - parses single operand", () => {
  const tok = makeToken(TokenType.NUMBER, "42");
  const state = makeState(tok);

  const numberParser = map(token(TokenType.NUMBER), (t) => parseInt(t.value));
  const opParser = map(token(TokenType.AMP), () => (a: number, b: number) =>
    a + b
  );
  const parser = chainl1(numberParser, opParser);

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, 42);
  }
});

Deno.test("chainl1 - parses left-associative chain", () => {
  const tok1 = makeToken(TokenType.NUMBER, "1");
  const tok2 = makeToken(TokenType.AMP, "&");
  const tok3 = makeToken(TokenType.NUMBER, "2");
  const tok4 = makeToken(TokenType.AMP, "&");
  const tok5 = makeToken(TokenType.NUMBER, "3");
  const state = makeState(tok1, tok2, tok3, tok4, tok5);

  const numberParser = map(token(TokenType.NUMBER), (t) => parseInt(t.value));
  const opParser = map(token(TokenType.AMP), () => (a: number, b: number) =>
    a + b
  );
  const parser = chainl1(numberParser, opParser);

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    // (1 + 2) + 3 = 6
    assertEquals(result.value, 6);
  }
});

Deno.test("chainl1 - stops at non-operator", () => {
  const tok1 = makeToken(TokenType.NUMBER, "5");
  const tok2 = makeToken(TokenType.AMP, "&");
  const tok3 = makeToken(TokenType.NUMBER, "3");
  const tok4 = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok1, tok2, tok3, tok4);

  const numberParser = map(token(TokenType.NUMBER), (t) => parseInt(t.value));
  const opParser = map(token(TokenType.AMP), () => (a: number, b: number) =>
    a + b
  );
  const parser = chainl1(numberParser, opParser);

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, 8);
    assertEquals(result.state.pos, 3); // Stops before pipe
  }
});

Deno.test("between - parses content between delimiters", () => {
  const tok1 = makeToken(TokenType.LPAREN, "(");
  const tok2 = makeToken(TokenType.WORD, "echo");
  const tok3 = makeToken(TokenType.RPAREN, ")");
  const state = makeState(tok1, tok2, tok3);

  const parser = between(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.WORD);
    assertEquals(result.value.value, "echo");
    assertEquals(result.state.pos, 3);
  }
});

Deno.test("between - fails if left delimiter missing", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.RPAREN, ")");
  const state = makeState(tok1, tok2);

  const parser = between(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("between - fails if content missing", () => {
  const tok1 = makeToken(TokenType.LPAREN, "(");
  const tok2 = makeToken(TokenType.RPAREN, ")");
  const state = makeState(tok1, tok2);

  const parser = between(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("between - fails if right delimiter missing", () => {
  const tok1 = makeToken(TokenType.LPAREN, "(");
  const tok2 = makeToken(TokenType.WORD, "echo");
  const tok3 = makeToken(TokenType.PIPE, "|");
  const state = makeState(tok1, tok2, tok3);

  const parser = between(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );

  const result = parser(state);

  assertEquals(result.success, false);
});

Deno.test("lazy - enables recursive grammar", () => {
  const tok1 = makeToken(TokenType.LPAREN, "(");
  const tok2 = makeToken(TokenType.LPAREN, "(");
  const tok3 = makeToken(TokenType.WORD, "x");
  const tok4 = makeToken(TokenType.RPAREN, ")");
  const tok5 = makeToken(TokenType.RPAREN, ")");
  const state = makeState(tok1, tok2, tok3, tok4, tok5);

  // expr = word | '(' expr ')'
  const expr: any = lazy(() =>
    alt(
      token(TokenType.WORD),
      between(token(TokenType.LPAREN), expr, token(TokenType.RPAREN)),
    )
  );

  const result = expr(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.state.pos, 5);
  }
});

Deno.test("lazy - defers parser construction", () => {
  let called = false;
  const parser = lazy(() => {
    called = true;
    return pure(42);
  });

  // Function not called yet
  assertEquals(called, false);

  const state = createState([]);
  parser(state);

  // Function called during parse
  assertEquals(called, true);
});

// =============================================================================
// Composition Integration Tests
// =============================================================================

Deno.test("composition - map with seq", () => {
  const tok1 = makeToken(TokenType.WORD, "echo");
  const tok2 = makeToken(TokenType.WORD, "hello");
  const state = makeState(tok1, tok2);

  const parser = map(
    seq(token(TokenType.WORD), token(TokenType.WORD)),
    ([a, b]) => `${a.value} ${b.value}`,
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "echo hello");
  }
});

Deno.test("composition - many with alt", () => {
  const tok1 = makeToken(TokenType.SEMICOLON, ";");
  const tok2 = makeToken(TokenType.NEWLINE, "\n");
  const tok3 = makeToken(TokenType.SEMICOLON, ";");
  const state = makeState(tok1, tok2, tok3);

  const parser = many(
    alt(token(TokenType.SEMICOLON), token(TokenType.NEWLINE)),
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 3);
  }
});

Deno.test("composition - sepBy with between", () => {
  const tok1 = makeToken(TokenType.LPAREN, "(");
  const tok2 = makeToken(TokenType.WORD, "a");
  const tok3 = makeToken(TokenType.RPAREN, ")");
  const tok4 = makeToken(TokenType.SEMICOLON, ";");
  const tok5 = makeToken(TokenType.LPAREN, "(");
  const tok6 = makeToken(TokenType.WORD, "b");
  const tok7 = makeToken(TokenType.RPAREN, ")");
  const state = makeState(tok1, tok2, tok3, tok4, tok5, tok6, tok7);

  const item = between(
    token(TokenType.LPAREN),
    token(TokenType.WORD),
    token(TokenType.RPAREN),
  );
  const parser = sepBy(item, token(TokenType.SEMICOLON));

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 2);
    assertEquals(result.value[0]?.value, "a");
    assertEquals(result.value[1]?.value, "b");
  }
});

Deno.test("composition - bind with choice", () => {
  const tok1 = makeToken(TokenType.WORD, "if");
  const tok2 = makeToken(TokenType.WORD, "condition");
  const state = makeState(tok1, tok2);

  const keyword = choice(
    tokenValue(TokenType.WORD, "if"),
    tokenValue(TokenType.WORD, "for"),
    tokenValue(TokenType.WORD, "while"),
  );

  const parser = bind(keyword, (kw) =>
    kw.value === "if"
      ? token(TokenType.WORD) // condition
      : pure(kw)
  );

  const result = parser(state);

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.value, "condition");
  }
});
