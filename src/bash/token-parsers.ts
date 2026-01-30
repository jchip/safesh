/**
 * Bash Token Parsers
 *
 * Token-level parsers for bash syntax elements, built using combinator primitives.
 * These parsers work with lexer tokens rather than raw strings.
 */

import { TokenType } from "./lexer.ts";
import {
  token,
  tokenValue,
  alt,
  choice,
  map,
  many,
  many1,
  optional,
  sepBy1,
  between,
  seq,
  type Parser,
  type ParserState,
  type ParseResult,
} from "./combinators.ts";
import type { Token } from "./lexer.ts";

// ============================================================================
// Reserved Word Parsers
// ============================================================================

/** Match 'if' keyword */
export const ifKeyword: Parser<Token> = token(TokenType.IF);

/** Match 'then' keyword */
export const thenKeyword: Parser<Token> = token(TokenType.THEN);

/** Match 'else' keyword */
export const elseKeyword: Parser<Token> = token(TokenType.ELSE);

/** Match 'elif' keyword */
export const elifKeyword: Parser<Token> = token(TokenType.ELIF);

/** Match 'fi' keyword */
export const fiKeyword: Parser<Token> = token(TokenType.FI);

/** Match 'for' keyword */
export const forKeyword: Parser<Token> = token(TokenType.FOR);

/** Match 'while' keyword */
export const whileKeyword: Parser<Token> = token(TokenType.WHILE);

/** Match 'until' keyword */
export const untilKeyword: Parser<Token> = token(TokenType.UNTIL);

/** Match 'do' keyword */
export const doKeyword: Parser<Token> = token(TokenType.DO);

/** Match 'done' keyword */
export const doneKeyword: Parser<Token> = token(TokenType.DONE);

/** Match 'case' keyword */
export const caseKeyword: Parser<Token> = token(TokenType.CASE);

/** Match 'esac' keyword */
export const esacKeyword: Parser<Token> = token(TokenType.ESAC);

/** Match 'in' keyword */
export const inKeyword: Parser<Token> = token(TokenType.IN);

/** Match 'function' keyword */
export const functionKeyword: Parser<Token> = token(TokenType.FUNCTION);

/** Match 'select' keyword */
export const selectKeyword: Parser<Token> = token(TokenType.SELECT);

/** Match 'time' keyword */
export const timeKeyword: Parser<Token> = token(TokenType.TIME);

/** Match 'coproc' keyword */
export const coprocKeyword: Parser<Token> = token(TokenType.COPROC);

/** Match 'return' keyword */
export const returnKeyword: Parser<Token> = token(TokenType.RETURN);

/** Match 'break' keyword */
export const breakKeyword: Parser<Token> = token(TokenType.BREAK);

/** Match 'continue' keyword */
export const continueKeyword: Parser<Token> = token(TokenType.CONTINUE);

// ============================================================================
// Operator Parsers
// ============================================================================

/** Match | operator */
export const pipe: Parser<Token> = token(TokenType.PIPE);

/** Match |& operator */
export const pipeAmp: Parser<Token> = token(TokenType.PIPE_AMP);

/** Match && operator */
export const andAnd: Parser<Token> = token(TokenType.AND_AND);

/** Match || operator */
export const orOr: Parser<Token> = token(TokenType.OR_OR);

/** Match ; operator */
export const semicolon: Parser<Token> = token(TokenType.SEMICOLON);

/** Match & operator */
export const ampersand: Parser<Token> = token(TokenType.AMP);

/** Match ! operator */
export const bang: Parser<Token> = token(TokenType.BANG);

/** Match ( */
export const lparen: Parser<Token> = token(TokenType.LPAREN);

/** Match ) */
export const rparen: Parser<Token> = token(TokenType.RPAREN);

/** Match { */
export const lbrace: Parser<Token> = token(TokenType.LBRACE);

/** Match } */
export const rbrace: Parser<Token> = token(TokenType.RBRACE);

/** Match [[ */
export const doubleBracketStart: Parser<Token> = token(TokenType.DBRACK_START);

/** Match ]] */
export const doubleBracketEnd: Parser<Token> = token(TokenType.DBRACK_END);

/** Match (( */
export const doubleParenStart: Parser<Token> = token(TokenType.DPAREN_START);

/** Match )) */
export const doubleParenEnd: Parser<Token> = token(TokenType.DPAREN_END);

/** Match ;; */
export const doubleSemi: Parser<Token> = token(TokenType.DSEMI);

/** Match ;& */
export const semiAnd: Parser<Token> = token(TokenType.SEMI_AND);

/** Match ;;& */
export const semiSemiAnd: Parser<Token> = token(TokenType.SEMI_SEMI_AND);

// ============================================================================
// Redirection Parsers
// ============================================================================

/** Match < operator */
export const less: Parser<Token> = token(TokenType.LESS);

/** Match > operator */
export const great: Parser<Token> = token(TokenType.GREAT);

/** Match << operator */
export const dless: Parser<Token> = token(TokenType.DLESS);

/** Match >> operator */
export const dgreat: Parser<Token> = token(TokenType.DGREAT);

/** Match <& operator */
export const lessAnd: Parser<Token> = token(TokenType.LESSAND);

/** Match >& operator */
export const greatAnd: Parser<Token> = token(TokenType.GREATAND);

/** Match <> operator */
export const lessGreat: Parser<Token> = token(TokenType.LESSGREAT);

/** Match <<- operator */
export const dlessDash: Parser<Token> = token(TokenType.DLESSDASH);

/** Match >| operator */
export const clobber: Parser<Token> = token(TokenType.CLOBBER);

/** Match <<< operator */
export const tless: Parser<Token> = token(TokenType.TLESS);

/** Match &> operator */
export const andGreat: Parser<Token> = token(TokenType.AND_GREAT);

/** Match &>> operator */
export const andDgreat: Parser<Token> = token(TokenType.AND_DGREAT);

/** Match <( operator */
export const lessLparen: Parser<Token> = token(TokenType.LESS_LPAREN);

/** Match >( operator */
export const greatLparen: Parser<Token> = token(TokenType.GREAT_LPAREN);

// ============================================================================
// Word Parsers
// ============================================================================

/** Match any word token */
export const word: Parser<Token> = token(TokenType.WORD);

/** Match a name (identifier) */
export const name: Parser<Token> = token(TokenType.NAME);

/** Match a number */
export const number: Parser<Token> = token(TokenType.NUMBER);

/** Match word or name (for command names/args) */
export const wordOrName: Parser<Token> = alt(word, name);

/** Match an assignment word (VAR=value) */
export const assignmentWord: Parser<Token> = token(TokenType.ASSIGNMENT_WORD);

/** Match a comment */
export const comment: Parser<Token> = token(TokenType.COMMENT);

/** Match here-document content */
export const heredocContent: Parser<Token> = token(TokenType.HEREDOC_CONTENT);

// ============================================================================
// Utility Parsers
// ============================================================================

/** Match newline */
export const newline: Parser<Token> = token(TokenType.NEWLINE);

/** Match EOF */
export const eofToken: Parser<Token> = token(TokenType.EOF);

/** Skip zero or more newlines, return count */
export const skipNewlines: Parser<Token[]> = many(newline);

/** Skip one or more newlines, require at least one */
export const skipNewlines1: Parser<Token[]> = many1(newline);

/** Match a statement separator (; or newline) */
export const statementSep: Parser<Token> = alt(semicolon, newline);

/** Match any logical operator (&& or ||) */
export const logicalOp: Parser<Token> = alt(andAnd, orOr);

/** Match any pipe operator (| or |&) */
export const pipeOp: Parser<Token> = alt(pipe, pipeAmp);

/** Match any case terminator (;;, ;&, or ;;&) */
export const caseTerminator: Parser<Token> = choice(
  semiSemiAnd,
  semiAnd,
  doubleSemi,
);

/** Match any redirection operator */
export const redirectOp: Parser<Token> = choice(
  andDgreat,
  andGreat,
  dlessDash,
  dless,
  dgreat,
  lessGreat,
  lessAnd,
  greatAnd,
  lessLparen,
  greatLparen,
  clobber,
  tless,
  less,
  great,
);

/** Extract token value as string */
export const extractValue = <T extends Token>(tok: T): string => tok.value;

/** Parse word and extract its value */
export const wordValue: Parser<string> = map(word, extractValue);

/** Parse name and extract its value */
export const nameValue: Parser<string> = map(name, extractValue);

/** Parse word or name and extract its value */
export const wordOrNameValue: Parser<string> = map(wordOrName, extractValue);
