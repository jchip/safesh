/**
 * Tests for Lookahead Error Hints
 */

import { assertEquals } from "jsr:@std/assert@1";
import { TokenType, type Token } from "./lexer.ts";
import type { ParserState } from "./combinators.ts";
import { createState } from "./combinators.ts";
import {
  hintIfNext,
  hintIfNextAny,
  COMMON_HINTS,
  getBestHint,
  formatErrorWithHint,
  type ErrorHint,
} from "./error-hints.ts";

// Helper function to create a token
function makeToken(type: TokenType, value: string, pos = 0): Token {
  return {
    type,
    value,
    start: pos,
    end: pos + value.length,
    line: 1,
    column: 1,
  };
}

// Helper function to create parser state with tokens
function makeState(tokens: Token[]): ParserState {
  return createState(tokens);
}

Deno.test("hintIfNext returns hint when token matches", () => {
  const tokens = [makeToken(TokenType.LBRACE, "{")];
  const state = makeState(tokens);
  const hint: ErrorHint = {
    message: "Found opening brace",
    suggestion: "Use keyword instead",
  };

  const result = hintIfNext(state, TokenType.LBRACE, hint);
  assertEquals(result, hint);
});

Deno.test("hintIfNext returns null when token doesn't match", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);
  const hint: ErrorHint = {
    message: "Found opening brace",
  };

  const result = hintIfNext(state, TokenType.LBRACE, hint);
  assertEquals(result, null);
});

Deno.test("hintIfNext returns null at end of input", () => {
  const tokens: Token[] = [];
  const state = makeState(tokens);
  const hint: ErrorHint = {
    message: "Found opening brace",
  };

  const result = hintIfNext(state, TokenType.LBRACE, hint);
  assertEquals(result, null);
});

Deno.test("hintIfNextAny works with multiple types", () => {
  const tokens = [makeToken(TokenType.PIPE, "|")];
  const state = makeState(tokens);
  const hint: ErrorHint = {
    message: "Found operator",
  };

  const result = hintIfNextAny(
    state,
    [TokenType.PIPE, TokenType.AND_AND, TokenType.OR_OR],
    hint
  );
  assertEquals(result, hint);
});

Deno.test("hintIfNextAny returns null when no type matches", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);
  const hint: ErrorHint = {
    message: "Found operator",
  };

  const result = hintIfNextAny(
    state,
    [TokenType.PIPE, TokenType.AND_AND],
    hint
  );
  assertEquals(result, null);
});

Deno.test("missingThen hint for brace", () => {
  const tokens = [makeToken(TokenType.LBRACE, "{")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingThen(state);
  assertEquals(hint?.message, "Bash uses 'then' keyword, not '{'");
  assertEquals(hint?.suggestion, "Replace '{' with 'then'");
});

Deno.test("missingThen hint for word", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingThen(state);
  assertEquals(hint?.message, "Expected 'then' keyword");
  assertEquals(hint?.suggestion, "Add 'then' after the condition");
});

Deno.test("missingThen returns null for irrelevant tokens", () => {
  const tokens = [makeToken(TokenType.SEMICOLON, ";")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingThen(state);
  assertEquals(hint, null);
});

Deno.test("missingDo hint for brace", () => {
  const tokens = [makeToken(TokenType.LBRACE, "{")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingDo(state);
  assertEquals(hint?.message, "Bash loops use 'do' keyword, not '{'");
  assertEquals(hint?.suggestion, "Replace '{' with 'do'");
});

Deno.test("missingDo hint for word", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingDo(state);
  assertEquals(hint?.message, "Expected 'do' keyword");
  assertEquals(hint?.suggestion, "Add 'do' before loop body");
});

Deno.test("missingDo returns null for irrelevant tokens", () => {
  const tokens = [makeToken(TokenType.SEMICOLON, ";")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingDo(state);
  assertEquals(hint, null);
});

Deno.test("missingFi hint at EOF", () => {
  const tokens = [makeToken(TokenType.EOF, "")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingFi(state);
  assertEquals(hint?.message, "Unterminated if-statement");
  assertEquals(hint?.suggestion, "Add 'fi' to close the if-statement");
});

Deno.test("missingFi hint for brace", () => {
  const tokens = [makeToken(TokenType.RBRACE, "}")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingFi(state);
  assertEquals(hint?.message, "Bash if-statements end with 'fi', not '}'");
  assertEquals(hint?.suggestion, "Replace '}' with 'fi'");
});

Deno.test("missingFi returns null for irrelevant tokens", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingFi(state);
  assertEquals(hint, null);
});

Deno.test("missingDone hint for brace", () => {
  const tokens = [makeToken(TokenType.RBRACE, "}")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingDone(state);
  assertEquals(hint?.message, "Bash loops end with 'done', not '}'");
  assertEquals(hint?.suggestion, "Replace '}' with 'done'");
});

Deno.test("missingDone hint at EOF", () => {
  const tokens = [makeToken(TokenType.EOF, "")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingDone(state);
  assertEquals(hint?.message, "Unterminated loop");
  assertEquals(hint?.suggestion, "Add 'done' to close the loop");
});

Deno.test("missingDone returns null for irrelevant tokens", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.missingDone(state);
  assertEquals(hint, null);
});

Deno.test("bracketMismatch hint", () => {
  const tokens = [makeToken(TokenType.DBRACK_END, "]]")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.bracketMismatch(state);
  assertEquals(hint?.message, "Mismatched brackets");
  assertEquals(hint?.suggestion, "Use ']' for [ ] tests, ']]' for [[ ]] tests");
});

Deno.test("bracketMismatch returns null for correct tokens", () => {
  const tokens = [makeToken(TokenType.WORD, "test")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.bracketMismatch(state);
  assertEquals(hint, null);
});

Deno.test("unexpectedOperator hint for pipe", () => {
  const tokens = [makeToken(TokenType.PIPE, "|")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.unexpectedOperator(state);
  assertEquals(hint?.message, "Unexpected operator '|'");
  assertEquals(hint?.suggestion, "Check for missing command before operator");
});

Deno.test("unexpectedOperator hint for AND_AND", () => {
  const tokens = [makeToken(TokenType.AND_AND, "&&")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.unexpectedOperator(state);
  assertEquals(hint?.message, "Unexpected operator '&&'");
  assertEquals(hint?.suggestion, "Check for missing command before operator");
});

Deno.test("unexpectedOperator hint for OR_OR", () => {
  const tokens = [makeToken(TokenType.OR_OR, "||")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.unexpectedOperator(state);
  assertEquals(hint?.message, "Unexpected operator '||'");
  assertEquals(hint?.suggestion, "Check for missing command before operator");
});

Deno.test("unexpectedOperator hint for SEMICOLON", () => {
  const tokens = [makeToken(TokenType.SEMICOLON, ";")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.unexpectedOperator(state);
  assertEquals(hint?.message, "Unexpected operator ';'");
  assertEquals(hint?.suggestion, "Check for missing command before operator");
});

Deno.test("unexpectedOperator hint for AMP", () => {
  const tokens = [makeToken(TokenType.AMP, "&")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.unexpectedOperator(state);
  assertEquals(hint?.message, "Unexpected operator '&'");
  assertEquals(hint?.suggestion, "Check for missing command before operator");
});

Deno.test("unexpectedOperator returns null for non-operators", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);

  const hint = COMMON_HINTS.unexpectedOperator(state);
  assertEquals(hint, null);
});

Deno.test("getBestHint selects appropriate hint for if context", () => {
  const tokens = [makeToken(TokenType.LBRACE, "{")];
  const state = makeState(tokens);

  const hint = getBestHint(state, "if");
  assertEquals(hint?.message, "Bash uses 'then' keyword, not '{'");
});

Deno.test("getBestHint selects appropriate hint for for context", () => {
  const tokens = [makeToken(TokenType.LBRACE, "{")];
  const state = makeState(tokens);

  const hint = getBestHint(state, "for");
  assertEquals(hint?.message, "Bash loops use 'do' keyword, not '{'");
});

Deno.test("getBestHint selects appropriate hint for while context", () => {
  const tokens = [makeToken(TokenType.RBRACE, "}")];
  const state = makeState(tokens);

  const hint = getBestHint(state, "while");
  assertEquals(hint?.message, "Bash loops end with 'done', not '}'");
});

Deno.test("getBestHint selects appropriate hint for general context", () => {
  const tokens = [makeToken(TokenType.PIPE, "|")];
  const state = makeState(tokens);

  const hint = getBestHint(state, "general");
  assertEquals(hint?.message, "Unexpected operator '|'");
});

Deno.test("getBestHint returns null when no hint applies", () => {
  const tokens = [makeToken(TokenType.WORD, "echo")];
  const state = makeState(tokens);

  const hint = getBestHint(state, "general");
  assertEquals(hint, null);
});

Deno.test("formatErrorWithHint formats correctly with hint", () => {
  const hint: ErrorHint = {
    message: "Expected 'then' keyword",
    suggestion: "Add 'then' after the condition",
  };

  const result = formatErrorWithHint("Parse error", hint);
  assertEquals(
    result,
    "Parse error\n  Hint: Expected 'then' keyword\n  Suggestion: Add 'then' after the condition"
  );
});

Deno.test("formatErrorWithHint formats correctly without suggestion", () => {
  const hint: ErrorHint = {
    message: "Expected 'then' keyword",
  };

  const result = formatErrorWithHint("Parse error", hint);
  assertEquals(
    result,
    "Parse error\n  Hint: Expected 'then' keyword"
  );
});

Deno.test("formatErrorWithHint returns base message when hint is null", () => {
  const result = formatErrorWithHint("Parse error", null);
  assertEquals(result, "Parse error");
});

Deno.test("formatErrorWithHint handles multiline base message", () => {
  const hint: ErrorHint = {
    message: "Expected 'then' keyword",
    suggestion: "Add 'then' after the condition",
  };

  const result = formatErrorWithHint("Parse error at line 5\nColumn 10", hint);
  assertEquals(
    result,
    "Parse error at line 5\nColumn 10\n  Hint: Expected 'then' keyword\n  Suggestion: Add 'then' after the condition"
  );
});
