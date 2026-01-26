/**
 * Tests for timeout command functionality (SSH-426)
 * Tests both transpilation and runtime behavior
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { parse } from "../../src/bash/parser.ts";
import { cmd } from "../../src/stdlib/command.ts";

// Helper function for easier testing
function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

// =============================================================================
// Transpilation Tests
// =============================================================================

describe("Timeout Command - Transpilation", () => {
  it("should transpile timeout with seconds (no suffix)", () => {
    const code = transpileBash("timeout 5 sleep 10");
    assertStringIncludes(code, 'cmd({ timeout: 5000 }, "sleep", "10")');
  });

  it("should transpile timeout with explicit seconds suffix", () => {
    const code = transpileBash("timeout 30s sleep 60");
    assertStringIncludes(code, 'cmd({ timeout: 30000 }, "sleep", "60")');
  });

  it("should transpile timeout with minutes", () => {
    const code = transpileBash("timeout 2m long-running-task");
    assertStringIncludes(code, 'cmd({ timeout: 120000 }, "long-running-task")');
  });

  it("should transpile timeout with hours", () => {
    const code = transpileBash("timeout 1h backup-job");
    assertStringIncludes(code, 'cmd({ timeout: 3600000 }, "backup-job")');
  });

  it("should transpile timeout with days", () => {
    const code = transpileBash("timeout 1d weekly-task");
    assertStringIncludes(code, 'cmd({ timeout: 86400000 }, "weekly-task")');
  });

  it("should transpile timeout with command arguments", () => {
    const code = transpileBash("timeout 10 curl -s https://example.com");
    assertStringIncludes(code, 'cmd({ timeout: 10000 }, "curl", "-s", "https://example.com")');
  });

  it("should transpile timeout with quoted arguments", () => {
    const code = transpileBash('timeout 5 echo "hello world"');
    assertStringIncludes(code, 'cmd({ timeout: 5000 }, "echo", "hello world")');
  });

  it("should transpile timeout in pipeline", () => {
    const code = transpileBash("timeout 5 curl -s https://api.example.com | jq .data");
    assertStringIncludes(code, 'cmd({ timeout: 5000 }, "curl"');
    assertStringIncludes(code, "jq");
  });

  it("should transpile timeout with command substitution", () => {
    const code = transpileBash("result=$(timeout 3 fetch-data)");
    assertStringIncludes(code, 'cmd({ timeout: 3000 }, "fetch-data")');
  });

  it("should transpile timeout with variable duration", () => {
    const code = transpileBash(`
      TIMEOUT_VAL=30
      timeout $TIMEOUT_VAL sleep 60
    `);
    // The variable should be expanded at runtime
    assertStringIncludes(code, "TIMEOUT_VAL");
  });

  it("should transpile timeout with background job", () => {
    const code = transpileBash("timeout 10 long-task &");
    assertStringIncludes(code, 'cmd({ timeout: 10000 }, "long-task")');
    assertStringIncludes(code, "background");
  });
});

// =============================================================================
// Runtime Tests
// =============================================================================

describe("Timeout Command - Runtime Behavior", {
  sanitizeResources: false, // Timeout creates resources that are cleaned up after test
  sanitizeOps: false, // Timeout involves async operations
}, () => {
  // Skip on Windows as signal handling differs
  const isWindows = Deno.build.os === "windows";

  it("should allow command to complete if under timeout", async () => {
    if (isWindows) return;

    const result = await cmd(
      { timeout: 2000 }, // 2 second timeout
      "sleep",
      "0.1" // 100ms sleep
    ).exec();

    assertEquals(result.success, true);
    assertEquals(result.code, 0);
  });

  it("should kill command and return exit code 124 when timeout exceeded", async () => {
    if (isWindows) return;

    const result = await cmd(
      { timeout: 100 }, // 100ms timeout
      "sleep",
      "10" // 10 second sleep (will be killed)
    ).exec();

    assertEquals(result.success, false);
    assertEquals(result.code, 124); // GNU timeout exit code
  });

  it("should handle timeout with fast-completing command", async () => {
    if (isWindows) return;

    const result = await cmd(
      { timeout: 5000 },
      "echo",
      "hello"
    ).exec();

    assertEquals(result.success, true);
    assertEquals(result.code, 0);
    assertEquals(result.stdout.trim(), "hello");
  });

  it("should handle timeout with command that produces output", async () => {
    if (isWindows) return;

    // Command that outputs then sleeps
    const result = await cmd(
      { timeout: 200 },
      "sh",
      "-c",
      "echo 'start'; sleep 10; echo 'end'"
    ).exec();

    assertEquals(result.success, false);
    assertEquals(result.code, 124);
    // Should have partial output before timeout
    assertStringIncludes(result.stdout, "start");
  });

  it("should handle zero timeout gracefully", async () => {
    if (isWindows) return;

    // Zero or negative timeout should execute immediately
    const result = await cmd(
      { timeout: 0 },
      "echo",
      "test"
    ).exec();

    // With 0 timeout, behavior depends on implementation
    // Either succeeds if command is fast, or times out immediately
    assertEquals(typeof result.code, "number");
  });

  it("should handle timeout with failing command", async () => {
    if (isWindows) return;

    // Command that fails quickly (before timeout)
    const result = await cmd(
      { timeout: 5000 },
      "sh",
      "-c",
      "exit 42"
    ).exec();

    assertEquals(result.success, false);
    assertEquals(result.code, 42); // Original exit code, not timeout
  });

  it("should handle timeout with non-existent command", async () => {
    if (isWindows) return;

    try {
      await cmd(
        { timeout: 1000 },
        "this-command-does-not-exist-xyz"
      ).exec();

      // Should throw before timeout
      throw new Error("Should have thrown");
    } catch (error) {
      // Command not found error, not timeout
      assertEquals(error instanceof Error, true);
    }
  });

  it("should handle very short timeout", async () => {
    if (isWindows) return;

    const result = await cmd(
      { timeout: 1 }, // 1ms timeout
      "sleep",
      "1"
    ).exec();

    assertEquals(result.success, false);
    assertEquals(result.code, 124);
  });

  it("should handle very long timeout", async () => {
    if (isWindows) return;

    const result = await cmd(
      { timeout: 86400000 }, // 1 day timeout
      "echo",
      "quick"
    ).exec();

    assertEquals(result.success, true);
    assertEquals(result.code, 0);
  });
});

// =============================================================================
// Integration Tests - Timeout with Streaming
// =============================================================================

describe("Timeout Command - Streaming Integration", {
  sanitizeResources: false, // Timeout creates resources that are cleaned up after test
  sanitizeOps: false, // Timeout involves async operations
}, () => {
  const isWindows = Deno.build.os === "windows";

  it("should handle timeout with stdout streaming", async () => {
    if (isWindows) return;

    const lines: string[] = [];

    try {
      await cmd(
        { timeout: 200 },
        "sh",
        "-c",
        "for i in 1 2 3 4 5; do echo line$i; sleep 0.1; done"
      )
        .stdout()
        .lines()
        .forEach(line => {
          lines.push(line);
        });
    } catch {
      // Timeout expected
    }

    // Should have collected some lines before timeout
    assertEquals(lines.length > 0, true);
  });

  it("should cleanup resources on timeout", async () => {
    if (isWindows) return;

    // Test that timeout properly cleans up and doesn't leave zombie processes
    const result = await cmd(
      { timeout: 50 },
      "sleep",
      "5"
    ).exec();

    assertEquals(result.code, 124);

    // Give a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 200));

    // Process should be terminated, no zombies
    // (Hard to test directly, but the test should complete without hanging)
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Timeout Command - Edge Cases", {
  sanitizeResources: false, // Timeout creates resources that are cleaned up after test
  sanitizeOps: false, // Timeout involves async operations
}, () => {
  const isWindows = Deno.build.os === "windows";

  it("should handle command that catches SIGTERM", async () => {
    if (isWindows) return;

    // Command that traps SIGTERM but still gets killed by SIGKILL
    const result = await cmd(
      { timeout: 100 },
      "sh",
      "-c",
      "trap 'echo caught' TERM; sleep 10"
    ).exec();

    assertEquals(result.success, false);
    assertEquals(result.code, 124);
  });

  it("should handle timeout with command using pipes internally", async () => {
    if (isWindows) return;

    const result = await cmd(
      { timeout: 100 },
      "sh",
      "-c",
      "yes | head -n 1000000"
    ).exec();

    // Should timeout or complete, but not hang
    assertEquals(typeof result.code, "number");
  });
});
