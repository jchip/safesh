/**
 * Tests for init() command registration
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";

// Mock the environment variable for project commands
function setProjectCommands(commands: Array<{ name: string; path: string }>): void {
  if (commands.length > 0) {
    Deno.env.set("SAFESH_PROJECT_COMMANDS", JSON.stringify(commands));
  } else {
    Deno.env.delete("SAFESH_PROJECT_COMMANDS");
  }
}

// Import init after setting up env mocks
import { init } from "../src/stdlib/command.ts";

// ============================================================================
// Permission Tests
// ============================================================================

Deno.test("init - throws when command not in allowed list", () => {
  // Clear any existing project commands
  setProjectCommands([]);

  assertThrows(
    () => {
      init({
        myTool: "./scripts/my-tool.sh",
      });
    },
    Error,
    "Project command(s) not allowed: myTool",
  );
});

Deno.test("init - throws with helpful message for multiple commands", () => {
  setProjectCommands([]);

  assertThrows(
    () => {
      init({
        tool1: "./scripts/tool1.sh",
        tool2: "./scripts/tool2.sh",
      });
    },
    Error,
    "tool1, tool2",
  );
});

Deno.test("init - succeeds when command is allowed", () => {
  setProjectCommands([
    { name: "myTool", path: "./scripts/my-tool.sh" },
  ]);

  const commands = init({
    myTool: "./scripts/my-tool.sh",
  });

  assertEquals(commands.myTool.name, "myTool");
  assertEquals(commands.myTool.path, "./scripts/my-tool.sh");
});

Deno.test("init - succeeds with multiple allowed commands", () => {
  setProjectCommands([
    { name: "build", path: "./scripts/build.sh" },
    { name: "test", path: "./scripts/test.sh" },
    { name: "deploy", path: "./scripts/deploy.sh" },
  ]);

  const commands = init({
    build: "./scripts/build.sh",
    test: "./scripts/test.sh",
  });

  assertEquals(commands.build.name, "build");
  assertEquals(commands.build.path, "./scripts/build.sh");
  assertEquals(commands.test.name, "test");
  assertEquals(commands.test.path, "./scripts/test.sh");
});

Deno.test("init - throws if path doesn't match", () => {
  setProjectCommands([
    { name: "build", path: "./scripts/build.sh" },
  ]);

  assertThrows(
    () => {
      init({
        build: "./other/build.sh", // wrong path
      });
    },
    Error,
    "Project command(s) not allowed: build",
  );
});

Deno.test("init - throws if name doesn't match", () => {
  setProjectCommands([
    { name: "build", path: "./scripts/build.sh" },
  ]);

  assertThrows(
    () => {
      init({
        compile: "./scripts/build.sh", // wrong name
      });
    },
    Error,
    "Project command(s) not allowed: compile",
  );
});

// ============================================================================
// Registered Command Tests
// ============================================================================

Deno.test("init - registered command has correct interface", () => {
  setProjectCommands([
    { name: "myScript", path: "./scripts/my-script.sh" },
  ]);

  const commands = init({
    myScript: "./scripts/my-script.sh",
  });

  // Check interface
  assertEquals(typeof commands.myScript.exec, "function");
  assertEquals(typeof commands.myScript.stream, "function");
  assertEquals(typeof commands.myScript.cmd, "function");
  assertEquals(commands.myScript.name, "myScript");
  assertEquals(commands.myScript.path, "./scripts/my-script.sh");
});

Deno.test("init - cmd() returns Command for piping", () => {
  setProjectCommands([
    { name: "myScript", path: "./scripts/my-script.sh" },
  ]);

  const commands = init({
    myScript: "./scripts/my-script.sh",
  });

  // cmd() should return a Command object
  const cmd = commands.myScript.cmd(["--help"]);
  assertEquals(typeof cmd.exec, "function");
  assertEquals(typeof cmd.pipe, "function");
  assertEquals(typeof cmd.stream, "function");
});

// ============================================================================
// Cleanup
// ============================================================================

// Clean up environment after tests
Deno.test("cleanup", () => {
  Deno.env.delete("SAFESH_PROJECT_COMMANDS");
});
