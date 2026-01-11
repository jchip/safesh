/**
 * Tests for new parser features (SSH-253 to SSH-257)
 *
 * SSH-253: [[ ... ]] test expression parsing
 * SSH-254: (( ... )) arithmetic command parsing
 * SSH-255: Pratt parser for arithmetic expressions
 * SSH-256: Improved parameter expansion parsing
 * SSH-257: {var}>file FD variable redirections
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { parse } from "./parser.ts";
import { parseArithmetic } from "./arithmetic-parser.ts";
import type * as AST from "./ast.ts";

describe("New Parser Features", () => {
  describe("SSH-253: [[ ... ]] test expressions", () => {
    it("should parse unary file test -f", () => {
      const ast = parse("[[ -f /etc/passwd ]]");
      const stmt = ast.body[0] as AST.TestCommand;

      assertEquals(stmt.type, "TestCommand");
      assertEquals(stmt.expression.type, "UnaryTest");
      const expr = stmt.expression as AST.UnaryTest;
      assertEquals(expr.operator, "-f");
      assertEquals((expr.argument as AST.Word).value, "/etc/passwd");
    });

    it("should parse binary string equality ==", () => {
      const ast = parse('[[ $var == "value" ]]');
      const stmt = ast.body[0] as AST.TestCommand;

      assertEquals(stmt.type, "TestCommand");
      assertEquals(stmt.expression.type, "BinaryTest");
      const expr = stmt.expression as AST.BinaryTest;
      assertEquals(expr.operator, "==");
    });

    it("should parse binary numeric comparison -eq", () => {
      const ast = parse("[[ $a -eq $b ]]");
      const stmt = ast.body[0] as AST.TestCommand;
      const expr = stmt.expression as AST.BinaryTest;

      assertEquals(expr.operator, "-eq");
    });

    it("should parse logical AND inside test", () => {
      const ast = parse("[[ -f /etc/passwd && -r /etc/passwd ]]");
      const stmt = ast.body[0] as AST.TestCommand;

      assertEquals(stmt.expression.type, "LogicalTest");
      const expr = stmt.expression as AST.LogicalTest;
      assertEquals(expr.operator, "&&");
    });

    it("should parse logical OR inside test", () => {
      const ast = parse("[[ -z $var || $var == default ]]");
      const stmt = ast.body[0] as AST.TestCommand;

      assertEquals(stmt.expression.type, "LogicalTest");
      const expr = stmt.expression as AST.LogicalTest;
      assertEquals(expr.operator, "||");
    });

    it("should parse negation with !", () => {
      const ast = parse("[[ ! -f /tmp/file ]]");
      const stmt = ast.body[0] as AST.TestCommand;

      assertEquals(stmt.expression.type, "LogicalTest");
      const expr = stmt.expression as AST.LogicalTest;
      assertEquals(expr.operator, "!");
    });

    it("should parse regex match =~", () => {
      const ast = parse('[[ $str =~ ^[0-9]+$ ]]');
      const stmt = ast.body[0] as AST.TestCommand;
      const expr = stmt.expression as AST.BinaryTest;

      assertEquals(expr.operator, "=~");
    });
  });

  describe("SSH-254: (( ... )) arithmetic commands", () => {
    it("should parse simple arithmetic command", () => {
      const ast = parse("(( x = 5 ))");
      const stmt = ast.body[0] as AST.ArithmeticCommand;

      assertEquals(stmt.type, "ArithmeticCommand");
      assertEquals(stmt.expression.type, "AssignmentExpression");
    });

    it("should parse postfix increment", () => {
      const ast = parse("(( count++ ))");
      const stmt = ast.body[0] as AST.ArithmeticCommand;

      assertEquals(stmt.expression.type, "UnaryArithmeticExpression");
      const expr = stmt.expression as AST.UnaryArithmeticExpression;
      assertEquals(expr.operator, "++");
      assertEquals(expr.prefix, false);
    });

    it("should parse prefix decrement", () => {
      const ast = parse("(( --count ))");
      const stmt = ast.body[0] as AST.ArithmeticCommand;

      assertEquals(stmt.expression.type, "UnaryArithmeticExpression");
      const expr = stmt.expression as AST.UnaryArithmeticExpression;
      assertEquals(expr.operator, "--");
      assertEquals(expr.prefix, true);
    });

    it("should parse C-style for loop", () => {
      const ast = parse("for (( i=0; i<10; i++ )); do\n  echo loop\ndone");
      const stmt = ast.body[0] as AST.CStyleForStatement;

      assertEquals(stmt.type, "CStyleForStatement");
      assertExists(stmt.init);
      assertExists(stmt.test);
      assertExists(stmt.update);
      assertEquals(stmt.body.length, 1);
    });

    it("should parse C-style for loop with empty parts", () => {
      const ast = parse("for (( ; ; )); do\n  echo infinite\ndone");
      const stmt = ast.body[0] as AST.CStyleForStatement;

      assertEquals(stmt.init, null);
      assertEquals(stmt.test, null);
      assertEquals(stmt.update, null);
    });
  });

  describe("SSH-255: Pratt parser for arithmetic", () => {
    it("should parse simple addition", () => {
      const expr = parseArithmetic("a + b");

      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "+");
    });

    it("should parse multiplication with higher precedence", () => {
      const expr = parseArithmetic("a + b * c");

      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "+");
      assertEquals(bin.right.type, "BinaryArithmeticExpression");
      const right = bin.right as AST.BinaryArithmeticExpression;
      assertEquals(right.operator, "*");
    });

    it("should parse parenthesized expressions", () => {
      const expr = parseArithmetic("(a + b) * c");

      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "*");
      assertEquals(bin.left.type, "GroupedArithmeticExpression");
    });

    it("should parse ternary conditional", () => {
      const expr = parseArithmetic("a ? b : c");

      assertEquals(expr.type, "ConditionalArithmeticExpression");
      const cond = expr as AST.ConditionalArithmeticExpression;
      assertEquals(cond.test.type, "VariableReference");
      assertEquals(cond.consequent.type, "VariableReference");
      assertEquals(cond.alternate.type, "VariableReference");
    });

    it("should parse right-associative exponentiation", () => {
      const expr = parseArithmetic("2 ** 3 ** 2");

      assertEquals(expr.type, "BinaryArithmeticExpression");
      const bin = expr as AST.BinaryArithmeticExpression;
      assertEquals(bin.operator, "**");
      // Right-associative: 2 ** (3 ** 2) = 2 ** 9 = 512
      assertEquals(bin.right.type, "BinaryArithmeticExpression");
    });

    it("should parse unary minus", () => {
      const expr = parseArithmetic("-x");

      assertEquals(expr.type, "UnaryArithmeticExpression");
      const un = expr as AST.UnaryArithmeticExpression;
      assertEquals(un.operator, "-");
      assertEquals(un.prefix, true);
    });

    it("should parse bitwise operators", () => {
      const expr = parseArithmetic("a & b | c ^ d");

      assertEquals(expr.type, "BinaryArithmeticExpression");
    });

    it("should parse compound assignment", () => {
      const expr = parseArithmetic("x += 5");

      assertEquals(expr.type, "AssignmentExpression");
      const assign = expr as AST.AssignmentExpression;
      assertEquals(assign.operator, "+=");
    });

    it("should parse hex and octal numbers", () => {
      const hexExpr = parseArithmetic("0xFF");
      assertEquals(hexExpr.type, "NumberLiteral");
      assertEquals((hexExpr as AST.NumberLiteral).value, 255);

      const octExpr = parseArithmetic("0777");
      assertEquals(octExpr.type, "NumberLiteral");
      assertEquals((octExpr as AST.NumberLiteral).value, 511);
    });
  });

  describe("SSH-256: Parameter expansion parsing", () => {
    it("should parse simple ${var}", () => {
      const ast = parse('echo ${VAR}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;
      const arg = cmd.args[0] as AST.Word;
      const part = arg.parts[0] as AST.ParameterExpansion;

      assertEquals(part.type, "ParameterExpansion");
      assertEquals(part.parameter, "VAR");
    });

    it("should parse ${var:-default}", () => {
      const ast = parse('echo ${VAR:-default}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;
      const arg = cmd.args[0] as AST.Word;
      const part = arg.parts[0] as AST.ParameterExpansion;

      assertEquals(part.modifier, ":-");
      assertEquals((part.modifierArg as AST.Word).value, "default");
    });

    it("should parse ${#var} length", () => {
      const ast = parse('echo ${#VAR}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;
      const arg = cmd.args[0] as AST.Word;
      const part = arg.parts[0] as AST.ParameterExpansion;

      assertEquals(part.modifier, "length");
    });

    it("should parse ${var[@]} array", () => {
      const ast = parse('echo ${arr[@]}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;
      const arg = cmd.args[0] as AST.Word;
      const part = arg.parts[0] as AST.ParameterExpansion;

      assertEquals(part.parameter, "arr[@]");
    });

    it("should parse ${!var} indirect expansion", () => {
      const ast = parse('echo ${!ref}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;
      const arg = cmd.args[0] as AST.Word;
      const part = arg.parts[0] as AST.ParameterExpansion;

      assertEquals(part.parameter, "!ref");
    });

    it("should parse ${var//pattern/replacement}", () => {
      const ast = parse('echo ${str//old/new}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;
      const arg = cmd.args[0] as AST.Word;
      const part = arg.parts[0] as AST.ParameterExpansion;

      assertEquals(part.modifier, "//");
    });
  });

  describe("SSH-257: {var}>file FD variable redirections", () => {
    it("should parse {fd}>file redirection", () => {
      const ast = parse('exec {fd}>tempfile');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;

      assertEquals(cmd.redirects.length, 1);
      assertEquals(cmd.redirects[0]?.fdVar, "fd");
      assertEquals(cmd.redirects[0]?.operator, ">");
    });

    it("should parse {fd}<file redirection", () => {
      const ast = parse('exec {input}<inputfile');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.fdVar, "input");
      assertEquals(cmd.redirects[0]?.operator, "<");
    });

    it("should parse {fd}>&- close syntax", () => {
      const ast = parse('exec {fd}>&-');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.fdVar, "fd");
      assertEquals(cmd.redirects[0]?.operator, ">&");
    });

    it("should not confuse brace expansion with FD var", () => {
      const ast = parse('echo {a,b,c}');
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;

      // {a,b,c} is an argument, not a redirect
      assertEquals(cmd.redirects.length, 0);
      assertEquals(cmd.args.length, 1);
    });
  });
});
