/**
 * Bash Statement Parsers
 *
 * Combinator-based parsers for bash statements. These parsers work alongside
 * the existing parser and use the token parsers and combinators to build AST nodes.
 */

import type * as AST from "./ast.ts";
import {
  type Parser,
  type ParserState,
  type ParseResult,
  map,
  seq,
  alt,
  many,
  optional,
  currentToken,
  advanceState,
  isAtEnd,
} from "./combinators.ts";
import {
  ifKeyword,
  thenKeyword,
  elseKeyword,
  elifKeyword,
  fiKeyword,
  forKeyword,
  whileKeyword,
  doKeyword,
  doneKeyword,
  inKeyword,
  name,
  wordOrName,
  skipNewlines,
  semicolon,
} from "./token-parsers.ts";
import { TokenType, type Token } from "./lexer.ts";

// ============================================================================
// Helper Functions
// ============================================================================

/** Skip newlines and optional semicolons */
const ws: Parser<Token[]> = skipNewlines;

/** Skip newlines, parse something, skip more newlines */
function trimmed<T>(parser: Parser<T>): Parser<T> {
  return (state) => {
    let s = ws(state).state;
    const result = parser(s);
    if (!result.success) return result;
    s = ws(result.state).state;
    return { ...result, state: s };
  };
}

// ============================================================================
// Word Parser (creates AST.Word)
// ============================================================================

/** Parse a word/name/number token and create Word AST node */
export const wordNode: Parser<AST.Word> = (state) => {
  const tok = currentToken(state);
  if (!tok) return { success: false, expected: "word", state };

  // Accept WORD, NAME, or NUMBER tokens
  if (tok.type === TokenType.WORD || tok.type === TokenType.NAME || tok.type === TokenType.NUMBER) {
    return {
      success: true,
      value: {
        type: "Word",
        value: tok.value,
        quoted: tok.quoted ?? false,
        singleQuoted: tok.singleQuoted ?? false,
        parts: [{ type: "LiteralPart", value: tok.value }],
      },
      state: advanceState(state),
    };
  }

  return { success: false, expected: "word", state };
};

/** Parse multiple words */
export const wordList: Parser<AST.Word[]> = many(trimmed(wordNode));

// ============================================================================
// Simple Command (placeholder - full implementation complex)
// ============================================================================

/** Simple command: name [args...] */
export const simpleCommand: Parser<AST.Command> = (state) => {
  // Parse command name
  const nameResult = wordNode(state);
  if (!nameResult.success) {
    return { success: false, expected: "command name", state };
  }

  // Parse arguments (words until special token)
  const args: AST.Word[] = [];
  let s = nameResult.state;

  while (!isAtEnd(s)) {
    const tok = currentToken(s);
    if (!tok) break;
    // Stop at operators/keywords
    if ([
      TokenType.PIPE,
      TokenType.AND_AND,
      TokenType.OR_OR,
      TokenType.SEMICOLON,
      TokenType.NEWLINE,
      TokenType.AMP,
      TokenType.RPAREN,
      TokenType.RBRACE,
      TokenType.FI,
      TokenType.DONE,
      TokenType.ESAC,
      TokenType.THEN,
      TokenType.ELSE,
      TokenType.ELIF,
      TokenType.DO,
    ].includes(tok.type)) break;

    const argResult = wordNode(s);
    if (!argResult.success) break;
    args.push(argResult.value);
    s = argResult.state;
  }

  return {
    success: true,
    value: {
      type: "Command",
      name: nameResult.value,
      args,
      redirects: [],
      assignments: [],
    },
    state: s,
  };
};

// ============================================================================
// Statement List (for compound command bodies)
// ============================================================================

// Forward declaration for recursion
let statementParser: Parser<AST.Statement>;

/** Parse statement list until terminator tokens */
export function statementList(terminators: TokenType[]): Parser<AST.Statement[]> {
  return (state) => {
    const statements: AST.Statement[] = [];
    let s = state;

    while (!isAtEnd(s)) {
      // Skip newlines/semicolons
      s = ws(s).state;

      const tok = currentToken(s);
      if (!tok || terminators.includes(tok.type)) break;

      // Skip standalone semicolons/newlines
      if (tok.type === TokenType.SEMICOLON || tok.type === TokenType.NEWLINE) {
        s = advanceState(s);
        continue;
      }

      const stmtResult = statementParser(s);
      if (!stmtResult.success) break;
      statements.push(stmtResult.value);
      s = stmtResult.state;
    }

    return { success: true, value: statements, state: s };
  };
}

// ============================================================================
// If Statement (and Elif)
// ============================================================================

/** Parse if or elif statement - internal helper */
function parseIfOrElif(state: ParserState, isElif: boolean): ParseResult<AST.IfStatement> {
  // Expect 'if' or 'elif'
  let s = state;
  if (isElif) {
    const elifResult = elifKeyword(state);
    if (!elifResult.success) return { success: false, expected: "'elif'", state };
    s = ws(elifResult.state).state;
  } else {
    const ifResult = ifKeyword(state);
    if (!ifResult.success) return { success: false, expected: "'if'", state };
    s = ws(ifResult.state).state;
  }

  // Parse condition (simple command for now)
  const condResult = simpleCommand(s);
  if (!condResult.success) return { success: false, expected: "condition", state: s };
  s = ws(condResult.state).state;

  // Optional semicolon
  const semiTok = currentToken(s);
  if (semiTok?.type === TokenType.SEMICOLON) s = advanceState(s);
  s = ws(s).state;

  // Expect 'then'
  const thenResult = thenKeyword(s);
  if (!thenResult.success) return { success: false, expected: "'then'", state: s };
  s = ws(thenResult.state).state;

  // Parse consequent
  const bodyResult = statementList([TokenType.ELIF, TokenType.ELSE, TokenType.FI])(s);
  if (!bodyResult.success) return { success: false, expected: "statement", state: s };
  s = ws(bodyResult.state).state;

  // Check for elif/else/fi
  let alternate: AST.Statement[] | AST.IfStatement | null = null;
  const nextTok = currentToken(s);

  if (nextTok?.type === TokenType.ELIF) {
    // Recursively parse elif (which is like if but starts with elif)
    const elifResult = parseIfOrElif(s, true);
    if (!elifResult.success) return { success: false, expected: "elif body", state: s };
    alternate = elifResult.value;
    s = elifResult.state;
  } else if (nextTok?.type === TokenType.ELSE) {
    s = advanceState(s);
    s = ws(s).state;
    const elseResult = statementList([TokenType.FI])(s);
    if (!elseResult.success) return { success: false, expected: "else body", state: s };
    alternate = elseResult.value;
    s = elseResult.state;

    // Expect 'fi'
    const fiResult = fiKeyword(s);
    if (!fiResult.success) return { success: false, expected: "'fi'", state: s };
    s = fiResult.state;
  } else {
    // Expect 'fi'
    const fiResult = fiKeyword(s);
    if (!fiResult.success) return { success: false, expected: "'fi'", state: s };
    s = fiResult.state;
  }

  // Wrap condition in Pipeline for AST compatibility
  const test: AST.Pipeline = {
    type: "Pipeline",
    commands: [condResult.value],
    operator: null,
    background: false,
  };

  return {
    success: true,
    value: {
      type: "IfStatement",
      test,
      consequent: bodyResult.value,
      alternate,
    },
    state: s,
  };
}

/** Parse if statement (public API) */
export const ifStatement: Parser<AST.IfStatement> = (state) => {
  return parseIfOrElif(state, false);
};

// ============================================================================
// For Statement
// ============================================================================

export const forStatement: Parser<AST.ForStatement> = (state) => {
  // Expect 'for'
  const forResult = forKeyword(state);
  if (!forResult.success) return { success: false, expected: "'for'", state };
  let s = ws(forResult.state).state;

  // Parse variable name
  const varResult = name(s);
  if (!varResult.success) return { success: false, expected: "variable name", state: s };
  const variable = varResult.value.value;
  s = ws(varResult.state).state;

  // Optional 'in' word list
  let iterable: AST.Word[] = [];
  const inTok = currentToken(s);
  if (inTok?.type === TokenType.IN) {
    s = advanceState(s);
    s = ws(s).state;

    // Parse words until semicolon/newline/do
    while (!isAtEnd(s)) {
      const tok = currentToken(s);
      if (
        !tok ||
        tok.type === TokenType.SEMICOLON ||
        tok.type === TokenType.NEWLINE ||
        tok.type === TokenType.DO
      ) break;
      const wordResult = wordNode(s);
      if (!wordResult.success) break;
      iterable.push(wordResult.value);
      s = wordResult.state;
    }
  }

  // Skip semicolon/newlines
  s = ws(s).state;
  const semiTok = currentToken(s);
  if (semiTok?.type === TokenType.SEMICOLON) s = advanceState(s);
  s = ws(s).state;

  // Expect 'do'
  const doResult = doKeyword(s);
  if (!doResult.success) return { success: false, expected: "'do'", state: s };
  s = ws(doResult.state).state;

  // Parse body
  const bodyResult = statementList([TokenType.DONE])(s);
  if (!bodyResult.success) return { success: false, expected: "statement", state: s };
  s = bodyResult.state;

  // Expect 'done'
  const doneResult = doneKeyword(s);
  if (!doneResult.success) return { success: false, expected: "'done'", state: s };

  return {
    success: true,
    value: {
      type: "ForStatement",
      variable,
      iterable,
      body: bodyResult.value,
    },
    state: doneResult.state,
  };
};

// ============================================================================
// While Statement
// ============================================================================

export const whileStatement: Parser<AST.WhileStatement> = (state) => {
  const whileResult = whileKeyword(state);
  if (!whileResult.success) return { success: false, expected: "'while'", state };
  let s = ws(whileResult.state).state;

  // Parse condition
  const condResult = simpleCommand(s);
  if (!condResult.success) return { success: false, expected: "condition", state: s };
  s = ws(condResult.state).state;

  // Optional semicolon
  const semiTok = currentToken(s);
  if (semiTok?.type === TokenType.SEMICOLON) s = advanceState(s);
  s = ws(s).state;

  // Expect 'do'
  const doResult = doKeyword(s);
  if (!doResult.success) return { success: false, expected: "'do'", state: s };
  s = ws(doResult.state).state;

  // Parse body
  const bodyResult = statementList([TokenType.DONE])(s);
  if (!bodyResult.success) return { success: false, expected: "statement", state: s };
  s = bodyResult.state;

  // Expect 'done'
  const doneResult = doneKeyword(s);
  if (!doneResult.success) return { success: false, expected: "'done'", state: s };

  const test: AST.Pipeline = {
    type: "Pipeline",
    commands: [condResult.value],
    operator: null,
    background: false,
  };

  return {
    success: true,
    value: {
      type: "WhileStatement",
      test,
      body: bodyResult.value,
    },
    state: doneResult.state,
  };
};

// ============================================================================
// Main Statement Parser
// ============================================================================

/** Parse any statement */
statementParser = (state: ParserState): ParseResult<AST.Statement> => {
  const tok = currentToken(state);
  if (!tok) return { success: false, expected: "statement", state };

  switch (tok.type) {
    case TokenType.IF:
      return ifStatement(state);
    case TokenType.FOR:
      return forStatement(state);
    case TokenType.WHILE:
      return whileStatement(state);
    // Add more as needed
    default:
      return simpleCommand(state);
  }
};

export { statementParser };
