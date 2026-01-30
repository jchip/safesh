/**
 * Tests for Bash Token Parsers
 */

import { assertEquals } from "@std/assert";
import { TokenType, type Token } from "./lexer.ts";
import { createState } from "./combinators.ts";
import {
  // Reserved words
  ifKeyword,
  thenKeyword,
  elseKeyword,
  elifKeyword,
  fiKeyword,
  forKeyword,
  whileKeyword,
  untilKeyword,
  doKeyword,
  doneKeyword,
  caseKeyword,
  esacKeyword,
  inKeyword,
  functionKeyword,
  selectKeyword,
  timeKeyword,
  coprocKeyword,
  returnKeyword,
  breakKeyword,
  continueKeyword,
  // Operators
  pipe,
  pipeAmp,
  andAnd,
  orOr,
  semicolon,
  ampersand,
  bang,
  lparen,
  rparen,
  lbrace,
  rbrace,
  doubleBracketStart,
  doubleBracketEnd,
  doubleParenStart,
  doubleParenEnd,
  doubleSemi,
  semiAnd,
  semiSemiAnd,
  // Redirections
  less,
  great,
  dless,
  dgreat,
  lessAnd,
  greatAnd,
  lessGreat,
  dlessDash,
  clobber,
  tless,
  andGreat,
  andDgreat,
  lessLparen,
  greatLparen,
  // Words
  word,
  name,
  number,
  wordOrName,
  assignmentWord,
  comment,
  heredocContent,
  // Utility
  newline,
  eofToken,
  skipNewlines,
  skipNewlines1,
  statementSep,
  logicalOp,
  pipeOp,
  caseTerminator,
  redirectOp,
  wordValue,
  nameValue,
  wordOrNameValue,
} from "./token-parsers.ts";

// Helper function to create a token
function tok(type: TokenType, value: string = ""): Token {
  return {
    type,
    value,
    start: 0,
    end: value.length,
    line: 1,
    column: 1,
  };
}

// =============================================================================
// Reserved Word Parser Tests
// =============================================================================

Deno.test("ifKeyword - matches IF token", () => {
  const state = createState([tok(TokenType.IF, "if")]);
  const result = ifKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.IF);
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("ifKeyword - fails on non-IF token", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = ifKeyword(state);
  assertEquals(result.success, false);
});

Deno.test("thenKeyword - matches THEN token", () => {
  const state = createState([tok(TokenType.THEN, "then")]);
  const result = thenKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.THEN);
  }
});

Deno.test("elseKeyword - matches ELSE token", () => {
  const state = createState([tok(TokenType.ELSE, "else")]);
  const result = elseKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.ELSE);
  }
});

Deno.test("elifKeyword - matches ELIF token", () => {
  const state = createState([tok(TokenType.ELIF, "elif")]);
  const result = elifKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.ELIF);
  }
});

Deno.test("fiKeyword - matches FI token", () => {
  const state = createState([tok(TokenType.FI, "fi")]);
  const result = fiKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.FI);
  }
});

Deno.test("forKeyword - matches FOR token", () => {
  const state = createState([tok(TokenType.FOR, "for")]);
  const result = forKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.FOR);
  }
});

Deno.test("whileKeyword - matches WHILE token", () => {
  const state = createState([tok(TokenType.WHILE, "while")]);
  const result = whileKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.WHILE);
  }
});

Deno.test("untilKeyword - matches UNTIL token", () => {
  const state = createState([tok(TokenType.UNTIL, "until")]);
  const result = untilKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.UNTIL);
  }
});

Deno.test("doKeyword - matches DO token", () => {
  const state = createState([tok(TokenType.DO, "do")]);
  const result = doKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DO);
  }
});

Deno.test("doneKeyword - matches DONE token", () => {
  const state = createState([tok(TokenType.DONE, "done")]);
  const result = doneKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DONE);
  }
});

Deno.test("caseKeyword - matches CASE token", () => {
  const state = createState([tok(TokenType.CASE, "case")]);
  const result = caseKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.CASE);
  }
});

Deno.test("esacKeyword - matches ESAC token", () => {
  const state = createState([tok(TokenType.ESAC, "esac")]);
  const result = esacKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.ESAC);
  }
});

Deno.test("inKeyword - matches IN token", () => {
  const state = createState([tok(TokenType.IN, "in")]);
  const result = inKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.IN);
  }
});

Deno.test("functionKeyword - matches FUNCTION token", () => {
  const state = createState([tok(TokenType.FUNCTION, "function")]);
  const result = functionKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.FUNCTION);
  }
});

Deno.test("selectKeyword - matches SELECT token", () => {
  const state = createState([tok(TokenType.SELECT, "select")]);
  const result = selectKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SELECT);
  }
});

Deno.test("timeKeyword - matches TIME token", () => {
  const state = createState([tok(TokenType.TIME, "time")]);
  const result = timeKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.TIME);
  }
});

Deno.test("coprocKeyword - matches COPROC token", () => {
  const state = createState([tok(TokenType.COPROC, "coproc")]);
  const result = coprocKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.COPROC);
  }
});

Deno.test("returnKeyword - matches RETURN token", () => {
  const state = createState([tok(TokenType.RETURN, "return")]);
  const result = returnKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.RETURN);
  }
});

Deno.test("breakKeyword - matches BREAK token", () => {
  const state = createState([tok(TokenType.BREAK, "break")]);
  const result = breakKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.BREAK);
  }
});

Deno.test("continueKeyword - matches CONTINUE token", () => {
  const state = createState([tok(TokenType.CONTINUE, "continue")]);
  const result = continueKeyword(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.CONTINUE);
  }
});

// =============================================================================
// Operator Parser Tests
// =============================================================================

Deno.test("pipe - matches PIPE token", () => {
  const state = createState([tok(TokenType.PIPE, "|")]);
  const result = pipe(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.PIPE);
  }
});

Deno.test("pipeAmp - matches PIPE_AMP token", () => {
  const state = createState([tok(TokenType.PIPE_AMP, "|&")]);
  const result = pipeAmp(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.PIPE_AMP);
  }
});

Deno.test("andAnd - matches AND_AND token", () => {
  const state = createState([tok(TokenType.AND_AND, "&&")]);
  const result = andAnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.AND_AND);
  }
});

Deno.test("orOr - matches OR_OR token", () => {
  const state = createState([tok(TokenType.OR_OR, "||")]);
  const result = orOr(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.OR_OR);
  }
});

Deno.test("semicolon - matches SEMICOLON token", () => {
  const state = createState([tok(TokenType.SEMICOLON, ";")]);
  const result = semicolon(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMICOLON);
  }
});

Deno.test("ampersand - matches AMP token", () => {
  const state = createState([tok(TokenType.AMP, "&")]);
  const result = ampersand(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.AMP);
  }
});

Deno.test("bang - matches BANG token", () => {
  const state = createState([tok(TokenType.BANG, "!")]);
  const result = bang(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.BANG);
  }
});

Deno.test("lparen - matches LPAREN token", () => {
  const state = createState([tok(TokenType.LPAREN, "(")]);
  const result = lparen(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.LPAREN);
  }
});

Deno.test("rparen - matches RPAREN token", () => {
  const state = createState([tok(TokenType.RPAREN, ")")]);
  const result = rparen(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.RPAREN);
  }
});

Deno.test("lbrace - matches LBRACE token", () => {
  const state = createState([tok(TokenType.LBRACE, "{")]);
  const result = lbrace(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.LBRACE);
  }
});

Deno.test("rbrace - matches RBRACE token", () => {
  const state = createState([tok(TokenType.RBRACE, "}")]);
  const result = rbrace(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.RBRACE);
  }
});

Deno.test("doubleBracketStart - matches DBRACK_START token", () => {
  const state = createState([tok(TokenType.DBRACK_START, "[[")]);
  const result = doubleBracketStart(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DBRACK_START);
  }
});

Deno.test("doubleBracketEnd - matches DBRACK_END token", () => {
  const state = createState([tok(TokenType.DBRACK_END, "]]")]);
  const result = doubleBracketEnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DBRACK_END);
  }
});

Deno.test("doubleParenStart - matches DPAREN_START token", () => {
  const state = createState([tok(TokenType.DPAREN_START, "((")]);
  const result = doubleParenStart(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DPAREN_START);
  }
});

Deno.test("doubleParenEnd - matches DPAREN_END token", () => {
  const state = createState([tok(TokenType.DPAREN_END, "))")]);
  const result = doubleParenEnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DPAREN_END);
  }
});

Deno.test("doubleSemi - matches DSEMI token", () => {
  const state = createState([tok(TokenType.DSEMI, ";;")]);
  const result = doubleSemi(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DSEMI);
  }
});

Deno.test("semiAnd - matches SEMI_AND token", () => {
  const state = createState([tok(TokenType.SEMI_AND, ";&")]);
  const result = semiAnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMI_AND);
  }
});

Deno.test("semiSemiAnd - matches SEMI_SEMI_AND token", () => {
  const state = createState([tok(TokenType.SEMI_SEMI_AND, ";;&")]);
  const result = semiSemiAnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMI_SEMI_AND);
  }
});

// =============================================================================
// Redirection Parser Tests
// =============================================================================

Deno.test("less - matches LESS token", () => {
  const state = createState([tok(TokenType.LESS, "<")]);
  const result = less(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.LESS);
  }
});

Deno.test("great - matches GREAT token", () => {
  const state = createState([tok(TokenType.GREAT, ">")]);
  const result = great(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.GREAT);
  }
});

Deno.test("dless - matches DLESS token", () => {
  const state = createState([tok(TokenType.DLESS, "<<")]);
  const result = dless(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DLESS);
  }
});

Deno.test("dgreat - matches DGREAT token", () => {
  const state = createState([tok(TokenType.DGREAT, ">>")]);
  const result = dgreat(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DGREAT);
  }
});

Deno.test("lessAnd - matches LESSAND token", () => {
  const state = createState([tok(TokenType.LESSAND, "<&")]);
  const result = lessAnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.LESSAND);
  }
});

Deno.test("greatAnd - matches GREATAND token", () => {
  const state = createState([tok(TokenType.GREATAND, ">&")]);
  const result = greatAnd(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.GREATAND);
  }
});

Deno.test("lessGreat - matches LESSGREAT token", () => {
  const state = createState([tok(TokenType.LESSGREAT, "<>")]);
  const result = lessGreat(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.LESSGREAT);
  }
});

Deno.test("dlessDash - matches DLESSDASH token", () => {
  const state = createState([tok(TokenType.DLESSDASH, "<<-")]);
  const result = dlessDash(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DLESSDASH);
  }
});

Deno.test("clobber - matches CLOBBER token", () => {
  const state = createState([tok(TokenType.CLOBBER, ">|")]);
  const result = clobber(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.CLOBBER);
  }
});

Deno.test("tless - matches TLESS token", () => {
  const state = createState([tok(TokenType.TLESS, "<<<")]);
  const result = tless(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.TLESS);
  }
});

Deno.test("andGreat - matches AND_GREAT token", () => {
  const state = createState([tok(TokenType.AND_GREAT, "&>")]);
  const result = andGreat(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.AND_GREAT);
  }
});

Deno.test("andDgreat - matches AND_DGREAT token", () => {
  const state = createState([tok(TokenType.AND_DGREAT, "&>>")]);
  const result = andDgreat(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.AND_DGREAT);
  }
});

Deno.test("lessLparen - matches LESS_LPAREN token", () => {
  const state = createState([tok(TokenType.LESS_LPAREN, "<(")]);
  const result = lessLparen(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.LESS_LPAREN);
  }
});

Deno.test("greatLparen - matches GREAT_LPAREN token", () => {
  const state = createState([tok(TokenType.GREAT_LPAREN, ">(")]);
  const result = greatLparen(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.GREAT_LPAREN);
  }
});

// =============================================================================
// Word Parser Tests
// =============================================================================

Deno.test("word - matches WORD token", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = word(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.WORD);
    assertEquals(result.value.value, "test");
  }
});

Deno.test("word - fails on non-WORD token", () => {
  const state = createState([tok(TokenType.NAME, "var")]);
  const result = word(state);
  assertEquals(result.success, false);
});

Deno.test("name - matches NAME token", () => {
  const state = createState([tok(TokenType.NAME, "variable")]);
  const result = name(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.NAME);
    assertEquals(result.value.value, "variable");
  }
});

Deno.test("name - fails on non-NAME token", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = name(state);
  assertEquals(result.success, false);
});

Deno.test("number - matches NUMBER token", () => {
  const state = createState([tok(TokenType.NUMBER, "123")]);
  const result = number(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.NUMBER);
    assertEquals(result.value.value, "123");
  }
});

Deno.test("wordOrName - matches WORD token", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = wordOrName(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.WORD);
  }
});

Deno.test("wordOrName - matches NAME token", () => {
  const state = createState([tok(TokenType.NAME, "var")]);
  const result = wordOrName(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.NAME);
  }
});

Deno.test("wordOrName - fails on non-word/name token", () => {
  const state = createState([tok(TokenType.PIPE, "|")]);
  const result = wordOrName(state);
  assertEquals(result.success, false);
});

Deno.test("assignmentWord - matches ASSIGNMENT_WORD token", () => {
  const state = createState([tok(TokenType.ASSIGNMENT_WORD, "VAR=value")]);
  const result = assignmentWord(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(result.value.value, "VAR=value");
  }
});

Deno.test("comment - matches COMMENT token", () => {
  const state = createState([tok(TokenType.COMMENT, "# comment")]);
  const result = comment(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.COMMENT);
  }
});

Deno.test("heredocContent - matches HEREDOC_CONTENT token", () => {
  const state = createState([tok(TokenType.HEREDOC_CONTENT, "content\n")]);
  const result = heredocContent(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.HEREDOC_CONTENT);
  }
});

// =============================================================================
// Utility Parser Tests
// =============================================================================

Deno.test("newline - matches NEWLINE token", () => {
  const state = createState([tok(TokenType.NEWLINE, "\n")]);
  const result = newline(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.NEWLINE);
  }
});

Deno.test("eofToken - matches EOF token", () => {
  const state = createState([tok(TokenType.EOF, "")]);
  const result = eofToken(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.EOF);
  }
});

Deno.test("skipNewlines - skips zero newlines", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = skipNewlines(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 0);
    assertEquals(result.state.pos, 0);
  }
});

Deno.test("skipNewlines - skips one newline", () => {
  const state = createState([
    tok(TokenType.NEWLINE, "\n"),
    tok(TokenType.WORD, "test"),
  ]);
  const result = skipNewlines(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
    assertEquals(result.state.pos, 1);
  }
});

Deno.test("skipNewlines - skips multiple newlines", () => {
  const state = createState([
    tok(TokenType.NEWLINE, "\n"),
    tok(TokenType.NEWLINE, "\n"),
    tok(TokenType.NEWLINE, "\n"),
    tok(TokenType.WORD, "test"),
  ]);
  const result = skipNewlines(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 3);
    assertEquals(result.state.pos, 3);
  }
});

Deno.test("skipNewlines1 - requires at least one newline", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = skipNewlines1(state);
  assertEquals(result.success, false);
});

Deno.test("skipNewlines1 - succeeds with one newline", () => {
  const state = createState([
    tok(TokenType.NEWLINE, "\n"),
    tok(TokenType.WORD, "test"),
  ]);
  const result = skipNewlines1(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.length, 1);
  }
});

Deno.test("statementSep - matches semicolon", () => {
  const state = createState([tok(TokenType.SEMICOLON, ";")]);
  const result = statementSep(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMICOLON);
  }
});

Deno.test("statementSep - matches newline", () => {
  const state = createState([tok(TokenType.NEWLINE, "\n")]);
  const result = statementSep(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.NEWLINE);
  }
});

Deno.test("statementSep - fails on other tokens", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = statementSep(state);
  assertEquals(result.success, false);
});

Deno.test("logicalOp - matches AND_AND", () => {
  const state = createState([tok(TokenType.AND_AND, "&&")]);
  const result = logicalOp(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.AND_AND);
  }
});

Deno.test("logicalOp - matches OR_OR", () => {
  const state = createState([tok(TokenType.OR_OR, "||")]);
  const result = logicalOp(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.OR_OR);
  }
});

Deno.test("logicalOp - fails on other tokens", () => {
  const state = createState([tok(TokenType.PIPE, "|")]);
  const result = logicalOp(state);
  assertEquals(result.success, false);
});

Deno.test("pipeOp - matches PIPE", () => {
  const state = createState([tok(TokenType.PIPE, "|")]);
  const result = pipeOp(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.PIPE);
  }
});

Deno.test("pipeOp - matches PIPE_AMP", () => {
  const state = createState([tok(TokenType.PIPE_AMP, "|&")]);
  const result = pipeOp(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.PIPE_AMP);
  }
});

Deno.test("pipeOp - fails on other tokens", () => {
  const state = createState([tok(TokenType.AND_AND, "&&")]);
  const result = pipeOp(state);
  assertEquals(result.success, false);
});

Deno.test("caseTerminator - matches DSEMI", () => {
  const state = createState([tok(TokenType.DSEMI, ";;")]);
  const result = caseTerminator(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.DSEMI);
  }
});

Deno.test("caseTerminator - matches SEMI_AND", () => {
  const state = createState([tok(TokenType.SEMI_AND, ";&")]);
  const result = caseTerminator(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMI_AND);
  }
});

Deno.test("caseTerminator - matches SEMI_SEMI_AND", () => {
  const state = createState([tok(TokenType.SEMI_SEMI_AND, ";;&")]);
  const result = caseTerminator(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMI_SEMI_AND);
  }
});

Deno.test("caseTerminator - prioritizes SEMI_SEMI_AND over SEMI_AND", () => {
  const state = createState([tok(TokenType.SEMI_SEMI_AND, ";;&")]);
  const result = caseTerminator(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value.type, TokenType.SEMI_SEMI_AND);
  }
});

Deno.test("redirectOp - matches various redirection operators", () => {
  const redirections = [
    [TokenType.AND_DGREAT, "&>>"],
    [TokenType.AND_GREAT, "&>"],
    [TokenType.DLESSDASH, "<<-"],
    [TokenType.DLESS, "<<"],
    [TokenType.DGREAT, ">>"],
    [TokenType.LESSGREAT, "<>"],
    [TokenType.LESSAND, "<&"],
    [TokenType.GREATAND, ">&"],
    [TokenType.LESS_LPAREN, "<("],
    [TokenType.GREAT_LPAREN, ">("],
    [TokenType.CLOBBER, ">|"],
    [TokenType.TLESS, "<<<"],
    [TokenType.LESS, "<"],
    [TokenType.GREAT, ">"],
  ] as const;

  for (const [type, value] of redirections) {
    const state = createState([tok(type, value)]);
    const result = redirectOp(state);
    assertEquals(result.success, true, `Should match ${type}`);
    if (result.success) {
      assertEquals(result.value.type, type);
    }
  }
});

Deno.test("redirectOp - fails on non-redirection token", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = redirectOp(state);
  assertEquals(result.success, false);
});

// =============================================================================
// Value Extraction Tests
// =============================================================================

Deno.test("wordValue - extracts word value", () => {
  const state = createState([tok(TokenType.WORD, "hello")]);
  const result = wordValue(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "hello");
  }
});

Deno.test("nameValue - extracts name value", () => {
  const state = createState([tok(TokenType.NAME, "variable")]);
  const result = nameValue(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "variable");
  }
});

Deno.test("wordOrNameValue - extracts word value", () => {
  const state = createState([tok(TokenType.WORD, "test")]);
  const result = wordOrNameValue(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "test");
  }
});

Deno.test("wordOrNameValue - extracts name value", () => {
  const state = createState([tok(TokenType.NAME, "var")]);
  const result = wordOrNameValue(state);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.value, "var");
  }
});
