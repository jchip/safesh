/**
 * Pratt Parser for Bash Arithmetic Expressions
 *
 * Implements a top-down operator precedence parser (Pratt parser) for
 * arithmetic expressions used in $((...)) and ((...)).
 *
 * Handles:
 * - Binary operators with proper precedence
 * - Unary prefix operators (-, +, !, ~, ++, --)
 * - Postfix operators (++, --)
 * - Ternary conditional (? :)
 * - Assignment operators (=, +=, -=, etc.)
 * - Parenthesized expressions
 * - Variable references and numeric literals
 */

import type * as AST from "./ast.ts";

// =============================================================================
// Token Types for Arithmetic Lexer
// =============================================================================

enum ArithTokenType {
  NUMBER,
  IDENTIFIER,
  PARAM_EXPANSION, // ${...}
  PLUS,
  MINUS,
  STAR,
  SLASH,
  PERCENT,
  POWER,       // **
  LSHIFT,      // <<
  RSHIFT,      // >>
  LT,          // <
  GT,          // >
  LE,          // <=
  GE,          // >=
  EQ,          // ==
  NE,          // !=
  AMP,         // &
  CARET,       // ^
  PIPE,        // |
  AND,         // &&
  OR,          // ||
  BANG,        // !
  TILDE,       // ~
  QUESTION,    // ?
  COLON,       // :
  COMMA,       // ,
  ASSIGN,      // =
  PLUS_ASSIGN, // +=
  MINUS_ASSIGN,// -=
  STAR_ASSIGN, // *=
  SLASH_ASSIGN,// /=
  PERCENT_ASSIGN, // %=
  LSHIFT_ASSIGN,  // <<=
  RSHIFT_ASSIGN,  // >>=
  AMP_ASSIGN,     // &=
  PIPE_ASSIGN,    // |=
  CARET_ASSIGN,   // ^=
  INC,         // ++
  DEC,         // --
  LPAREN,
  RPAREN,
  EOF,
}

interface ArithToken {
  type: ArithTokenType;
  value: string;
  pos: number;
}

// =============================================================================
// Binding Powers (Precedence)
// =============================================================================

// Higher number = tighter binding
const PRECEDENCE = {
  COMMA: 1,
  ASSIGNMENT: 2,
  TERNARY: 3,
  OR: 4,
  AND: 5,
  BIT_OR: 6,
  BIT_XOR: 7,
  BIT_AND: 8,
  EQUALITY: 9,
  COMPARISON: 10,
  SHIFT: 11,
  ADDITIVE: 12,
  MULTIPLICATIVE: 13,
  POWER: 14,  // Right-associative
  PREFIX: 15,
  POSTFIX: 16,
} as const;

// =============================================================================
// Arithmetic Lexer
// =============================================================================

class ArithmeticLexer {
  private input: string;
  private pos = 0;

  constructor(input: string) {
    this.input = input;
  }

  private peek(offset = 0): string {
    return this.input[this.pos + offset] ?? "";
  }

  private advance(): string {
    return this.input[this.pos++] ?? "";
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.peek())) {
      this.pos++;
    }
  }

  next(): ArithToken {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return { type: ArithTokenType.EOF, value: "", pos: this.pos };
    }

    const startPos = this.pos;
    const c = this.peek();
    const c2 = this.peek(1);
    const c3 = this.peek(2);

    // Three-character operators
    if (c === "<" && c2 === "<" && c3 === "=") {
      this.pos += 3;
      return { type: ArithTokenType.LSHIFT_ASSIGN, value: "<<=", pos: startPos };
    }
    if (c === ">" && c2 === ">" && c3 === "=") {
      this.pos += 3;
      return { type: ArithTokenType.RSHIFT_ASSIGN, value: ">>=", pos: startPos };
    }

    // Two-character operators
    const twoChar = c + c2;
    const twoCharMap: Record<string, ArithTokenType> = {
      "**": ArithTokenType.POWER,
      "<<": ArithTokenType.LSHIFT,
      ">>": ArithTokenType.RSHIFT,
      "<=": ArithTokenType.LE,
      ">=": ArithTokenType.GE,
      "==": ArithTokenType.EQ,
      "!=": ArithTokenType.NE,
      "&&": ArithTokenType.AND,
      "||": ArithTokenType.OR,
      "++": ArithTokenType.INC,
      "--": ArithTokenType.DEC,
      "+=": ArithTokenType.PLUS_ASSIGN,
      "-=": ArithTokenType.MINUS_ASSIGN,
      "*=": ArithTokenType.STAR_ASSIGN,
      "/=": ArithTokenType.SLASH_ASSIGN,
      "%=": ArithTokenType.PERCENT_ASSIGN,
      "&=": ArithTokenType.AMP_ASSIGN,
      "|=": ArithTokenType.PIPE_ASSIGN,
      "^=": ArithTokenType.CARET_ASSIGN,
    };

    if (twoCharMap[twoChar]) {
      this.pos += 2;
      return { type: twoCharMap[twoChar]!, value: twoChar, pos: startPos };
    }

    // Single-character operators
    const singleCharMap: Record<string, ArithTokenType> = {
      "+": ArithTokenType.PLUS,
      "-": ArithTokenType.MINUS,
      "*": ArithTokenType.STAR,
      "/": ArithTokenType.SLASH,
      "%": ArithTokenType.PERCENT,
      "<": ArithTokenType.LT,
      ">": ArithTokenType.GT,
      "&": ArithTokenType.AMP,
      "^": ArithTokenType.CARET,
      "|": ArithTokenType.PIPE,
      "!": ArithTokenType.BANG,
      "~": ArithTokenType.TILDE,
      "?": ArithTokenType.QUESTION,
      ":": ArithTokenType.COLON,
      ",": ArithTokenType.COMMA,
      "=": ArithTokenType.ASSIGN,
      "(": ArithTokenType.LPAREN,
      ")": ArithTokenType.RPAREN,
    };

    if (singleCharMap[c]) {
      this.pos++;
      return { type: singleCharMap[c]!, value: c, pos: startPos };
    }

    // Parameter expansion: ${...}
    if (c === "$" && c2 === "{") {
      let value = this.advance() + this.advance(); // "${"
      let braceDepth = 1;

      while (braceDepth > 0 && this.pos < this.input.length) {
        const ch = this.peek();
        value += this.advance();

        if (ch === "{") {
          braceDepth++;
        } else if (ch === "}") {
          braceDepth--;
        }
      }

      return { type: ArithTokenType.PARAM_EXPANSION, value, pos: startPos };
    }

    // Numbers (decimal, octal, hex)
    if (/[0-9]/.test(c)) {
      let value = "";
      // Hex
      if (c === "0" && (c2 === "x" || c2 === "X")) {
        value = this.advance() + this.advance();
        while (/[0-9a-fA-F]/.test(this.peek())) {
          value += this.advance();
        }
      }
      // Octal
      else if (c === "0" && /[0-7]/.test(c2)) {
        value = this.advance();
        while (/[0-7]/.test(this.peek())) {
          value += this.advance();
        }
      }
      // Decimal
      else {
        while (/[0-9]/.test(this.peek())) {
          value += this.advance();
        }
      }
      return { type: ArithTokenType.NUMBER, value, pos: startPos };
    }

    // Identifiers (variable names)
    if (/[a-zA-Z_]/.test(c)) {
      let value = "";
      while (/[a-zA-Z0-9_]/.test(this.peek())) {
        value += this.advance();
      }
      return { type: ArithTokenType.IDENTIFIER, value, pos: startPos };
    }

    // Unknown character - skip and try again
    this.pos++;
    return this.next();
  }

  tokenize(): ArithToken[] {
    const tokens: ArithToken[] = [];
    let token: ArithToken;
    do {
      token = this.next();
      tokens.push(token);
    } while (token.type !== ArithTokenType.EOF);
    return tokens;
  }
}

// =============================================================================
// Pratt Parser
// =============================================================================

export class ArithmeticParser {
  private tokens: ArithToken[] = [];
  private pos = 0;

  constructor(private input: string) {
    const lexer = new ArithmeticLexer(input);
    this.tokens = lexer.tokenize();
  }

  private current(): ArithToken {
    return this.tokens[this.pos] ?? { type: ArithTokenType.EOF, value: "", pos: 0 };
  }

  private advance(): ArithToken {
    const token = this.current();
    this.pos++;
    return token;
  }

  private expect(type: ArithTokenType): ArithToken {
    const token = this.current();
    if (token.type !== type) {
      throw new Error(
        `Expected ${ArithTokenType[type]}, got ${ArithTokenType[token.type]} at position ${token.pos}`
      );
    }
    return this.advance();
  }

  parse(): AST.ArithmeticExpression {
    const result = this.parseExpression(0);
    if (this.current().type !== ArithTokenType.EOF) {
      throw new Error(`Unexpected token: ${this.current().value}`);
    }
    return result;
  }

  private parseExpression(minPrecedence: number): AST.ArithmeticExpression {
    let left = this.parsePrefix();

    while (true) {
      const token = this.current();
      const precedence = this.getInfixPrecedence(token.type);

      if (precedence === null || precedence < minPrecedence) {
        break;
      }

      left = this.parseInfix(left, token, precedence);
    }

    return left;
  }

  private parsePrefix(): AST.ArithmeticExpression {
    const token = this.current();

    switch (token.type) {
      case ArithTokenType.NUMBER: {
        this.advance();
        return {
          type: "NumberLiteral",
          value: this.parseNumber(token.value),
        };
      }

      case ArithTokenType.IDENTIFIER: {
        this.advance();
        // Check for postfix ++ or --
        const next = this.current();
        if (next.type === ArithTokenType.INC || next.type === ArithTokenType.DEC) {
          this.advance();
          return {
            type: "UnaryArithmeticExpression",
            operator: next.type === ArithTokenType.INC ? "++" : "--",
            argument: { type: "VariableReference", name: token.value },
            prefix: false,
          };
        }
        return { type: "VariableReference", name: token.value };
      }

      case ArithTokenType.PARAM_EXPANSION: {
        this.advance();
        return this.parseParameterExpansionToken(token.value);
      }

      case ArithTokenType.LPAREN: {
        this.advance();
        const expr = this.parseExpression(0);
        this.expect(ArithTokenType.RPAREN);
        return {
          type: "GroupedArithmeticExpression",
          expression: expr,
        };
      }

      case ArithTokenType.PLUS:
      case ArithTokenType.MINUS:
      case ArithTokenType.BANG:
      case ArithTokenType.TILDE: {
        this.advance();
        const operand = this.parseExpression(PRECEDENCE.PREFIX);
        const opMap: Record<string, AST.UnaryArithmeticExpression["operator"]> = {
          "+": "+",
          "-": "-",
          "!": "!",
          "~": "~",
        };
        return {
          type: "UnaryArithmeticExpression",
          operator: opMap[token.value]!,
          argument: operand,
          prefix: true,
        };
      }

      case ArithTokenType.INC:
      case ArithTokenType.DEC: {
        this.advance();
        const operand = this.parseExpression(PRECEDENCE.PREFIX);
        return {
          type: "UnaryArithmeticExpression",
          operator: token.type === ArithTokenType.INC ? "++" : "--",
          argument: operand,
          prefix: true,
        };
      }

      default:
        throw new Error(
          `Unexpected token in arithmetic expression: ${ArithTokenType[token.type]} (${token.value})`
        );
    }
  }

  private parseInfix(
    left: AST.ArithmeticExpression,
    token: ArithToken,
    precedence: number
  ): AST.ArithmeticExpression {
    this.advance();

    // Handle ternary operator
    if (token.type === ArithTokenType.QUESTION) {
      const consequent = this.parseExpression(0);
      this.expect(ArithTokenType.COLON);
      const alternate = this.parseExpression(PRECEDENCE.TERNARY);
      return {
        type: "ConditionalArithmeticExpression",
        test: left,
        consequent,
        alternate,
      };
    }

    // Handle assignment operators
    if (this.isAssignmentOp(token.type)) {
      if (left.type !== "VariableReference") {
        throw new Error("Invalid left-hand side of assignment");
      }
      // Right-associative
      const right = this.parseExpression(precedence);
      return {
        type: "AssignmentExpression",
        operator: this.getAssignmentOp(token.type),
        left,
        right,
      };
    }

    // Handle binary operators
    const operator = this.getBinaryOp(token.type);
    if (operator) {
      // Right-associative for **
      const rightPrec = token.type === ArithTokenType.POWER ? precedence : precedence + 1;
      const right = this.parseExpression(rightPrec);
      return {
        type: "BinaryArithmeticExpression",
        operator,
        left,
        right,
      };
    }

    throw new Error(`Unknown infix operator: ${token.value}`);
  }

  private getInfixPrecedence(type: ArithTokenType): number | null {
    switch (type) {
      case ArithTokenType.COMMA:
        return PRECEDENCE.COMMA;
      case ArithTokenType.ASSIGN:
      case ArithTokenType.PLUS_ASSIGN:
      case ArithTokenType.MINUS_ASSIGN:
      case ArithTokenType.STAR_ASSIGN:
      case ArithTokenType.SLASH_ASSIGN:
      case ArithTokenType.PERCENT_ASSIGN:
      case ArithTokenType.LSHIFT_ASSIGN:
      case ArithTokenType.RSHIFT_ASSIGN:
      case ArithTokenType.AMP_ASSIGN:
      case ArithTokenType.PIPE_ASSIGN:
      case ArithTokenType.CARET_ASSIGN:
        return PRECEDENCE.ASSIGNMENT;
      case ArithTokenType.QUESTION:
        return PRECEDENCE.TERNARY;
      case ArithTokenType.OR:
        return PRECEDENCE.OR;
      case ArithTokenType.AND:
        return PRECEDENCE.AND;
      case ArithTokenType.PIPE:
        return PRECEDENCE.BIT_OR;
      case ArithTokenType.CARET:
        return PRECEDENCE.BIT_XOR;
      case ArithTokenType.AMP:
        return PRECEDENCE.BIT_AND;
      case ArithTokenType.EQ:
      case ArithTokenType.NE:
        return PRECEDENCE.EQUALITY;
      case ArithTokenType.LT:
      case ArithTokenType.GT:
      case ArithTokenType.LE:
      case ArithTokenType.GE:
        return PRECEDENCE.COMPARISON;
      case ArithTokenType.LSHIFT:
      case ArithTokenType.RSHIFT:
        return PRECEDENCE.SHIFT;
      case ArithTokenType.PLUS:
      case ArithTokenType.MINUS:
        return PRECEDENCE.ADDITIVE;
      case ArithTokenType.STAR:
      case ArithTokenType.SLASH:
      case ArithTokenType.PERCENT:
        return PRECEDENCE.MULTIPLICATIVE;
      case ArithTokenType.POWER:
        return PRECEDENCE.POWER;
      default:
        return null;
    }
  }

  private isAssignmentOp(type: ArithTokenType): boolean {
    return [
      ArithTokenType.ASSIGN,
      ArithTokenType.PLUS_ASSIGN,
      ArithTokenType.MINUS_ASSIGN,
      ArithTokenType.STAR_ASSIGN,
      ArithTokenType.SLASH_ASSIGN,
      ArithTokenType.PERCENT_ASSIGN,
      ArithTokenType.LSHIFT_ASSIGN,
      ArithTokenType.RSHIFT_ASSIGN,
      ArithTokenType.AMP_ASSIGN,
      ArithTokenType.PIPE_ASSIGN,
      ArithTokenType.CARET_ASSIGN,
    ].includes(type);
  }

  private getAssignmentOp(type: ArithTokenType): AST.AssignmentExpression["operator"] {
    const map: Record<number, AST.AssignmentExpression["operator"]> = {
      [ArithTokenType.ASSIGN]: "=",
      [ArithTokenType.PLUS_ASSIGN]: "+=",
      [ArithTokenType.MINUS_ASSIGN]: "-=",
      [ArithTokenType.STAR_ASSIGN]: "*=",
      [ArithTokenType.SLASH_ASSIGN]: "/=",
      [ArithTokenType.PERCENT_ASSIGN]: "%=",
      [ArithTokenType.LSHIFT_ASSIGN]: "<<=",
      [ArithTokenType.RSHIFT_ASSIGN]: ">>=",
      [ArithTokenType.AMP_ASSIGN]: "&=",
      [ArithTokenType.PIPE_ASSIGN]: "|=",
      [ArithTokenType.CARET_ASSIGN]: "^=",
    };
    return map[type]!;
  }

  private getBinaryOp(type: ArithTokenType): AST.BinaryArithmeticExpression["operator"] | null {
    const map: Record<number, AST.BinaryArithmeticExpression["operator"]> = {
      [ArithTokenType.PLUS]: "+",
      [ArithTokenType.MINUS]: "-",
      [ArithTokenType.STAR]: "*",
      [ArithTokenType.SLASH]: "/",
      [ArithTokenType.PERCENT]: "%",
      [ArithTokenType.POWER]: "**",
      [ArithTokenType.LSHIFT]: "<<",
      [ArithTokenType.RSHIFT]: ">>",
      [ArithTokenType.LT]: "<",
      [ArithTokenType.GT]: ">",
      [ArithTokenType.LE]: "<=",
      [ArithTokenType.GE]: ">=",
      [ArithTokenType.EQ]: "==",
      [ArithTokenType.NE]: "!=",
      [ArithTokenType.AMP]: "&",
      [ArithTokenType.CARET]: "^",
      [ArithTokenType.PIPE]: "|",
      [ArithTokenType.AND]: "&&",
      [ArithTokenType.OR]: "||",
      [ArithTokenType.COMMA]: ",",
    };
    return map[type] ?? null;
  }

  private parseNumber(value: string): number {
    // Hex
    if (value.startsWith("0x") || value.startsWith("0X")) {
      return parseInt(value, 16);
    }
    // Octal
    if (value.startsWith("0") && value.length > 1 && /^[0-7]+$/.test(value)) {
      return parseInt(value, 8);
    }
    // Decimal
    return parseInt(value, 10);
  }

  /**
   * Parse parameter expansion token ${...} into AST node
   * @param value - The full ${...} string including braces
   */
  private parseParameterExpansionToken(value: string): AST.ParameterExpansion {
    // Strip ${ and }
    const content = value.slice(2, -1);
    let pos = 0;

    // Handle ${!var} indirect expansion
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
        const subscriptContent = content.slice(subscriptStart + 1, pos - 1);
        // Store subscript
        const result: AST.ParameterExpansion = {
          type: "ParameterExpansion",
          parameter: paramName,
          subscript: subscriptContent,
        };
        if (isIndirect) {
          result.indirection = true;
        }
        // Check for modifiers after subscript
        if (pos < content.length) {
          this.applyModifier(result, content.slice(pos));
        }
        return result;
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
    const result: AST.ParameterExpansion = {
      type: "ParameterExpansion",
      parameter: paramName,
    };

    this.applyModifier(result, remaining);
    return result;
  }

  /**
   * Apply parameter expansion modifier to the result
   */
  private applyModifier(result: AST.ParameterExpansion, remaining: string): void {
    // Two-character modifiers
    const twoCharModifiers: Record<string, AST.ParameterModifier> = {
      ":-": ":-",
      ":=": ":=",
      ":?": ":?",
      ":+": ":+",
      "##": "##",
      "%%": "%%",
      "^^": "^^",
      ",,": ",,",
      "//": "//",
      "/#": "/#",
      "/%": "/%",
    };

    for (const [pattern, modifier] of Object.entries(twoCharModifiers)) {
      if (remaining.startsWith(pattern)) {
        const arg = remaining.slice(pattern.length);
        result.modifier = modifier;
        if (arg) {
          result.modifierArg = {
            type: "Word",
            value: arg,
            quoted: false,
            singleQuoted: false,
            parts: [{ type: "LiteralPart", value: arg }],
          };
        }
        return;
      }
    }

    // Single-character modifiers
    const singleCharModifiers: Record<string, AST.ParameterModifier> = {
      "-": "-",
      "=": "=",
      "?": "?",
      "+": "+",
      "#": "#",
      "%": "%",
      "^": "^",
      ",": ",",
      "/": "/",
    };

    const firstChar = remaining[0] ?? "";
    const modifier = singleCharModifiers[firstChar];
    if (modifier) {
      const arg = remaining.slice(1);
      result.modifier = modifier;
      if (arg) {
        result.modifierArg = {
          type: "Word",
          value: arg,
          quoted: false,
          singleQuoted: false,
          parts: [{ type: "LiteralPart", value: arg }],
        };
      }
    }
  }
}

// =============================================================================
// Convenience Function
// =============================================================================

export function parseArithmetic(input: string): AST.ArithmeticExpression {
  const parser = new ArithmeticParser(input);
  return parser.parse();
}
