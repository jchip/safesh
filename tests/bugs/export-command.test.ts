/**
 * Bug test: export VAR=value should work as variable assignment + env export
 *
 * SSH-493: The parser treats `export VAR=value` as two separate statements:
 * 1. A command named "export" (fails with "Command not found")
 * 2. A standalone variable assignment VAR=value
 *
 * The transpiler already supports the `exported` flag on VariableAssignment
 * (SSH-306), but the parser never sets it.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

describe("Bug: export VAR=value", () => {
  it("should parse export with assignment as exported variable", () => {
    const ast = parse("export VAR=value");

    // Should have ONE pipeline (not two)
    assertEquals(ast.body.length, 1);

    // The pipeline should have one command with an exported assignment
    const pipeline = ast.body[0]!;
    if (pipeline.type === "Pipeline") {
      const cmd = pipeline.commands[0]!;
      if (cmd.type === "Command") {
        assertEquals(cmd.assignments.length, 1);
        assertEquals(cmd.assignments[0]!.name, "VAR");
        assertEquals(cmd.assignments[0]!.exported, true);
        // Command name should be empty (variable-assignment-only)
        assertEquals((cmd.name as { value: string }).value, "");
      }
    }
  });

  it("should transpile export VAR=value with Deno.env.set", () => {
    const code = transpileBash("export VAR=value");

    // Should declare the variable
    assertStringIncludes(code, "let VAR");
    // Should export to environment
    assertStringIncludes(code, 'Deno.env.set("VAR"');
    // Should NOT contain $.cmd("export") - export is not an external command
    assertEquals(code.includes('$.cmd("export")'), false);
    assertEquals(code.includes('__printCmd'), false);
  });

  it("should handle export with quoted value", () => {
    const code = transpileBash('export VAR="hello world"');

    assertStringIncludes(code, "let VAR");
    assertStringIncludes(code, 'Deno.env.set("VAR"');
    assertStringIncludes(code, "hello world");
  });

  it("should handle export with variable expansion in value", () => {
    const code = transpileBash('export PATH="$HOME/bin:$PATH"');

    assertStringIncludes(code, "let PATH");
    assertStringIncludes(code, 'Deno.env.set("PATH"');
    assertStringIncludes(code, "$.ENV.HOME");
    assertStringIncludes(code, "$.ENV.PATH");
  });

  it("should handle multiple export assignments", () => {
    const code = transpileBash("export VAR1=val1; export VAR2=val2");

    assertStringIncludes(code, "let VAR1");
    assertStringIncludes(code, "let VAR2");
    assertStringIncludes(code, 'Deno.env.set("VAR1"');
    assertStringIncludes(code, 'Deno.env.set("VAR2"');
  });

  it("should handle export with tilde expansion", () => {
    const code = transpileBash("export ANDROID_HOME=~/Library/Android/sdk");

    assertStringIncludes(code, "let ANDROID_HOME");
    assertStringIncludes(code, 'Deno.env.set("ANDROID_HOME"');
    assertStringIncludes(code, "Deno.env.get");
  });

  it("should handle export followed by && chain", () => {
    const code = transpileBash('export FOO=bar && echo $FOO');

    assertStringIncludes(code, "let FOO");
    assertStringIncludes(code, 'Deno.env.set("FOO"');
    assertStringIncludes(code, "$.echo(");
  });

  it("should handle readonly with assignment", () => {
    const ast = parse("readonly VAR=value");

    // Should be a single pipeline with assignment
    assertEquals(ast.body.length, 1);
    const pipeline = ast.body[0]!;
    if (pipeline.type === "Pipeline") {
      const cmd = pipeline.commands[0]!;
      if (cmd.type === "Command") {
        assertEquals(cmd.assignments.length, 1);
        assertEquals(cmd.assignments[0]!.name, "VAR");
      }
    }
  });

  it("should handle local with assignment", () => {
    const ast = parse("local VAR=value");

    assertEquals(ast.body.length, 1);
    const pipeline = ast.body[0]!;
    if (pipeline.type === "Pipeline") {
      const cmd = pipeline.commands[0]!;
      if (cmd.type === "Command") {
        assertEquals(cmd.assignments.length, 1);
        assertEquals(cmd.assignments[0]!.name, "VAR");
      }
    }
  });

  it("should still handle export -p as a command", () => {
    const ast = parse("export -p");

    // Should be a regular command (not variable assignment)
    const pipeline = ast.body[0]!;
    if (pipeline.type === "Pipeline") {
      const cmd = pipeline.commands[0]!;
      if (cmd.type === "Command") {
        assertEquals((cmd.name as { value: string }).value, "export");
        assertEquals(cmd.assignments.length, 0);
      }
    }
  });

  it("SSH-566: export PATH self-reference should not cause TDZ error", () => {
    // export PATH="$PATH:..." used to generate `let PATH = \`...\`` which
    // triggers "Cannot access 'PATH' before initialization" (TDZ error)
    // because `typeof PATH` on a let-declared variable in its own initializer throws.
    // Fix: split into `let PATH; PATH = ...;` so typeof sees undefined, not TDZ.
    const code = transpileBash(
      'export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"'
    );

    assertStringIncludes(code, 'Deno.env.set("PATH"');

    // Must split declaration and assignment for self-referencing variables
    assertStringIncludes(code, "let PATH;");

    // Execute to verify no TDZ error
    const bodyCode = code
      .replace(/import .*/g, "")
      .replace(/"use strict";/, "")
      .replace(/\(async \(\) => \{/, "")
      .replace(/\}\)\(\);/, "");
    const fn = new Function("$", "Deno", bodyCode + "; return PATH;");
    const mockEnv: Record<string, string> = { PATH: "/usr/bin", HOME: "/Users/test" };
    const result = fn(
      { ENV: mockEnv, VARS: {} },
      { env: { set: (k: string, v: string) => { mockEnv[k] = v; }, get: (k: string) => mockEnv[k] } },
    );
    assertStringIncludes(result, "/usr/bin");
    assertStringIncludes(result, "platform-tools");
  });

  it("SSH-566: non-export self-referencing assignment should not TDZ", () => {
    const code = transpileBash('PATH="$PATH:/usr/local/bin"');

    // Must split declaration and assignment
    assertStringIncludes(code, "let PATH;");

    const bodyCode = code
      .replace(/import .*/g, "")
      .replace(/"use strict";/, "")
      .replace(/\(async \(\) => \{/, "")
      .replace(/\}\)\(\);/, "");
    const fn = new Function("$", "Deno", bodyCode + "; return PATH;");
    const result = fn(
      { ENV: { PATH: "/usr/bin" }, VARS: {} },
      { env: { set: () => {}, get: () => undefined } },
    );
    assertStringIncludes(result, "/usr/bin");
    assertStringIncludes(result, "/usr/local/bin");
  });

  it("SSH-566: non-self-referencing export should use inline declaration", () => {
    const code = transpileBash('export FOO="bar"');
    // Should NOT split — no self-reference, so inline `let FOO = ...` is safe
    assertStringIncludes(code, 'let FOO = "bar"');
    assertStringIncludes(code, 'Deno.env.set("FOO"');
  });

  it("should handle the original failing command pattern", () => {
    const code = transpileBash(
      'export ANDROID_HOME=~/Library/Android/sdk && export PATH="$ANDROID_HOME/platform-tools:$PATH"'
    );

    // Both exports should work
    assertStringIncludes(code, "let ANDROID_HOME");
    assertStringIncludes(code, 'Deno.env.set("ANDROID_HOME"');
    assertStringIncludes(code, "let PATH");
    assertStringIncludes(code, 'Deno.env.set("PATH"');
    // Should NOT have $.cmd("export")
    assertEquals(code.includes('$.cmd("export")'), false);
  });
});
