/**
 * Bash Lexer for SafeShell
 *
 * A comprehensive tokenizer for bash scripts, adapted from just-bash for Deno.
 *
 * Handles:
 * - Operators and delimiters (|, ||, &&, ;, &, etc.)
 * - Redirections (<, >, >>, <<, 2>, &>, etc.)
 * - Words with quoting rules (single, double, $'...')
 * - Comments (# to end of line)
 * - Here-documents (<< and <<-)
 * - Escape sequences
 * - Variables ($VAR, ${VAR}, ${VAR:-default}, etc.)
 * - Command substitution ($(cmd), `cmd`)
 * - Reserved words (if, then, else, fi, for, while, do, done, case, esac, in, function)
 */

// =============================================================================
// Token Types
// =============================================================================

export enum TokenType {
  // End of input
  EOF = "EOF",

  // Newlines and separators
  NEWLINE = "NEWLINE",
  SEMICOLON = "SEMICOLON",
  AMP = "AMP", // &

  // Operators
  PIPE = "PIPE", // |
  PIPE_AMP = "PIPE_AMP", // |&
  AND_AND = "AND_AND", // &&
  OR_OR = "OR_OR", // ||
  BANG = "BANG", // !

  // Redirections
  LESS = "LESS", // <
  GREAT = "GREAT", // >
  DLESS = "DLESS", // <<
  DGREAT = "DGREAT", // >>
  LESSAND = "LESSAND", // <&
  GREATAND = "GREATAND", // >&
  LESSGREAT = "LESSGREAT", // <>
  DLESSDASH = "DLESSDASH", // <<-
  CLOBBER = "CLOBBER", // >|
  TLESS = "TLESS", // <<<
  AND_GREAT = "AND_GREAT", // &>
  AND_DGREAT = "AND_DGREAT", // &>>

  // Process substitution
  LESS_LPAREN = "LESS_LPAREN", // <(
  GREAT_LPAREN = "GREAT_LPAREN", // >(

  // Grouping
  LPAREN = "LPAREN", // (
  RPAREN = "RPAREN", // )
  LBRACE = "LBRACE", // {
  RBRACE = "RBRACE", // }

  // Special
  DSEMI = "DSEMI", // ;;
  SEMI_AND = "SEMI_AND", // ;&
  SEMI_SEMI_AND = "SEMI_SEMI_AND", // ;;&

  // Compound commands
  DBRACK_START = "DBRACK_START", // [[
  DBRACK_END = "DBRACK_END", // ]]
  DPAREN_START = "DPAREN_START", // ((
  DPAREN_END = "DPAREN_END", // ))

  // Reserved words
  IF = "IF",
  THEN = "THEN",
  ELSE = "ELSE",
  ELIF = "ELIF",
  FI = "FI",
  FOR = "FOR",
  WHILE = "WHILE",
  UNTIL = "UNTIL",
  DO = "DO",
  DONE = "DONE",
  CASE = "CASE",
  ESAC = "ESAC",
  IN = "IN",
  FUNCTION = "FUNCTION",
  SELECT = "SELECT",
  TIME = "TIME",
  COPROC = "COPROC",

  // Words and identifiers
  WORD = "WORD",
  NAME = "NAME", // Valid variable name
  NUMBER = "NUMBER", // For redirections like 2>&1
  ASSIGNMENT_WORD = "ASSIGNMENT_WORD", // VAR=value

  // Comments
  COMMENT = "COMMENT",

  // Here-document content
  HEREDOC_CONTENT = "HEREDOC_CONTENT",
}

// =============================================================================
// Token Interface
// =============================================================================

export interface Token {
  type: TokenType;
  value: string;
  /** Original position in input */
  start: number;
  end: number;
  line: number;
  column: number;
  /** For WORD tokens: quote information */
  quoted?: boolean;
  singleQuoted?: boolean;
}

// =============================================================================
// Position Interface (for streaming API)
// =============================================================================

export interface Position {
  offset: number;
  line: number;
  column: number;
}

// =============================================================================
// Reserved Words
// =============================================================================

const RESERVED_WORDS: Record<string, TokenType> = {
  if: TokenType.IF,
  then: TokenType.THEN,
  else: TokenType.ELSE,
  elif: TokenType.ELIF,
  fi: TokenType.FI,
  for: TokenType.FOR,
  while: TokenType.WHILE,
  until: TokenType.UNTIL,
  do: TokenType.DO,
  done: TokenType.DONE,
  case: TokenType.CASE,
  esac: TokenType.ESAC,
  in: TokenType.IN,
  function: TokenType.FUNCTION,
  select: TokenType.SELECT,
  time: TokenType.TIME,
  coproc: TokenType.COPROC,
};

// =============================================================================
// Operator Tables
// =============================================================================

/**
 * Three-character operators
 */
const THREE_CHAR_OPS: Array<[string, string, string, TokenType]> = [
  [";", ";", "&", TokenType.SEMI_SEMI_AND],
  ["<", "<", "<", TokenType.TLESS],
  ["&", ">", ">", TokenType.AND_DGREAT],
];

/**
 * Two-character operators
 */
const TWO_CHAR_OPS: Array<[string, string, TokenType]> = [
  ["[", "[", TokenType.DBRACK_START],
  ["]", "]", TokenType.DBRACK_END],
  ["(", "(", TokenType.DPAREN_START],
  [")", ")", TokenType.DPAREN_END],
  ["&", "&", TokenType.AND_AND],
  ["|", "|", TokenType.OR_OR],
  [";", ";", TokenType.DSEMI],
  [";", "&", TokenType.SEMI_AND],
  ["|", "&", TokenType.PIPE_AMP],
  [">", ">", TokenType.DGREAT],
  ["<", "&", TokenType.LESSAND],
  [">", "&", TokenType.GREATAND],
  ["<", ">", TokenType.LESSGREAT],
  [">", "|", TokenType.CLOBBER],
  ["&", ">", TokenType.AND_GREAT],
  ["<", "(", TokenType.LESS_LPAREN],
  [">", "(", TokenType.GREAT_LPAREN],
];

/**
 * Single-character operators
 */
const SINGLE_CHAR_OPS: Record<string, TokenType> = {
  "|": TokenType.PIPE,
  "&": TokenType.AMP,
  ";": TokenType.SEMICOLON,
  "(": TokenType.LPAREN,
  ")": TokenType.RPAREN,
  "<": TokenType.LESS,
  ">": TokenType.GREAT,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a string is a valid variable name
 */
function isValidName(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

/**
 * Check if a string is a valid assignment LHS with optional nested array subscript
 * Handles: VAR, a[0], a[x], a[a[0]], a[x+1], etc.
 */
function isValidAssignmentLHS(str: string): boolean {
  const match = str.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
  if (!match) return false;

  const afterName = str.slice(match[0].length);
  if (afterName === "" || afterName === "+") return true;

  if (afterName[0] === "[") {
    let depth = 0;
    let i = 0;
    for (; i < afterName.length; i++) {
      if (afterName[i] === "[") depth++;
      else if (afterName[i] === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0 || i >= afterName.length) return false;
    const afterBracket = afterName.slice(i + 1);
    return afterBracket === "" || afterBracket === "+";
  }

  return false;
}

// =============================================================================
// Lexer Class
// =============================================================================

export class Lexer {
  private input: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];
  private pendingHeredocs: {
    delimiter: string;
    stripTabs: boolean;
    quoted: boolean;
  }[] = [];

  constructor(input: string) {
    this.input = input;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Tokenize the entire input and return all tokens
   */
  tokenize(): Token[] {
    const input = this.input;
    const len = input.length;
    const tokens = this.tokens;
    const pendingHeredocs = this.pendingHeredocs;

    while (this.pos < len) {
      this.skipWhitespace();

      if (this.pos >= len) break;

      // Check for pending here-documents after newline
      if (
        pendingHeredocs.length > 0 &&
        tokens.length > 0 &&
        tokens[tokens.length - 1]!.type === TokenType.NEWLINE
      ) {
        this.readHeredocContent();
        continue;
      }

      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    // Add EOF token
    tokens.push({
      type: TokenType.EOF,
      value: "",
      start: this.pos,
      end: this.pos,
      line: this.line,
      column: this.column,
    });

    return tokens;
  }

  /**
   * Get the next token (streaming API)
   */
  next(): Token | null {
    if (this.tokens.length > 0) {
      return this.tokens.shift() ?? null;
    }

    const input = this.input;
    const len = input.length;

    this.skipWhitespace();

    if (this.pos >= len) {
      return {
        type: TokenType.EOF,
        value: "",
        start: this.pos,
        end: this.pos,
        line: this.line,
        column: this.column,
      };
    }

    if (this.pendingHeredocs.length > 0) {
      const prevChar = this.pos > 0 ? input[this.pos - 1] : "";
      if (prevChar === "\n") {
        this.readHeredocContent();
        if (this.tokens.length > 0) {
          return this.tokens.shift() ?? null;
        }
      }
    }

    return this.nextToken();
  }

  /**
   * Peek at the current character without advancing
   */
  peek(): string {
    return this.input[this.pos] ?? "";
  }

  /**
   * Peek at a character at offset from current position
   */
  peekAt(offset: number): string {
    return this.input[this.pos + offset] ?? "";
  }

  /**
   * Advance position by one character and return it
   */
  advance(): string {
    const char = this.input[this.pos] ?? "";
    this.pos++;
    if (char === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  /**
   * Check if current position matches a string, and advance if so
   */
  match(str: string): boolean {
    if (this.input.slice(this.pos, this.pos + str.length) === str) {
      for (let i = 0; i < str.length; i++) {
        this.advance();
      }
      return true;
    }
    return false;
  }

  /**
   * Get current position info
   */
  getPosition(): Position {
    return {
      offset: this.pos,
      line: this.line,
      column: this.column,
    };
  }

  /**
   * Check if we've reached end of input
   */
  isAtEnd(): boolean {
    return this.pos >= this.input.length;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private skipWhitespace(): void {
    const input = this.input;
    const len = input.length;
    let pos = this.pos;
    let col = this.column;
    let ln = this.line;

    while (pos < len) {
      const char = input[pos];
      if (char === " " || char === "\t") {
        pos++;
        col++;
      } else if (char === "\\" && input[pos + 1] === "\n") {
        pos += 2;
        ln++;
        col = 1;
      } else {
        break;
      }
    }

    this.pos = pos;
    this.column = col;
    this.line = ln;
  }

  private nextToken(): Token | null {
    const input = this.input;
    const pos = this.pos;
    const startLine = this.line;
    const startColumn = this.column;
    const c0 = input[pos];
    const c1 = input[pos + 1];
    const c2 = input[pos + 2];

    // Comments
    if (c0 === "#") {
      return this.readComment(pos, startLine, startColumn);
    }

    // Newline
    if (c0 === "\n") {
      this.pos = pos + 1;
      this.line++;
      this.column = 1;
      return {
        type: TokenType.NEWLINE,
        value: "\n",
        start: pos,
        end: pos + 1,
        line: startLine,
        column: startColumn,
      };
    }

    // Three-character operators
    if (c0 === "<" && c1 === "<" && c2 === "-") {
      this.pos = pos + 3;
      this.column = startColumn + 3;
      this.registerHeredocFromLookahead(true);
      return this.makeToken(TokenType.DLESSDASH, "<<-", pos, startLine, startColumn);
    }

    for (const [first, second, third, type] of THREE_CHAR_OPS) {
      if (c0 === first && c1 === second && c2 === third) {
        this.pos = pos + 3;
        this.column = startColumn + 3;
        return this.makeToken(type, first + second + third, pos, startLine, startColumn);
      }
    }

    // Two-character operators
    if (c0 === "<" && c1 === "<") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      this.registerHeredocFromLookahead(false);
      return this.makeToken(TokenType.DLESS, "<<", pos, startLine, startColumn);
    }

    for (const [first, second, type] of TWO_CHAR_OPS) {
      if (c0 === first && c1 === second) {
        this.pos = pos + 2;
        this.column = startColumn + 2;
        return this.makeToken(type, first + second, pos, startLine, startColumn);
      }
    }

    // Single-character operators
    const singleCharType = SINGLE_CHAR_OPS[c0 ?? ""];
    if (singleCharType) {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(singleCharType, c0!, pos, startLine, startColumn);
    }

    // Special cases
    if (c0 === "{") {
      if (c1 === "}") {
        this.pos = pos + 2;
        this.column = startColumn + 2;
        return {
          type: TokenType.WORD,
          value: "{}",
          start: pos,
          end: pos + 2,
          line: startLine,
          column: startColumn,
          quoted: false,
          singleQuoted: false,
        };
      }
      const braceContent = this.scanBraceExpansion(pos);
      if (braceContent !== null) {
        return this.readWordWithBraceExpansion(pos, startLine, startColumn);
      }
      const literalBrace = this.scanLiteralBraceWord(pos);
      if (literalBrace !== null) {
        return this.readWordWithBraceExpansion(pos, startLine, startColumn);
      }
      if (c1 !== undefined && c1 !== " " && c1 !== "\t" && c1 !== "\n") {
        return this.readWord(pos, startLine, startColumn);
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.LBRACE, "{", pos, startLine, startColumn);
    }

    if (c0 === "}") {
      if (this.isWordCharFollowing(pos + 1)) {
        return this.readWord(pos, startLine, startColumn);
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.RBRACE, "}", pos, startLine, startColumn);
    }

    if (c0 === "!") {
      if (c1 === "=") {
        this.pos = pos + 2;
        this.column = startColumn + 2;
        return this.makeToken(TokenType.WORD, "!=", pos, startLine, startColumn);
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.BANG, "!", pos, startLine, startColumn);
    }

    // Words
    return this.readWord(pos, startLine, startColumn);
  }

  private makeToken(
    type: TokenType,
    value: string,
    start: number,
    line: number,
    column: number
  ): Token {
    return {
      type,
      value,
      start,
      end: this.pos,
      line,
      column,
    };
  }

  // ===========================================================================
  // Helper Methods for Word Parsing
  // ===========================================================================

  /**
   * Check if a character is a word separator/boundary
   */
  private isSeparator(char: string | undefined): boolean {
    return (
      char === " " || char === "\t" || char === "\n" || char === ";" ||
      char === "&" || char === "|" || char === "(" || char === ")" ||
      char === "<" || char === ">"
    );
  }

  /**
   * Check if a character is a special character that requires slow path
   */
  private isSpecialChar(char: string | undefined): boolean {
    return (
      char === "'" || char === '"' || char === "\\" || char === "$" ||
      char === "`" || char === "{" || char === "}" || char === "~" ||
      char === "*" || char === "?" || char === "["
    );
  }

  /**
   * Read a single-quoted string starting at current position
   * Handles both regular single quotes and $'' ANSI-C quoting
   */
  private readSingleQuotedString(pos: number, isANSI: boolean): {
    value: string;
    pos: number;
    col: number;
  } {
    const input = this.input;
    const len = input.length;
    let value = isANSI ? "$'" : "";
    let col = this.column + (isANSI ? 2 : 1);
    pos += isANSI ? 2 : 1;

    while (pos < len && input[pos] !== "'") {
      if (isANSI && input[pos] === "\\" && pos + 1 < len) {
        value += input[pos]! + input[pos + 1]!;
        pos += 2;
        col += 2;
      } else {
        value += input[pos]!;
        pos++;
        col++;
      }
    }

    if (pos < len) {
      value += isANSI ? "'" : "";
      pos++;
      col++;
    }

    return { value, pos, col };
  }

  /**
   * Read a double-quoted string starting at current position
   * Handles both regular double quotes and $"..." locale quoting
   */
  private readDoubleQuotedString(pos: number, isLocale: boolean): {
    value: string;
    pos: number;
    col: number;
  } {
    const input = this.input;
    const len = input.length;
    let value = isLocale ? '$"' : "";
    let col = this.column + (isLocale ? 2 : 1);
    pos += isLocale ? 2 : 1;

    while (pos < len && input[pos] !== '"') {
      const char = input[pos]!;

      // Handle escapes in double quotes
      if (char === "\\" && pos + 1 < len) {
        const nextChar = input[pos + 1]!;
        if (nextChar === '"' || nextChar === "\\" || nextChar === "$" || nextChar === "`" || nextChar === "\n") {
          if (nextChar === "$" || nextChar === "`") {
            value += char + nextChar;
          } else {
            value += nextChar;
          }
          pos += 2;
          col += 2;
          continue;
        }
      }

      value += char;
      pos++;
      col++;
    }

    if (pos < len) {
      value += isLocale ? '"' : "";
      pos++;
      col++;
    }

    return { value, pos, col };
  }

  private readComment(start: number, line: number, column: number): Token {
    const input = this.input;
    const len = input.length;
    let pos = this.pos;

    while (pos < len && input[pos] !== "\n") {
      pos++;
    }

    const value = input.slice(start, pos);
    this.pos = pos;
    this.column = column + (pos - start);

    return {
      type: TokenType.COMMENT,
      value,
      start,
      end: pos,
      line,
      column,
    };
  }

  private readWord(start: number, line: number, column: number): Token {
    const input = this.input;
    const len = input.length;
    let pos = this.pos;

    // Fast path: scan for simple word (no special characters)
    const fastStart = pos;
    while (pos < len) {
      const c = input[pos];
      if (this.isSeparator(c) || this.isSpecialChar(c)) {
        break;
      }
      pos++;
    }

    // If we found a simple word ending at a separator or EOF, process it
    if (pos > fastStart) {
      const c = input[pos];
      if (pos >= len || this.isSeparator(c)) {
        const value = input.slice(fastStart, pos);
        this.pos = pos;
        this.column = column + (pos - fastStart);

        // Check for reserved words
        if (RESERVED_WORDS[value]) {
          return { type: RESERVED_WORDS[value]!, value, start, end: pos, line, column };
        }

        // Check for variable assignment
        const eqIdx = value.indexOf("=");
        if (eqIdx > 0 && isValidAssignmentLHS(value.slice(0, eqIdx))) {
          return { type: TokenType.ASSIGNMENT_WORD, value, start, end: pos, line, column };
        }

        // Check for numbers
        if (/^[0-9]+$/.test(value)) {
          return { type: TokenType.NUMBER, value, start, end: pos, line, column };
        }

        // Check for valid identifiers
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
          return { type: TokenType.NAME, value, start, end: pos, line, column, quoted: false, singleQuoted: false };
        }

        return { type: TokenType.WORD, value, start, end: pos, line, column, quoted: false, singleQuoted: false };
      }
    }

    // Slow path: handle complex words with quotes, escapes, expansions
    pos = this.pos;
    let col = this.column;
    let ln = this.line;
    let value = "";
    let quoted = false;
    let singleQuoted = false;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let startsWithQuote = input[pos] === '"' || input[pos] === "'";

    while (pos < len) {
      const char = input[pos];

      // Check for word boundaries (only when not inside quotes)
      if (!inSingleQuote && !inDoubleQuote) {
        if (this.isSeparator(char)) {
          break;
        }
      }

      // Handle $'' ANSI-C quoting
      if (char === "$" && pos + 1 < len && input[pos + 1] === "'" && !inSingleQuote && !inDoubleQuote) {
        value += "$'";
        pos += 2;
        col += 2;
        while (pos < len && input[pos] !== "'") {
          if (input[pos] === "\\" && pos + 1 < len) {
            value += input[pos]! + input[pos + 1]!;
            pos += 2;
            col += 2;
          } else {
            value += input[pos]!;
            pos++;
            col++;
          }
        }
        if (pos < len) {
          value += "'";
          pos++;
          col++;
        }
        continue;
      }

      // Handle $"..." locale quoting
      if (char === "$" && pos + 1 < len && input[pos + 1] === '"' && !inSingleQuote && !inDoubleQuote) {
        pos++;
        col++;
        inDoubleQuote = true;
        quoted = true;
        if (value === "") startsWithQuote = true;
        pos++;
        col++;
        continue;
      }

      // Handle quotes
      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote) {
          inSingleQuote = false;
          if (!startsWithQuote) value += char;
        } else {
          inSingleQuote = true;
          if (startsWithQuote) {
            singleQuoted = true;
            quoted = true;
          } else {
            value += char;
          }
        }
        pos++;
        col++;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        if (inDoubleQuote) {
          inDoubleQuote = false;
          if (!startsWithQuote) value += char;
        } else {
          inDoubleQuote = true;
          if (startsWithQuote) quoted = true;
          else value += char;
        }
        pos++;
        col++;
        continue;
      }

      // Handle escapes
      if (char === "\\" && !inSingleQuote && pos + 1 < len) {
        const nextChar = input[pos + 1];
        if (nextChar === "\n") {
          pos += 2;
          ln++;
          col = 1;
          continue;
        }
        if (inDoubleQuote) {
          if (nextChar === '"' || nextChar === "\\" || nextChar === "$" || nextChar === "`" || nextChar === "\n") {
            if (nextChar === "$" || nextChar === "`") {
              value += char + nextChar;
            } else {
              value += nextChar;
            }
            pos += 2;
            col += 2;
            continue;
          }
        } else {
          if (nextChar === '"' || nextChar === "'") {
            value += char + nextChar;
          } else {
            value += nextChar;
          }
          pos += 2;
          col += 2;
          continue;
        }
      }

      // Handle $(...) command substitution
      if (char === "$" && pos + 1 < len && input[pos + 1] === "(") {
        const result = this.readCommandSubstitution(pos, col, ln);
        value += result.value;
        pos = result.pos;
        col = result.col;
        ln = result.line;
        continue;
      }

      // Handle $[...] old-style arithmetic
      if (char === "$" && pos + 1 < len && input[pos + 1] === "[") {
        const result = this.readOldArithmetic(pos, col, ln);
        value += result.value;
        pos = result.pos;
        col = result.col;
        ln = result.line;
        continue;
      }

      // Handle ${...} parameter expansion
      if (char === "$" && pos + 1 < len && input[pos + 1] === "{") {
        const result = this.readParameterExpansion(pos, col, ln);
        value += result.value;
        pos = result.pos;
        col = result.col;
        ln = result.line;
        continue;
      }

      // Handle special variables
      if (char === "$" && pos + 1 < len) {
        const next = input[pos + 1]!;
        if (next === "#" || next === "?" || next === "$" || next === "!" ||
            next === "@" || next === "*" || next === "-" || (next >= "0" && next <= "9")) {
          value += char + next;
          pos += 2;
          col += 2;
          continue;
        }
      }

      // Handle backtick command substitution
      if (char === "`") {
        const result = this.readBacktickSubstitution(pos, col, ln);
        value += result.value;
        pos = result.pos;
        col = result.col;
        ln = result.line;
        continue;
      }

      value += char;
      pos++;
      if (char === "\n") {
        ln++;
        col = 1;
      } else {
        col++;
      }
    }

    this.pos = pos;
    this.column = col;
    this.line = ln;

    if (value === "") {
      return { type: TokenType.WORD, value: "", start, end: pos, line, column, quoted, singleQuoted };
    }

    if (!quoted && RESERVED_WORDS[value]) {
      return { type: RESERVED_WORDS[value]!, value, start, end: pos, line, column };
    }

    if (!startsWithQuote) {
      const eqIdx = value.indexOf("=");
      if (eqIdx > 0 && isValidAssignmentLHS(value.slice(0, eqIdx))) {
        return { type: TokenType.ASSIGNMENT_WORD, value, start, end: pos, line, column, quoted, singleQuoted };
      }
    }

    if (/^[0-9]+$/.test(value)) {
      return { type: TokenType.NUMBER, value, start, end: pos, line, column };
    }

    if (isValidName(value)) {
      return { type: TokenType.NAME, value, start, end: pos, line, column, quoted, singleQuoted };
    }

    return { type: TokenType.WORD, value, start, end: pos, line, column, quoted, singleQuoted };
  }

  /**
   * Read $(...) command substitution
   */
  private readCommandSubstitution(
    startPos: number,
    startCol: number,
    startLine: number
  ): { value: string; pos: number; col: number; line: number } {
    const input = this.input;
    const len = input.length;
    let pos = startPos;
    let col = startCol;
    let ln = startLine;
    let value = "";

    value += input[pos]; // $
    pos++;
    col++;
    value += input[pos]; // (
    pos++;
    col++;

    let depth = 1;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let caseDepth = 0;
    let inCasePattern = false;
    let wordBuffer = "";
    const isArithmetic = input[pos] === "(";

    while (depth > 0 && pos < len) {
      const c = input[pos]!;
      value += c;

      if (inSingleQuote) {
        if (c === "'") inSingleQuote = false;
      } else if (inDoubleQuote) {
        if (c === "\\" && pos + 1 < len) {
          value += input[pos + 1];
          pos++;
          col++;
        } else if (c === '"') {
          inDoubleQuote = false;
        }
      } else {
        if (c === "'") {
          inSingleQuote = true;
          wordBuffer = "";
        } else if (c === '"') {
          inDoubleQuote = true;
          wordBuffer = "";
        } else if (c === "\\" && pos + 1 < len) {
          value += input[pos + 1];
          pos++;
          col++;
          wordBuffer = "";
        } else if (c === "#" && !isArithmetic && (wordBuffer === "" || /\s/.test(input[pos - 1] || ""))) {
          while (pos + 1 < len && input[pos + 1] !== "\n") {
            pos++;
            col++;
            value += input[pos];
          }
          wordBuffer = "";
        } else if (/[a-zA-Z_]/.test(c)) {
          wordBuffer += c;
        } else {
          if (wordBuffer === "case") {
            caseDepth++;
            inCasePattern = false;
          } else if (wordBuffer === "in" && caseDepth > 0) {
            inCasePattern = true;
          } else if (wordBuffer === "esac" && caseDepth > 0) {
            caseDepth--;
            inCasePattern = false;
          }
          wordBuffer = "";

          if (c === "(") {
            if (pos > 0 && input[pos - 1] === "$") {
              depth++;
            } else if (!inCasePattern) {
              depth++;
            }
          } else if (c === ")") {
            if (inCasePattern) {
              inCasePattern = false;
            } else {
              depth--;
            }
          } else if (c === ";") {
            if (caseDepth > 0 && pos + 1 < len && input[pos + 1] === ";") {
              inCasePattern = true;
            }
          }
        }
      }

      if (c === "\n") {
        ln++;
        col = 0;
        wordBuffer = "";
      }
      pos++;
      col++;
    }

    return { value, pos, col, line: ln };
  }

  /**
   * Read $[...] old-style arithmetic
   */
  private readOldArithmetic(
    startPos: number,
    startCol: number,
    startLine: number
  ): { value: string; pos: number; col: number; line: number } {
    const input = this.input;
    const len = input.length;
    let pos = startPos;
    let col = startCol;
    let ln = startLine;
    let value = "";

    value += input[pos]; // $
    pos++;
    col++;
    value += input[pos]; // [
    pos++;
    col++;

    let depth = 1;
    while (depth > 0 && pos < len) {
      const c = input[pos];
      value += c;
      if (c === "[") depth++;
      else if (c === "]") depth--;
      else if (c === "\n") {
        ln++;
        col = 0;
      }
      pos++;
      col++;
    }

    return { value, pos, col, line: ln };
  }

  /**
   * Read ${...} parameter expansion
   */
  private readParameterExpansion(
    startPos: number,
    startCol: number,
    startLine: number
  ): { value: string; pos: number; col: number; line: number } {
    const input = this.input;
    const len = input.length;
    let pos = startPos;
    let col = startCol;
    let ln = startLine;
    let value = "";

    value += input[pos]; // $
    pos++;
    col++;
    value += input[pos]; // {
    pos++;
    col++;

    let depth = 1;
    while (depth > 0 && pos < len) {
      const c = input[pos];
      value += c;
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "\n") {
        ln++;
        col = 0;
      }
      pos++;
      col++;
    }

    return { value, pos, col, line: ln };
  }

  /**
   * Read `...` backtick command substitution
   */
  private readBacktickSubstitution(
    startPos: number,
    startCol: number,
    startLine: number
  ): { value: string; pos: number; col: number; line: number } {
    const input = this.input;
    const len = input.length;
    let pos = startPos;
    let col = startCol;
    let ln = startLine;
    let value = "";

    value += input[pos]; // `
    pos++;
    col++;

    while (pos < len && input[pos] !== "`") {
      const c = input[pos];
      value += c;
      if (c === "\\" && pos + 1 < len) {
        value += input[pos + 1];
        pos++;
        col++;
      }
      if (c === "\n") {
        ln++;
        col = 0;
      }
      pos++;
      col++;
    }

    if (pos < len) {
      value += input[pos]; // closing `
      pos++;
      col++;
    }

    return { value, pos, col, line: ln };
  }

  private readHeredocContent(): void {
    while (this.pendingHeredocs.length > 0) {
      const heredoc = this.pendingHeredocs.shift();
      if (!heredoc) break;
      const start = this.pos;
      const startLine = this.line;
      const startColumn = this.column;
      let content = "";

      while (this.pos < this.input.length) {
        let line = "";

        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          line += this.input[this.pos];
          this.pos++;
          this.column++;
        }

        const lineToCheck = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
        if (lineToCheck === heredoc.delimiter) {
          if (this.pos < this.input.length && this.input[this.pos] === "\n") {
            this.pos++;
            this.line++;
            this.column = 1;
          }
          break;
        }

        content += line;
        if (this.pos < this.input.length && this.input[this.pos] === "\n") {
          content += "\n";
          this.pos++;
          this.line++;
          this.column = 1;
        }
      }

      this.tokens.push({
        type: TokenType.HEREDOC_CONTENT,
        value: content,
        start,
        end: this.pos,
        line: startLine,
        column: startColumn,
      });
    }
  }

  /**
   * Register a here-document to be read after the next newline
   */
  addPendingHeredoc(delimiter: string, stripTabs: boolean, quoted: boolean): void {
    this.pendingHeredocs.push({ delimiter, stripTabs, quoted });
  }

  private registerHeredocFromLookahead(stripTabs: boolean): void {
    const savedPos = this.pos;
    const savedColumn = this.column;

    while (this.pos < this.input.length && (this.input[this.pos] === " " || this.input[this.pos] === "\t")) {
      this.pos++;
      this.column++;
    }

    let delimiter = "";
    let quoted = false;
    const char = this.input[this.pos];

    if (char === "'" || char === '"') {
      quoted = true;
      const quoteChar = char;
      this.pos++;
      this.column++;
      while (this.pos < this.input.length && this.input[this.pos] !== quoteChar) {
        delimiter += this.input[this.pos];
        this.pos++;
        this.column++;
      }
    } else {
      while (this.pos < this.input.length && !/[\s;<>&|()]/.test(this.input[this.pos]!)) {
        delimiter += this.input[this.pos]!;
        this.pos++;
        this.column++;
      }
    }

    this.pos = savedPos;
    this.column = savedColumn;

    if (delimiter) {
      this.pendingHeredocs.push({ delimiter, stripTabs, quoted });
    }
  }

  private isWordCharFollowing(pos: number): boolean {
    if (pos >= this.input.length) return false;
    const c = this.input[pos];
    return !(c === " " || c === "\t" || c === "\n" || c === ";" || c === "&" ||
             c === "|" || c === "(" || c === ")" || c === "<" || c === ">");
  }

  private readWordWithBraceExpansion(start: number, line: number, column: number): Token {
    const input = this.input;
    const len = input.length;
    let pos = start;
    let col = column;

    while (pos < len) {
      const c = input[pos];

      if (c === " " || c === "\t" || c === "\n" || c === ";" || c === "&" ||
          c === "|" || c === "(" || c === ")" || c === "<" || c === ">") {
        break;
      }

      if (c === "{") {
        const braceExp = this.scanBraceExpansion(pos);
        if (braceExp !== null) {
          let depth = 1;
          pos++;
          col++;
          while (pos < len && depth > 0) {
            if (input[pos] === "{") depth++;
            else if (input[pos] === "}") depth--;
            pos++;
            col++;
          }
          continue;
        }
        pos++;
        col++;
        continue;
      }

      if (c === "}") {
        pos++;
        col++;
        continue;
      }

      if (c === "$" && pos + 1 < len && input[pos + 1] === "(") {
        pos++;
        col++;
        pos++;
        col++;
        let depth = 1;
        while (depth > 0 && pos < len) {
          if (input[pos] === "(") depth++;
          else if (input[pos] === ")") depth--;
          pos++;
          col++;
        }
        continue;
      }

      if (c === "$" && pos + 1 < len && input[pos + 1] === "{") {
        pos++;
        col++;
        pos++;
        col++;
        let depth = 1;
        while (depth > 0 && pos < len) {
          if (input[pos] === "{") depth++;
          else if (input[pos] === "}") depth--;
          pos++;
          col++;
        }
        continue;
      }

      if (c === "`") {
        pos++;
        col++;
        while (pos < len && input[pos] !== "`") {
          if (input[pos] === "\\" && pos + 1 < len) {
            pos += 2;
            col += 2;
          } else {
            pos++;
            col++;
          }
        }
        if (pos < len) {
          pos++;
          col++;
        }
        continue;
      }

      pos++;
      col++;
    }

    const value = input.slice(start, pos);
    this.pos = pos;
    this.column = col;

    return {
      type: TokenType.WORD,
      value,
      start,
      end: pos,
      line,
      column,
      quoted: false,
      singleQuoted: false,
    };
  }

  private scanBraceExpansion(startPos: number): string | null {
    const input = this.input;
    const len = input.length;
    let pos = startPos + 1;
    let depth = 1;
    let hasComma = false;
    let hasRange = false;

    while (pos < len && depth > 0) {
      const c = input[pos];

      if (c === "{") {
        depth++;
        pos++;
      } else if (c === "}") {
        depth--;
        pos++;
      } else if (c === "," && depth === 1) {
        hasComma = true;
        pos++;
      } else if (c === "." && pos + 1 < len && input[pos + 1] === ".") {
        hasRange = true;
        pos += 2;
      } else if (c === " " || c === "\t" || c === "\n" || c === ";" || c === "&" || c === "|") {
        return null;
      } else {
        pos++;
      }
    }

    if (depth === 0 && (hasComma || hasRange)) {
      return input.slice(startPos, pos);
    }

    return null;
  }

  private scanLiteralBraceWord(startPos: number): string | null {
    const input = this.input;
    const len = input.length;
    let pos = startPos + 1;
    let depth = 1;

    while (pos < len && depth > 0) {
      const c = input[pos];

      if (c === "{") {
        depth++;
        pos++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          return input.slice(startPos, pos + 1);
        }
        pos++;
      } else if (c === " " || c === "\t" || c === "\n" || c === ";" || c === "&" || c === "|") {
        return null;
      } else {
        pos++;
      }
    }

    return null;
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

/**
 * Tokenize a bash script and return all tokens
 */
export function tokenize(input: string): Token[] {
  const lexer = new Lexer(input);
  return lexer.tokenize();
}
