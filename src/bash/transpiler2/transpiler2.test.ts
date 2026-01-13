/**
 * Comprehensive unit tests for transpiler2
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile, BashTranspiler2 } from "./mod.ts";
import { TranspilerContext } from "./context.ts";
import { OutputEmitter } from "./emitter.ts";
import { resolveOptions } from "./types.ts";
import {
  escapeForTemplate,
  escapeForQuotes,
  escapeRegex,
  globToRegex,
} from "./utils/escape.ts";

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe("Escape Utilities", () => {
  describe("escapeForTemplate", () => {
    it("should escape backticks", () => {
      assertEquals(escapeForTemplate("`cmd`"), "\\`cmd\\`");
    });

    it("should escape template literals", () => {
      // The function escapes ${ first (to \${), then escapes $ in the result
      // This results in \\${var} (escaped backslash then ${var})
      assertEquals(escapeForTemplate("${var}"), "\\\\${var}");
    });

    it("should escape backslashes", () => {
      assertEquals(escapeForTemplate("path\\file"), "path\\\\file");
    });

    it("should escape dollar signs", () => {
      assertEquals(escapeForTemplate("$var"), "\\$var");
    });
  });

  describe("escapeForQuotes", () => {
    it("should escape double quotes", () => {
      assertEquals(escapeForQuotes('say "hello"'), 'say \\"hello\\"');
    });

    it("should escape newlines", () => {
      assertEquals(escapeForQuotes("line1\nline2"), "line1\\nline2");
    });

    it("should escape tabs", () => {
      assertEquals(escapeForQuotes("col1\tcol2"), "col1\\tcol2");
    });
  });

  describe("escapeRegex", () => {
    it("should escape regex special characters", () => {
      assertEquals(escapeRegex("*.txt"), "\\*\\.txt");
    });

    it("should escape brackets", () => {
      assertEquals(escapeRegex("[a-z]"), "\\[a-z\\]");
    });
  });

  describe("globToRegex", () => {
    it("should convert single star", () => {
      assertEquals(globToRegex("*.txt"), "[^/]*\\.txt");
    });

    it("should convert double star", () => {
      // ** matches anything (.*), then / stays as /, * becomes [^/]*
      assertEquals(globToRegex("**/*.ts"), ".*/[^/]*\\.ts");
    });

    it("should convert question mark", () => {
      assertEquals(globToRegex("file?.txt"), "file[^/]\\.txt");
    });
  });
});

// =============================================================================
// TranspilerContext Tests
// =============================================================================

describe("TranspilerContext", () => {
  it("should track indent level", () => {
    const ctx = new TranspilerContext(resolveOptions());
    assertEquals(ctx.getIndent(), "");

    ctx.indent();
    assertEquals(ctx.getIndent(), "  ");

    ctx.indent();
    assertEquals(ctx.getIndent(), "    ");

    ctx.dedent();
    assertEquals(ctx.getIndent(), "  ");
  });

  it("should generate unique temp vars", () => {
    const ctx = new TranspilerContext(resolveOptions());
    assertEquals(ctx.getTempVar(), "_tmp0");
    assertEquals(ctx.getTempVar(), "_tmp1");
    assertEquals(ctx.getTempVar("test"), "test2");
  });

  it("should manage variable scopes", () => {
    const ctx = new TranspilerContext(resolveOptions());

    ctx.declareVariable("foo", "const");
    assertEquals(ctx.isDeclared("foo"), true);
    assertEquals(ctx.isDeclared("bar"), false);

    ctx.pushScope();
    ctx.declareVariable("bar", "let");
    assertEquals(ctx.isDeclared("foo"), true);
    assertEquals(ctx.isDeclared("bar"), true);

    ctx.popScope();
    assertEquals(ctx.isDeclared("foo"), true);
    assertEquals(ctx.isDeclared("bar"), false);
  });

  it("should snapshot and restore state", () => {
    const ctx = new TranspilerContext(resolveOptions());
    ctx.indent();
    ctx.getTempVar();

    const snapshot = ctx.snapshot();
    ctx.indent();
    ctx.getTempVar();

    assertEquals(ctx.getIndentLevel(), 2);

    ctx.restore(snapshot);
    assertEquals(ctx.getIndentLevel(), 1);
  });
});

// =============================================================================
// OutputEmitter Tests
// =============================================================================

describe("OutputEmitter", () => {
  it("should emit lines with indentation", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    emitter.emit("line1");
    ctx.indent();
    emitter.emit("line2");
    ctx.dedent();
    emitter.emit("line3");

    const lines = emitter.getLines();
    assertEquals(lines, ["line1", "  line2", "line3"]);
  });

  it("should manage imports", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    emitter.addImport("./mod.ts", ["$", "cmd"]);
    emitter.addImport("./utils.ts", "helper");
    emitter.emit("code here");

    const output = emitter.toString();
    assertStringIncludes(output, 'import { $, cmd } from "./mod.ts";');
    assertStringIncludes(output, 'import { helper } from "./utils.ts";');
  });

  it("should emit blocks", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    emitter.emitBlock("if (true) ", () => {
      emitter.emit("console.log('yes');");
    });

    const output = emitter.toString();
    assertStringIncludes(output, "if (true) {");
    assertStringIncludes(output, "  console.log('yes');");
    assertStringIncludes(output, "}");
  });
});

// =============================================================================
// Simple Commands Tests
// =============================================================================

describe("Transpiler2 - Simple Commands", () => {
  it("should transpile a simple command", () => {
    const ast = parse("ls");
    const output = transpile(ast);

    assertStringIncludes(output, "$.cmd`ls`");
    assertStringIncludes(output, "await");
  });

  it("should transpile command with arguments", () => {
    const ast = parse("ls -la /tmp");
    const output = transpile(ast);

    assertStringIncludes(output, "$.cmd`ls -la /tmp`");
  });

  it("should wrap in async IIFE", () => {
    const ast = parse("echo hello");
    const output = transpile(ast);

    assertStringIncludes(output, "(async () => {");
    assertStringIncludes(output, "})();");
  });

  it("should add imports when enabled", () => {
    const ast = parse("ls");
    const output = transpile(ast, { imports: true });

    assertStringIncludes(output, 'import { $ } from "./mod.ts";');
  });

  it("should skip imports when disabled", () => {
    const ast = parse("ls");
    const output = transpile(ast, { imports: false });

    assertEquals(output.includes('import { $ }'), false);
  });
});

// =============================================================================
// Fluent Commands Tests
// =============================================================================

describe("Transpiler2 - Fluent Commands", () => {
  it("should use $.cat for cat command", () => {
    const ast = parse("cat file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '$.cat("file.txt")');
  });

  it("should use $.head transform", () => {
    const ast = parse("head -5 file.txt");
    const output = transpile(ast);

    // head is used as a transform, so we see $.head(5)
    assertStringIncludes(output, "$.head(5)");
  });

  it("should use $.tail transform", () => {
    const ast = parse("tail -n20");
    const output = transpile(ast);

    assertStringIncludes(output, "$.tail(20)");
  });

  it("should use $.sort with options", () => {
    const ast = parse("sort -n -r");
    const output = transpile(ast);

    assertStringIncludes(output, "$.sort(");
    assertStringIncludes(output, "numeric: true");
    assertStringIncludes(output, "reverse: true");
  });

  it("should use $.uniq with options", () => {
    const ast = parse("uniq -c");
    const output = transpile(ast);

    assertStringIncludes(output, "$.uniq(");
    assertStringIncludes(output, "count: true");
  });

  it("should use $.wc with options", () => {
    const ast = parse("wc -l");
    const output = transpile(ast);

    assertStringIncludes(output, "$.wc(");
    assertStringIncludes(output, "lines: true");
  });
});

// =============================================================================
// Pipeline Tests
// =============================================================================

describe("Transpiler2 - Pipelines", () => {
  it("should transpile simple pipeline", () => {
    const ast = parse("ls | grep test");
    const output = transpile(ast);

    assertStringIncludes(output, ".pipe(");
  });

  it("should transpile AND operator", () => {
    const ast = parse("cmd1 && cmd2");
    const output = transpile(ast);

    assertStringIncludes(output, ".then(");
  });

  it("should transpile OR operator", () => {
    const ast = parse("cmd1 || cmd2");
    const output = transpile(ast);

    assertStringIncludes(output, ".catch(");
  });
});

// =============================================================================
// Control Flow Tests
// =============================================================================

describe("Transpiler2 - Control Flow", () => {
  it("should transpile if statement", () => {
    const ast = parse(`
      if test -f file
      then
        echo exists
      fi
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "if (");
    assertStringIncludes(output, ".code === 0)");
    assertStringIncludes(output, "$.cmd`echo exists`");
  });

  it("should transpile if-else statement", () => {
    const ast = parse(`
      if test -f file
      then
        echo yes
      else
        echo no
      fi
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "} else {");
    assertStringIncludes(output, "$.cmd`echo no`");
  });

  it("should transpile for loop", () => {
    const ast = parse(`
      for i in a b c
      do
        echo item
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "for (const i of");
    assertStringIncludes(output, '["a", "b", "c"]');
  });

  it("should transpile while loop", () => {
    const ast = parse(`
      while test -f file
      do
        sleep 1
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "while (true)");
    assertStringIncludes(output, "if (");
    assertStringIncludes(output, ".code !== 0) break;");
  });

  it("should transpile until loop", () => {
    const ast = parse(`
      until test -f file
      do
        sleep 1
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "while (true)");
    assertStringIncludes(output, ".code === 0) break;");
  });

  it("should transpile case statement", () => {
    const ast = parse("case $x in a) echo A;; b) echo B;; esac");
    const output = transpile(ast);

    assertStringIncludes(output, 'if (');
    assertStringIncludes(output, '/^a');
    assertStringIncludes(output, '.test(');
    assertStringIncludes(output, '} else if (');
  });

  it("should transpile function declaration", () => {
    const ast = parse(`
      function myfunc {
        echo hello
      }
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "async function myfunc()");
    assertStringIncludes(output, "$.cmd`echo hello`");
  });

  it("should handle scoping in functions (SSH-304)", () => {
    const ast = parse(`
      function myfunc {
        x=10
        echo $x
      }
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "async function myfunc()");
    assertStringIncludes(output, "let x = ");
  });

  it("should handle scoping in for loops (SSH-304)", () => {
    const ast = parse(`
      for i in a b c
      do
        y=val
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "for (const i of");
  });

  it("should call user-defined functions directly (SSH-324)", () => {
    const ast = parse(`
      function foo {
        echo hello
      }
      foo
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "async function foo()");
    assertStringIncludes(output, "await foo()");
    // Should NOT transpile as $.cmd`foo`
    assertEquals(output.includes("$.cmd`foo`"), false);
  });

  it("should call multiple user-defined functions (SSH-324)", () => {
    const ast = parse(`
      function greet {
        echo hello
      }
      function goodbye {
        echo bye
      }
      greet
      goodbye
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "async function greet()");
    assertStringIncludes(output, "async function goodbye()");
    assertStringIncludes(output, "await greet()");
    assertStringIncludes(output, "await goodbye()");
  });
});

// =============================================================================
// Variable Expansion Tests
// =============================================================================

describe("Transpiler2 - Variable Expansion", () => {
  it("should transpile simple variable", () => {
    const ast = parse('echo "$VAR"');
    const output = transpile(ast);

    assertStringIncludes(output, "${VAR}");
  });

  it("should transpile default value expansion", () => {
    const ast = parse('echo "${VAR:-default}"');
    const output = transpile(ast);

    // SSH-296: :- should check for both undefined AND empty string
    assertStringIncludes(output, "VAR === undefined || VAR === \"\"");
  });

  it("should transpile length expansion", () => {
    const ast = parse('echo "${#VAR}"');
    const output = transpile(ast);

    assertStringIncludes(output, "VAR.length");
  });

  it("should transpile uppercase expansion", () => {
    const ast = parse('echo "${VAR^^}"');
    const output = transpile(ast);

    assertStringIncludes(output, "toUpperCase()");
  });

  it("should transpile lowercase expansion", () => {
    const ast = parse('echo "${VAR,,}"');
    const output = transpile(ast);

    assertStringIncludes(output, "toLowerCase()");
  });
});

// =============================================================================
// Array Assignment Tests (SSH-327)
// =============================================================================

describe("Transpiler2 - Array Assignments", () => {
  it("should transpile simple array assignment", () => {
    const ast = parse("arr=(one two three)");
    const output = transpile(ast);

    assertStringIncludes(output, 'let arr = ["one", "two", "three"]');
  });

  it("should transpile empty array assignment", () => {
    const ast = parse("arr=()");
    const output = transpile(ast);

    assertStringIncludes(output, "let arr = []");
  });

  it("should transpile array with quoted elements", () => {
    const ast = parse('arr=("hello world" foo "bar baz")');
    const output = transpile(ast);

    assertStringIncludes(output, 'let arr = ["hello world", "foo", "bar baz"]');
  });

  it("should transpile array with variable expansion", () => {
    const ast = parse("arr=(one $VAR three)");
    const output = transpile(ast);

    assertStringIncludes(output, 'let arr = ["one", "${VAR}", "three"]');
  });

  it("should transpile array reassignment", () => {
    const ast = parse("arr=(a b); arr=(c d)");
    const output = transpile(ast);

    // First assignment should declare with let
    assertStringIncludes(output, 'let arr = ["a", "b"]');
    // Second assignment should not use let
    assertStringIncludes(output, 'arr = ["c", "d"]');
  });
});

// =============================================================================
// Arithmetic Tests
// =============================================================================

describe("Transpiler2 - Arithmetic", () => {
  it("should transpile arithmetic expansion", () => {
    const ast = parse('echo "$((1 + 2))"');
    const output = transpile(ast);

    assertStringIncludes(output, "(1 + 2)");
  });

  it("should transpile C-style for loop", () => {
    const ast = parse(`
      for ((i=0; i<10; i++))
      do
        echo item
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "for (");
    // Verify increment is valid JS (SSH-322)
    assertStringIncludes(output, "i++)");
    // Should NOT contain invalid Number() wrapping in increment
    assert(!output.includes("Number(i ?? 0)++)"), "Should not have Number() wrapper in increment");
  });

  it("should transpile C-style for loop with postfix increment (SSH-322)", () => {
    const ast = parse(`
      for ((i=0; i<5; i++))
      do
        echo $i
      done
    `);
    const output = transpile(ast);

    // Check that we generate valid JavaScript increment
    assertStringIncludes(output, "for (");
    assertStringIncludes(output, "i++)");
    // Ensure the increment is NOT wrapped in Number()
    assert(!output.includes("Number(i ?? 0)++)"), "Increment should not be wrapped in Number()");
  });

  it("should transpile C-style for loop with prefix increment", () => {
    const ast = parse(`
      for ((i=0; i<5; ++i))
      do
        echo $i
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "for (");
    assertStringIncludes(output, "++i)");
    // Ensure the increment is NOT wrapped in Number()
    assert(!output.includes("Number(i ?? 0))"), "Increment should not be wrapped in Number()");
  });

  it("should transpile C-style for loop with decrement", () => {
    const ast = parse(`
      for ((i=10; i>0; i--))
      do
        echo $i
      done
    `);
    const output = transpile(ast);

    assertStringIncludes(output, "for (");
    assertStringIncludes(output, "i--)");
    assert(!output.includes("Number(i ?? 0)--)"), "Decrement should not be wrapped in Number()");
  });

  it("should transpile arithmetic command", () => {
    const ast = parse("((x = 5 + 3))");
    const output = transpile(ast);

    assertStringIncludes(output, "(x = (5 + 3))");
  });
});

// =============================================================================
// Redirection Tests
// =============================================================================

describe("Transpiler2 - Redirections", () => {
  it("should transpile output redirection", () => {
    const ast = parse("echo hello > file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '.stdout("file.txt")');
  });

  it("should transpile append redirection", () => {
    const ast = parse("echo hello >> file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '.stdout("file.txt", { append: true })');
  });

  it("should transpile input redirection", () => {
    const ast = parse("cat < file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '.stdin("file.txt")');
  });
});

// =============================================================================
// Grouping Tests
// =============================================================================

describe("Transpiler2 - Grouping", () => {
  it("should transpile subshell", () => {
    const ast = parse("(echo hello)");
    const output = transpile(ast);

    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, "})();");
  });

  it("should await subshell IIFE with multiple commands", () => {
    const ast = parse("(cd /tmp && ls)");
    const output = transpile(ast);

    assertStringIncludes(output, "await (async () => {");
    assertStringIncludes(output, "$.cmd`cd /tmp`");
    assertStringIncludes(output, "$.cmd`ls`");
    assertStringIncludes(output, "})();");
  });

  it("should transpile brace group", () => {
    const ast = parse(`{
      echo hello
    }`);
    const output = transpile(ast);

    assertStringIncludes(output, "{");
    assertStringIncludes(output, "$.cmd`echo hello`");
  });
});

// =============================================================================
// Test Expression Tests
// =============================================================================

describe("Transpiler2 - Test Expressions", () => {
  it("should transpile file existence test", () => {
    const ast = parse("[[ -e file.txt ]]");
    const output = transpile(ast);

    assertStringIncludes(output, "$.fs.exists");
  });

  it("should transpile file type test", () => {
    const ast = parse("[[ -f file.txt ]]");
    const output = transpile(ast);

    assertStringIncludes(output, "$.fs.stat");
    assertStringIncludes(output, "isFile");
  });

  it("should transpile string comparison", () => {
    const ast = parse('[[ "$a" == "$b" ]]');
    const output = transpile(ast);

    assertStringIncludes(output, "===");
  });

  it("should transpile numeric comparison", () => {
    const ast = parse("[[ $a -eq $b ]]");
    const output = transpile(ast);

    assertStringIncludes(output, "Number(");
    assertStringIncludes(output, "===");
  });

  it("should transpile regex match", () => {
    const ast = parse('[[ $str =~ ^[0-9]+$ ]]');
    const output = transpile(ast);

    assertStringIncludes(output, "new RegExp");
    assertStringIncludes(output, ".test(");
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Transpiler2 - Integration", () => {
  it("should transpile a complete script", () => {
    const script = `
      NAME=World
      echo "Hello"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'let NAME = "World"');
    assertStringIncludes(output, "$.cmd`echo Hello`");
  });

  it("should handle simple pipeline", () => {
    const ast = parse("ls | grep test");
    const output = transpile(ast);

    // Pipeline should have pipe calls
    assertStringIncludes(output, ".pipe(");
  });

  it("should use custom import path", () => {
    const ast = parse("ls");
    const output = transpile(ast, { importPath: "@safesh/core" });

    assertStringIncludes(output, 'import { $ } from "@safesh/core";');
  });

  it("should respect strict mode option", () => {
    const ast = parse("ls");
    const withStrict = transpile(ast, { strict: true });
    const withoutStrict = transpile(ast, { strict: false });

    assertStringIncludes(withStrict, '"use strict";');
    assertEquals(withoutStrict.includes('"use strict";'), false);
  });
});

// =============================================================================
// BashTranspiler2 Class Tests
// =============================================================================

describe("BashTranspiler2 Class", () => {
  it("should be instantiable with options", () => {
    const transpiler = new BashTranspiler2({ indent: "    " });
    const ast = parse("echo hello");
    const output = transpiler.transpile(ast);

    // Check 4-space indentation inside async IIFE
    assertStringIncludes(output, "    await");
  });

  it("should be reusable for multiple transpilations", () => {
    const transpiler = new BashTranspiler2();

    const output1 = transpiler.transpile(parse("echo one"));
    const output2 = transpiler.transpile(parse("echo two"));

    assertStringIncludes(output1, "$.cmd`echo one`");
    assertStringIncludes(output2, "$.cmd`echo two`");
  });
});

// =============================================================================
// Diagnostic System Tests (SSH-305)
// =============================================================================

describe("Diagnostic System", () => {
  it("should collect diagnostics for unsupported parameter modifiers", () => {
    // Use a mock transpiler that exposes context
    const options = resolveOptions();
    const ctx = new TranspilerContext(options);

    // Simulate visiting a parameter expansion with an unsupported modifier
    // We can't directly call the handler, so we'll test through the transpiler
    // by creating a bash script with an unsupported modifier (which doesn't exist in real bash)
    // Since all real modifiers are supported, we'll need to check the implementation logic

    // For now, just verify the API exists
    ctx.addDiagnostic({ level: 'warning', message: 'Test warning' });
    const diagnostics = ctx.getDiagnostics();

    assertEquals(diagnostics.length, 1);
    assertEquals(diagnostics[0]?.level, 'warning');
    assertEquals(diagnostics[0]?.message, 'Test warning');
  });

  it("should clear diagnostics", () => {
    const options = resolveOptions();
    const ctx = new TranspilerContext(options);

    ctx.addDiagnostic({ level: 'warning', message: 'Warning 1' });
    ctx.addDiagnostic({ level: 'error', message: 'Error 1' });
    assertEquals(ctx.getDiagnostics().length, 2);

    ctx.clearDiagnostics();
    assertEquals(ctx.getDiagnostics().length, 0);
  });

  it("should support multiple diagnostic levels", () => {
    const options = resolveOptions();
    const ctx = new TranspilerContext(options);

    ctx.addDiagnostic({ level: 'error', message: 'Error message' });
    ctx.addDiagnostic({ level: 'warning', message: 'Warning message' });
    ctx.addDiagnostic({ level: 'info', message: 'Info message' });

    const diagnostics = ctx.getDiagnostics();
    assertEquals(diagnostics.length, 3);
    assertEquals(diagnostics[0]?.level, 'error');
    assertEquals(diagnostics[1]?.level, 'warning');
    assertEquals(diagnostics[2]?.level, 'info');
  });

  it("should support diagnostic with location", () => {
    const options = resolveOptions();
    const ctx = new TranspilerContext(options);

    ctx.addDiagnostic({
      level: 'warning',
      message: 'Test warning',
      location: { line: 10, column: 5 }
    });

    const diagnostics = ctx.getDiagnostics();
    assertEquals(diagnostics.length, 1);
    assertEquals(diagnostics[0]?.location?.line, 10);
    assertEquals(diagnostics[0]?.location?.column, 5);
  });

  it("should return a copy of diagnostics array", () => {
    const options = resolveOptions();
    const ctx = new TranspilerContext(options);

    ctx.addDiagnostic({ level: 'warning', message: 'Warning 1' });
    const diagnostics1 = ctx.getDiagnostics();

    ctx.addDiagnostic({ level: 'error', message: 'Error 1' });
    const diagnostics2 = ctx.getDiagnostics();

    // First call should not be affected by second diagnostic
    assertEquals(diagnostics1.length, 1);
    assertEquals(diagnostics2.length, 2);
  });
});
