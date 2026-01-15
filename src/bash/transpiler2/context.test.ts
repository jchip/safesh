/**
 * Tests for TranspilerContext
 *
 * This test suite covers context management functionality including:
 * - Options management
 * - Indentation control
 * - Variable scoping
 * - Function registry
 * - Temporary variable generation
 * - Diagnostics
 */

import { assertEquals, assertExists } from "@std/assert";
import { TranspilerContext } from "./context.ts";
import type { ResolvedOptions } from "./types.ts";

// Helper to create minimal resolved options
function createTestOptions(overrides: Partial<ResolvedOptions> = {}): ResolvedOptions {
  return {
    indent: "  ",
    compatibility: "modern",
    noImplicitDeno: false,
    ...overrides,
  } as ResolvedOptions;
}

Deno.test("TranspilerContext - Options", async (t) => {
  await t.step("getOptions should return the resolved options", () => {
    const options = createTestOptions({ indent: "    " });
    const ctx = new TranspilerContext(options);

    const retrieved = ctx.getOptions();
    assertEquals(retrieved.indent, "    ");
    assertEquals(retrieved, options);
  });
});

Deno.test("TranspilerContext - Indentation", async (t) => {
  await t.step("setIndentLevel should set the indent level directly", () => {
    const ctx = new TranspilerContext(createTestOptions());

    ctx.setIndentLevel(5);
    assertEquals(ctx.getIndentLevel(), 5);
    assertEquals(ctx.getIndent(), "          "); // 5 * 2 spaces
  });

  await t.step("setIndentLevel should clamp negative values to 0", () => {
    const ctx = new TranspilerContext(createTestOptions());

    ctx.setIndentLevel(-5);
    assertEquals(ctx.getIndentLevel(), 0);
    assertEquals(ctx.getIndent(), "");
  });

  await t.step("setIndentLevel should handle zero", () => {
    const ctx = new TranspilerContext(createTestOptions());
    ctx.indent();
    ctx.indent();

    ctx.setIndentLevel(0);
    assertEquals(ctx.getIndentLevel(), 0);
  });
});

Deno.test("TranspilerContext - Temporary Variables", async (t) => {
  await t.step("resetTempVars should reset the counter to 0", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Generate some temp vars
    assertEquals(ctx.getTempVar(), "_tmp0");
    assertEquals(ctx.getTempVar(), "_tmp1");
    assertEquals(ctx.getTempVar(), "_tmp2");

    // Reset and verify it starts from 0 again
    ctx.resetTempVars();
    assertEquals(ctx.getTempVar(), "_tmp0");
    assertEquals(ctx.getTempVar(), "_tmp1");
  });

  await t.step("resetTempVars should work with custom prefix", () => {
    const ctx = new TranspilerContext(createTestOptions());

    assertEquals(ctx.getTempVar("_custom"), "_custom0");
    assertEquals(ctx.getTempVar("_custom"), "_custom1");

    ctx.resetTempVars();
    assertEquals(ctx.getTempVar("_custom"), "_custom0");
  });
});

Deno.test("TranspilerContext - Variable Scopes", async (t) => {
  await t.step("getVariable should return variable info from any scope", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Declare in global scope
    ctx.declareVariable("globalVar", "const", true);

    // Push a new scope
    ctx.pushScope();
    ctx.declareVariable("localVar", "let", false);

    // Should find both
    const globalInfo = ctx.getVariable("globalVar");
    assertExists(globalInfo);
    assertEquals(globalInfo.type, "const");
    assertEquals(globalInfo.initialized, true);

    const localInfo = ctx.getVariable("localVar");
    assertExists(localInfo);
    assertEquals(localInfo.type, "let");
    assertEquals(localInfo.initialized, false);
  });

  await t.step("getVariable should return undefined for undeclared variables", () => {
    const ctx = new TranspilerContext(createTestOptions());

    const result = ctx.getVariable("nonexistent");
    assertEquals(result, undefined);
  });

  await t.step("getVariable should traverse parent scopes", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Declare in global scope
    ctx.declareVariable("outer", "const", true);

    // Push multiple nested scopes
    ctx.pushScope();
    ctx.declareVariable("middle", "let", true);

    ctx.pushScope();
    ctx.declareVariable("inner", "const", false);

    // All should be accessible
    assertExists(ctx.getVariable("outer"));
    assertExists(ctx.getVariable("middle"));
    assertExists(ctx.getVariable("inner"));
  });

  await t.step("isInCurrentScope should only check current scope", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Declare in global scope
    ctx.declareVariable("globalVar", "const", true);
    assertEquals(ctx.isInCurrentScope("globalVar"), true);

    // Push a new scope
    ctx.pushScope();
    ctx.declareVariable("localVar", "let", false);

    // localVar is in current scope, globalVar is not
    assertEquals(ctx.isInCurrentScope("localVar"), true);
    assertEquals(ctx.isInCurrentScope("globalVar"), false);

    // But isDeclared should find both
    assertEquals(ctx.isDeclared("localVar"), true);
    assertEquals(ctx.isDeclared("globalVar"), true);
  });

  await t.step("isInCurrentScope should return false for undeclared", () => {
    const ctx = new TranspilerContext(createTestOptions());
    assertEquals(ctx.isInCurrentScope("nonexistent"), false);
  });
});

Deno.test("TranspilerContext - Comprehensive Variable Scope Tests", async (t) => {
  await t.step("should handle shadowing in nested scopes", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Declare in global scope
    ctx.declareVariable("x", "const", true);
    let info = ctx.getVariable("x");
    assertEquals(info?.type, "const");

    // Shadow in nested scope
    ctx.pushScope();
    ctx.declareVariable("x", "let", false);
    info = ctx.getVariable("x");
    assertEquals(info?.type, "let");
    assertEquals(info?.initialized, false);

    // Pop scope, should see original
    ctx.popScope();
    info = ctx.getVariable("x");
    assertEquals(info?.type, "const");
    assertEquals(info?.initialized, true);
  });

  await t.step("should handle deep nesting", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Create deep nesting
    ctx.declareVariable("level0", "const");
    ctx.pushScope();
    ctx.declareVariable("level1", "const");
    ctx.pushScope();
    ctx.declareVariable("level2", "const");
    ctx.pushScope();
    ctx.declareVariable("level3", "const");

    // All should be accessible
    assertExists(ctx.getVariable("level0"));
    assertExists(ctx.getVariable("level1"));
    assertExists(ctx.getVariable("level2"));
    assertExists(ctx.getVariable("level3"));

    // Only level3 is in current scope
    assertEquals(ctx.isInCurrentScope("level3"), true);
    assertEquals(ctx.isInCurrentScope("level2"), false);
    assertEquals(ctx.isInCurrentScope("level1"), false);
    assertEquals(ctx.isInCurrentScope("level0"), false);
  });
});

Deno.test("TranspilerContext - Edge Cases", async (t) => {
  await t.step("should handle empty variable name", () => {
    const ctx = new TranspilerContext(createTestOptions());

    ctx.declareVariable("", "const");
    assertEquals(ctx.isDeclared(""), true);
    assertEquals(ctx.isInCurrentScope(""), true);
    assertExists(ctx.getVariable(""));
  });

  await t.step("should handle special characters in variable names", () => {
    const ctx = new TranspilerContext(createTestOptions());

    ctx.declareVariable("_$special123", "let", false);
    assertEquals(ctx.isDeclared("_$special123"), true);
    const info = ctx.getVariable("_$special123");
    assertEquals(info?.type, "let");
    assertEquals(info?.initialized, false);
  });

  await t.step("should handle multiple pops on global scope", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Try to pop global scope multiple times
    ctx.popScope();
    ctx.popScope();
    ctx.popScope();

    // Should still be functional
    ctx.declareVariable("test", "const");
    assertEquals(ctx.isDeclared("test"), true);
  });
});

Deno.test("TranspilerContext - Integration Tests", async (t) => {
  await t.step("should maintain state consistency across operations", () => {
    const ctx = new TranspilerContext(createTestOptions());

    // Mix operations
    ctx.indent();
    ctx.declareVariable("var1", "const");
    const temp1 = ctx.getTempVar();

    ctx.pushScope();
    ctx.indent();
    ctx.declareVariable("var2", "let");
    const temp2 = ctx.getTempVar();

    // Verify state
    assertEquals(ctx.getIndentLevel(), 2);
    assertEquals(temp1, "_tmp0");
    assertEquals(temp2, "_tmp1");
    assertEquals(ctx.isDeclared("var1"), true);
    assertEquals(ctx.isDeclared("var2"), true);
    assertEquals(ctx.isInCurrentScope("var1"), false);
    assertEquals(ctx.isInCurrentScope("var2"), true);

    // Pop and verify
    ctx.popScope();
    ctx.dedent();
    assertEquals(ctx.getIndentLevel(), 1);
    assertEquals(ctx.isDeclared("var1"), true);
    assertEquals(ctx.isDeclared("var2"), false);
  });

  await t.step("should handle snapshot and restore", () => {
    const ctx = new TranspilerContext(createTestOptions());

    ctx.indent();
    ctx.indent();
    ctx.getTempVar();
    ctx.getTempVar();

    const snapshot = ctx.snapshot();
    assertEquals(snapshot.indentLevel, 2);
    assertEquals(snapshot.tempVarCounter, 2);

    // Make changes
    ctx.indent();
    ctx.getTempVar();
    assertEquals(ctx.getIndentLevel(), 3);
    assertEquals(ctx.getTempVar(), "_tmp3");

    // Restore
    ctx.restore(snapshot);
    assertEquals(ctx.getIndentLevel(), 2);
    assertEquals(ctx.getTempVar(), "_tmp2");
  });
});
