/**
 * Tests for Error Recovery Utilities
 */

import { assertEquals } from "jsr:@std/assert";
import { type Token, TokenType } from "./lexer.ts";
import { createState, type ParseResult, type ParserState } from "./combinators.ts";
import {
  insertMissing,
  isSyncToken,
  skipToSync,
  skipUntil,
  skipWhile,
  SYNC_TOKENS,
  tryWithRecovery,
} from "./error-recovery.ts";

// Helper to create test tokens
function makeToken(type: TokenType, value: string, pos = 0): Token {
  return {
    type,
    value,
    start: pos,
    end: pos + value.length,
    line: 1,
    column: pos + 1,
  };
}

// Helper parser that always fails
function failingParser(state: ParserState): ParseResult<never> {
  return {
    success: false,
    expected: "something",
    state,
  };
}

// Helper parser that always succeeds
function succeedingParser(value: string) {
  return (state: ParserState): ParseResult<string> => {
    return {
      success: true,
      value,
      state,
    };
  };
}

Deno.test("isSyncToken - identifies newline as sync token", () => {
  assertEquals(isSyncToken(TokenType.NEWLINE), true);
});

Deno.test("isSyncToken - identifies semicolon as sync token", () => {
  assertEquals(isSyncToken(TokenType.SEMICOLON), true);
});

Deno.test("isSyncToken - identifies EOF as sync token", () => {
  assertEquals(isSyncToken(TokenType.EOF), true);
});

Deno.test("isSyncToken - identifies fi as sync token", () => {
  assertEquals(isSyncToken(TokenType.FI), true);
});

Deno.test("isSyncToken - identifies done as sync token", () => {
  assertEquals(isSyncToken(TokenType.DONE), true);
});

Deno.test("isSyncToken - identifies esac as sync token", () => {
  assertEquals(isSyncToken(TokenType.ESAC), true);
});

Deno.test("isSyncToken - identifies rbrace as sync token", () => {
  assertEquals(isSyncToken(TokenType.RBRACE), true);
});

Deno.test("isSyncToken - identifies rparen as sync token", () => {
  assertEquals(isSyncToken(TokenType.RPAREN), true);
});

Deno.test("isSyncToken - returns false for non-sync tokens", () => {
  assertEquals(isSyncToken(TokenType.WORD), false);
  assertEquals(isSyncToken(TokenType.PIPE), false);
  assertEquals(isSyncToken(TokenType.IF), false);
  assertEquals(isSyncToken(TokenType.THEN), false);
});

Deno.test("skipToSync - stops at newline", () => {
  const tokens = [
    makeToken(TokenType.WORD, "echo", 0),
    makeToken(TokenType.WORD, "hello", 5),
    makeToken(TokenType.NEWLINE, "\n", 10),
    makeToken(TokenType.WORD, "world", 11),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
  assertEquals(result.skipped[0]!.type, TokenType.WORD);
  assertEquals(result.skipped[0]!.value, "echo");
  assertEquals(result.skipped[1]!.type, TokenType.WORD);
  assertEquals(result.skipped[1]!.value, "hello");
});

Deno.test("skipToSync - stops at semicolon", () => {
  const tokens = [
    makeToken(TokenType.WORD, "foo", 0),
    makeToken(TokenType.WORD, "bar", 4),
    makeToken(TokenType.SEMICOLON, ";", 7),
    makeToken(TokenType.WORD, "baz", 8),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
  assertEquals(result.skipped[0]!.value, "foo");
  assertEquals(result.skipped[1]!.value, "bar");
});

Deno.test("skipToSync - stops at EOF", () => {
  const tokens = [
    makeToken(TokenType.WORD, "test", 0),
    makeToken(TokenType.PIPE, "|", 5),
    makeToken(TokenType.EOF, "", 6),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
  assertEquals(result.skipped[0]!.type, TokenType.WORD);
  assertEquals(result.skipped[1]!.type, TokenType.PIPE);
});

Deno.test("skipToSync - stops at fi (block-ending token)", () => {
  const tokens = [
    makeToken(TokenType.WORD, "error", 0),
    makeToken(TokenType.WORD, "tokens", 6),
    makeToken(TokenType.FI, "fi", 13),
    makeToken(TokenType.WORD, "after", 16),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
});

Deno.test("skipToSync - stops at done (block-ending token)", () => {
  const tokens = [
    makeToken(TokenType.WORD, "bad", 0),
    makeToken(TokenType.DONE, "done", 4),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
  assertEquals(result.skipped[0]!.value, "bad");
});

Deno.test("skipToSync - stops at esac (block-ending token)", () => {
  const tokens = [
    makeToken(TokenType.WORD, "invalid", 0),
    makeToken(TokenType.ESAC, "esac", 8),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
});

Deno.test("skipToSync - stops at rbrace (block-ending token)", () => {
  const tokens = [
    makeToken(TokenType.WORD, "err", 0),
    makeToken(TokenType.RBRACE, "}", 4),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
});

Deno.test("skipToSync - stops at rparen (block-ending token)", () => {
  const tokens = [
    makeToken(TokenType.WORD, "oops", 0),
    makeToken(TokenType.RPAREN, ")", 5),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
});

Deno.test("skipToSync - returns empty when already at sync token", () => {
  const tokens = [
    makeToken(TokenType.NEWLINE, "\n", 0),
    makeToken(TokenType.WORD, "next", 1),
  ];
  const state = createState(tokens);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 0);
  assertEquals(result.skipped.length, 0);
});

Deno.test("skipToSync - handles empty token stream", () => {
  const state = createState([]);

  const result = skipToSync(state);

  assertEquals(result.state.pos, 0);
  assertEquals(result.skipped.length, 0);
});

Deno.test("skipUntil - stops at specified token types", () => {
  const tokens = [
    makeToken(TokenType.WORD, "a", 0),
    makeToken(TokenType.WORD, "b", 2),
    makeToken(TokenType.PIPE, "|", 4),
    makeToken(TokenType.WORD, "c", 6),
  ];
  const state = createState(tokens);

  const result = skipUntil(state, [TokenType.PIPE, TokenType.AMP]);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
  assertEquals(result.skipped[0]!.value, "a");
  assertEquals(result.skipped[1]!.value, "b");
});

Deno.test("skipUntil - stops at first matching type", () => {
  const tokens = [
    makeToken(TokenType.WORD, "x", 0),
    makeToken(TokenType.THEN, "then", 2),
    makeToken(TokenType.WORD, "y", 7),
  ];
  const state = createState(tokens);

  const result = skipUntil(state, [TokenType.THEN, TokenType.ELSE]);

  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
  assertEquals(result.skipped[0]!.value, "x");
});

Deno.test("skipUntil - skips all tokens if none match", () => {
  const tokens = [
    makeToken(TokenType.WORD, "a", 0),
    makeToken(TokenType.WORD, "b", 2),
    makeToken(TokenType.EOF, "", 4),
  ];
  const state = createState(tokens);

  const result = skipUntil(state, [TokenType.PIPE]);

  assertEquals(result.state.pos, 3);
  assertEquals(result.skipped.length, 3);
});

Deno.test("skipUntil - handles empty stop types", () => {
  const tokens = [
    makeToken(TokenType.WORD, "test", 0),
    makeToken(TokenType.EOF, "", 4),
  ];
  const state = createState(tokens);

  const result = skipUntil(state, []);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
});

Deno.test("skipWhile - skips matching tokens", () => {
  const tokens = [
    makeToken(TokenType.WORD, "a", 0),
    makeToken(TokenType.WORD, "b", 2),
    makeToken(TokenType.PIPE, "|", 4),
    makeToken(TokenType.WORD, "c", 6),
  ];
  const state = createState(tokens);

  const result = skipWhile(state, (tok) => tok.type === TokenType.WORD);

  assertEquals(result.state.pos, 2);
  assertEquals(result.skipped.length, 2);
  assertEquals(result.skipped[0]!.value, "a");
  assertEquals(result.skipped[1]!.value, "b");
});

Deno.test("skipWhile - stops when predicate returns false", () => {
  const tokens = [
    makeToken(TokenType.WORD, "short", 0),
    makeToken(TokenType.WORD, "verylongword", 6),
    makeToken(TokenType.WORD, "x", 19),
  ];
  const state = createState(tokens);

  const result = skipWhile(state, (tok) => tok.value.length <= 5);

  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
  assertEquals(result.skipped[0]!.value, "short");
});

Deno.test("skipWhile - returns empty when first token doesn't match", () => {
  const tokens = [
    makeToken(TokenType.PIPE, "|", 0),
    makeToken(TokenType.WORD, "test", 2),
  ];
  const state = createState(tokens);

  const result = skipWhile(state, (tok) => tok.type === TokenType.WORD);

  assertEquals(result.state.pos, 0);
  assertEquals(result.skipped.length, 0);
});

Deno.test("tryWithRecovery - succeeds on valid input", () => {
  const tokens = [
    makeToken(TokenType.WORD, "test", 0),
  ];
  const state = createState(tokens);

  const result = tryWithRecovery(succeedingParser("success"), state);

  assertEquals(result.success, true);
  assertEquals(result.value, "success");
  assertEquals(result.recovered, false);
  assertEquals(result.skipped.length, 0);
});

Deno.test("tryWithRecovery - recovers on failure", () => {
  const tokens = [
    makeToken(TokenType.WORD, "bad", 0),
    makeToken(TokenType.WORD, "tokens", 4),
    makeToken(TokenType.NEWLINE, "\n", 11),
    makeToken(TokenType.WORD, "next", 12),
  ];
  const state = createState(tokens);

  const result = tryWithRecovery(failingParser, state);

  assertEquals(result.success, false);
  assertEquals(result.value, undefined);
  assertEquals(result.recovered, true);
  assertEquals(result.skipped.length, 2);
  assertEquals(result.skipped[0]!.value, "bad");
  assertEquals(result.skipped[1]!.value, "tokens");
  assertEquals(result.state.pos, 2);
});

Deno.test("tryWithRecovery - recovers to nearest sync point", () => {
  const tokens = [
    makeToken(TokenType.WORD, "err", 0),
    makeToken(TokenType.SEMICOLON, ";", 4),
    makeToken(TokenType.WORD, "ok", 5),
  ];
  const state = createState(tokens);

  const result = tryWithRecovery(failingParser, state);

  assertEquals(result.success, false);
  assertEquals(result.recovered, true);
  assertEquals(result.state.pos, 1);
  assertEquals(result.skipped.length, 1);
});

Deno.test("insertMissing - creates synthetic token with default position", () => {
  const token = insertMissing(TokenType.SEMICOLON);

  assertEquals(token.type, TokenType.SEMICOLON);
  assertEquals(token.value, "<missing SEMICOLON>");
  assertEquals(token.start, 0);
  assertEquals(token.end, 0);
  assertEquals(token.line, 1);
  assertEquals(token.column, 1);
});

Deno.test("insertMissing - creates synthetic token after given token", () => {
  const afterToken = makeToken(TokenType.WORD, "test", 10);
  afterToken.line = 5;
  afterToken.column = 3;

  const token = insertMissing(TokenType.NEWLINE, afterToken);

  assertEquals(token.type, TokenType.NEWLINE);
  assertEquals(token.value, "<missing NEWLINE>");
  assertEquals(token.start, 14);
  assertEquals(token.end, 14);
  assertEquals(token.line, 5);
  assertEquals(token.column, 7); // column 3 + length 4
});

Deno.test("insertMissing - handles various token types", () => {
  const token1 = insertMissing(TokenType.FI);
  assertEquals(token1.value, "<missing FI>");

  const token2 = insertMissing(TokenType.DONE);
  assertEquals(token2.value, "<missing DONE>");

  const token3 = insertMissing(TokenType.RPAREN);
  assertEquals(token3.value, "<missing RPAREN>");
});

Deno.test("SYNC_TOKENS constant - contains expected tokens", () => {
  assertEquals(SYNC_TOKENS.includes(TokenType.NEWLINE), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.SEMICOLON), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.EOF), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.FI), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.DONE), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.ESAC), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.RBRACE), true);
  assertEquals(SYNC_TOKENS.includes(TokenType.RPAREN), true);
  assertEquals(SYNC_TOKENS.length, 8);
});
