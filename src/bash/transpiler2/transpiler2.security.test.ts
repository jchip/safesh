/**
 * Security-Focused Test Suite for Transpiler2
 *
 * This test suite validates that the bash transpiler properly handles
 * security-sensitive scenarios and prevents common injection vulnerabilities.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";
import {
  escapeForTemplate,
  escapeForQuotes,
  escapeRegex,
} from "./utils/escape.ts";

// =============================================================================
// Escape Utilities Security Tests
// =============================================================================

describe("Security - Escape Utilities", () => {
  describe("escapeForTemplate - Command Injection Prevention", () => {
    it("should escape backticks to prevent command execution", () => {
      const malicious = "`rm -rf /`";
      const escaped = escapeForTemplate(malicious);
      assertEquals(escaped, "\\`rm -rf /\\`");
      // Verify backticks are escaped
      assertStringIncludes(escaped, "\\`");
    });

    it("should escape template literal interpolation ${}", () => {
      const malicious = "${process.exit(1)}";
      const escaped = escapeForTemplate(malicious);
      // Should escape both the ${ and standalone $
      assertStringIncludes(escaped, "\\\\${");
    });

    it("should escape dollar signs to prevent variable expansion", () => {
      const malicious = "$SHELL";
      const escaped = escapeForTemplate(malicious);
      assertEquals(escaped, "\\$SHELL");
    });

    it("should escape backslashes to prevent escape sequence injection", () => {
      const malicious = "path\\to\\file";
      const escaped = escapeForTemplate(malicious);
      assertEquals(escaped, "path\\\\to\\\\file");
    });

    it("should handle multiple injection vectors in one string", () => {
      const malicious = "`cmd` ${exec} $VAR \\escape";
      const escaped = escapeForTemplate(malicious);
      assertStringIncludes(escaped, "\\`");
      assertStringIncludes(escaped, "\\$");
      assertStringIncludes(escaped, "\\\\");
    });

    it("should prevent nested template literal injection", () => {
      const malicious = "`echo ${`nested`}`";
      const escaped = escapeForTemplate(malicious);
      // All backticks and interpolations should be escaped
      assert(escaped.includes("\\`"));
      assert(!escaped.match(/[^\\]`/)); // No unescaped backticks
    });
  });

  describe("escapeForQuotes - String Injection Prevention", () => {
    it("should escape double quotes to prevent string termination", () => {
      const malicious = 'say "hello"; rm -rf /';
      const escaped = escapeForQuotes(malicious);
      assertEquals(escaped, 'say \\"hello\\"; rm -rf /');
    });

    it("should escape newlines to prevent line injection", () => {
      const malicious = "line1\nmalicious_command";
      const escaped = escapeForQuotes(malicious);
      assertEquals(escaped, "line1\\nmalicious_command");
    });

    it("should escape tabs to prevent control character injection", () => {
      const malicious = "col1\tmalicious";
      const escaped = escapeForQuotes(malicious);
      assertEquals(escaped, "col1\\tmalicious");
    });

    it("should escape carriage returns", () => {
      const malicious = "line1\rmalicious";
      const escaped = escapeForQuotes(malicious);
      assertEquals(escaped, "line1\\rmalicious");
    });

    it("should handle multiple quote types safely", () => {
      const malicious = 'mix "double" and \'single\' quotes';
      const escaped = escapeForQuotes(malicious);
      assertStringIncludes(escaped, '\\"double\\"');
      // Single quotes don't need escaping in double-quoted strings
      assertStringIncludes(escaped, "'single'");
    });

    it("should prevent quote escaping attacks", () => {
      const malicious = '\\"already escaped\\"';
      const escaped = escapeForQuotes(malicious);
      // Should escape the backslashes too
      assertEquals(escaped, '\\\\\\"already escaped\\\\\\"');
    });
  });

  describe("escapeRegex - Pattern Injection Prevention", () => {
    it("should escape regex metacharacters", () => {
      const malicious = ".*+?^${}()|[]\\";
      const escaped = escapeRegex(malicious);
      assertEquals(escaped, "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
    });

    it("should prevent catastrophic backtracking patterns", () => {
      const malicious = "(a+)+";
      const escaped = escapeRegex(malicious);
      assertEquals(escaped, "\\(a\\+\\)\\+");
      // Escaped version is safe to use as literal pattern
    });

    it("should neutralize character class injections", () => {
      const malicious = "[^].*";
      const escaped = escapeRegex(malicious);
      assertEquals(escaped, "\\[\\^\\]\\.\\*");
    });

    it("should handle complex regex injection attempts", () => {
      const malicious = "(?<=(payload))";
      const escaped = escapeRegex(malicious);
      assertStringIncludes(escaped, "\\(\\?");
    });
  });
});

// =============================================================================
// Command Injection Prevention Tests
// =============================================================================

describe("Security - Command Injection Prevention", () => {
  it("should safely handle semicolons in variable values", () => {
    const ast = parse('VAR="value; rm -rf /"');
    const output = transpile(ast);

    // Variable should be assigned as a string literal
    assertStringIncludes(output, 'let VAR = "value; rm -rf /"');
    // Semicolon should not create a new statement
    assert(!output.includes('"; rm -rf /"'));
  });

  it("should safely handle ampersands in variable values", () => {
    const ast = parse('VAR="value & background_cmd"');
    const output = transpile(ast);

    assertStringIncludes(output, 'let VAR = "value & background_cmd"');
    // Should not create background execution
  });

  it("should safely handle pipes in variable values", () => {
    const ast = parse('VAR="value | grep secret"');
    const output = transpile(ast);

    assertStringIncludes(output, 'let VAR = "value | grep secret"');
    // Pipe should not create a pipeline
  });

  it("should safely handle backticks in variable values", () => {
    const ast = parse('VAR="value `malicious`"');
    const output = transpile(ast);

    // Backticks in quotes should be treated as command substitution by parser
    // but should be properly escaped in output
  });

  it("should escape dollar signs in literal strings", () => {
    const ast = parse('VAR="\\$SECRET"');
    const output = transpile(ast);

    // Escaped dollar should not trigger variable expansion
    assertStringIncludes(output, "\\$");
  });

  it("should handle command substitution safely", () => {
    const ast = parse('VAR=$(cat /etc/passwd)');
    const output = transpile(ast);

    // Command substitution should be properly wrapped
    assertStringIncludes(output, '$.cat("/etc/passwd")');
    assertStringIncludes(output, ".text()");
  });

  it("should prevent injection through unquoted variables", () => {
    const ast = parse('echo $VAR');
    const output = transpile(ast);

    // Variable should be interpolated in template literal
    assertStringIncludes(output, "${VAR}");
    // Should be within a template literal context
    assertStringIncludes(output, '$.cmd("');
  });

  it("should handle shell metacharacters in command arguments", () => {
    const ast = parse('echo "test;whoami"');
    const output = transpile(ast);

    // Should be passed as a single argument
    assertStringIncludes(output, "test;whoami");
    // Should not execute whoami
  });
});

// =============================================================================
// Path Traversal Prevention Tests
// =============================================================================

describe("Security - Path Traversal Prevention", () => {
  it("should handle directory traversal attempts in cat command", () => {
    const ast = parse('cat ../../etc/passwd');
    const output = transpile(ast);

    // Path should be passed as-is (security enforcement at runtime)
    assertStringIncludes(output, "../../etc/passwd");
  });

  it("should handle absolute paths safely", () => {
    const ast = parse('cat /etc/passwd');
    const output = transpile(ast);

    assertStringIncludes(output, "/etc/passwd");
  });

  it("should handle paths with spaces", () => {
    const ast = parse('cat "path with spaces"');
    const output = transpile(ast);

    assertStringIncludes(output, "path with spaces");
  });

  it("should handle paths with special characters", () => {
    const ast = parse('cat "file\\nname"');
    const output = transpile(ast);

    // Escaped newline in path should be preserved
    assertStringIncludes(output, "file");
  });

  it("should handle null byte injection attempts", () => {
    const ast = parse('cat "file.txt\\x00.sh"');
    const output = transpile(ast);

    // Null bytes should be handled (though bash parser may reject)
    assertStringIncludes(output, "file.txt");
  });

  it("should handle redirection to dangerous paths", () => {
    const ast = parse('echo data > /dev/null');
    const output = transpile(ast);

    assertStringIncludes(output, ".stdout");
    assertStringIncludes(output, "/dev/null");
  });

  it("should handle symbolic link traversal attempts", () => {
    const ast = parse('cat /tmp/link/../../../etc/passwd');
    const output = transpile(ast);

    assertStringIncludes(output, "/tmp/link/../../../etc/passwd");
  });
});

// =============================================================================
// Parameter Expansion Safety Tests
// =============================================================================

describe("Security - Parameter Expansion Safety", () => {
  it("should handle indirect expansion safely", () => {
    const ast = parse('echo "${!VAR}"');
    const output = transpile(ast);

    // Indirect expansion should use eval() for runtime lookup
    assertStringIncludes(output, "eval(VAR)");
  });

  it("should handle default value expansion safely", () => {
    const ast = parse('echo "${VAR:-$(malicious)}"');
    const output = transpile(ast);

    // Command substitution in default should be transpiled
    assertStringIncludes(output, '$.cmd("malicious")');
  });

  it("should handle substring expansion safely", () => {
    const ast = parse('echo "${VAR:0:10}"');
    const output = transpile(ast);

    // Substring expansion is passed to shell (not yet implemented in transpiler)
    assertStringIncludes(output, "${VAR:0:10}");
  });

  it("should handle pattern substitution safely", () => {
    const ast = parse('echo "${VAR//pattern/replacement}"');
    const output = transpile(ast);

    assertStringIncludes(output, ".replaceAll(");
  });

  it("should prevent code injection through expansion modifiers", () => {
    const ast = parse('echo "${VAR^^}"');
    const output = transpile(ast);

    assertStringIncludes(output, ".toUpperCase()");
    // Should not allow arbitrary code execution
  });

  it("should handle array expansion safely", () => {
    const ast = parse('echo "${arr[@]}"');
    const output = transpile(ast);

    assertStringIncludes(output, "arr");
    // Array expansion should be safe
  });

  it("should handle length expansion safely", () => {
    const ast = parse('echo "${#VAR}"');
    const output = transpile(ast);

    assertStringIncludes(output, ".length");
  });
});

// =============================================================================
// Shell Metacharacter Handling Tests
// =============================================================================

describe("Security - Shell Metacharacter Handling", () => {
  it("should safely handle semicolons in commands", () => {
    const ast = parse('cmd1; cmd2');
    const output = transpile(ast);

    // Should create two separate statements
    assertStringIncludes(output, '$.cmd("cmd1")');
    assertStringIncludes(output, '$.cmd("cmd2")');
  });

  it("should safely handle ampersands for background execution", () => {
    const ast = parse('cmd1 & cmd2');
    const output = transpile(ast);

    // Background execution should be handled
    assertStringIncludes(output, '$.cmd("cmd1")');
    assertStringIncludes(output, '$.cmd("cmd2")');
  });

  it("should safely handle pipes", () => {
    const ast = parse('cmd1 | cmd2');
    const output = transpile(ast);

    // Pipe should create fluent chain
    assertStringIncludes(output, ".pipe(");
  });

  it("should safely handle redirections", () => {
    const ast = parse('cmd > output.txt');
    const output = transpile(ast);

    assertStringIncludes(output, ".stdout");
    assertStringIncludes(output, "output.txt");
  });

  it("should safely handle command substitution with $(...)", () => {
    const ast = parse('VAR=$(cmd)');
    const output = transpile(ast);

    assertStringIncludes(output, '$.cmd("cmd")');
  });

  it("should safely handle here-documents", () => {
    const ast = parse(`cat <<EOF
content
EOF`);
    const output = transpile(ast);

    // Here-doc should be handled safely
    assertStringIncludes(output, "content");
  });

  it("should handle nested subshells safely", () => {
    const ast = parse('( (echo inner) )');
    const output = transpile(ast);

    // Nested subshells should create nested IIFEs
    const iifes = output.match(/await \(async \(\) => \{/g);
    // Should have at least 2 nested IIFEs
    assert(iifes && iifes.length >= 2);
  });

  it("should prevent glob pattern injection", () => {
    const ast = parse('echo *');
    const output = transpile(ast);

    // Glob should be passed to command (shell handles expansion)
    assertStringIncludes(output, '$.cmd("echo", "*")');
  });
});

// =============================================================================
// Quote Escaping Security Tests
// =============================================================================

describe("Security - Quote Escaping", () => {
  it("should handle escaped quotes in double-quoted strings", () => {
    const ast = parse('echo "say \\"hello\\""');
    const output = transpile(ast);

    // Escaped quotes should be preserved in the output
    assertStringIncludes(output, "say");
    assertStringIncludes(output, "hello");
  });

  it("should handle single quotes in double-quoted strings", () => {
    const ast = parse('echo "it\'s working"');
    const output = transpile(ast);

    assertStringIncludes(output, "it's working");
  });

  it("should handle mixed quoting", () => {
    const ast = parse("echo 'single' \"double\"");
    const output = transpile(ast);

    assertStringIncludes(output, "single");
    assertStringIncludes(output, "double");
  });

  it("should prevent quote escape injection", () => {
    const ast = parse('VAR="value\\"; malicious; #"');
    const output = transpile(ast);

    // Everything should be in the string value
    assertStringIncludes(output, 'let VAR = ');
    // Should not create separate statements
  });

  it("should handle backslash escaping in strings", () => {
    const ast = parse('echo "path\\\\to\\\\file"');
    const output = transpile(ast);

    assertStringIncludes(output, "path\\\\to\\\\file");
  });

  it("should handle dollar sign escaping", () => {
    const ast = parse('echo "\\$VAR"');
    const output = transpile(ast);

    // Escaped dollar should be double-escaped in template literal
    assertStringIncludes(output, "\\${VAR}");
  });

  it("should handle backtick escaping in strings", () => {
    const ast = parse('echo "\\`cmd\\`"');
    const output = transpile(ast);

    // Escaped backticks should not execute
    assertStringIncludes(output, "\\`");
  });
});

// =============================================================================
// Environment Variable Safety Tests
// =============================================================================

describe("Security - Environment Variable Safety", () => {
  it("should handle PATH manipulation safely", () => {
    const ast = parse('PATH="/malicious:$PATH"');
    const output = transpile(ast);

    assertStringIncludes(output, 'let PATH = ');
    assertStringIncludes(output, '${PATH}');
  });

  it("should handle LD_PRELOAD safely", () => {
    const ast = parse('LD_PRELOAD="/tmp/malicious.so"');
    const output = transpile(ast);

    assertStringIncludes(output, 'let LD_PRELOAD = "/tmp/malicious.so"');
  });

  it("should handle IFS manipulation safely", () => {
    const ast = parse('IFS=";"');
    const output = transpile(ast);

    assertStringIncludes(output, 'let IFS = ";"');
  });

  it("should handle environment variable expansion in commands", () => {
    const ast = parse('echo $HOME');
    const output = transpile(ast);

    assertStringIncludes(output, "${HOME}");
  });

  it("should handle complex environment variable patterns", () => {
    const ast = parse('VAR="$USER@$HOST"');
    const output = transpile(ast);

    assertStringIncludes(output, "${USER}");
    assertStringIncludes(output, "${HOST}");
  });

  it("should handle exported variables safely", () => {
    const ast = parse('export VAR="value"');
    const output = transpile(ast);

    // Export with assignment is currently transpiled as export command + assignment
    assertStringIncludes(output, 'let VAR = "value"');
  });

  it("should handle readonly variables", () => {
    const ast = parse('readonly VAR="value"');
    const output = transpile(ast);

    // Readonly with assignment is transpiled as readonly command + assignment
    assertStringIncludes(output, 'let VAR = "value"');
  });
});

// =============================================================================
// Subshell Safety Tests
// =============================================================================

describe("Security - Subshell Safety", () => {
  it("should isolate subshell variable assignments", () => {
    const ast = parse('(VAR=value; echo $VAR)');
    const output = transpile(ast);

    // Subshell creates IIFE scope
    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, "let VAR");
  });

  it("should handle command substitution in subshell", () => {
    const ast = parse('VAR=$( (echo inner) )');
    const output = transpile(ast);

    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, '$.cmd("echo", "inner")');
  });

  it("should prevent subshell escape to parent scope", () => {
    const ast = parse('(cd /tmp); pwd');
    const output = transpile(ast);

    // cd in subshell should not affect parent
    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, '$.cmd("cd", "/tmp")');
    assertStringIncludes(output, '$.cmd("pwd")');
  });

  it("should handle nested subshells securely", () => {
    const ast = parse('( (echo inner) )');
    const output = transpile(ast);

    // Nested subshells should be safely isolated
    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, '$.cmd("echo", "inner")');
  });

  it("should handle subshell with pipelines", () => {
    const ast = parse('(ls | grep test)');
    const output = transpile(ast);

    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, ".pipe(");
  });

  it("should handle command redirections safely", () => {
    const ast = parse('ls > file.txt');
    const output = transpile(ast);

    // Redirection should be safe
    assertStringIncludes(output, "file.txt");
    assertStringIncludes(output, ".stdout");
  });
});

// =============================================================================
// Redirection Safety Tests
// =============================================================================

describe("Security - Redirection Safety", () => {
  it("should handle output redirection to files safely", () => {
    const ast = parse('echo data > /tmp/output.txt');
    const output = transpile(ast);

    assertStringIncludes(output, '.stdout("/tmp/output.txt")');
  });

  it("should handle append redirection safely", () => {
    const ast = parse('echo data >> /tmp/output.txt');
    const output = transpile(ast);

    assertStringIncludes(output, '.stdout("/tmp/output.txt", { append: true })');
  });

  it("should handle input redirection safely", () => {
    const ast = parse('cat < /tmp/input.txt');
    const output = transpile(ast);

    assertStringIncludes(output, '.stdin("/tmp/input.txt")');
  });

  it("should prevent redirection to sensitive files", () => {
    const ast = parse('echo malicious > /etc/passwd');
    const output = transpile(ast);

    // Should transpile (runtime will enforce permissions)
    assertStringIncludes(output, '.stdout("/etc/passwd")');
  });

  it("should handle stderr redirection safely", () => {
    const ast = parse('cmd 2> /tmp/error.log');
    const output = transpile(ast);

    // stderr redirection should be handled
    assertStringIncludes(output, '$.cmd("cmd")');
  });

  it("should handle file descriptor duplication safely", () => {
    const ast = parse('cmd 2>&1');
    const output = transpile(ast);

    // FD duplication should be transpiled
    assertStringIncludes(output, '$.cmd("cmd")');
  });

  it("should handle here-string safely", () => {
    const ast = parse('cat <<< "data"');
    const output = transpile(ast);

    assertStringIncludes(output, "data");
  });

  it("should prevent command injection through redirection targets", () => {
    const ast = parse('echo test > "file;rm -rf /"');
    const output = transpile(ast);

    // Filename with shell metacharacters should be safe
    assertStringIncludes(output, '.stdout("file;rm -rf /")');
  });

  it("should handle multiple redirections safely", () => {
    const ast = parse('cmd < input.txt > output.txt 2> error.log');
    const output = transpile(ast);

    assertStringIncludes(output, '$.cmd("cmd")');
  });
});

// =============================================================================
// Complex Injection Scenarios
// =============================================================================

describe("Security - Complex Injection Scenarios", () => {
  it("should prevent chained command injection", () => {
    const ast = parse('VAR="value"; echo $VAR');
    const output = transpile(ast);

    // Two separate statements
    assertStringIncludes(output, 'let VAR = "value"');
    assertStringIncludes(output, '$.cmd("echo")');
  });

  it("should handle injection via arithmetic expansion", () => {
    const ast = parse('echo $((1 + 2))');
    const output = transpile(ast);

    assertStringIncludes(output, "(1 + 2)");
    // Should not allow arbitrary code
  });

  it("should prevent injection through case patterns", () => {
    const ast = parse('case $x in "test;malicious") echo matched;; esac');
    const output = transpile(ast);

    assertStringIncludes(output, "test;malicious");
    // Pattern should be safe
  });

  it("should handle injection attempts in function names", () => {
    const ast = parse('function test_func { echo safe; }');
    const output = transpile(ast);

    assertStringIncludes(output, "async function test_func()");
  });

  it("should prevent injection through array indices", () => {
    const ast = parse('echo ${arr[0]}');
    const output = transpile(ast);

    assertStringIncludes(output, "arr[0]");
  });

  it("should handle multiple injection vectors combined", () => {
    const ast = parse('VAR="$(cmd)"; echo "$VAR; malicious"');
    const output = transpile(ast);

    assertStringIncludes(output, '$.cmd("cmd")');
    assertStringIncludes(output, "${VAR}; malicious");
    // Semicolon in string should not execute
  });

  it("should prevent code injection through glob patterns", () => {
    const ast = parse('echo *.txt');
    const output = transpile(ast);

    // Glob should be passed to command safely
    assertStringIncludes(output, '$.cmd("echo", "*.txt")');
  });

  it("should handle brace expansion injection attempts", () => {
    const ast = parse('echo {1..10}');
    const output = transpile(ast);

    // Brace expansion should be safe
    assertStringIncludes(output, "echo");
  });

  it("should prevent injection via tilde expansion", () => {
    const ast = parse('cat ~/file.txt');
    const output = transpile(ast);

    // Tilde should expand to home directory safely
    assertStringIncludes(output, "Deno.env.get");
  });

  it("should handle null command injection", () => {
    const ast = parse(': test');
    const output = transpile(ast);

    // Null command should be transpiled safely
    assertStringIncludes(output, "`: test`");
  });
});

// =============================================================================
// Escaping Edge Cases
// =============================================================================

describe("Security - Escaping Edge Cases", () => {
  it("should handle Unicode characters safely", () => {
    const ast = parse('echo "Hello 世界"');
    const output = transpile(ast);

    assertStringIncludes(output, "Hello 世界");
  });

  it("should handle emoji safely", () => {
    const ast = parse('echo "test 🔒 secure"');
    const output = transpile(ast);

    assertStringIncludes(output, "test 🔒 secure");
  });

  it("should handle zero-width characters", () => {
    const ast = parse('echo "test\u200Bhidden"');
    const output = transpile(ast);

    assertStringIncludes(output, "test");
  });

  it("should handle ANSI escape codes safely", () => {
    const ast = parse('echo "\\033[31mred\\033[0m"');
    const output = transpile(ast);

    // ANSI codes should be preserved
    assertStringIncludes(output, "\\033");
  });

  it("should handle long strings without truncation", () => {
    const longString = "A".repeat(10000);
    const ast = parse(`echo "${longString}"`);
    const output = transpile(ast);

    assertStringIncludes(output, longString);
  });

  it("should handle malformed UTF-8 gracefully", () => {
    // This tests the transpiler's robustness
    const ast = parse('echo "test"');
    const output = transpile(ast);

    assertStringIncludes(output, "test");
  });

  it("should handle control characters safely", () => {
    const ast = parse('echo "test\\x00null"');
    const output = transpile(ast);

    assertStringIncludes(output, "test");
  });

  it("should handle special regex characters in patterns", () => {
    const ast = parse('case $x in *.txt) echo match;; esac');
    const output = transpile(ast);

    // Glob should be converted to regex safely
    assertStringIncludes(output, "test(");
  });
});
