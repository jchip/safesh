/**
 * Comprehensive tests for arithmetic-parser.ts (SSH-350)
 * Target: >85% branch and >85% line coverage
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import { parseArithmetic, ArithmeticParser } from "./arithmetic-parser.ts";
import type * as AST from "./ast.ts";

describe("Arithmetic Parser - Comprehensive Coverage", () => {
  describe("Basic operators", () => {
    it("should parse addition", () => {
      const expr = parseArithmetic("1 + 2");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "+");
    });

    it("should parse subtraction", () => {
      const expr = parseArithmetic("10 - 5");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "-");
    });

    it("should parse multiplication", () => {
      const expr = parseArithmetic("3 * 4");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "*");
    });

    it("should parse division", () => {
      const expr = parseArithmetic("20 / 4");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "/");
    });

    it("should parse modulo", () => {
      const expr = parseArithmetic("17 % 5");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "%");
    });

    it("should parse power", () => {
      const expr = parseArithmetic("2 ** 8");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "**");
    });
  });

  describe("Shift operators", () => {
    it("should parse left shift", () => {
      const expr = parseArithmetic("1 << 4");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "<<");
    });

    it("should parse right shift", () => {
      const expr = parseArithmetic("16 >> 2");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, ">>");
    });
  });

  describe("Comparison operators", () => {
    it("should parse less than", () => {
      const expr = parseArithmetic("a < b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "<");
    });

    it("should parse greater than", () => {
      const expr = parseArithmetic("a > b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, ">");
    });

    it("should parse less than or equal", () => {
      const expr = parseArithmetic("a <= b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "<=");
    });

    it("should parse greater than or equal", () => {
      const expr = parseArithmetic("a >= b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, ">=");
    });

    it("should parse equality", () => {
      const expr = parseArithmetic("a == b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "==");
    });

    it("should parse not equal", () => {
      const expr = parseArithmetic("a != b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "!=");
    });
  });

  describe("Bitwise operators", () => {
    it("should parse bitwise AND", () => {
      const expr = parseArithmetic("a & b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "&");
    });

    it("should parse bitwise OR", () => {
      const expr = parseArithmetic("a | b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "|");
    });

    it("should parse bitwise XOR", () => {
      const expr = parseArithmetic("a ^ b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "^");
    });
  });

  describe("Logical operators", () => {
    it("should parse logical AND", () => {
      const expr = parseArithmetic("a && b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "&&");
    });

    it("should parse logical OR", () => {
      const expr = parseArithmetic("a || b");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "||");
    });
  });

  describe("Unary operators", () => {
    it("should parse unary plus", () => {
      const expr = parseArithmetic("+x");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "+");
      assertEquals(un.prefix, true);
    });

    it("should parse unary minus", () => {
      const expr = parseArithmetic("-x");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "-");
      assertEquals(un.prefix, true);
    });

    it("should parse logical NOT", () => {
      const expr = parseArithmetic("!x");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "!");
      assertEquals(un.prefix, true);
    });

    it("should parse bitwise NOT", () => {
      const expr = parseArithmetic("~x");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "~");
      assertEquals(un.prefix, true);
    });

    it("should parse prefix increment", () => {
      const expr = parseArithmetic("++x");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "++");
      assertEquals(un.prefix, true);
    });

    it("should parse prefix decrement", () => {
      const expr = parseArithmetic("--x");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "--");
      assertEquals(un.prefix, true);
    });

    it("should parse postfix increment", () => {
      const expr = parseArithmetic("x++");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "++");
      assertEquals(un.prefix, false);
    });

    it("should parse postfix decrement", () => {
      const expr = parseArithmetic("x--");
      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "--");
      assertEquals(un.prefix, false);
    });
  });

  describe("Assignment operators", () => {
    it("should parse simple assignment", () => {
      const expr = parseArithmetic("x = 5");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "=");
    });

    it("should parse += assignment", () => {
      const expr = parseArithmetic("x += 5");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "+=");
    });

    it("should parse -= assignment", () => {
      const expr = parseArithmetic("x -= 5");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "-=");
    });

    it("should parse *= assignment", () => {
      const expr = parseArithmetic("x *= 5");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "*=");
    });

    it("should parse /= assignment", () => {
      const expr = parseArithmetic("x /= 5");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "/=");
    });

    it("should parse %= assignment", () => {
      const expr = parseArithmetic("x %= 5");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "%=");
    });

    it("should parse <<= assignment", () => {
      const expr = parseArithmetic("x <<= 2");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "<<=");
    });

    it("should parse >>= assignment", () => {
      const expr = parseArithmetic("x >>= 2");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, ">>=");
    });

    it("should parse &= assignment", () => {
      const expr = parseArithmetic("x &= 15");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "&=");
    });

    it("should parse |= assignment", () => {
      const expr = parseArithmetic("x |= 8");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "|=");
    });

    it("should parse ^= assignment", () => {
      const expr = parseArithmetic("x ^= 3");
      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "^=");
    });
  });

  describe("Comma operator", () => {
    it("should parse comma separated expressions", () => {
      const expr = parseArithmetic("a = 1, b = 2, c = 3");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, ",");
    });
  });

  describe("Ternary conditional", () => {
    it("should parse simple ternary", () => {
      const expr = parseArithmetic("a ? b : c");
      assertEquals(expr.type, "ConditionalArithmeticExpression");
      const cond = expr as AST.ConditionalArithmeticExpression;
      assertEquals(cond.test.type, "VariableReference");
      assertEquals(cond.consequent.type, "VariableReference");
      assertEquals(cond.alternate.type, "VariableReference");
    });

    it("should parse nested ternary", () => {
      const expr = parseArithmetic("a ? b ? c : d : e");
      assertEquals(expr.type, "ConditionalArithmeticExpression");
    });
  });

  describe("Number literals", () => {
    it("should parse decimal numbers", () => {
      const expr = parseArithmetic("42");
      assertEquals(expr.type, "NumberLiteral");
      assertEquals((expr as AST.NumberLiteral).value, 42);
    });

    it("should parse hex numbers with lowercase x", () => {
      const expr = parseArithmetic("0xff");
      assertEquals(expr.type, "NumberLiteral");
      assertEquals((expr as AST.NumberLiteral).value, 255);
    });

    it("should parse hex numbers with uppercase X", () => {
      const expr = parseArithmetic("0XFF");
      assertEquals(expr.type, "NumberLiteral");
      assertEquals((expr as AST.NumberLiteral).value, 255);
    });

    it("should parse octal numbers", () => {
      const expr = parseArithmetic("0755");
      assertEquals(expr.type, "NumberLiteral");
      assertEquals((expr as AST.NumberLiteral).value, 493);
    });

    it("should parse zero", () => {
      const expr = parseArithmetic("0");
      assertEquals(expr.type, "NumberLiteral");
      assertEquals((expr as AST.NumberLiteral).value, 0);
    });
  });

  describe("Variable references", () => {
    it("should parse simple variable", () => {
      const expr = parseArithmetic("var");
      assertEquals(expr.type, "VariableReference");
      assertEquals((expr as AST.VariableReference).name, "var");
    });

    it("should parse variable with underscores", () => {
      const expr = parseArithmetic("_my_var_123");
      assertEquals(expr.type, "VariableReference");
      assertEquals((expr as AST.VariableReference).name, "_my_var_123");
    });
  });

  describe("Parenthesized expressions", () => {
    it("should parse grouped expression", () => {
      const expr = parseArithmetic("(a + b)");
      assertEquals(expr.type, "GroupedArithmeticExpression");
      const grouped = expr as AST.GroupedArithmeticExpression;
      assertEquals(grouped.expression.type, "BinaryArithmeticExpression");
    });

    it("should parse nested groups", () => {
      const expr = parseArithmetic("((a + b) * c)");
      assertEquals(expr.type, "GroupedArithmeticExpression");
    });
  });

  describe("Parameter expansion", () => {
    it("should parse simple parameter expansion", () => {
      const expr = parseArithmetic("${var}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "var");
    });

    it("should parse parameter with default :- modifier", () => {
      const expr = parseArithmetic("${var:-10}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "var");
      assertEquals(param.modifier, ":-");
    });

    it("should parse parameter with := modifier", () => {
      const expr = parseArithmetic("${var:=10}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, ":=");
    });

    it("should parse parameter with :? modifier", () => {
      const expr = parseArithmetic("${var:?error}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, ":?");
    });

    it("should parse parameter with :+ modifier", () => {
      const expr = parseArithmetic("${var:+alt}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, ":+");
    });

    it("should parse parameter with ## modifier", () => {
      const expr = parseArithmetic("${var##pattern}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "##");
    });

    it("should parse parameter with %% modifier", () => {
      const expr = parseArithmetic("${var%%pattern}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "%%");
    });

    it("should parse parameter with ^^ modifier", () => {
      const expr = parseArithmetic("${var^^}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "^^");
    });

    it("should parse parameter with ,, modifier", () => {
      const expr = parseArithmetic("${var,,}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, ",,");
    });

    it("should parse parameter with // modifier", () => {
      const expr = parseArithmetic("${var//old/new}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "//");
    });

    it("should parse parameter with /# modifier", () => {
      const expr = parseArithmetic("${var/#prefix/}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "/#");
    });

    it("should parse parameter with /% modifier", () => {
      const expr = parseArithmetic("${var/%suffix/}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "/%");
    });

    it("should parse parameter with - modifier (single char)", () => {
      const expr = parseArithmetic("${var-default}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "-");
    });

    it("should parse parameter with = modifier (single char)", () => {
      const expr = parseArithmetic("${var=value}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "=");
    });

    it("should parse parameter with ? modifier (single char)", () => {
      const expr = parseArithmetic("${var?msg}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "?");
    });

    it("should parse parameter with + modifier (single char)", () => {
      const expr = parseArithmetic("${var+alt}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "+");
    });

    it("should parse parameter with # modifier (single char)", () => {
      const expr = parseArithmetic("${var#pattern}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "#");
    });

    it("should parse parameter with % modifier (single char)", () => {
      const expr = parseArithmetic("${var%pattern}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "%");
    });

    it("should parse parameter with ^ modifier (single char)", () => {
      const expr = parseArithmetic("${var^}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "^");
    });

    it("should parse parameter with , modifier (single char)", () => {
      const expr = parseArithmetic("${var,}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, ",");
    });

    it("should parse parameter with / modifier (single char)", () => {
      const expr = parseArithmetic("${var/old/new}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "/");
    });

    it("should parse ${#var} length modifier", () => {
      const expr = parseArithmetic("${#var}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, "length");
    });

    it("should parse ${#} positional parameters count", () => {
      const expr = parseArithmetic("${#}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "#");
    });

    it("should parse ${#@} positional parameters count", () => {
      const expr = parseArithmetic("${#@}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "#@");
    });

    it("should parse ${#*} positional parameters count", () => {
      const expr = parseArithmetic("${#*}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "#*");
    });

    it("should parse ${!var} indirect expansion", () => {
      const expr = parseArithmetic("${!ref}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "!ref");
    });

    it("should parse special parameter $?", () => {
      const expr = parseArithmetic("${?}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "?");
    });

    it("should parse special parameter $$", () => {
      const expr = parseArithmetic("${$}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "$");
    });

    it("should parse special parameter $!", () => {
      const expr = parseArithmetic("${!}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "!");
    });

    it("should parse special parameter $@", () => {
      const expr = parseArithmetic("${@}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "@");
    });

    it("should parse special parameter $*", () => {
      const expr = parseArithmetic("${*}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "*");
    });

    it("should parse special parameter $-", () => {
      const expr = parseArithmetic("${-}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "-");
    });

    it("should parse positional parameter $0", () => {
      const expr = parseArithmetic("${0}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "0");
    });

    it("should parse positional parameter $1", () => {
      const expr = parseArithmetic("${1}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "1");
    });

    it("should parse array subscript", () => {
      const expr = parseArithmetic("${arr[0]}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "arr");
      assertEquals(param.subscript, "0");
    });

    it("should parse nested array subscript", () => {
      const expr = parseArithmetic("${arr[arr2[0]]}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "arr");
      assertEquals(param.subscript, "arr2[0]");
    });

    it("should parse array with modifier", () => {
      const expr = parseArithmetic("${arr[0]:-default}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "arr");
      assertEquals(param.subscript, "0");
      assertEquals(param.modifier, ":-");
    });

    it("should parse indirect array", () => {
      const expr = parseArithmetic("${!arr[0]}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.parameter, "arr");
      assertEquals(param.subscript, "0");
      assertEquals(param.indirection, true);
    });

    it("should parse nested parameter expansion", () => {
      const expr = parseArithmetic("${var} + ${other}");
      assertEquals(expr.type, "BinaryArithmeticExpression");
    });

    it("should parse modifier without argument", () => {
      const expr = parseArithmetic("${var:-}");
      assertEquals(expr.type, "ParameterExpansion");
      const param = expr as AST.ParameterExpansion;
      assertEquals(param.modifier, ":-");
    });
  });

  describe("Operator precedence", () => {
    it("should handle multiplication before addition", () => {
      const expr = parseArithmetic("2 + 3 * 4");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "+");
      assertEquals((bin.left as AST.NumberLiteral).value, 2);
      assertEquals(bin.right.type, "BinaryArithmeticExpression");
    });

    it("should handle power right-associativity", () => {
      const expr = parseArithmetic("2 ** 3 ** 2");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "**");
      assertEquals(bin.right.type, "BinaryArithmeticExpression");
    });

    it("should handle parentheses override precedence", () => {
      const expr = parseArithmetic("(2 + 3) * 4");
      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "*");
      assertEquals(bin.left.type, "GroupedArithmeticExpression");
    });
  });

  describe("Error handling", () => {
    it("should throw on unexpected token after expression", () => {
      assertThrows(() => {
        parseArithmetic("1 + 2 3");
      }, Error, "Unexpected token");
    });

    it("should throw on unknown character (SSH-530)", () => {
      // Previously unknown chars like @ were silently skipped, turning @+1 into +1
      assertThrows(() => {
        parseArithmetic("@+1");
      }, Error, "Unexpected character '@' at position 0");
    });

    it("should throw on invalid token in prefix position", () => {
      assertThrows(() => {
        parseArithmetic(")");
      }, Error, "Unexpected token in arithmetic expression");
    });

    it("should throw on missing closing parenthesis", () => {
      assertThrows(() => {
        parseArithmetic("(1 + 2");
      }, Error, "Expected RPAREN");
    });

    it("should throw on missing colon in ternary", () => {
      assertThrows(() => {
        parseArithmetic("a ? b");
      }, Error, "Expected COLON");
    });

    it("should throw on assignment to non-variable", () => {
      assertThrows(() => {
        parseArithmetic("(a + b) = 5");
      }, Error, "Invalid left-hand side of assignment");
    });

    it("should throw on assignment to literal", () => {
      assertThrows(() => {
        parseArithmetic("42 = 5");
      }, Error, "Invalid left-hand side of assignment");
    });
  });

  describe("Complex expressions", () => {
    it("should parse complex nested expression", () => {
      const expr = parseArithmetic("((a + b) * c - d) / (e % f)");
      assertEquals(expr.type, "BinaryArithmeticExpression");
    });

    it("should parse chained comparisons", () => {
      const expr = parseArithmetic("a < b && b < c && c < d");
      assertEquals(expr.type, "BinaryArithmeticExpression");
    });

    it("should parse mixed operators", () => {
      const expr = parseArithmetic("a & b | c ^ d << 2 >> 1");
      assertEquals(expr.type, "BinaryArithmeticExpression");
    });

    it("should parse multiple ternary operators", () => {
      const expr = parseArithmetic("a ? b ? c : d : e ? f : g");
      assertEquals(expr.type, "ConditionalArithmeticExpression");
    });

    it("should parse assignment in ternary", () => {
      const expr = parseArithmetic("x = a ? b : c");
      assertEquals(expr.type, "AssignmentExpression");
    });
  });

  describe("Edge cases", () => {
    it("should handle whitespace", () => {
      const expr = parseArithmetic("  a   +   b  ");
      assertEquals(expr.type, "BinaryArithmeticExpression");
    });

    it("should handle empty parameter expansion content", () => {
      const expr = parseArithmetic("${var}");
      assertEquals(expr.type, "ParameterExpansion");
    });
  });
});
