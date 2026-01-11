/**
 * Bash Parser for SafeShell
 *
 * Recursive descent parser that converts tokens from the lexer into an AST.
 * Handles the complex bash grammar including pipelines, control flow, and expansions.
 */

import { Lexer, Token, TokenType } from "./lexer.ts";
import type * as AST from "./ast.ts";

// =============================================================================
// Parser Class
// =============================================================================

export class Parser {
  private lexer: Lexer;
  private currentToken: Token;
  private peekToken: Token;

  constructor(input: string) {
    this.lexer = new Lexer(input);
    const first = this.lexer.next();
    const second = this.lexer.next();

    this.currentToken = first ?? this.makeEOF();
    this.peekToken = second ?? this.makeEOF();
  }

  // ===========================================================================
  // Token Management
  // ===========================================================================

  private makeEOF(): Token {
    return {
      type: TokenType.EOF,
      value: "",
      start: 0,
      end: 0,
      line: 0,
      column: 0,
    };
  }

  private advance(): Token {
    const prev = this.currentToken;
    this.currentToken = this.peekToken;
    const next = this.lexer.next();
    this.peekToken = next ?? this.makeEOF();
    return prev;
  }

  private expect(type: TokenType): Token {
    if (this.currentToken.type !== type) {
      throw this.error(
        `Expected ${type}, got ${this.currentToken.type}: "${this.currentToken.value}"`,
      );
    }
    return this.advance();
  }

  private is(type: TokenType): boolean {
    return this.currentToken.type === type;
  }

  private isAny(...types: TokenType[]): boolean {
    return types.includes(this.currentToken.type);
  }

  private skip(type: TokenType): boolean {
    if (this.is(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private skipNewlines(): void {
    while (this.is(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  private error(message: string): Error {
    const { line, column } = this.currentToken;
    return new Error(`Parse error at ${line}:${column}: ${message}`);
  }

  // ===========================================================================
  // Entry Point
  // ===========================================================================

  public parse(): AST.Program {
    const body: AST.Statement[] = [];

    this.skipNewlines();

    while (!this.is(TokenType.EOF)) {
      if (this.is(TokenType.NEWLINE) || this.is(TokenType.SEMICOLON)) {
        this.advance();
        continue;
      }

      body.push(this.parseStatement());
      this.skipNewlines();
    }

    return {
      type: "Program",
      body,
    };
  }

  // ===========================================================================
  // Statements
  // ===========================================================================

  private parseStatement(): AST.Statement {
    // Control flow statements
    if (this.is(TokenType.IF)) {
      return this.parseIfStatement();
    }
    if (this.is(TokenType.FOR)) {
      return this.parseForStatement();
    }
    if (this.is(TokenType.WHILE)) {
      return this.parseWhileStatement();
    }
    if (this.is(TokenType.UNTIL)) {
      return this.parseUntilStatement();
    }
    if (this.is(TokenType.CASE)) {
      return this.parseCaseStatement();
    }
    if (this.is(TokenType.FUNCTION)) {
      return this.parseFunctionDeclaration();
    }

    // Grouping
    if (this.is(TokenType.LPAREN)) {
      return this.parseSubshell();
    }
    if (this.is(TokenType.LBRACE)) {
      return this.parseBraceGroup();
    }

    // Variable assignment or pipeline
    if (this.is(TokenType.ASSIGNMENT_WORD)) {
      return this.parseVariableAssignment();
    }

    // Default: parse as pipeline
    return this.parsePipeline();
  }

  // ===========================================================================
  // Pipelines and Logical Operators
  // ===========================================================================

  private parsePipeline(): AST.Pipeline {
    let left: AST.Command | AST.Pipeline = this.parseCommand();

    while (
      this.isAny(
        TokenType.PIPE,
        TokenType.PIPE_AMP,
        TokenType.AND_AND,
        TokenType.OR_OR,
        TokenType.AMP,
        TokenType.SEMICOLON,
      )
    ) {
      const operator = this.advance();
      this.skipNewlines();

      const right = this.parseCommand();

      // Determine operator and background flag
      let op: AST.Pipeline["operator"] = null;
      let background = false;

      switch (operator.type) {
        case TokenType.PIPE:
        case TokenType.PIPE_AMP:
          op = "|";
          break;
        case TokenType.AND_AND:
          op = "&&";
          break;
        case TokenType.OR_OR:
          op = "||";
          break;
        case TokenType.SEMICOLON:
          op = ";";
          break;
        case TokenType.AMP:
          op = "&";
          background = true;
          break;
      }

      left = {
        type: "Pipeline",
        commands: [left, right],
        operator: op,
        background,
      };
    }

    // Check for trailing & for background
    if (this.is(TokenType.AMP)) {
      this.advance();
      if (left.type === "Pipeline") {
        left.background = true;
      } else {
        left = {
          type: "Pipeline",
          commands: [left],
          operator: "&",
          background: true,
        };
      }
    }

    // Return as pipeline even if single command for consistency
    if (left.type !== "Pipeline") {
      return {
        type: "Pipeline",
        commands: [left],
        operator: null,
        background: false,
      };
    }

    return left;
  }

  // ===========================================================================
  // Commands
  // ===========================================================================

  private parseCommand(): AST.Command {
    const assignments: AST.VariableAssignment[] = [];
    const redirects: AST.Redirection[] = [];

    // Parse leading assignments (VAR=value)
    while (this.is(TokenType.ASSIGNMENT_WORD)) {
      assignments.push(this.parseVariableAssignment());
    }

    // Parse command name
    if (
      !this.is(TokenType.WORD) &&
      !this.is(TokenType.NAME) &&
      assignments.length === 0
    ) {
      throw this.error("Expected command name");
    }

    let name: AST.Word;
    if (this.is(TokenType.WORD) || this.is(TokenType.NAME)) {
      const token = this.advance();
      name = {
        type: "Word",
        value: token.value,
        quoted: token.quoted || false,
        singleQuoted: token.singleQuoted || false,
        parts: [{ type: "LiteralPart", value: token.value }],
      };
    } else {
      name = { type: "Word", value: "", quoted: false, singleQuoted: false, parts: [] };
    }

    // Parse arguments and redirections
    const args: (AST.Word | AST.ParameterExpansion | AST.CommandSubstitution)[] = [];

    while (
      this.isAny(
        TokenType.WORD,
        TokenType.NAME,
        TokenType.LESS,
        TokenType.GREAT,
        TokenType.DGREAT,
        TokenType.LESSAND,
        TokenType.GREATAND,
        TokenType.LESSGREAT,
        TokenType.CLOBBER,
        TokenType.DLESS,
        TokenType.DLESSDASH,
        TokenType.TLESS,
        TokenType.AND_GREAT,
        TokenType.AND_DGREAT,
        TokenType.NUMBER,
      )
    ) {
      // Check for redirection
      if (this.isRedirectionOperator()) {
        redirects.push(this.parseRedirection());
      } else {
        args.push(this.parseWord());
      }
    }

    return {
      type: "Command",
      name,
      args,
      redirects,
      assignments,
    };
  }

  // ===========================================================================
  // Control Flow
  // ===========================================================================

  private parseIfStatement(): AST.IfStatement {
    this.expect(TokenType.IF);
    this.skipNewlines();

    const test = this.parsePipeline();
    this.skipNewlines();
    this.expect(TokenType.THEN);
    this.skipNewlines();

    const consequent = this.parseStatementList([TokenType.ELIF, TokenType.ELSE, TokenType.FI]);
    this.skipNewlines();

    let alternate: AST.Statement[] | AST.IfStatement | null = null;

    if (this.is(TokenType.ELIF)) {
      alternate = this.parseIfStatement();
    } else if (this.is(TokenType.ELSE)) {
      this.advance();
      this.skipNewlines();
      alternate = this.parseStatementList([TokenType.FI]);
    }

    this.expect(TokenType.FI);

    return {
      type: "IfStatement",
      test,
      consequent,
      alternate,
    };
  }

  private parseForStatement(): AST.ForStatement {
    this.expect(TokenType.FOR);
    const variable = this.expect(TokenType.NAME).value;
    this.skipNewlines();

    let iterable: (AST.Word | AST.ParameterExpansion | AST.CommandSubstitution)[] = [];

    if (this.is(TokenType.IN)) {
      this.advance();
      this.skipNewlines();

      // Parse word list
      while (this.is(TokenType.WORD) || this.is(TokenType.NAME)) {
        iterable.push(this.parseWord());
      }

      this.skipNewlines();
      this.skip(TokenType.SEMICOLON);
    }

    this.skipNewlines();
    this.expect(TokenType.DO);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.DONE]);
    this.expect(TokenType.DONE);

    return {
      type: "ForStatement",
      variable,
      iterable,
      body,
    };
  }

  private parseWhileStatement(): AST.WhileStatement {
    return this.parseLoopStatement(TokenType.WHILE, "WhileStatement");
  }

  private parseUntilStatement(): AST.UntilStatement {
    return this.parseLoopStatement(TokenType.UNTIL, "UntilStatement");
  }

  /**
   * Shared helper for parsing while and until loops
   * Both have the same structure: KEYWORD test DO body DONE
   */
  private parseLoopStatement<T extends "WhileStatement" | "UntilStatement">(
    keyword: TokenType.WHILE | TokenType.UNTIL,
    type: T,
  ): T extends "WhileStatement" ? AST.WhileStatement : AST.UntilStatement {
    this.expect(keyword);
    this.skipNewlines();

    const test = this.parsePipeline();
    this.skipNewlines();
    this.expect(TokenType.DO);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.DONE]);
    this.expect(TokenType.DONE);

    return {
      type,
      test,
      body,
    } as T extends "WhileStatement" ? AST.WhileStatement : AST.UntilStatement;
  }

  private parseCaseStatement(): AST.CaseStatement {
    this.expect(TokenType.CASE);
    const word = this.parseWord();
    this.skipNewlines();
    this.expect(TokenType.IN);
    this.skipNewlines();

    const cases: AST.CaseClause[] = [];

    while (!this.is(TokenType.ESAC)) {
      if (this.is(TokenType.NEWLINE)) {
        this.advance();
        continue;
      }

      const patterns: (AST.Word | AST.ParameterExpansion)[] = [];

      // Parse patterns
      do {
        patterns.push(this.parseWord());
      } while (this.skip(TokenType.PIPE));

      this.expect(TokenType.RPAREN);
      this.skipNewlines();

      // Parse body until ;;
      const body: AST.Statement[] = [];
      while (!this.is(TokenType.DSEMI) && !this.is(TokenType.ESAC)) {
        if (this.is(TokenType.NEWLINE) || this.is(TokenType.SEMICOLON)) {
          this.advance();
          continue;
        }
        body.push(this.parseStatement());
      }

      if (this.is(TokenType.DSEMI)) {
        this.advance();
      }
      this.skipNewlines();

      cases.push({
        type: "CaseClause",
        patterns,
        body,
      });
    }

    this.expect(TokenType.ESAC);

    return {
      type: "CaseStatement",
      word,
      cases,
    };
  }

  private parseFunctionDeclaration(): AST.FunctionDeclaration {
    this.expect(TokenType.FUNCTION);
    const name = this.expect(TokenType.NAME).value;
    this.skipNewlines();

    // Optional ()
    if (this.is(TokenType.LPAREN)) {
      this.advance();
      this.expect(TokenType.RPAREN);
      this.skipNewlines();
    }

    // Parse function body (can be a brace group or subshell)
    let body: AST.Statement[];

    if (this.is(TokenType.LBRACE)) {
      const group = this.parseBraceGroup();
      body = group.body;
    } else if (this.is(TokenType.LPAREN)) {
      const subshell = this.parseSubshell();
      body = subshell.body;
    } else {
      throw this.error("Expected function body");
    }

    return {
      type: "FunctionDeclaration",
      name,
      body,
    };
  }

  // ===========================================================================
  // Grouping
  // ===========================================================================

  private parseSubshell(): AST.Subshell {
    this.expect(TokenType.LPAREN);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.RPAREN]);

    this.expect(TokenType.RPAREN);

    return {
      type: "Subshell",
      body,
    };
  }

  private parseBraceGroup(): AST.BraceGroup {
    this.expect(TokenType.LBRACE);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.RBRACE]);

    this.expect(TokenType.RBRACE);

    return {
      type: "BraceGroup",
      body,
    };
  }

  // ===========================================================================
  // Variables
  // ===========================================================================

  private parseVariableAssignment(): AST.VariableAssignment {
    const token = this.expect(TokenType.ASSIGNMENT_WORD);
    const parts = token.value.split("=");
    const name = parts[0] ?? "";
    const value = parts.slice(1).join("=");

    return {
      type: "VariableAssignment",
      name,
      value: {
        type: "Word",
        value,
        quoted: token.quoted || false,
        singleQuoted: token.singleQuoted || false,
        parts: [{ type: "LiteralPart", value }],
      },
    };
  }

  // ===========================================================================
  // Redirections
  // ===========================================================================

  private isRedirectionOperator(): boolean {
    return this.isAny(
      TokenType.LESS,
      TokenType.GREAT,
      TokenType.DGREAT,
      TokenType.LESSAND,
      TokenType.GREATAND,
      TokenType.LESSGREAT,
      TokenType.CLOBBER,
      TokenType.DLESS,
      TokenType.DLESSDASH,
      TokenType.TLESS,
      TokenType.AND_GREAT,
      TokenType.AND_DGREAT,
      TokenType.NUMBER,
    );
  }

  private parseRedirection(): AST.Redirection {
    let fd: number | undefined;

    // Check for fd number (e.g., "2>")
    if (this.is(TokenType.NUMBER)) {
      fd = parseInt(this.advance().value, 10);
    }

    // Parse operator
    const operatorToken = this.advance();
    let operator: AST.RedirectionOperator;

    switch (operatorToken.type) {
      case TokenType.LESS:
        operator = "<";
        break;
      case TokenType.GREAT:
        operator = ">";
        break;
      case TokenType.DGREAT:
        operator = ">>";
        break;
      case TokenType.LESSAND:
        operator = "<&";
        break;
      case TokenType.GREATAND:
        operator = ">&";
        break;
      case TokenType.LESSGREAT:
        operator = "<>";
        break;
      case TokenType.CLOBBER:
        operator = ">|";
        break;
      case TokenType.DLESS:
        operator = "<<";
        break;
      case TokenType.DLESSDASH:
        operator = "<<-";
        break;
      case TokenType.TLESS:
        operator = "<<<";
        break;
      case TokenType.AND_GREAT:
        operator = "&>";
        break;
      case TokenType.AND_DGREAT:
        operator = "&>>";
        break;
      default:
        throw this.error(`Invalid redirection operator: ${operatorToken.type}`);
    }

    // Parse target (word or fd number)
    let target: AST.Word | number;

    if (this.is(TokenType.NUMBER) && (operator === ">&" || operator === "<&")) {
      target = parseInt(this.advance().value, 10);
    } else {
      target = this.parseWord();
    }

    return {
      type: "Redirection",
      operator,
      fd,
      target,
    };
  }

  // ===========================================================================
  // Words and Expansions
  // ===========================================================================

  private parseWord(): AST.Word {
    const token = this.isAny(TokenType.WORD, TokenType.NAME)
      ? this.advance()
      : this.expect(TokenType.WORD);

    return {
      type: "Word",
      value: token.value,
      quoted: token.quoted || false,
      singleQuoted: token.singleQuoted || false,
      parts: this.parseWordParts(token.value, token.quoted || false),
    };
  }

  private parseWordParts(value: string, quoted: boolean): AST.WordPart[] {
    // Simple implementation: treat as literal for now
    // A full implementation would parse expansions within the word
    return [
      {
        type: "LiteralPart",
        value,
      },
    ];
  }

  // ===========================================================================
  // Statement List Helper
  // ===========================================================================

  private parseStatementList(terminators: TokenType[]): AST.Statement[] {
    const statements: AST.Statement[] = [];

    while (!this.isAny(...terminators) && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.NEWLINE) || this.is(TokenType.SEMICOLON)) {
        this.advance();
        continue;
      }

      statements.push(this.parseStatement());
    }

    return statements;
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

export function parse(input: string): AST.Program {
  const parser = new Parser(input);
  return parser.parse();
}
