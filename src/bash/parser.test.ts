/**
 * Comprehensive unit tests for the bash parser
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse, parseWithRecovery } from "./parser.ts";
import type * as AST from "./ast.ts";

/**
 * Helper to extract the first command from a program's body.
 * Control flow statements (if, for, while, etc.) are now wrapped in Pipelines
 * so they can participate in logical operators (&&, ||) and pipes (|).
 */
function getFirstStatement(ast: AST.Program): AST.Statement {
  const first = ast.body[0];
  if (!first) throw new Error("No statements in program");
  if (first.type === "Pipeline" && first.commands.length === 1 && first.operator === null) {
    return first.commands[0]! as AST.Statement;
  }
  return first;
}

describe("Bash Parser", () => {
  describe("Simple Commands", () => {
    it("should parse a simple command", () => {
      const ast = parse("ls");
      assertEquals(ast.type, "Program");
      assertEquals(ast.body.length, 1);

      const pipeline = ast.body[0] as AST.Pipeline;
      assertEquals(pipeline.type, "Pipeline");
      assertEquals(pipeline.commands.length, 1);

      const cmd = pipeline.commands[0] as AST.Command;
      assertEquals(cmd.type, "Command");
      assertEquals((cmd.name as AST.Word).value, "ls");
      assertEquals(cmd.args.length, 0);
    });

    it("should parse a command with arguments", () => {
      const ast = parse("ls -la /tmp");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals((cmd.name as AST.Word).value, "ls");
      assertEquals(cmd.args.length, 2);
      assertEquals(cmd.args[0]?.type, "Word");
      assertEquals((cmd.args[0] as AST.Word).value, "-la");
      assertEquals((cmd.args[1] as AST.Word).value, "/tmp");
    });

    it("should parse a command with quoted arguments", () => {
      const ast = parse('echo "hello world"');
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals((cmd.name as AST.Word).value, "echo");
      assertEquals(cmd.args.length, 1);
      assertEquals((cmd.args[0] as AST.Word).value, "hello world");
      assertEquals((cmd.args[0] as AST.Word).quoted, true);
    });

    it("should parse single-quoted arguments", () => {
      const ast = parse("echo 'hello world'");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals((cmd.args[0] as AST.Word).value, "hello world");
      assertEquals((cmd.args[0] as AST.Word).singleQuoted, true);
    });
  });

  describe("Pipelines", () => {
    it("should parse a simple pipeline", () => {
      const ast = parse("ls | grep test");
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.type, "Pipeline");
      assertEquals(pipeline.commands.length, 2);
      assertEquals(pipeline.operator, "|");

      const cmd1 = pipeline.commands[0] as AST.Command;
      const cmd2 = pipeline.commands[1] as AST.Command;

      assertEquals((cmd1.name as AST.Word).value, "ls");
      assertEquals((cmd2.name as AST.Word).value, "grep");
      assertEquals((cmd2.args[0] as AST.Word).value, "test");
    });

    it("should parse multiple pipes", () => {
      const ast = parse("cat file | grep foo | sort");
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.commands.length, 3);
      assertEquals(((pipeline.commands[0] as AST.Command).name as AST.Word).value, "cat");
      assertEquals(((pipeline.commands[1] as AST.Command).name as AST.Word).value, "grep");
      assertEquals(((pipeline.commands[2] as AST.Command).name as AST.Word).value, "sort");
    });
  });

  describe("Logical Operators", () => {
    it("should parse AND operator", () => {
      const ast = parse("cmd1 && cmd2");
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.operator, "&&");
      assertEquals(pipeline.commands.length, 2);
      // Each operand of && is now a Pipeline (for proper precedence handling)
      const left = pipeline.commands[0] as AST.Pipeline;
      const right = pipeline.commands[1] as AST.Pipeline;
      assertEquals(((left.commands[0] as AST.Command).name as AST.Word).value, "cmd1");
      assertEquals(((right.commands[0] as AST.Command).name as AST.Word).value, "cmd2");
    });

    it("should parse OR operator", () => {
      const ast = parse("cmd1 || cmd2");
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.operator, "||");
      assertEquals(pipeline.commands.length, 2);
    });

    it("should parse semicolon separator", () => {
      const ast = parse("cmd1; cmd2");
      assertEquals(ast.body.length, 2);

      const p1 = ast.body[0] as AST.Pipeline;
      const p2 = ast.body[1] as AST.Pipeline;

      assertEquals(((p1.commands[0] as AST.Command).name as AST.Word).value, "cmd1");
      assertEquals(((p2.commands[0] as AST.Command).name as AST.Word).value, "cmd2");
    });

    it("should parse background operator", () => {
      const ast = parse("cmd &");
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.background, true);
      // For single-command background, operator is null (& is a flag, not an operator)
      assertEquals(pipeline.operator, null);
    });
  });

  describe("Redirections", () => {
    it("should parse output redirection", () => {
      const ast = parse("echo hello > file.txt");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects.length, 1);
      assertEquals(cmd.redirects[0]?.operator, ">");
      assertEquals((cmd.redirects[0]?.target as AST.Word).value, "file.txt");
    });

    it("should parse append redirection", () => {
      const ast = parse("echo hello >> file.txt");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.operator, ">>");
    });

    it("should parse input redirection", () => {
      const ast = parse("cat < input.txt");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.operator, "<");
      assertEquals((cmd.redirects[0]?.target as AST.Word).value, "input.txt");
    });

    it("should parse stderr redirection", () => {
      const ast = parse("cmd 2> error.log");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.fd, 2);
      assertEquals(cmd.redirects[0]?.operator, ">");
    });

    it("should parse combined stdout/stderr redirection", () => {
      const ast = parse("cmd &> all.log");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.operator, "&>");
    });

    it("should parse multiple redirections", () => {
      const ast = parse("cmd < in.txt > out.txt 2> err.txt");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects.length, 3);
      assertEquals(cmd.redirects[0]?.operator, "<");
      assertEquals(cmd.redirects[1]?.operator, ">");
      assertEquals(cmd.redirects[2]?.operator, ">");
      assertEquals(cmd.redirects[2]?.fd, 2);
    });

    it("should parse here-document (<<)", () => {
      const ast = parse("cat <<EOF\nHello World\nEOF");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects.length, 1);
      assertEquals(cmd.redirects[0]?.operator, "<<");
      assertEquals((cmd.redirects[0]?.target as AST.Word).value, "Hello World\n");
    });

    it("should parse here-document with tab stripping (<<-)", () => {
      const ast = parse("cat <<-EOF\n\tHello World\n\tWith Tabs\nEOF");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects.length, 1);
      assertEquals(cmd.redirects[0]?.operator, "<<-");
      assertEquals((cmd.redirects[0]?.target as AST.Word).value, "Hello World\nWith Tabs\n");
    });

    it("should parse here-document with empty content", () => {
      const ast = parse("cat <<EOF\nEOF");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects.length, 1);
      assertEquals(cmd.redirects[0]?.operator, "<<");
      assertEquals((cmd.redirects[0]?.target as AST.Word).value, "");
    });

    it("should parse here-document with multiple lines", () => {
      const ast = parse("cat <<EOF\nLine 1\nLine 2\nLine 3\nEOF");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.operator, "<<");
      assertEquals((cmd.redirects[0]?.target as AST.Word).value, "Line 1\nLine 2\nLine 3\n");
    });

    it("should parse here-document in pipeline", () => {
      const ast = parse(`cat <<'EOF' | jq -r '.commits[]'
{
  "commits": [
    {"id": 1}
  ]
}
EOF`);
      const pipeline = ast.body[0] as AST.Pipeline;
      assertEquals(pipeline.commands.length, 2);

      const catCmd = pipeline.commands[0] as AST.Command;
      assertEquals((catCmd.name as AST.Word).value, "cat");
      assertEquals(catCmd.redirects.length, 1);
      assertEquals(catCmd.redirects[0]?.operator, "<<");
      const heredocContent = (catCmd.redirects[0]?.target as AST.Word).value;
      assertEquals(heredocContent, '{\n  "commits": [\n    {"id": 1}\n  ]\n}\n');

      const jqCmd = pipeline.commands[1] as AST.Command;
      assertEquals((jqCmd.name as AST.Word).value, "jq");
    });

    it("should parse here-document with JSON content containing braces", () => {
      const ast = parse(`cat <<'EOF'
{
  "key": "value"
}
EOF`);
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.redirects[0]?.operator, "<<");
      const content = (cmd.redirects[0]?.target as AST.Word).value;
      assertEquals(content, '{\n  "key": "value"\n}\n');
    });
  });

  describe("Variable Assignments", () => {
    it("should parse simple variable assignment", () => {
      const ast = parse("NAME=value");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments.length, 1);
      assertEquals(cmd.assignments[0]?.name, "NAME");
      assertEquals(cmd.assignments[0]?.value.type, "Word");
      assertEquals((cmd.assignments[0]?.value as AST.Word).value, "value");
    });

    it("should parse assignment with quoted value", () => {
      const ast = parse('NAME="hello world"');
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments[0]?.name, "NAME");
      assertEquals((cmd.assignments[0]?.value as AST.Word).value, "hello world");
    });

    it("should parse assignment with empty value", () => {
      const ast = parse("NAME=");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments[0]?.name, "NAME");
      assertEquals((cmd.assignments[0]?.value as AST.Word).value, "");
    });

    it("should parse assignment with equals in value", () => {
      const ast = parse("URL=http://example.com?foo=bar");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments[0]?.name, "URL");
      assertEquals(
        (cmd.assignments[0]?.value as AST.Word).value,
        "http://example.com?foo=bar"
      );
    });

    it("should parse command with leading assignments", () => {
      const ast = parse("VAR=value cmd arg");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments.length, 1);
      assertEquals(cmd.assignments[0]?.name, "VAR");
      assertEquals((cmd.name as AST.Word).value, "cmd");
      assertEquals((cmd.args[0] as AST.Word).value, "arg");
    });

    // SSH-569: name=value after command should be treated as argument, not assignment
    it("should treat name=value as argument when it follows a command", () => {
      // In bash: curl -d name="Basic" passes 'name=Basic' as argument to -d
      // The parser should NOT split this into separate commands
      const ast = parse('curl -d name="Basic"');
      assertEquals(ast.body.length, 1, "should be a single statement");

      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals((cmd.name as AST.Word).value, "curl");
      assertEquals(cmd.assignments.length, 0, "no assignments - name=Basic is an arg");
      assertEquals(cmd.args.length, 2, "should have 2 args: -d and name=Basic");
      assertEquals((cmd.args[0] as AST.Word).value, "-d");
      // Lexer preserves quotes in partial-quoted words; parts handle expansion
      assertEquals((cmd.args[1] as AST.Word).value, 'name="Basic"');
    });

    it("should treat multiple name=value as arguments in curl -d pattern", () => {
      // Real-world pattern: curl with multiple -d flags using name=value
      const ast = parse(`curl -s https://example.com \\
  -u "key:" \\
  -d name="Basic" \\
  -d description="Vault backup" \\
  -d "metadata[plan_id]=basic"`);

      assertEquals(ast.body.length, 1, "should be a single statement");

      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals((cmd.name as AST.Word).value, "curl");
      assertEquals(cmd.assignments.length, 0, "no assignments");
      // Args: -s, url, -u, key:, -d, name="Basic", -d, description="Vault backup", -d, metadata[plan_id]=basic
      assertEquals(cmd.args.length, 10, "should have 10 args");
      assertEquals((cmd.args[4] as AST.Word).value, "-d");
      assertEquals((cmd.args[5] as AST.Word).value, 'name="Basic"');
      assertEquals((cmd.args[6] as AST.Word).value, "-d");
      assertEquals((cmd.args[7] as AST.Word).value, 'description="Vault backup"');
    });

    // SSH-327: Array assignment tests
    it("should parse simple array assignment", () => {
      const ast = parse("arr=(one two three)");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments.length, 1);
      assertEquals(cmd.assignments[0]?.name, "arr");
      assertEquals(cmd.assignments[0]?.value.type, "ArrayLiteral");

      const arrayValue = cmd.assignments[0]?.value as AST.ArrayLiteral;
      assertEquals(arrayValue.elements.length, 3);
      assertEquals((arrayValue.elements[0] as AST.Word).value, "one");
      assertEquals((arrayValue.elements[1] as AST.Word).value, "two");
      assertEquals((arrayValue.elements[2] as AST.Word).value, "three");
    });

    it("should parse empty array assignment", () => {
      const ast = parse("arr=()");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      assertEquals(cmd.assignments[0]?.name, "arr");
      assertEquals(cmd.assignments[0]?.value.type, "ArrayLiteral");

      const arrayValue = cmd.assignments[0]?.value as AST.ArrayLiteral;
      assertEquals(arrayValue.elements.length, 0);
    });

    it("should parse array assignment with quoted elements", () => {
      const ast = parse('arr=("hello world" foo "bar baz")');
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      const arrayValue = cmd.assignments[0]?.value as AST.ArrayLiteral;
      assertEquals(arrayValue.elements.length, 3);
      assertEquals((arrayValue.elements[0] as AST.Word).value, "hello world");
      assertEquals((arrayValue.elements[0] as AST.Word).quoted, true);
      assertEquals((arrayValue.elements[1] as AST.Word).value, "foo");
      assertEquals((arrayValue.elements[2] as AST.Word).value, "bar baz");
      assertEquals((arrayValue.elements[2] as AST.Word).quoted, true);
    });

    it("should parse array assignment with variable expansion", () => {
      const ast = parse("arr=(one $VAR three)");
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;

      const arrayValue = cmd.assignments[0]?.value as AST.ArrayLiteral;
      assertEquals(arrayValue.elements.length, 3);
      assertEquals((arrayValue.elements[0] as AST.Word).value, "one");

      const secondElement = arrayValue.elements[1] as AST.Word;
      assertEquals(secondElement.parts.length, 1);
      assertEquals(secondElement.parts[0]?.type, "ParameterExpansion");
      assertEquals((secondElement.parts[0] as AST.ParameterExpansion).parameter, "VAR");

      assertEquals((arrayValue.elements[2] as AST.Word).value, "three");
    });
  });

  describe("If Statements", () => {
    it("should parse simple if statement", () => {
      const ast = parse(`
        if test -f file.txt
        then
          echo exists
        fi
      `);

      const stmt = getFirstStatement(ast) as AST.IfStatement;
      assertEquals(stmt.type, "IfStatement");
      assertExists(stmt.test);
      assertEquals(stmt.consequent.length, 1);
      assertEquals(stmt.alternate, null);
    });

    it("should parse if-else statement", () => {
      const ast = parse(`
        if test -f file.txt
        then
          echo exists
        else
          echo missing
        fi
      `);

      const stmt = getFirstStatement(ast) as AST.IfStatement;
      assertEquals(Array.isArray(stmt.alternate), true);
      assertEquals((stmt.alternate as AST.Statement[]).length, 1);
    });

    it("should parse if-elif-else statement", () => {
      const ast = parse(`
        if test -f file1.txt
        then
          echo file1
        elif test -f file2.txt
        then
          echo file2
        else
          echo none
        fi
      `);

      const stmt = getFirstStatement(ast) as AST.IfStatement;
      assertExists(stmt.alternate);
      assertEquals((stmt.alternate as AST.IfStatement).type, "IfStatement");

      const elif = stmt.alternate as AST.IfStatement;
      assertEquals(Array.isArray(elif.alternate), true);
    });
  });

  describe("For Loops", () => {
    it("should parse for loop with word list", () => {
      const ast = parse(`
        for var in a b c
        do
          echo $var
        done
      `);

      const stmt = getFirstStatement(ast) as AST.ForStatement;
      assertEquals(stmt.type, "ForStatement");
      assertEquals(stmt.variable, "var");
      assertEquals(stmt.iterable.length, 3);
      assertEquals((stmt.iterable[0] as AST.Word).value, "a");
      assertEquals((stmt.iterable[1] as AST.Word).value, "b");
      assertEquals((stmt.iterable[2] as AST.Word).value, "c");
      assertEquals(stmt.body.length, 1);
    });

    it("should parse for loop without word list", () => {
      const ast = parse(`
        for var
        do
          echo $var
        done
      `);

      const stmt = getFirstStatement(ast) as AST.ForStatement;
      assertEquals(stmt.variable, "var");
      assertEquals(stmt.iterable.length, 0);
    });

    it("should parse for loop with glob pattern", () => {
      const ast = parse(`
        for file in *.ts
        do
          echo $file
        done
      `);

      const stmt = getFirstStatement(ast) as AST.ForStatement;
      assertEquals((stmt.iterable[0] as AST.Word).value, "*.ts");
    });

    it("should parse for loop with numeric literals", () => {
      const ast = parse(`
        for i in 1 2 3
        do
          echo $i
        done
      `);

      const stmt = getFirstStatement(ast) as AST.ForStatement;
      assertEquals(stmt.type, "ForStatement");
      assertEquals(stmt.variable, "i");
      assertEquals(stmt.iterable.length, 3);
      assertEquals((stmt.iterable[0] as AST.Word).value, "1");
      assertEquals((stmt.iterable[1] as AST.Word).value, "2");
      assertEquals((stmt.iterable[2] as AST.Word).value, "3");
      assertEquals(stmt.body.length, 1);
    });
  });

  describe("While Loops", () => {
    it("should parse while loop", () => {
      const ast = parse(`
        while test $count -lt 10
        do
          echo $count
        done
      `);

      const stmt = getFirstStatement(ast) as AST.WhileStatement;
      assertEquals(stmt.type, "WhileStatement");
      assertExists(stmt.test);
      assertEquals(stmt.body.length, 1);
    });

    it("should parse while true loop", () => {
      const ast = parse(`
        while true
        do
          echo loop
        done
      `);

      const stmt = getFirstStatement(ast) as AST.WhileStatement;
      assertExists(stmt.test);
    });
  });

  describe("Until Loops", () => {
    it("should parse until loop", () => {
      const ast = parse(`
        until test $count -ge 10
        do
          echo $count
        done
      `);

      const stmt = getFirstStatement(ast) as AST.UntilStatement;
      assertEquals(stmt.type, "UntilStatement");
      assertExists(stmt.test);
      assertEquals(stmt.body.length, 1);
    });
  });

  describe("Case Statements", () => {
    it("should parse case statement", () => {
      const ast = parse(`
        case $var in
          a)
            echo A
            ;;
          b)
            echo B
            ;;
        esac
      `);

      const stmt = getFirstStatement(ast) as AST.CaseStatement;
      assertEquals(stmt.type, "CaseStatement");
      assertExists(stmt.word);
      assertEquals(stmt.cases.length, 2);

      assertEquals(stmt.cases[0]?.patterns.length, 1);
      assertEquals((stmt.cases[0]?.patterns[0] as AST.Word).value, "a");
      assertEquals(stmt.cases[0]?.body.length, 1);

      assertEquals((stmt.cases[1]?.patterns[0] as AST.Word).value, "b");
    });

    it("should parse case with multiple patterns", () => {
      const ast = parse(`
        case $var in
          a|b|c)
            echo ABC
            ;;
        esac
      `);

      const stmt = getFirstStatement(ast) as AST.CaseStatement;
      assertEquals(stmt.cases[0]?.patterns.length, 3);
      assertEquals((stmt.cases[0]?.patterns[0] as AST.Word).value, "a");
      assertEquals((stmt.cases[0]?.patterns[1] as AST.Word).value, "b");
      assertEquals((stmt.cases[0]?.patterns[2] as AST.Word).value, "c");
    });

    it("should parse case with wildcard pattern", () => {
      const ast = parse(`
        case $var in
          *.txt)
            echo text file
            ;;
          *)
            echo other
            ;;
        esac
      `);

      const stmt = getFirstStatement(ast) as AST.CaseStatement;
      assertEquals((stmt.cases[0]?.patterns[0] as AST.Word).value, "*.txt");
      assertEquals((stmt.cases[1]?.patterns[0] as AST.Word).value, "*");
    });
  });

  describe("Functions", () => {
    it("should parse function declaration", () => {
      const ast = parse(`
        function myfunc {
          echo hello
        }
      `);

      const stmt = ast.body[0] as AST.FunctionDeclaration;
      assertEquals(stmt.type, "FunctionDeclaration");
      assertEquals(stmt.name, "myfunc");
      assertEquals(stmt.body.length, 1);
    });

    it("should parse function with parentheses", () => {
      const ast = parse(`
        function myfunc() {
          echo hello
        }
      `);

      const stmt = ast.body[0] as AST.FunctionDeclaration;
      assertEquals(stmt.name, "myfunc");
    });
  });

  describe("Grouping", () => {
    it("should parse subshell", () => {
      const ast = parse("(echo hello; echo world)");

      const stmt = getFirstStatement(ast) as AST.Subshell;

      assertEquals(stmt.type, "Subshell");
      assertEquals(stmt.body.length, 2);
    });

    // SSH-481: Subshell with trailing redirections
    it("should parse subshell with redirections", () => {
      const ast = parse("(cd /tmp && echo test) 2>&1");

      const stmt = getFirstStatement(ast) as AST.Subshell;

      assertEquals(stmt.type, "Subshell");
      assertEquals(stmt.body.length, 1); // The && chain is one statement
      assertExists(stmt.redirections);
      assertEquals(stmt.redirections!.length, 1);
      assertEquals(stmt.redirections![0]!.operator, ">&");
      assertEquals(stmt.redirections![0]!.fd, 2);
    });

    it("should parse subshell with multiple redirections", () => {
      const ast = parse("(echo test) >out.txt 2>&1");

      const stmt = getFirstStatement(ast) as AST.Subshell;

      assertEquals(stmt.type, "Subshell");
      assertExists(stmt.redirections);
      assertEquals(stmt.redirections!.length, 2);
    });

    it("should parse brace group with redirections", () => {
      const ast = parse("{ echo test; } 2>&1");

      const stmt = getFirstStatement(ast) as AST.BraceGroup;

      assertEquals(stmt.type, "BraceGroup");
      assertExists(stmt.redirections);
      assertEquals(stmt.redirections!.length, 1);
    });

    it("should parse brace group", () => {
      const ast = parse("{ echo hello; echo world; }");

      const stmt = getFirstStatement(ast) as AST.BraceGroup;

      assertEquals(stmt.type, "BraceGroup");
      assertEquals(stmt.body.length, 2);
    });
  });

  describe("Comments", () => {
    it("should ignore comments", () => {
      const ast = parse(`
        # This is a comment
        echo hello  # inline comment
        # Another comment
      `);

      assertEquals(ast.body.length, 1);
      const stmt = ast.body[0] as AST.Pipeline;
      const cmd = stmt.commands[0] as AST.Command;
      assertEquals((cmd.name as AST.Word).value, "echo");
    });
  });

  describe("Multiple Statements", () => {
    it("should parse multiple statements separated by newlines", () => {
      const ast = parse(`
        cmd1
        cmd2
        cmd3
      `);

      assertEquals(ast.body.length, 3);
      assertEquals((ast.body[0] as AST.Pipeline).commands[0]?.type, "Command");
      assertEquals((ast.body[1] as AST.Pipeline).commands[0]?.type, "Command");
      assertEquals((ast.body[2] as AST.Pipeline).commands[0]?.type, "Command");
    });

    it("should parse multiple statements separated by semicolons", () => {
      const ast = parse("cmd1; cmd2; cmd3");

      assertEquals(ast.body.length, 3);
    });

    it("should handle empty lines", () => {
      const ast = parse(`
        cmd1


        cmd2
      `);

      assertEquals(ast.body.length, 2);
    });
  });

  describe("Complex Nested Structures", () => {
    it("should parse nested if in for loop", () => {
      const ast = parse(`
        for file in *.txt
        do
          if test -f $file
          then
            cat $file
          fi
        done
      `);

      const forStmt = getFirstStatement(ast) as AST.ForStatement;
      assertEquals(forStmt.body.length, 1);
      // The if statement inside the for loop body is also wrapped in a Pipeline
      const ifPipeline = forStmt.body[0] as AST.Pipeline;
      assertEquals((ifPipeline.commands[0] as AST.IfStatement).type, "IfStatement");
    });

    it("should parse pipeline in if condition", () => {
      const ast = parse(`
        if cat file.txt | grep pattern
        then
          echo found
        fi
      `);

      const stmt = getFirstStatement(ast) as AST.IfStatement;
      assertEquals(stmt.test.type, "Pipeline");
      assertEquals((stmt.test as AST.Pipeline).commands.length, 2);
    });
  });

  describe("Error Handling", () => {
    it("should throw on unclosed if", () => {
      assertThrows(
        () => parse("if test -f file\nthen\necho hello"),
        Error,
        "Expected"
      );
    });

    it("should throw on unclosed for", () => {
      assertThrows(
        () => parse("for x in a b c\ndo\necho $x"),
        Error,
        "Expected"
      );
    });

    it("should throw on unclosed while", () => {
      assertThrows(
        () => parse("while true\ndo\necho loop"),
        Error,
        "Expected"
      );
    });

    it("should throw on unexpected token", () => {
      assertThrows(
        () => parse("if then fi"),
        Error
      );
    });
  });

  describe("Variable Expansions", () => {
    it("should parse simple $VAR expansion", () => {
      const ast = parse("echo $HOME");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.args.length, 1);
      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts.length, 1);
      assertEquals(arg.parts[0]?.type, "ParameterExpansion");
      assertEquals((arg.parts[0] as AST.ParameterExpansion).parameter, "HOME");
    });

    it("should parse ${VAR} expansion", () => {
      const ast = parse("echo ${PATH}");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts[0]?.type, "ParameterExpansion");
      assertEquals((arg.parts[0] as AST.ParameterExpansion).parameter, "PATH");
    });

    it("should parse ${VAR:-default} expansion", () => {
      const ast = parse("echo ${NAME:-world}");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      const expansion = arg.parts[0] as AST.ParameterExpansion;
      assertEquals(expansion.parameter, "NAME");
      assertEquals(expansion.modifier, ":-");
      assertEquals((expansion.modifierArg as AST.Word).value, "world");
    });

    it("should parse ${#VAR} length expansion", () => {
      const ast = parse("echo ${#PATH}");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      const expansion = arg.parts[0] as AST.ParameterExpansion;
      assertEquals(expansion.parameter, "PATH");
      assertEquals(expansion.modifier, "length");
    });

    it("should parse mixed literal and expansion", () => {
      const ast = parse('echo "Hello $USER!"');
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts.length, 3);
      assertEquals(arg.parts[0]?.type, "LiteralPart");
      assertEquals((arg.parts[0] as AST.LiteralPart).value, "Hello ");
      assertEquals(arg.parts[1]?.type, "ParameterExpansion");
      assertEquals(arg.parts[2]?.type, "LiteralPart");
    });

    // SSH-484: Variable expansion in command names
    it("should parse $VAR in command name", () => {
      const ast = parse("$HOME/bin/cmd arg");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const name = cmd.name as AST.Word;
      assertEquals(name.parts.length, 2);
      assertEquals(name.parts[0]?.type, "ParameterExpansion");
      assertEquals((name.parts[0] as AST.ParameterExpansion).parameter, "HOME");
      assertEquals(name.parts[1]?.type, "LiteralPart");
      assertEquals((name.parts[1] as AST.LiteralPart).value, "/bin/cmd");
    });

    it("should parse ${VAR} in command name", () => {
      const ast = parse("${ANDROID_HOME}/platform-tools/adb install app.apk");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const name = cmd.name as AST.Word;
      assertEquals(name.parts.length, 2);
      assertEquals(name.parts[0]?.type, "ParameterExpansion");
      assertEquals((name.parts[0] as AST.ParameterExpansion).parameter, "ANDROID_HOME");
      assertEquals(name.parts[1]?.type, "LiteralPart");
      assertEquals((name.parts[1] as AST.LiteralPart).value, "/platform-tools/adb");
    });

    it("should parse special variables $?, $$, $#", () => {
      const ast = parse("echo $? $$ $#");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.args.length, 3);
      assertEquals((cmd.args[0] as AST.Word).parts[0]?.type, "ParameterExpansion");
      assertEquals(((cmd.args[0] as AST.Word).parts[0] as AST.ParameterExpansion).parameter, "?");
      assertEquals(((cmd.args[1] as AST.Word).parts[0] as AST.ParameterExpansion).parameter, "$");
      assertEquals(((cmd.args[2] as AST.Word).parts[0] as AST.ParameterExpansion).parameter, "#");
    });
  });

  describe("Command Substitution", () => {
    it("should parse $(command) substitution", () => {
      const ast = parse("echo $(pwd)");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts[0]?.type, "CommandSubstitution");
      const cs = arg.parts[0] as AST.CommandSubstitution;
      assertEquals(cs.backtick, false);
      assertEquals(cs.command.length, 1);
    });

    it("should parse backtick command substitution", () => {
      const ast = parse("echo `pwd`");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts[0]?.type, "CommandSubstitution");
      const cs = arg.parts[0] as AST.CommandSubstitution;
      assertEquals(cs.backtick, true);
    });

    it("should parse nested command substitution", () => {
      const ast = parse("echo $(cat $(pwd)/file.txt)");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts[0]?.type, "CommandSubstitution");
      const cs = arg.parts[0] as AST.CommandSubstitution;
      assertEquals(cs.command.length, 1);
      // Inner command should have nested substitution
      const innerCmd = (cs.command[0] as AST.Pipeline).commands[0] as AST.Command;
      assertEquals((innerCmd.name as AST.Word).value, "cat");
    });

    it("should parse command substitution with pipeline", () => {
      const ast = parse("echo $(ls | grep foo)");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      const cs = arg.parts[0] as AST.CommandSubstitution;
      const innerPipeline = cs.command[0] as AST.Pipeline;
      assertEquals(innerPipeline.operator, "|");
    });
  });

  describe("Arithmetic Expansion", () => {
    it("should parse simple arithmetic", () => {
      const ast = parse("echo $((1 + 2))");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts[0]?.type, "ArithmeticExpansion");
      const arith = arg.parts[0] as AST.ArithmeticExpansion;
      assertEquals(arith.expression.type, "BinaryArithmeticExpression");
    });

    it("should parse arithmetic with variable", () => {
      const ast = parse("echo $((count + 1))");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      const arith = arg.parts[0] as AST.ArithmeticExpansion;
      const expr = arith.expression as AST.BinaryArithmeticExpression;
      assertEquals(expr.left.type, "VariableReference");
      assertEquals((expr.left as AST.VariableReference).name, "count");
    });

    it("should parse number literal", () => {
      const ast = parse("echo $((42))");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      const arith = arg.parts[0] as AST.ArithmeticExpansion;
      assertEquals(arith.expression.type, "NumberLiteral");
      assertEquals((arith.expression as AST.NumberLiteral).value, 42);
    });
  });

  describe("Process Substitution", () => {
    it("should parse <() process substitution", () => {
      const ast = parse("diff <(ls dir1) <(ls dir2)");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      assertEquals(cmd.args.length, 2);
      const arg1 = cmd.args[0] as AST.Word;
      assertEquals(arg1.parts[0]?.type, "ProcessSubstitution");
      const ps = arg1.parts[0] as AST.ProcessSubstitution;
      assertEquals(ps.operator, "<(");
    });

    it("should parse >() process substitution", () => {
      const ast = parse("tee >(grep error > errors.log)");
      const pipeline = ast.body[0] as AST.Pipeline;
      const cmd = pipeline.commands[0] as AST.Command;

      const arg = cmd.args[0] as AST.Word;
      assertEquals(arg.parts[0]?.type, "ProcessSubstitution");
      const ps = arg.parts[0] as AST.ProcessSubstitution;
      assertEquals(ps.operator, ">(");
    });
  });

  describe("Test Commands [[ ]]", () => {
    it("should parse [[ ]] in if statement", () => {
      const ast = parse(`if [[ $x -gt 3 ]]
then
  echo yes
fi`);
      const ifStmt = getFirstStatement(ast) as AST.IfStatement;
      assertEquals(ifStmt.type, "IfStatement");

      const testPipeline = ifStmt.test as AST.Pipeline;
      assertEquals(testPipeline.type, "Pipeline");

      const testCmd = testPipeline.commands[0] as AST.TestCommand;
      assertEquals(testCmd.type, "TestCommand");

      const expr = testCmd.expression as AST.BinaryTest;
      assertEquals(expr.type, "BinaryTest");
      assertEquals(expr.operator, "-gt");
    });

    it("should parse [[ ]] in while statement", () => {
      const ast = parse(`while [[ $x -lt 10 ]]
do
  x=$((x + 1))
done`);
      const whileStmt = getFirstStatement(ast) as AST.WhileStatement;
      assertEquals(whileStmt.type, "WhileStatement");

      const testPipeline = whileStmt.test as AST.Pipeline;
      const testCmd = testPipeline.commands[0] as AST.TestCommand;
      assertEquals(testCmd.type, "TestCommand");
    });

    it("should parse [[ ]] in until statement", () => {
      const ast = parse(`until [[ $x -eq 5 ]]
do
  x=$((x + 1))
done`);
      const untilStmt = getFirstStatement(ast) as AST.UntilStatement;
      assertEquals(untilStmt.type, "UntilStatement");

      const testPipeline = untilStmt.test as AST.Pipeline;
      const testCmd = testPipeline.commands[0] as AST.TestCommand;
      assertEquals(testCmd.type, "TestCommand");
    });

    it("should parse [[ ]] with string comparison", () => {
      const ast = parse(`[[ "$name" == "John" ]]`);
      const pipeline = ast.body[0] as AST.Pipeline;
      const testCmd = pipeline.commands[0] as AST.TestCommand;

      const expr = testCmd.expression as AST.BinaryTest;
      assertEquals(expr.operator, "==");
    });

    it("should parse [[ ]] with file test operators", () => {
      const ast = parse(`[[ -f /etc/passwd ]]`);
      const pipeline = ast.body[0] as AST.Pipeline;
      const testCmd = pipeline.commands[0] as AST.TestCommand;

      const expr = testCmd.expression as AST.UnaryTest;
      assertEquals(expr.type, "UnaryTest");
      assertEquals(expr.operator, "-f");
    });

    it("should parse [[ ]] with logical AND", () => {
      const ast = parse(`[[ $x -gt 3 && $x -lt 10 ]]`);
      const pipeline = ast.body[0] as AST.Pipeline;
      const testCmd = pipeline.commands[0] as AST.TestCommand;

      const expr = testCmd.expression as AST.LogicalTest;
      assertEquals(expr.type, "LogicalTest");
      assertEquals(expr.operator, "&&");
    });

    it("should parse [[ ]] with logical OR", () => {
      const ast = parse(`[[ $x -eq 1 || $x -eq 2 ]]`);
      const pipeline = ast.body[0] as AST.Pipeline;
      const testCmd = pipeline.commands[0] as AST.TestCommand;

      const expr = testCmd.expression as AST.LogicalTest;
      assertEquals(expr.type, "LogicalTest");
      assertEquals(expr.operator, "||");
    });

    it("should parse [[ ]] with negation", () => {
      const ast = parse(`[[ ! -f /nonexistent ]]`);
      const pipeline = ast.body[0] as AST.Pipeline;
      const testCmd = pipeline.commands[0] as AST.TestCommand;

      const expr = testCmd.expression as AST.LogicalTest;
      assertEquals(expr.type, "LogicalTest");
      assertEquals(expr.operator, "!");
    });

    it("should parse [[ ]] in pipeline with &&", () => {
      const ast = parse(`[[ $x -eq 1 ]] && echo "yes"`);
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.operator, "&&");
      assertEquals(pipeline.commands.length, 2);
      // Each operand of && is now a Pipeline (for proper precedence handling)
      const left = pipeline.commands[0] as AST.Pipeline;
      const right = pipeline.commands[1] as AST.Pipeline;
      assertEquals(left.commands[0]?.type, "TestCommand");
      assertEquals(right.commands[0]?.type, "Command");
    });

    it("should parse [[ ]] in pipeline with ||", () => {
      const ast = parse(`[[ $x -eq 1 ]] || [[ $x -eq 2 ]]`);
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.operator, "||");
      assertEquals(pipeline.commands.length, 2);
      // Each operand of || is now a Pipeline (for proper precedence handling)
      const left = pipeline.commands[0] as AST.Pipeline;
      const right = pipeline.commands[1] as AST.Pipeline;
      assertEquals(left.commands[0]?.type, "TestCommand");
      assertEquals(right.commands[0]?.type, "TestCommand");
    });

    it("should parse (( )) arithmetic command in if", () => {
      const ast = parse(`if (( x > 3 ))
then
  echo yes
fi`);
      const ifStmt = getFirstStatement(ast) as AST.IfStatement;
      const testPipeline = ifStmt.test as AST.Pipeline;
      const arithCmd = testPipeline.commands[0] as AST.ArithmeticCommand;

      assertEquals(arithCmd.type, "ArithmeticCommand");
      assertExists(arithCmd.expression);
    });

    it("should parse mixed [[ ]] and (( )) in pipeline", () => {
      const ast = parse(`[[ -f /tmp/file ]] && (( x > 5 ))`);
      const pipeline = ast.body[0] as AST.Pipeline;

      assertEquals(pipeline.commands.length, 2);
      // Each operand of && is now a Pipeline (for proper precedence handling)
      const left = pipeline.commands[0] as AST.Pipeline;
      const right = pipeline.commands[1] as AST.Pipeline;
      assertEquals(left.commands[0]?.type, "TestCommand");
      assertEquals(right.commands[0]?.type, "ArithmeticCommand");
    });
  });

  describe("Edge Cases", () => {
    it("should parse empty input", () => {
      const ast = parse("");
      assertEquals(ast.type, "Program");
      assertEquals(ast.body.length, 0);
    });

    it("should parse whitespace only", () => {
      const ast = parse("   \n\n   ");
      assertEquals(ast.body.length, 0);
    });

    it("should parse command with trailing whitespace", () => {
      const ast = parse("echo hello   \n");
      assertEquals(ast.body.length, 1);
    });

    it("should handle various quote combinations", () => {
      const ast = parse(`echo "double" 'single' mixed`);
      const cmd = (ast.body[0] as AST.Pipeline).commands[0] as AST.Command;

      assertEquals(cmd.args.length, 3);
      assertEquals((cmd.args[0] as AST.Word).quoted, true);
      assertEquals((cmd.args[1] as AST.Word).singleQuoted, true);
      assertEquals((cmd.args[2] as AST.Word).quoted, false);
    });
  });

  describe("Error Recovery", () => {
    it("should return empty diagnostics for valid input", () => {
      const result = parseWithRecovery("echo hello");

      assertEquals(result.ast.body.length, 1);
      assertEquals(result.diagnostics.length, 0);
    });

    it("should collect error without throwing", () => {
      const result = parseWithRecovery("if test; then");

      // Should have returned a result instead of throwing
      assertEquals(result.ast.type, "Program");
      assertEquals(result.diagnostics.length > 0, true);
    });

    it("should include context in error messages", () => {
      const result = parseWithRecovery("if test; then");

      // Check that context is included
      const hasContext = result.diagnostics.some(
        (d) => d.context && d.context.includes("if")
      );
      assertEquals(hasContext, true);
    });
  });

  describe("Parser Error Context", () => {
    it("should provide context for error in until loop", () => {
      assertThrows(() => {
        parse("until true; do fi; done");
      }, Error, "until");
    });

    it("should provide context for error in case statement", () => {
      assertThrows(() => {
        parse("case $x in\n  a) fi;;\nesac");
      }, Error, "case");
    });

    it("should provide context for error in function", () => {
      assertThrows(() => {
        parse("function foo { fi; }");
      }, Error, "brace group");
    });

    it("should provide context for error in subshell", () => {
      assertThrows(() => {
        parse("( fi )");
      }, Error, "subshell");
    });

    it("should provide context for error in brace group", () => {
      assertThrows(() => {
        parse("{ fi; }");
      }, Error, "brace group");
    });

    it("should parse command substitution without error", () => {
      const result = parse("echo $(cat file)");
      assertEquals(result.type, "Program");
      assertEquals(result.body.length, 1);
    });
  });
});
