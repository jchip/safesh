/**
 * Comprehensive unit tests for the AWK parser
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { AwkParser } from "./parser.ts";
import type * as AST from "./ast.ts";

describe("AWK Parser", () => {
  describe("Program Structure", () => {
    it("should parse empty program", () => {
      const parser = new AwkParser();
      const ast = parser.parse("");
      assertEquals(ast.functions.length, 0);
      assertEquals(ast.rules.length, 0);
    });

    it("should parse simple action block", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print }");
      assertEquals(ast.rules.length, 1);
      assertEquals(ast.rules[0]?.pattern, undefined);
      assertEquals(ast.rules[0]?.action.type, "block");
    });

    it("should parse multiple rules", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`
        BEGIN { print "start" }
        { print $1 }
        END { print "end" }
      `);
      assertEquals(ast.rules.length, 3);
    });
  });

  describe("BEGIN/END Blocks", () => {
    it("should parse BEGIN block", () => {
      const parser = new AwkParser();
      const ast = parser.parse("BEGIN { print }");
      assertEquals(ast.rules.length, 1);
      assertEquals(ast.rules[0]?.pattern?.type, "begin");
    });

    it("should parse END block", () => {
      const parser = new AwkParser();
      const ast = parser.parse("END { print }");
      assertEquals(ast.rules.length, 1);
      assertEquals(ast.rules[0]?.pattern?.type, "end");
    });

    it("should parse BEGIN and END blocks", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`
        BEGIN { x = 0 }
        END { print x }
      `);
      assertEquals(ast.rules.length, 2);
      assertEquals(ast.rules[0]?.pattern?.type, "begin");
      assertEquals(ast.rules[1]?.pattern?.type, "end");
    });
  });

  describe("Pattern-Action Rules", () => {
    it("should parse regex pattern", () => {
      const parser = new AwkParser();
      const ast = parser.parse("/pattern/ { print }");
      assertEquals(ast.rules.length, 1);
      assertEquals(ast.rules[0]?.pattern?.type, "regex_pattern");
      const pattern = ast.rules[0]?.pattern as AST.AwkRegexPattern;
      assertEquals(pattern.pattern, "pattern");
    });

    it("should parse expression pattern", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 > 10 { print }");
      assertEquals(ast.rules[0]?.pattern?.type, "expr_pattern");
    });

    it("should parse range pattern with regexes", () => {
      const parser = new AwkParser();
      const ast = parser.parse("/start/, /end/ { print }");
      assertEquals(ast.rules[0]?.pattern?.type, "range");
      const pattern = ast.rules[0]?.pattern as AST.AwkRangePattern;
      assertEquals(pattern.start.type, "regex_pattern");
      assertEquals(pattern.end.type, "regex_pattern");
    });

    it("should parse range pattern with expressions", () => {
      const parser = new AwkParser();
      const ast = parser.parse("NR == 1, NR == 10 { print }");
      assertEquals(ast.rules[0]?.pattern?.type, "range");
      const pattern = ast.rules[0]?.pattern as AST.AwkRangePattern;
      assertEquals(pattern.start.type, "expr_pattern");
      assertEquals(pattern.end.type, "expr_pattern");
    });

    it("should parse pattern without action (default print)", () => {
      const parser = new AwkParser();
      const ast = parser.parse("/pattern/");
      assertEquals(ast.rules.length, 1);
      assertEquals(ast.rules[0]?.action.statements.length, 1);
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      assertEquals(stmt.type, "print");
    });
  });

  describe("Field References", () => {
    it("should parse $0 field reference", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print $0 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkFieldRef;
      assertEquals(arg.type, "field");
      assertEquals((arg.index as AST.AwkNumberLiteral).value, 0);
    });

    it("should parse $1, $2, etc.", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print $1, $2, $3 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      assertEquals(stmt.args.length, 3);
      assertEquals(stmt.args[0]?.type, "field");
      assertEquals(stmt.args[1]?.type, "field");
      assertEquals(stmt.args[2]?.type, "field");
    });

    it("should parse $NF (field by variable)", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print $NF }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkFieldRef;
      assertEquals(arg.type, "field");
      assertEquals((arg.index as AST.AwkVariable).type, "variable");
      assertEquals((arg.index as AST.AwkVariable).name, "NF");
    });

    it("should parse $(NF-1) (field by expression)", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print $(NF-1) }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkFieldRef;
      assertEquals(arg.type, "field");
      assertEquals((arg.index as AST.AwkBinaryOp).type, "binary");
    });
  });

  describe("Array Access", () => {
    it("should parse simple array access", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print arr[1] }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkArrayAccess;
      assertEquals(arg.type, "array_access");
      assertEquals(arg.array, "arr");
      assertEquals((arg.key as AST.AwkNumberLiteral).value, 1);
    });

    it("should parse array access with string key", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print arr["key"] }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkArrayAccess;
      assertEquals((arg.key as AST.AwkStringLiteral).value, "key");
    });

    it("should parse array access with expression key", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print arr[$1] }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkArrayAccess;
      assertEquals((arg.key as AST.AwkFieldRef).type, "field");
    });

    it("should parse multidimensional array (SUBSEP)", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print arr[1,2] }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkArrayAccess;
      assertEquals(arg.type, "array_access");
      // Key should be a concatenation with SUBSEP
      assertEquals((arg.key as AST.AwkBinaryOp).type, "binary");
    });
  });

  describe("Function Calls", () => {
    it("should parse function call without arguments", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print length() }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkFunctionCall;
      assertEquals(arg.type, "call");
      assertEquals(arg.name, "length");
      assertEquals(arg.args.length, 0);
    });

    it("should parse function call with arguments", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print substr($0, 1, 10) }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkFunctionCall;
      assertEquals(arg.type, "call");
      assertEquals(arg.name, "substr");
      assertEquals(arg.args.length, 3);
    });

    it("should parse nested function calls", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print toupper(substr($0, 1, 5)) }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkFunctionCall;
      assertEquals(arg.type, "call");
      assertEquals(arg.name, "toupper");
      assertEquals(arg.args[0]?.type, "call");
    });
  });

  describe("Function Definitions", () => {
    it("should parse function with no parameters", () => {
      const parser = new AwkParser();
      const ast = parser.parse("function foo() { return 1 }");
      assertEquals(ast.functions.length, 1);
      assertEquals(ast.functions[0]?.name, "foo");
      assertEquals(ast.functions[0]?.params.length, 0);
    });

    it("should parse function with parameters", () => {
      const parser = new AwkParser();
      const ast = parser.parse("function add(a, b) { return a + b }");
      assertEquals(ast.functions.length, 1);
      assertEquals(ast.functions[0]?.name, "add");
      assertEquals(ast.functions[0]?.params.length, 2);
      assertEquals(ast.functions[0]?.params[0], "a");
      assertEquals(ast.functions[0]?.params[1], "b");
    });

    it("should parse function with body", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`
        function max(a, b) {
          if (a > b) return a
          else return b
        }
      `);
      assertEquals(ast.functions[0]?.body.statements.length, 1);
      assertEquals(ast.functions[0]?.body.statements[0]?.type, "if");
    });
  });

  describe("Print Statements", () => {
    it("should parse print with no arguments (prints $0)", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      assertEquals(stmt.type, "print");
      assertEquals(stmt.args.length, 1);
      assertEquals(stmt.args[0]?.type, "field");
    });

    it("should parse print with multiple arguments", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print $1, $2, $3 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      assertEquals(stmt.args.length, 3);
    });

    it("should parse print with output redirection", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print $0 > "output.txt" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      assertEquals(stmt.output?.redirect, ">");
      assertEquals((stmt.output?.file as AST.AwkStringLiteral).value, "output.txt");
    });

    it("should parse print with append redirection", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print $0 >> "output.txt" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      assertEquals(stmt.output?.redirect, ">>");
    });

    it("should parse printf with format", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ printf "%s: %d\\n", $1, $2 }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintfStmt;
      assertEquals(stmt.type, "printf");
      assertEquals(stmt.format.type, "string");
      assertEquals(stmt.args.length, 2);
    });

    it("should parse printf with output redirection", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ printf "%s\\n", $1 > "out.txt" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintfStmt;
      assertEquals(stmt.output?.redirect, ">");
    });
  });

  describe("Expression Parsing - Literals", () => {
    it("should parse number literals", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 42 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkNumberLiteral;
      assertEquals(arg.type, "number");
      assertEquals(arg.value, 42);
    });

    it("should parse floating point numbers", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 3.14 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkNumberLiteral;
      assertEquals(arg.value, 3.14);
    });

    it("should parse string literals", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print "hello" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkStringLiteral;
      assertEquals(arg.type, "string");
      assertEquals(arg.value, "hello");
    });

    it("should parse regex literals", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print /pattern/ }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkRegexLiteral;
      assertEquals(arg.type, "regex");
      assertEquals(arg.pattern, "pattern");
    });

    it("should parse variables", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const arg = stmt.args[0] as AST.AwkVariable;
      assertEquals(arg.type, "variable");
      assertEquals(arg.name, "x");
    });
  });

  describe("Expression Parsing - Arithmetic", () => {
    it("should parse addition", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 1 + 2 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.type, "binary");
      assertEquals(expr.operator, "+");
    });

    it("should parse subtraction", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 5 - 3 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.operator, "-");
    });

    it("should parse multiplication", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 2 * 3 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.operator, "*");
    });

    it("should parse division", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 10 / 2 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.operator, "/");
    });

    it("should parse modulo", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 10 % 3 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.operator, "%");
    });

    it("should parse exponentiation", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 2 ^ 3 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.operator, "^");
    });
  });

  describe("Expression Parsing - Precedence", () => {
    it("should respect multiplication over addition", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 2 + 3 * 4 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      // Should be: 2 + (3 * 4)
      assertEquals(expr.operator, "+");
      assertEquals((expr.left as AST.AwkNumberLiteral).value, 2);
      assertEquals((expr.right as AST.AwkBinaryOp).operator, "*");
    });

    it("should respect parentheses", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print (2 + 3) * 4 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      // Should be: (2 + 3) * 4
      assertEquals(expr.operator, "*");
      assertEquals((expr.left as AST.AwkBinaryOp).operator, "+");
    });

    it("should respect exponentiation over multiplication", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 2 * 3 ^ 2 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      // Should be: 2 * (3 ^ 2)
      assertEquals(expr.operator, "*");
      assertEquals((expr.right as AST.AwkBinaryOp).operator, "^");
    });

    it("should parse right-associative exponentiation", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print 2 ^ 3 ^ 2 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      // Should be: 2 ^ (3 ^ 2)
      assertEquals(expr.operator, "^");
      assertEquals((expr.left as AST.AwkNumberLiteral).value, 2);
      assertEquals((expr.right as AST.AwkBinaryOp).operator, "^");
    });
  });

  describe("Expression Parsing - Comparison", () => {
    it("should parse less than", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 < 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "<");
    });

    it("should parse less than or equal", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 <= 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "<=");
    });

    it("should parse greater than", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 > 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, ">");
    });

    it("should parse greater than or equal", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 >= 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, ">=");
    });

    it("should parse equality", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 == 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "==");
    });

    it("should parse inequality", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 != 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "!=");
    });

    it("should parse regex match", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 ~ /pattern/ { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "~");
    });

    it("should parse regex not match", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 !~ /pattern/ { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "!~");
    });
  });

  describe("Expression Parsing - Logical", () => {
    it("should parse logical AND", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 > 5 && $2 < 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "&&");
    });

    it("should parse logical OR", () => {
      const parser = new AwkParser();
      const ast = parser.parse("$1 > 5 || $2 < 10 { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      assertEquals(expr.operator, "||");
    });

    it("should parse logical NOT", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print !x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkUnaryOp;
      assertEquals(expr.type, "unary");
      assertEquals(expr.operator, "!");
    });

    it("should respect AND precedence over OR", () => {
      const parser = new AwkParser();
      const ast = parser.parse("a || b && c { print }");
      const pattern = ast.rules[0]?.pattern as AST.AwkExprPattern;
      const expr = pattern.expression as AST.AwkBinaryOp;
      // Should be: a || (b && c)
      assertEquals(expr.operator, "||");
      assertEquals((expr.right as AST.AwkBinaryOp).operator, "&&");
    });
  });

  describe("Expression Parsing - Unary", () => {
    it("should parse unary minus", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print -x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkUnaryOp;
      assertEquals(expr.type, "unary");
      assertEquals(expr.operator, "-");
    });

    it("should parse unary plus", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print +x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkUnaryOp;
      assertEquals(expr.operator, "+");
    });

    it("should parse pre-increment", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print ++x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkPreIncrement;
      assertEquals(expr.type, "pre_increment");
      assertEquals((expr.operand as AST.AwkVariable).name, "x");
    });

    it("should parse pre-decrement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print --x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkPreDecrement;
      assertEquals(expr.type, "pre_decrement");
    });

    it("should parse post-increment", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print x++ }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkPostIncrement;
      assertEquals(expr.type, "post_increment");
    });

    it("should parse post-decrement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print x-- }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkPostDecrement;
      assertEquals(expr.type, "post_decrement");
    });
  });

  describe("Expression Parsing - Assignment", () => {
    it("should parse simple assignment", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x = 10 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.type, "assignment");
      assertEquals(expr.operator, "=");
      assertEquals((expr.target as AST.AwkVariable).name, "x");
    });

    it("should parse += operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x += 5 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.operator, "+=");
    });

    it("should parse -= operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x -= 5 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.operator, "-=");
    });

    it("should parse *= operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x *= 5 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.operator, "*=");
    });

    it("should parse /= operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x /= 5 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.operator, "/=");
    });

    it("should parse %= operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x %= 5 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.operator, "%=");
    });

    it("should parse ^= operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ x ^= 2 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals(expr.operator, "^=");
    });

    it("should parse field assignment", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ $1 = 10 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals((expr.target as AST.AwkFieldRef).type, "field");
    });

    it("should parse array assignment", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ arr[1] = 10 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkAssignment;
      assertEquals((expr.target as AST.AwkArrayAccess).type, "array_access");
    });
  });

  describe("Expression Parsing - Ternary", () => {
    it("should parse ternary operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print x > 0 ? x : -x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkTernaryOp;
      assertEquals(expr.type, "ternary");
      assertExists(expr.condition);
      assertExists(expr.consequent);
      assertExists(expr.alternate);
    });

    it("should parse nested ternary", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print x > 0 ? 1 : x < 0 ? -1 : 0 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkTernaryOp;
      assertEquals(expr.type, "ternary");
      assertEquals((expr.alternate as AST.AwkTernaryOp).type, "ternary");
    });
  });

  describe("Expression Parsing - String Concatenation", () => {
    it("should parse implicit string concatenation", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print "hello" "world" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.type, "binary");
      assertEquals(expr.operator, " ");
    });

    it("should parse variable concatenation", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print x y }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkBinaryOp;
      assertEquals(expr.operator, " ");
    });
  });

  describe("Expression Parsing - In Operator", () => {
    it("should parse in operator", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ print ("key" in arr) }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      const expr = stmt.args[0] as AST.AwkInExpr;
      assertEquals(expr.type, "in");
      assertEquals(expr.array, "arr");
    });
  });

  describe("Control Flow - If Statements", () => {
    it("should parse simple if statement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ if (x > 0) print x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkIfStmt;
      assertEquals(stmt.type, "if");
      assertExists(stmt.condition);
      assertExists(stmt.consequent);
      assertEquals(stmt.alternate, undefined);
    });

    it("should parse if-else statement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ if (x > 0) print x; else print -x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkIfStmt;
      assertExists(stmt.alternate);
    });

    it("should parse if-else with blocks", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`{
        if (x > 0) {
          print "positive"
        } else {
          print "negative"
        }
      }`);
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkIfStmt;
      assertEquals((stmt.consequent as AST.AwkBlock).type, "block");
      assertEquals((stmt.alternate as AST.AwkBlock).type, "block");
    });

    it("should parse nested if statements", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`{
        if (x > 0) {
          if (x > 10) print "big"
          else print "small"
        }
      }`);
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkIfStmt;
      const block = stmt.consequent as AST.AwkBlock;
      assertEquals(block.statements[0]?.type, "if");
    });
  });

  describe("Control Flow - While Loops", () => {
    it("should parse while loop", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ while (x < 10) x++ }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkWhileStmt;
      assertEquals(stmt.type, "while");
      assertExists(stmt.condition);
      assertExists(stmt.body);
    });

    it("should parse while loop with block", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`{
        while (x < 10) {
          print x
          x++
        }
      }`);
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkWhileStmt;
      assertEquals((stmt.body as AST.AwkBlock).type, "block");
      assertEquals((stmt.body as AST.AwkBlock).statements.length, 2);
    });
  });

  describe("Control Flow - Do-While Loops", () => {
    it("should parse do-while loop", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ do x++ while (x < 10) }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkDoWhileStmt;
      assertEquals(stmt.type, "do_while");
      assertExists(stmt.body);
      assertExists(stmt.condition);
    });

    it("should parse do-while with block", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`{
        do {
          print x
          x++
        } while (x < 10)
      }`);
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkDoWhileStmt;
      assertEquals((stmt.body as AST.AwkBlock).type, "block");
    });
  });

  describe("Control Flow - For Loops", () => {
    it("should parse C-style for loop", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ for (i = 0; i < 10; i++) print i }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkForStmt;
      assertEquals(stmt.type, "for");
      assertExists(stmt.init);
      assertExists(stmt.condition);
      assertExists(stmt.update);
    });

    it("should parse for loop without init", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ for (; i < 10; i++) print i }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkForStmt;
      assertEquals(stmt.init, undefined);
    });

    it("should parse for loop without condition", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ for (i = 0; ; i++) { if (i >= 10) break; print i } }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkForStmt;
      assertEquals(stmt.condition, undefined);
    });

    it("should parse for loop without update", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ for (i = 0; i < 10; ) { print i; i++ } }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkForStmt;
      assertEquals(stmt.update, undefined);
    });

    it("should parse for-in loop", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ for (key in arr) print key }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkForInStmt;
      assertEquals(stmt.type, "for_in");
      assertEquals(stmt.variable, "key");
      assertEquals(stmt.array, "arr");
    });
  });

  describe("Control Flow - Break and Continue", () => {
    it("should parse break statement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ while (1) { if (x > 10) break; x++ } }");
      const whileStmt = ast.rules[0]?.action.statements[0] as AST.AwkWhileStmt;
      const block = whileStmt.body as AST.AwkBlock;
      const ifStmt = block.statements[0] as AST.AwkIfStmt;
      assertEquals((ifStmt.consequent as AST.AwkBreakStmt).type, "break");
    });

    it("should parse continue statement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ while (1) { if (x < 0) continue; x-- } }");
      const whileStmt = ast.rules[0]?.action.statements[0] as AST.AwkWhileStmt;
      const block = whileStmt.body as AST.AwkBlock;
      const ifStmt = block.statements[0] as AST.AwkIfStmt;
      assertEquals((ifStmt.consequent as AST.AwkContinueStmt).type, "continue");
    });
  });

  describe("Control Flow - Next and Exit", () => {
    it("should parse next statement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ if (x < 0) next; print x }");
      const ifStmt = ast.rules[0]?.action.statements[0] as AST.AwkIfStmt;
      assertEquals((ifStmt.consequent as AST.AwkNextStmt).type, "next");
    });

    it("should parse nextfile statement", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ if (x < 0) nextfile; print x }");
      const ifStmt = ast.rules[0]?.action.statements[0] as AST.AwkIfStmt;
      assertEquals((ifStmt.consequent as AST.AwkNextFileStmt).type, "nextfile");
    });

    it("should parse exit without code", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ exit }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExitStmt;
      assertEquals(stmt.type, "exit");
      assertEquals(stmt.code, undefined);
    });

    it("should parse exit with code", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ exit 1 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExitStmt;
      assertExists(stmt.code);
      assertEquals((stmt.code as AST.AwkNumberLiteral).value, 1);
    });

    it("should parse return without value", () => {
      const parser = new AwkParser();
      const ast = parser.parse("function f() { return }");
      const block = ast.functions[0]?.body;
      assertExists(block);
      const stmt = block.statements[0] as AST.AwkReturnStmt;
      assertEquals(stmt.type, "return");
      assertEquals(stmt.value, undefined);
    });

    it("should parse return with value", () => {
      const parser = new AwkParser();
      const ast = parser.parse("function f() { return 42 }");
      const block = ast.functions[0]?.body;
      assertExists(block);
      const stmt = block.statements[0] as AST.AwkReturnStmt;
      assertExists(stmt.value);
    });
  });

  describe("Control Flow - Delete", () => {
    it("should parse delete array element", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ delete arr[1] }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkDeleteStmt;
      assertEquals(stmt.type, "delete");
      assertEquals((stmt.target as AST.AwkArrayAccess).type, "array_access");
    });

    it("should parse delete array", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ delete arr }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkDeleteStmt;
      assertEquals((stmt.target as AST.AwkVariable).type, "variable");
    });
  });

  describe("Special Features - Getline", () => {
    it("should parse getline without arguments", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ getline }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkGetline;
      assertEquals(expr.type, "getline");
      assertEquals(expr.variable, undefined);
      assertEquals(expr.file, undefined);
    });

    it("should parse getline with variable", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ getline x }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkGetline;
      assertEquals(expr.variable, "x");
    });

    it("should parse getline from file", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ getline < "input.txt" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkGetline;
      assertExists(expr.file);
    });

    it("should parse getline variable from file", () => {
      const parser = new AwkParser();
      const ast = parser.parse('{ getline x < "input.txt" }');
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkExpressionStmt;
      const expr = stmt.expression as AST.AwkGetline;
      assertEquals(expr.variable, "x");
      assertExists(expr.file);
    });
  });

  describe("Error Cases", () => {
    it("should throw on unclosed block", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ print"),
        Error,
        "Unexpected token: EOF"
      );
    });

    it("should throw on unclosed if", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ if (x > 0) "),
        Error
      );
    });

    it("should throw on unclosed while", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ while (x < 10) "),
        Error
      );
    });

    it("should throw on unclosed for", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ for (i = 0; i < 10; i++) "),
        Error
      );
    });

    it("should throw on invalid assignment target", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ 42 = x }"),
        Error,
        "Invalid assignment target"
      );
    });

    it("should throw on invalid delete target", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ delete 42 }"),
        Error,
        "delete requires"
      );
    });

    it("should throw on unexpected token", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("{ } }"),
        Error
      );
    });

    it("should throw on missing function name", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("function () { }"),
        Error,
        "Expected"
      );
    });

    it("should throw on missing function body", () => {
      const parser = new AwkParser();
      assertThrows(
        () => parser.parse("function f()"),
        Error
      );
    });
  });

  describe("Complex Examples", () => {
    it("should parse script with multiple rules and functions", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`
        function max(a, b) {
          return a > b ? a : b
        }

        BEGIN {
          sum = 0
          count = 0
        }

        $1 > 0 {
          sum += $1
          count++
        }

        END {
          if (count > 0) {
            print "Average:", sum / count
            print "Max:", max(sum, count)
          }
        }
      `);

      assertEquals(ast.functions.length, 1);
      assertEquals(ast.rules.length, 3);
      assertEquals(ast.rules[0]?.pattern?.type, "begin");
      assertEquals(ast.rules[1]?.pattern?.type, "expr_pattern");
      assertEquals(ast.rules[2]?.pattern?.type, "end");
    });

    it("should parse complex expression with multiple operators", () => {
      const parser = new AwkParser();
      const ast = parser.parse("{ print (x + y) * z / 2 ^ 3 - w % 5 }");
      const stmt = ast.rules[0]?.action.statements[0] as AST.AwkPrintStmt;
      // Just verify it parses without error
      assertEquals(stmt.type, "print");
    });

    it("should parse nested loops and conditions", () => {
      const parser = new AwkParser();
      const ast = parser.parse(`{
        for (i = 0; i < 10; i++) {
          for (j = 0; j < 10; j++) {
            if (i == j) continue
            if (i + j > 10) break
            print i, j
          }
        }
      }`);

      const forStmt = ast.rules[0]?.action.statements[0] as AST.AwkForStmt;
      assertEquals(forStmt.type, "for");
      const innerBlock = forStmt.body as AST.AwkBlock;
      assertEquals(innerBlock.statements[0]?.type, "for");
    });
  });
});
