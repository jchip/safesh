/**
 * Tests for initCmds() command registration
 *
 * Note: The permission checking logic is tested in src/core/command_permission.test.ts
 * These tests verify the initCmds() function behavior when $config is not available
 * (file execution mode where Deno sandbox enforces permissions)
 */

import { assertEquals } from "@std/assert";
import { initCmds } from "../src/stdlib/command.ts";

// ============================================================================
// Basic Registration Tests (No $config - file execution mode)
// ============================================================================

Deno.test("initCmds - returns callable functions", async () => {
  // In file execution mode (no $config), initCmds just creates callable wrappers
  const cmds = await initCmds({
    myTool: "./scripts/my-tool.sh",
  });

  // Should be a function
  assertEquals(typeof cmds.myTool, "function");
});

Deno.test("initCmds - registers multiple commands", async () => {
  const cmds = await initCmds({
    build: "./scripts/build.sh",
    test: "./scripts/test.sh",
  });

  assertEquals(typeof cmds.build, "function");
  assertEquals(typeof cmds.test, "function");
});

Deno.test("initCmds - basic command names work", async () => {
  // In file execution mode, basic names just create wrappers
  const cmds = await initCmds({
    git: "git",
    deno: "deno",
  });

  assertEquals(typeof cmds.git, "function");
  assertEquals(typeof cmds.deno, "function");
});
