/**
 * Tests for initCmds() command registration
 *
 * Note: The permission checking logic is tested in src/core/command_permission.test.ts
 * These tests verify the initCmds() function behavior when $.config is not available
 * (file execution mode where Deno sandbox enforces permissions)
 */

import { assertEquals } from "@std/assert";
import { CMD_NAME_SYMBOL, initCmds } from "../src/stdlib/command.ts";

// ============================================================================
// Basic Registration Tests (No $.config - file execution mode)
// ============================================================================

Deno.test("initCmds - returns callable functions", async () => {
  // In file execution mode (no $.config), initCmds just creates callable wrappers
  const [myTool] = await initCmds(["./scripts/my-tool.sh"]);

  // Should be a function
  assertEquals(typeof myTool, "function");
});

Deno.test("initCmds - registers multiple commands", async () => {
  const [build, test] = await initCmds([
    "./scripts/build.sh",
    "./scripts/test.sh",
  ]);

  assertEquals(typeof build, "function");
  assertEquals(typeof test, "function");
});

Deno.test("initCmds - basic command names work", async () => {
  // In file execution mode, basic names just create wrappers
  const [git, deno] = await initCmds(["git", "deno"]);

  assertEquals(typeof git, "function");
  assertEquals(typeof deno, "function");
});

Deno.test("initCmds - session allows exact relative path command", async () => {
  const globalWithDollar = globalThis as typeof globalThis & {
    $?: Record<symbol, unknown>;
  };
  const originalDollar = globalWithDollar.$;

  globalWithDollar.$ = {
    [Symbol.for("safesh.config")]: {
      allowedCommands: [],
      sessionAllowedCommands: ["./node_modules/.bin/mocha"],
      cwd: "/tmp/original",
      projectDir: "/tmp/project",
      allowProjectCommands: false,
    },
  };

  try {
    const [mocha] = await initCmds(["./node_modules/.bin/mocha"]);

    assertEquals(typeof mocha, "function");
    assertEquals(mocha![CMD_NAME_SYMBOL], "./node_modules/.bin/mocha");
  } finally {
    if (originalDollar === undefined) {
      delete globalWithDollar.$;
    } else {
      globalWithDollar.$ = originalDollar;
    }
  }
});
