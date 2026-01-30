/**
 * Pipeline Parsers using Combinator Approach
 *
 * Demonstrates combinator-based pipeline parsing using chainl1 for
 * left-associative operators. This is a NEW module showcasing the
 * combinator infrastructure built in SSH-458, SSH-459, and SSH-460.
 */

import type * as AST from "./ast.ts";
import {
  type Parser,
  type ParserState,
  type ParseResult,
  map,
  alt,
  chainl1,
  pure,
  createState,
  currentToken,
  isAtEnd,
  advanceState,
} from "./combinators.ts";
import {
  pipe,
  andAnd,
  orOr,
  ampersand,
  pipeOp,
  logicalOp,
  wordOrName,
  skipNewlines,
} from "./token-parsers.ts";
import { TokenType, type Token } from "./lexer.ts";

// ============================================================================
// Helper: Skip whitespace
// ============================================================================

const ws: Parser<Token[]> = skipNewlines;

// ============================================================================
// Simple Command (basic implementation)
// ============================================================================

/** Create a Word AST node */
function makeWord(tok: Token): AST.Word {
  return {
    type: "Word",
    value: tok.value,
    quoted: tok.quoted ?? false,
    singleQuoted: tok.singleQuoted ?? false,
    parts: [{ type: "LiteralPart", value: tok.value }],
  };
}

/** Parse a simple command (name + args) */
export const simpleCommand: Parser<AST.Command> = (state) => {
  const nameResult = wordOrName(state);
  if (!nameResult.success) {
    return { success: false, expected: "command name", state };
  }

  const args: AST.Word[] = [];
  let s = nameResult.state;

  // Stop tokens for arguments
  const stopTokens = [
    TokenType.PIPE,
    TokenType.PIPE_AMP,
    TokenType.AND_AND,
    TokenType.OR_OR,
    TokenType.SEMICOLON,
    TokenType.NEWLINE,
    TokenType.AMP,
    TokenType.EOF,
    TokenType.RPAREN,
    TokenType.RBRACE,
    TokenType.FI,
    TokenType.DONE,
    TokenType.ESAC,
    TokenType.THEN,
    TokenType.ELSE,
    TokenType.ELIF,
    TokenType.DO,
  ];

  while (!isAtEnd(s)) {
    const tok = currentToken(s);
    if (!tok || stopTokens.includes(tok.type)) break;

    // Accept WORD, NAME, or NUMBER tokens as arguments
    if (
      tok.type !== TokenType.WORD &&
      tok.type !== TokenType.NAME &&
      tok.type !== TokenType.NUMBER
    ) {
      break;
    }

    args.push(makeWord(tok));
    s = advanceState(s);
  }

  return {
    success: true,
    value: {
      type: "Command",
      name: makeWord(nameResult.value),
      args,
      redirects: [],
      assignments: [],
    },
    state: s,
  };
};

// ============================================================================
// Pipeline Operators
// ============================================================================

/** Helper to create pipeline from two commands with operator */
function makePipeline(
  left: AST.Statement,
  right: AST.Statement,
  op: AST.Pipeline["operator"],
): AST.Pipeline {
  // If left is already a pipeline with same operator, extend it
  if (left.type === "Pipeline" && left.operator === op) {
    return {
      type: "Pipeline",
      commands: [...left.commands, right],
      operator: op,
      background: false,
    };
  }

  return {
    type: "Pipeline",
    commands: [left, right],
    operator: op,
    background: false,
  };
}

/** Pipe operator (|) that returns a combining function */
export const pipeOperator: Parser<
  (left: AST.Statement, right: AST.Statement) => AST.Pipeline
> = (state) => {
  // Skip leading whitespace
  let s = ws(state).state;

  const tok = currentToken(s);
  if (
    !tok ||
    (tok.type !== TokenType.PIPE && tok.type !== TokenType.PIPE_AMP)
  ) {
    return { success: false, expected: "'|'", state };
  }

  s = advanceState(s);
  // Skip trailing whitespace
  s = ws(s).state;

  return {
    success: true,
    value: (left, right) => makePipeline(left, right, "|"),
    state: s,
  };
};

/** AND operator (&&) that returns a combining function */
export const andOperator: Parser<
  (left: AST.Statement, right: AST.Statement) => AST.Pipeline
> = (state) => {
  let s = ws(state).state;

  const tok = currentToken(s);
  if (!tok || tok.type !== TokenType.AND_AND) {
    return { success: false, expected: "'&&'", state };
  }

  s = advanceState(s);
  s = ws(s).state;

  return {
    success: true,
    value: (left, right) => makePipeline(left, right, "&&"),
    state: s,
  };
};

/** OR operator (||) that returns a combining function */
export const orOperator: Parser<
  (left: AST.Statement, right: AST.Statement) => AST.Pipeline
> = (state) => {
  let s = ws(state).state;

  const tok = currentToken(s);
  if (!tok || tok.type !== TokenType.OR_OR) {
    return { success: false, expected: "'||'", state };
  }

  s = advanceState(s);
  s = ws(s).state;

  return {
    success: true,
    value: (left, right) => makePipeline(left, right, "||"),
    state: s,
  };
};

// ============================================================================
// Pipeline Parser using chainl1
// ============================================================================

/**
 * Parse a pipeline: cmd1 | cmd2 | cmd3
 * Uses chainl1 for left-associative parsing.
 */
export const pipeline: Parser<AST.Statement> = chainl1(
  simpleCommand,
  pipeOperator,
);

/**
 * Parse and-or list: pipeline && pipeline || pipeline
 * Uses chainl1 for left-associative parsing.
 */
export const andOrList: Parser<AST.Statement> = chainl1(
  pipeline,
  alt(andOperator, orOperator),
);

// ============================================================================
// Complete List (with background &)
// ============================================================================

/**
 * Parse a complete command with optional trailing &
 */
export const completeCommand: Parser<AST.Statement> = (state) => {
  const result = andOrList(state);
  if (!result.success) return result;

  let s = result.state;
  let stmt = result.value;

  // Check for trailing &
  const tok = currentToken(s);
  if (tok?.type === TokenType.AMP) {
    s = advanceState(s);

    // Wrap in pipeline with background flag
    if (stmt.type === "Pipeline") {
      stmt = { ...stmt, background: true };
    } else {
      stmt = {
        type: "Pipeline",
        commands: [stmt],
        operator: "&",
        background: true,
      };
    }
  }

  return { success: true, value: stmt, state: s };
};

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parse a complete pipeline from token array.
 */
export function parsePipeline(tokens: Token[]): ParseResult<AST.Statement> {
  const state = createState(tokens);
  return completeCommand(state);
}

/**
 * Wrap single command in pipeline for AST consistency.
 */
export function wrapInPipeline(cmd: AST.Command): AST.Pipeline {
  return {
    type: "Pipeline",
    commands: [cmd],
    operator: null,
    background: false,
  };
}
