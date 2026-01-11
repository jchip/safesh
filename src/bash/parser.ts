/**
 * Bash Parser for SafeShell
 *
 * Recursive descent parser that converts tokens from the lexer into an AST.
 * Handles the complex bash grammar including pipelines, control flow, and expansions.
 */

import { Lexer, Token, TokenType } from "./lexer.ts";
import type * as AST from "./ast.ts";
import { parseArithmetic } from "./arithmetic-parser.ts";

// =============================================================================
// Parser Context (for better error messages)
// =============================================================================

type ParserContext =
  | { type: "if"; startLine: number; startColumn: number }
  | { type: "for"; variable: string; startLine: number; startColumn: number }
  | { type: "while"; startLine: number; startColumn: number }
  | { type: "until"; startLine: number; startColumn: number }
  | { type: "case"; startLine: number; startColumn: number }
  | { type: "function"; name: string; startLine: number; startColumn: number }
  | { type: "subshell"; startLine: number; startColumn: number }
  | { type: "brace_group"; startLine: number; startColumn: number }
  | { type: "command_substitution"; startLine: number; startColumn: number };

// =============================================================================
// Parser Class
// =============================================================================

export class Parser {
  private lexer: Lexer;
  private currentToken: Token;
  private peekToken: Token;
  private contextStack: ParserContext[] = [];
  private diagnostics: AST.ParseDiagnostic[] = [];
  private recoveryMode = false;

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
    const contextInfo = this.getContextInfo();
    const fullMessage = contextInfo
      ? `Parse error at ${line}:${column}: ${message}\n  ${contextInfo}`
      : `Parse error at ${line}:${column}: ${message}`;
    return new Error(fullMessage);
  }

  private getContextInfo(): string | null {
    if (this.contextStack.length === 0) return null;

    const context = this.contextStack[this.contextStack.length - 1]!;
    switch (context.type) {
      case "if":
        return `in 'if' statement started at line ${context.startLine}`;
      case "for":
        return `in 'for' loop (variable: ${context.variable}) started at line ${context.startLine}`;
      case "while":
        return `in 'while' loop started at line ${context.startLine}`;
      case "until":
        return `in 'until' loop started at line ${context.startLine}`;
      case "case":
        return `in 'case' statement started at line ${context.startLine}`;
      case "function":
        return `in function '${context.name}' started at line ${context.startLine}`;
      case "subshell":
        return `in subshell started at line ${context.startLine}`;
      case "brace_group":
        return `in brace group started at line ${context.startLine}`;
      case "command_substitution":
        return `in command substitution started at line ${context.startLine}`;
    }
  }

  private pushContext(context: ParserContext): void {
    this.contextStack.push(context);
  }

  private popContext(): void {
    this.contextStack.pop();
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

  /**
   * Parse with error recovery - returns AST and diagnostics
   * Continues parsing after errors to collect multiple issues
   */
  public parseWithRecovery(): AST.ParseResult {
    this.recoveryMode = true;
    this.diagnostics = [];
    const body: AST.Statement[] = [];

    this.skipNewlines();

    while (!this.is(TokenType.EOF)) {
      if (this.is(TokenType.NEWLINE) || this.is(TokenType.SEMICOLON)) {
        this.advance();
        continue;
      }

      try {
        body.push(this.parseStatement());
      } catch (e) {
        // Record the error and try to recover
        if (e instanceof Error) {
          this.addDiagnostic("error", e.message);
        }
        this.recover();
      }
      this.skipNewlines();
    }

    return {
      ast: { type: "Program", body },
      diagnostics: this.diagnostics,
    };
  }

  /**
   * Add a diagnostic without throwing
   */
  private addDiagnostic(
    severity: AST.DiagnosticSeverity,
    message: string,
    code?: string
  ): void {
    this.diagnostics.push({
      severity,
      message,
      line: this.currentToken.line,
      column: this.currentToken.column,
      code,
      context: this.getContextInfo() ?? undefined,
    });
  }

  /**
   * Recover from an error by skipping to a synchronization point
   */
  private recover(): void {
    // Skip until we find a statement boundary
    const syncTokens = [
      TokenType.NEWLINE,
      TokenType.SEMICOLON,
      TokenType.EOF,
      TokenType.FI,
      TokenType.DONE,
      TokenType.ESAC,
      TokenType.RBRACE,
      TokenType.RPAREN,
    ];

    while (!this.isAny(...syncTokens)) {
      this.advance();
    }

    // Also pop any open contexts
    while (this.contextStack.length > 0) {
      this.popContext();
    }
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

    // Test expression [[ ... ]]
    if (this.is(TokenType.DBRACK_START)) {
      return this.parseTestCommand();
    }

    // Arithmetic command (( ... ))
    if (this.is(TokenType.DPAREN_START)) {
      return this.parseArithmeticCommand();
    }

    // Grouping
    if (this.is(TokenType.LPAREN)) {
      return this.parseSubshell();
    }
    if (this.is(TokenType.LBRACE)) {
      return this.parseBraceGroup();
    }

    // Default: parse as pipeline (handles assignments as part of commands)
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
        TokenType.NUMBER,
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
        TokenType.LESS_LPAREN,
        TokenType.GREAT_LPAREN,
      )
    ) {
      // Check for process substitution
      if (this.isAny(TokenType.LESS_LPAREN, TokenType.GREAT_LPAREN)) {
        args.push(this.parseProcessSubstitutionWord());
      } else if (this.isRedirectionOperator()) {
        // Check for redirection (including {var}>file pattern)
        redirects.push(this.parseRedirection());
      } else if (this.isFdVarRedirection()) {
        // Check for {var}>file FD variable redirection
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
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;
    this.pushContext({ type: "if", startLine, startColumn });

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
      this.popContext(); // Pop before recursing for elif
      alternate = this.parseIfStatement();
    } else if (this.is(TokenType.ELSE)) {
      this.advance();
      this.skipNewlines();
      alternate = this.parseStatementList([TokenType.FI]);
      this.expect(TokenType.FI);
      this.popContext();
    } else {
      this.expect(TokenType.FI);
      this.popContext();
    }

    return {
      type: "IfStatement",
      test,
      consequent,
      alternate,
    };
  }

  private parseForStatement(): AST.ForStatement | AST.CStyleForStatement {
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;

    this.expect(TokenType.FOR);
    this.skipNewlines();

    // Check for C-style for loop: for (( init; test; update ))
    if (this.is(TokenType.DPAREN_START)) {
      return this.parseCStyleForStatement(startLine, startColumn);
    }

    const variable = this.expect(TokenType.NAME).value;

    this.pushContext({ type: "for", variable, startLine, startColumn });
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
    this.popContext();

    return {
      type: "ForStatement",
      variable,
      iterable,
      body,
    };
  }

  /**
   * Parse C-style for loop: for (( init; test; update )); do body; done
   */
  private parseCStyleForStatement(
    startLine: number,
    startColumn: number
  ): AST.CStyleForStatement {
    this.pushContext({ type: "for", variable: "(C-style)", startLine, startColumn });

    this.expect(TokenType.DPAREN_START);

    // Collect content until ))
    // Only track DPAREN_START/END for depth, not regular parens
    let content = "";
    let depth = 1;
    while (depth > 0 && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.DPAREN_START)) {
        depth++;
        content += "((";
        this.advance();
      } else if (this.is(TokenType.DPAREN_END)) {
        depth--;
        if (depth > 0) {
          content += "))";
        }
        this.advance();
      } else {
        // Include regular parens as part of content
        content += this.currentToken.value;
        this.advance();
      }
    }

    // Parse the three parts: init; test; update
    const parts = this.splitCStyleForParts(content);
    const init = parts[0]?.trim() ? parseArithmetic(parts[0].trim()) : null;
    const test = parts[1]?.trim() ? parseArithmetic(parts[1].trim()) : null;
    const update = parts[2]?.trim() ? parseArithmetic(parts[2].trim()) : null;

    this.skipNewlines();
    this.skip(TokenType.SEMICOLON);
    this.skipNewlines();
    this.expect(TokenType.DO);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.DONE]);
    this.expect(TokenType.DONE);
    this.popContext();

    return {
      type: "CStyleForStatement",
      init,
      test,
      update,
      body,
    };
  }

  /**
   * Split C-style for parts on semicolons, respecting nested parens
   */
  private splitCStyleForParts(content: string): string[] {
    const parts: string[] = [];
    let current = "";
    let depth = 0;

    for (const char of content) {
      if (char === "(" || char === "[") {
        depth++;
        current += char;
      } else if (char === ")" || char === "]") {
        depth--;
        current += char;
      } else if (char === ";" && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    parts.push(current);

    return parts;
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
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;
    const contextType = keyword === TokenType.WHILE ? "while" : "until";
    this.pushContext({ type: contextType, startLine, startColumn });

    this.expect(keyword);
    this.skipNewlines();

    const test = this.parsePipeline();
    this.skipNewlines();
    this.expect(TokenType.DO);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.DONE]);
    this.expect(TokenType.DONE);
    this.popContext();

    return {
      type,
      test,
      body,
    } as T extends "WhileStatement" ? AST.WhileStatement : AST.UntilStatement;
  }

  private parseCaseStatement(): AST.CaseStatement {
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;
    this.pushContext({ type: "case", startLine, startColumn });

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
    this.popContext();

    return {
      type: "CaseStatement",
      word,
      cases,
    };
  }

  private parseFunctionDeclaration(): AST.FunctionDeclaration {
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;

    this.expect(TokenType.FUNCTION);
    const name = this.expect(TokenType.NAME).value;

    this.pushContext({ type: "function", name, startLine, startColumn });
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

    this.popContext();

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
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;
    this.pushContext({ type: "subshell", startLine, startColumn });

    this.expect(TokenType.LPAREN);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.RPAREN]);

    this.expect(TokenType.RPAREN);
    this.popContext();

    return {
      type: "Subshell",
      body,
    };
  }

  private parseBraceGroup(): AST.BraceGroup {
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;
    this.pushContext({ type: "brace_group", startLine, startColumn });

    this.expect(TokenType.LBRACE);
    this.skipNewlines();

    const body = this.parseStatementList([TokenType.RBRACE]);

    this.expect(TokenType.RBRACE);
    this.popContext();

    return {
      type: "BraceGroup",
      body,
    };
  }

  // ===========================================================================
  // Test Command [[ ... ]]
  // ===========================================================================

  /**
   * Parse [[ expression ]] test command
   */
  private parseTestCommand(): AST.TestCommand {
    this.expect(TokenType.DBRACK_START);
    this.skipNewlines();

    const expression = this.parseTestExpression();

    this.skipNewlines();
    this.expect(TokenType.DBRACK_END);

    return {
      type: "TestCommand",
      expression,
    };
  }

  /**
   * Parse test expression with logical operators
   * Handles: || (lowest), && (higher), ! (prefix), comparisons (highest)
   */
  private parseTestExpression(): AST.TestCondition {
    return this.parseTestOr();
  }

  private parseTestOr(): AST.TestCondition {
    let left = this.parseTestAnd();

    while (this.is(TokenType.OR_OR)) {
      this.advance();
      this.skipNewlines();
      const right = this.parseTestAnd();
      left = {
        type: "LogicalTest",
        operator: "||",
        left,
        right,
      };
    }

    return left;
  }

  private parseTestAnd(): AST.TestCondition {
    let left = this.parseTestUnary();

    while (this.is(TokenType.AND_AND)) {
      this.advance();
      this.skipNewlines();
      const right = this.parseTestUnary();
      left = {
        type: "LogicalTest",
        operator: "&&",
        left,
        right,
      };
    }

    return left;
  }

  private parseTestUnary(): AST.TestCondition {
    // Handle ! negation
    if (this.is(TokenType.BANG)) {
      this.advance();
      this.skipNewlines();
      const operand = this.parseTestUnary();
      return {
        type: "LogicalTest",
        operator: "!",
        right: operand,
      };
    }

    // Handle parenthesized expressions
    if (this.is(TokenType.LPAREN)) {
      this.advance();
      this.skipNewlines();
      const expr = this.parseTestExpression();
      this.skipNewlines();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    return this.parseTestPrimary();
  }

  private parseTestPrimary(): AST.TestCondition {
    // Check for unary file/string test operators
    const unaryOps: AST.UnaryTestOperator[] = [
      "-e", "-f", "-d", "-L", "-h", "-b", "-c", "-p", "-S", "-t",
      "-r", "-w", "-x", "-s", "-g", "-u", "-k", "-O", "-G", "-N",
      "-z", "-n",
    ];

    if (this.is(TokenType.WORD) || this.is(TokenType.NAME)) {
      const value = this.currentToken.value;
      if (unaryOps.includes(value as AST.UnaryTestOperator)) {
        this.advance();
        this.skipNewlines();
        const argument = this.parseTestWord();
        return {
          type: "UnaryTest",
          operator: value as AST.UnaryTestOperator,
          argument,
        };
      }
    }

    // Parse left operand
    const left = this.parseTestWord();
    this.skipNewlines();

    // Check for binary operators
    if (this.is(TokenType.DBRACK_END) || this.is(TokenType.AND_AND) ||
        this.is(TokenType.OR_OR) || this.is(TokenType.RPAREN)) {
      // Just a string test (non-empty check)
      return {
        type: "StringTest",
        value: left,
      };
    }

    // Binary operators
    const binaryOps: Record<string, AST.BinaryTestOperator> = {
      "=": "=",
      "==": "==",
      "!=": "!=",
      "<": "<",
      ">": ">",
      "-eq": "-eq",
      "-ne": "-ne",
      "-lt": "-lt",
      "-le": "-le",
      "-gt": "-gt",
      "-ge": "-ge",
      "-nt": "-nt",
      "-ot": "-ot",
      "-ef": "-ef",
      "=~": "=~",
    };

    const opToken = this.currentToken;
    const op = binaryOps[opToken.value];
    if (op) {
      this.advance();
      this.skipNewlines();
      const right = this.parseTestWord();
      return {
        type: "BinaryTest",
        operator: op,
        left,
        right,
      };
    }

    // Fallback to string test
    return {
      type: "StringTest",
      value: left,
    };
  }

  private parseTestWord(): AST.Word | AST.ParameterExpansion {
    if (this.isAny(TokenType.WORD, TokenType.NAME, TokenType.NUMBER)) {
      return this.parseWord();
    }
    throw this.error("Expected word in test expression");
  }

  // ===========================================================================
  // Arithmetic Command (( ... ))
  // ===========================================================================

  /**
   * Parse (( expression )) arithmetic command
   */
  private parseArithmeticCommand(): AST.ArithmeticCommand {
    this.expect(TokenType.DPAREN_START);

    // Collect all tokens until ))
    // Only track DPAREN_START/END for depth, not regular parens
    let content = "";
    let depth = 1;

    while (depth > 0 && !this.is(TokenType.EOF)) {
      if (this.is(TokenType.DPAREN_START)) {
        depth++;
        content += "((";
        this.advance();
      } else if (this.is(TokenType.DPAREN_END)) {
        depth--;
        if (depth > 0) {
          content += "))";
        }
        this.advance();
      } else {
        content += this.currentToken.value;
        if (this.is(TokenType.NEWLINE)) {
          content += " ";
        }
        this.advance();
      }
    }

    const expression = parseArithmetic(content.trim());

    return {
      type: "ArithmeticCommand",
      expression,
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
    // Direct redirection operators
    if (this.isAny(
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
    )) {
      return true;
    }

    // Number followed by redirection operator (e.g., 2> or 10>&)
    if (this.is(TokenType.NUMBER)) {
      return this.isNextTokenRedirect();
    }

    return false;
  }

  /**
   * Check if the peek token is a redirection operator
   */
  private isNextTokenRedirect(): boolean {
    return [
      TokenType.LESS,
      TokenType.GREAT,
      TokenType.DGREAT,
      TokenType.LESSAND,
      TokenType.GREATAND,
      TokenType.LESSGREAT,
      TokenType.CLOBBER,
    ].includes(this.peekToken.type);
  }

  /**
   * Check if current token is a {var} pattern followed by a redirection operator
   * This supports Bash 4.1+ FD variable syntax: {fd}>file
   */
  private isFdVarRedirection(): boolean {
    if (!this.isAny(TokenType.WORD, TokenType.NAME)) {
      return false;
    }

    const value = this.currentToken.value;
    // Check for {identifier} pattern
    if (!/^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(value)) {
      return false;
    }

    // Check if next token is a redirection operator
    const nextType = this.peekToken.type;
    return [
      TokenType.LESS,
      TokenType.GREAT,
      TokenType.DGREAT,
      TokenType.LESSAND,
      TokenType.GREATAND,
      TokenType.LESSGREAT,
      TokenType.CLOBBER,
    ].includes(nextType);
  }

  private parseRedirection(): AST.Redirection {
    let fd: number | undefined;
    let fdVar: string | undefined;

    // Check for fd number (e.g., "2>")
    if (this.is(TokenType.NUMBER)) {
      fd = parseInt(this.advance().value, 10);
    }
    // Check for fd variable (e.g., "{fd}>") - Bash 4.1+ syntax
    else if (this.is(TokenType.WORD) || this.is(TokenType.NAME)) {
      const value = this.currentToken.value;
      const fdVarMatch = value.match(/^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/);
      if (fdVarMatch) {
        // Check if NEXT token is a redirection operator
        const nextIsRedirect = [
          TokenType.LESS, TokenType.GREAT, TokenType.DGREAT,
          TokenType.LESSAND, TokenType.GREATAND, TokenType.LESSGREAT,
          TokenType.CLOBBER,
        ].includes(this.peekToken.type);

        if (nextIsRedirect) {
          // This is a {var} prefix for FD variable allocation
          fdVar = fdVarMatch[1];
          this.advance();
        }
      }
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
    } else if (this.is(TokenType.WORD) && this.currentToken.value === "-" &&
               (operator === ">&" || operator === "<&")) {
      // Handle close FD syntax: >&- or <&-
      target = this.parseWord();
    } else {
      target = this.parseWord();
    }

    const result: AST.Redirection = {
      type: "Redirection",
      operator,
      target,
    };

    if (fd !== undefined) {
      result.fd = fd;
    }
    if (fdVar !== undefined) {
      result.fdVar = fdVar;
    }

    return result;
  }

  // ===========================================================================
  // Words and Expansions
  // ===========================================================================

  private parseWord(): AST.Word {
    const token = this.isAny(TokenType.WORD, TokenType.NAME, TokenType.NUMBER)
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

  /**
   * Parse a process substitution <(...) or >(...)
   * Returns a Word containing a ProcessSubstitution part
   */
  private parseProcessSubstitutionWord(): AST.Word {
    const startLine = this.currentToken.line;
    const startColumn = this.currentToken.column;
    const isInput = this.is(TokenType.LESS_LPAREN);
    const operator: "<(" | ">(" = isInput ? "<(" : ">(";

    this.pushContext({ type: "command_substitution", startLine, startColumn });
    this.advance(); // consume <( or >(
    this.skipNewlines();

    // Parse the commands inside
    const body = this.parseStatementList([TokenType.RPAREN]);

    this.expect(TokenType.RPAREN);
    this.popContext();

    const processSubstitution: AST.ProcessSubstitution = {
      type: "ProcessSubstitution",
      operator,
      command: body,
    };

    return {
      type: "Word",
      value: `${operator}...)`, // Placeholder value
      quoted: false,
      singleQuoted: false,
      parts: [processSubstitution],
    };
  }

  private parseWordParts(value: string, quoted: boolean): AST.WordPart[] {
    const parts: AST.WordPart[] = [];
    let pos = 0;
    let literal = "";

    const flushLiteral = () => {
      if (literal) {
        parts.push({ type: "LiteralPart", value: literal });
        literal = "";
      }
    };

    while (pos < value.length) {
      const char = value[pos];

      if (char === "$") {
        const next = value[pos + 1];

        // $((arithmetic))
        if (next === "(" && value[pos + 2] === "(") {
          flushLiteral();
          // startPos should be position of first '(' (pos + 1)
          const result = this.extractBalancedDouble(value, pos + 1, "(", ")");
          parts.push(this.parseArithmeticContent(result.content));
          pos = result.end + 1;
          continue;
        }

        // $(command)
        if (next === "(") {
          flushLiteral();
          const result = this.extractBalanced(value, pos + 1, "(", ")");
          parts.push(this.parseCommandSubstitutionContent(result.content, false));
          pos = result.end + 1;
          continue;
        }

        // ${parameter}
        if (next === "{") {
          flushLiteral();
          const result = this.extractBalanced(value, pos + 1, "{", "}");
          parts.push(this.parseParameterExpansionContent(result.content));
          pos = result.end + 1;
          continue;
        }

        // Special variables: $#, $?, $$, $!, $@, $*, $-, $0-$9
        if (next && /^[#?$!@*\-0-9]$/.test(next)) {
          flushLiteral();
          parts.push({
            type: "ParameterExpansion",
            parameter: next,
          });
          pos += 2;
          continue;
        }

        // Simple $VAR
        const varMatch = value.slice(pos + 1).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
        if (varMatch) {
          flushLiteral();
          parts.push({
            type: "ParameterExpansion",
            parameter: varMatch[0],
          });
          pos += 1 + varMatch[0].length;
          continue;
        }

        // Just a literal $
        literal += char;
        pos++;
        continue;
      }

      // Backtick command substitution (only outside double quotes or when explicitly in double quotes)
      if (char === "`") {
        flushLiteral();
        const endIdx = this.findMatchingBacktick(value, pos + 1);
        const content = value.slice(pos + 1, endIdx);
        parts.push(this.parseCommandSubstitutionContent(content, true));
        pos = endIdx + 1;
        continue;
      }

      // Process substitution <() or >() is handled at the token level
      // by LESS_LPAREN and GREAT_LPAREN tokens

      literal += char;
      pos++;
    }

    flushLiteral();

    return parts.length > 0 ? parts : [{ type: "LiteralPart", value }];
  }

  // ===========================================================================
  // Expansion Parsing Helpers
  // ===========================================================================

  /**
   * Extract content between balanced delimiters (e.g., { and })
   */
  private extractBalanced(
    value: string,
    startPos: number,
    open: string,
    close: string
  ): { content: string; end: number } {
    let depth = 1;
    let pos = startPos + 1; // Skip opening delimiter
    let inSingleQuote = false;
    let inDoubleQuote = false;

    while (pos < value.length && depth > 0) {
      const char = value[pos];

      // Handle quotes
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (!inSingleQuote && !inDoubleQuote) {
        // Handle escapes
        if (char === "\\" && pos + 1 < value.length) {
          pos += 2;
          continue;
        }
        if (char === open) depth++;
        else if (char === close) depth--;
      }
      pos++;
    }

    const content = value.slice(startPos + 1, pos - 1);
    return { content, end: pos - 1 };
  }

  /**
   * Extract content between double balanced delimiters (e.g., (( and )))
   * For $((expr)), startPos points to the first '(' after '$'
   */
  private extractBalancedDouble(
    value: string,
    startPos: number,
    open: string,
    close: string
  ): { content: string; end: number } {
    let depth = 2; // Start with depth 2 for ((
    let pos = startPos + 2; // Skip opening ((
    let inSingleQuote = false;
    let inDoubleQuote = false;

    while (pos < value.length && depth > 0) {
      const char = value[pos];

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (!inSingleQuote && !inDoubleQuote) {
        if (char === "\\" && pos + 1 < value.length) {
          pos += 2;
          continue;
        }
        if (char === open) depth++;
        else if (char === close) depth--;
      }
      pos++;
    }

    // Content starts after '((' (startPos + 2) and ends before '))' (pos - 2)
    // But startPos points to first '(', so content starts at startPos + 2
    const contentStart = startPos + 2;
    const contentEnd = pos - 2;
    const content = value.slice(contentStart, contentEnd);
    return { content, end: pos - 1 };
  }

  /**
   * Find matching backtick, handling escapes
   */
  private findMatchingBacktick(value: string, startPos: number): number {
    let pos = startPos;
    while (pos < value.length) {
      if (value[pos] === "\\") {
        pos += 2; // Skip escaped char
        continue;
      }
      if (value[pos] === "`") {
        return pos;
      }
      pos++;
    }
    return value.length; // No match found, return end
  }

  /**
   * Parse ${...} parameter expansion content
   * Uses proper tokenized parsing instead of regex for robustness with nested expansions
   */
  private parseParameterExpansionContent(content: string): AST.ParameterExpansion {
    let pos = 0;

    // Handle ${!var} indirect expansion or ${!prefix*} prefix matching
    const isIndirect = content[0] === "!";
    if (isIndirect) {
      pos = 1;
    }

    // Handle ${#var} - length
    if (content[0] === "#" && !isIndirect) {
      const param = content.slice(1);
      // Check if it's ${#} (number of positional params) vs ${#var} (length of var)
      if (param === "" || param === "@" || param === "*") {
        return {
          type: "ParameterExpansion",
          parameter: "#" + param,
        };
      }
      return {
        type: "ParameterExpansion",
        parameter: param,
        modifier: "length",
      };
    }

    // Extract parameter name (supports arrays like var[@] or var[0])
    let paramName = "";
    const startPos = pos;

    // Handle special single-char parameters: $, ?, !, @, *, -, 0-9
    if (/^[?$!@*\-0-9]$/.test(content[pos] ?? "")) {
      paramName = content[pos]!;
      pos++;
    } else {
      // Regular identifier
      while (pos < content.length && /[a-zA-Z0-9_]/.test(content[pos]!)) {
        paramName += content[pos]!;
        pos++;
      }

      // Handle array subscript: var[subscript]
      if (content[pos] === "[") {
        const subscriptStart = pos;
        let depth = 1;
        pos++;
        while (pos < content.length && depth > 0) {
          if (content[pos] === "[") depth++;
          else if (content[pos] === "]") depth--;
          pos++;
        }
        paramName += content.slice(subscriptStart, pos);
      }
    }

    if (isIndirect) {
      paramName = "!" + paramName;
    }

    // If we've consumed all content, it's a simple expansion
    if (pos >= content.length) {
      return {
        type: "ParameterExpansion",
        parameter: paramName,
      };
    }

    // Parse modifier
    const remaining = content.slice(pos);
    const modifierArg = (arg: string): AST.Word => ({
      type: "Word",
      value: arg,
      quoted: false,
      singleQuoted: false,
      parts: this.parseWordParts(arg, false),
    });

    // Two-character modifiers (check first)
    const twoCharModifiers: Array<[string, AST.ParameterModifier]> = [
      [":-", ":-"], [":=", ":="], [":?", ":?"], [":+", ":+"],
      ["##", "##"], ["%%", "%%"], ["^^", "^^"], [",,", ",,"],
      ["//", "//"], ["/#", "/#"], ["/%", "/%"],
    ];

    for (const [pattern, modifier] of twoCharModifiers) {
      if (remaining.startsWith(pattern)) {
        const arg = remaining.slice(pattern.length);
        const result: AST.ParameterExpansion = {
          type: "ParameterExpansion",
          parameter: paramName,
          modifier,
        };
        if (arg) {
          result.modifierArg = modifierArg(arg);
        }
        return result;
      }
    }

    // Single-character modifiers
    const singleCharModifiers: Record<string, AST.ParameterModifier> = {
      "-": "-", "=": "=", "?": "?", "+": "+",
      "#": "#", "%": "%", "^": "^", ",": ",",
      "/": "/", "@": "@",
    };

    const firstChar = remaining[0] ?? "";
    if (singleCharModifiers[firstChar]) {
      const modifier = singleCharModifiers[firstChar]!;
      const arg = remaining.slice(1);
      const result: AST.ParameterExpansion = {
        type: "ParameterExpansion",
        parameter: paramName,
        modifier,
      };
      if (arg) {
        result.modifierArg = modifierArg(arg);
      }
      return result;
    }

    // Fallback: treat entire content as parameter name
    return {
      type: "ParameterExpansion",
      parameter: content,
    };
  }

  /**
   * Parse $(...) or `...` command substitution content
   */
  private parseCommandSubstitutionContent(
    content: string,
    backtick: boolean
  ): AST.CommandSubstitution {
    // Recursively parse the inner commands
    const innerParser = new Parser(content);
    const innerProgram = innerParser.parse();

    return {
      type: "CommandSubstitution",
      command: innerProgram.body,
      backtick,
    };
  }

  /**
   * Parse $((expr)) arithmetic content
   */
  private parseArithmeticContent(content: string): AST.ArithmeticExpansion {
    return {
      type: "ArithmeticExpansion",
      expression: parseArithmetic(content.trim()),
    };
  }

  /**
   * Parse <() or >() process substitution content
   */
  private parseProcessSubstitutionContent(
    operator: "<(" | ">(",
    content: string
  ): AST.ProcessSubstitution {
    const innerParser = new Parser(content);
    const innerProgram = innerParser.parse();

    return {
      type: "ProcessSubstitution",
      operator,
      command: innerProgram.body,
    };
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
// Convenience Functions
// =============================================================================

export function parse(input: string): AST.Program {
  const parser = new Parser(input);
  return parser.parse();
}

/**
 * Parse with error recovery - returns AST and diagnostics
 * Continues parsing after errors to collect multiple issues
 */
export function parseWithRecovery(input: string): AST.ParseResult {
  const parser = new Parser(input);
  return parser.parseWithRecovery();
}
