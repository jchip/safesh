/**
 * Tests for init() command registration
 *
 * Note: The permission checking logic is tested in src/core/command_permission.test.ts
 * These tests verify the init() function behavior when $config is not available
 * (file execution mode where Deno sandbox enforces permissions)
 */

import { assertEquals } from "@std/assert";
import { init } from "../src/stdlib/command.ts";

// ============================================================================
// Basic Registration Tests (No $config - file execution mode)
// ============================================================================

Deno.test("init - returns async function", async () => {
  // In file execution mode (no $config), init just creates wrappers
  const commands = await init({
    myTool: "./scripts/my-tool.sh",
  });

  assertEquals(commands.myTool.name, "myTool");
  assertEquals(commands.myTool.path, "./scripts/my-tool.sh");
});

Deno.test("init - registers multiple commands", async () => {
  const commands = await init({
    build: "./scripts/build.sh",
    test: "./scripts/test.sh",
  });

  assertEquals(commands.build.name, "build");
  assertEquals(commands.build.path, "./scripts/build.sh");
  assertEquals(commands.test.name, "test");
  assertEquals(commands.test.path, "./scripts/test.sh");
});

// ============================================================================
// Registered Command Interface Tests
// ============================================================================

Deno.test("init - registered command has correct interface", async () => {
  const commands = await init({
    myScript: "./scripts/my-script.sh",
  });

  // Check interface
  assertEquals(typeof commands.myScript.exec, "function");
  assertEquals(typeof commands.myScript.stream, "function");
  assertEquals(typeof commands.myScript.cmd, "function");
  assertEquals(commands.myScript.name, "myScript");
  assertEquals(commands.myScript.path, "./scripts/my-script.sh");
});

Deno.test("init - cmd() returns Command for piping", async () => {
  const commands = await init({
    myScript: "./scripts/my-script.sh",
  });

  // cmd() should return a Command object
  const cmd = commands.myScript.cmd(["--help"]);
  assertEquals(typeof cmd.exec, "function");
  assertEquals(typeof cmd.pipe, "function");
  assertEquals(typeof cmd.stream, "function");
});

Deno.test("init - basic command names work", async () => {
  // In file execution mode, basic names just create wrappers
  const commands = await init({
    git: "git",
    deno: "deno",
  });

  assertEquals(commands.git.name, "git");
  assertEquals(commands.git.path, "git");
  assertEquals(commands.deno.name, "deno");
  assertEquals(commands.deno.path, "deno");
});
