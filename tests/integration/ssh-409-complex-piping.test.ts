/**
 * SSH-409: Test complex piped commands that were failing with 'transform is not a function'
 *
 * The bug occurs when piping external commands (find, wc, awk, column) through other commands.
 * The transpiler was incorrectly trying to wrap commands with $.toCmdLines() instead of direct piping.
 */

import { assertEquals, assert } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { cmd, initCmds } from "safesh:command";
import { cat } from "safesh:fs-streams";
import { lines } from "safesh:transforms";

const TEST_DIR = join(Deno.cwd(), ".temp", "ssh-409-test");

async function setup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
  await ensureDir(TEST_DIR);

  // Create test files
  await Deno.writeTextFile(
    join(TEST_DIR, "numbers.txt"),
    "5\n2\n8\n1\n9\n3\n",
  );

  await Deno.writeTextFile(
    join(TEST_DIR, "data.txt"),
    "10 hello\n20 world\n5 test\n",
  );
}

async function cleanup() {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

Deno.test({
  name: "SSH-409: Echo piped to awk (command to command)",
  async fn() {
    // Test command-to-command piping
    const result = await cmd("echo", ["10 hello"])
      .pipe(cmd("awk", ["{printf \"%-8s %s\\n\", $1, $2}"]))
      .exec();

    assertEquals(result.success, true, `Command should succeed. stderr: ${result.stderr}`);
    assert(result.stdout.includes("10"), "Should contain formatted output");
  },
});

Deno.test({
  name: "SSH-409: Cat piped to sort piped to head (three-stage pipeline)",
  async fn() {
    await setup();
    try {
      // Test three-stage pipeline: cat | sort | head
      const result = await cmd("cat", [join(TEST_DIR, "numbers.txt")])
        .pipe(cmd("sort", ["-n"]))
        .pipe(cmd("head", ["-3"]))
        .exec();

      assertEquals(result.success, true, `Pipeline should succeed. stderr: ${result.stderr}`);

      const outputLines = result.stdout.trim().split("\n");
      assertEquals(outputLines.length, 3, "Should have 3 lines from head");
      assertEquals(outputLines[0], "1", "First line should be 1");
      assertEquals(outputLines[1], "2", "Second line should be 2");
      assertEquals(outputLines[2], "3", "Third line should be 3");
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "SSH-409: Command piped to command with initCmds",
  async fn() {
    await setup();
    try {
      // Initialize commands for piping
      const [sort, head] = await initCmds(["sort", "head"]);

      // Test using CommandFn from initCmds
      const result = await cmd("cat", [join(TEST_DIR, "numbers.txt")])
        .pipe(sort!, ["-n"])
        .pipe(head!, ["-2"])
        .exec();

      assertEquals(result.success, true, `Pipeline should succeed. stderr: ${result.stderr}`);

      const outputLines = result.stdout.trim().split("\n");
      assertEquals(outputLines.length, 2, "Should have 2 lines from head");
      assertEquals(outputLines[0], "1", "First line should be 1");
      assertEquals(outputLines[1], "2", "Second line should be 2");
    } finally {
      await cleanup();
    }
  },
});
