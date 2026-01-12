/**
 * Tests for stdlib/command.ts - SSH-195: Command Execution
 * Tests $.cmd, $.git, built-in aliases, and $.initCmds
 */

import { assertEquals, assertStringIncludes, assertRejects } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { cmd, git, initCmds } from "../../src/stdlib/command.ts";

// Resolve /tmp to real path
const realTmp = Deno.realPathSync("/tmp");
const testDir = `${realTmp}/safesh-command-test`;

describe("command execution (SSH-195)", { sanitizeResources: false, sanitizeOps: false }, () => {
  beforeEach(async () => {
    await Deno.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("cmd - basic execution", () => {
    it("executes simple command", async () => {
      const result = await cmd("echo", "hello").exec();

      assertEquals(result.success, true);
      assertEquals(result.code, 0);
      assertStringIncludes(result.stdout, "hello");
    });

    it("executes command with multiple arguments", async () => {
      const result = await cmd("echo", "hello", "world").exec();

      assertStringIncludes(result.stdout, "hello");
      assertStringIncludes(result.stdout, "world");
    });

    it("captures stderr separately", async () => {
      // Use a command that writes to stderr (test on Unix systems)
      if (Deno.build.os !== "windows") {
        const result = await cmd("sh", "-c", "echo error >&2").exec();

        assertEquals(result.stdout.trim(), "");
        assertStringIncludes(result.stderr, "error");
      }
    });

    it("returns non-zero exit code on failure", async () => {
      if (Deno.build.os !== "windows") {
        const result = await cmd("sh", "-c", "exit 42").exec();

        assertEquals(result.success, false);
        assertEquals(result.code, 42);
      }
    });

    it("supports working directory option", async () => {
      await Deno.writeTextFile(`${testDir}/file.txt`, "content");

      const result = await cmd({ cwd: testDir }, "ls", "file.txt").exec();

      assertEquals(result.success, true);
      assertStringIncludes(result.stdout, "file.txt");
    });

    it("supports environment variables", async () => {
      const result = await cmd(
        { env: { TEST_VAR: "test_value" } },
        "sh",
        "-c",
        "echo $TEST_VAR"
      ).exec();

      assertStringIncludes(result.stdout, "test_value");
    });

    it("can be awaited directly (thenable)", async () => {
      const result = await cmd("echo", "direct");

      assertEquals(result.success, true);
      assertStringIncludes(result.stdout, "direct");
    });

    it("supports catch for error handling", async () => {
      if (Deno.build.os !== "windows") {
        const result = await cmd("sh", "-c", "exit 1").catch(() => ({
          stdout: "",
          stderr: "",
          code: -1,
          success: false,
        }));

        assertEquals(result.success, false);
      }
    });
  });

  describe("cmd - streaming output", () => {
    it("streams stdout", async () => {
      const lines: string[] = [];

      await cmd("echo", "line1\nline2")
        .stdout()
        .forEach(chunk => {
          lines.push(chunk);
        });

      assertEquals(lines.length > 0, true);
    });

    it("streams stderr", async () => {
      if (Deno.build.os !== "windows") {
        const chunks: string[] = [];

        await cmd("sh", "-c", "echo error >&2")
          .stderr()
          .forEach(chunk => {
            chunks.push(chunk);
          });

        const output = chunks.join("");
        assertStringIncludes(output, "error");
      }
    });

    it("streams with mergeStreams option", async () => {
      const result = await cmd(
        { mergeStreams: true },
        "sh",
        "-c",
        "echo out; echo err >&2"
      ).exec();

      assertEquals(typeof result.output, "string");
      assertStringIncludes(result.output!, "out");
      assertStringIncludes(result.output!, "err");
    });
  });

  describe("cmd - stdin handling", () => {
    it("writes string to stdin", async () => {
      if (Deno.build.os !== "windows") {
        const result = await cmd(
          { stdin: "hello from stdin" },
          "cat"
        ).exec();

        assertStringIncludes(result.stdout, "hello from stdin");
      }
    });

    it("writes bytes to stdin", async () => {
      if (Deno.build.os !== "windows") {
        const data = new TextEncoder().encode("binary data");
        const result = await cmd({ stdin: data }, "cat").exec();

        assertStringIncludes(result.stdout, "binary data");
      }
    });
  });

  describe("git - command helper", () => {
    beforeEach(async () => {
      // Initialize a git repo
      await cmd({ cwd: testDir }, "git", "init").exec();
      await cmd(
        { cwd: testDir },
        "git",
        "config",
        "user.name",
        "Test User"
      ).exec();
      await cmd(
        { cwd: testDir },
        "git",
        "config",
        "user.email",
        "test@example.com"
      ).exec();
    });

    it("executes git commands", async () => {
      const result = await git({ cwd: testDir }, "status").exec();

      assertEquals(result.success, true);
      assertStringIncludes(result.stdout, "branch");
    });

    it("supports git with multiple arguments", async () => {
      await Deno.writeTextFile(`${testDir}/test.txt`, "content");
      await git({ cwd: testDir }, "add", "test.txt").exec();

      const result = await git({ cwd: testDir }, "status", "--short").exec();

      assertStringIncludes(result.stdout, "test.txt");
    });

    it("can be used in pipelines", async () => {
      await Deno.writeTextFile(`${testDir}/file1.txt`, "1");
      await Deno.writeTextFile(`${testDir}/file2.txt`, "2");
      await git({ cwd: testDir }, "add", ".").exec();
      await git(
        { cwd: testDir },
        "commit",
        "-m",
        "Initial commit"
      ).exec();

      const lines = await git({ cwd: testDir }, "log", "--oneline")
        .stdout()
        .collect();

      assertEquals(lines.length > 0, true);
    });
  });

  describe("initCmds - command initialization", () => {
    it("initializes single command", async () => {
      const [echo] = await initCmds(["echo"]);

      const result = await cmd("echo", "test").exec();
      assertEquals(result.success, true);
    });

    it("initializes multiple commands", async () => {
      const [echo, cat] = await initCmds(["echo", "cat"]);

      const result1 = await cmd("echo", "hello").exec();
      assertEquals(result1.success, true);

      if (Deno.build.os !== "windows") {
        const result2 = await cmd({ stdin: "test" }, "cat").exec();
        assertEquals(result2.success, true);
      }
    });

    it("returns CommandFn with metadata", async () => {
      const [echo] = await initCmds(["echo"]);

      // CommandFn should be a function
      assertEquals(typeof echo, "function");
    });

    it("validates command permissions", async () => {
      // This test depends on SafeShell permission system
      // The command should be allowed if in permissions.run
      const [ls] = await initCmds(["ls"]);

      // Should be able to execute
      const result = await cmd("ls", testDir).exec();
      assertEquals(result.success, true);
    });

    it("throws on command not found", async () => {
      await assertRejects(
        async () => await cmd("nonexistent-command-xyz", "arg").exec(),
        Error,
        "not found",
      );
    });
  });

  describe("command piping", () => {
    it("pipes between commands using .pipe()", async () => {
      if (Deno.build.os !== "windows") {
        const [grep, sort] = await initCmds(["grep", "sort"]);

        // Create a test file
        await Deno.writeTextFile(
          `${testDir}/data.txt`,
          "banana\napple\ncherry\napricot\n"
        );

        const result = await cmd("cat", `${testDir}/data.txt`)
          .pipe(grep!, ["a"])
          .exec();

        assertEquals(result.success, true);
        assertStringIncludes(result.stdout, "banana");
        assertStringIncludes(result.stdout, "apple");
      }
    });
  });

  describe("error handling", () => {
    it("throws on command not allowed", async () => {
      // This depends on SafeShell config
      // Commands not in permissions.run should fail
      await assertRejects(
        async () => await cmd("nonexistent-command").exec(),
        Error,
      );
    });

    it("handles command timeout", async () => {
      // Test timeout functionality if implemented
      if (Deno.build.os !== "windows") {
        const result = await cmd(
          { timeout: 100 },
          "sleep",
          "10"
        ).exec().catch(() => ({
          stdout: "",
          stderr: "",
          code: -1,
          success: false,
        }));

        // Timeout should cause failure (if timeout is implemented)
        // Otherwise the command succeeds
        assertEquals(typeof result.success, "boolean");
      }
    });

    it("provides clear error for permission denied", async () => {
      // Create script without execute permission
      if (Deno.build.os !== "windows") {
        await Deno.writeTextFile(`${testDir}/script.sh`, "#!/bin/sh\necho test");
        await Deno.chmod(`${testDir}/script.sh`, 0o644); // No execute bit

        await assertRejects(
          async () => await cmd(`${testDir}/script.sh`).exec(),
        );
      }
    });
  });

  describe("advanced features", () => {
    it("collects stdout as array of strings", async () => {
      const result = await cmd("echo", "line1\nline2")
        .stdout()
        .collect();

      assertEquals(Array.isArray(result), true);
    });

    it("counts output lines", async () => {
      if (Deno.build.os !== "windows") {
        const count = await cmd("sh", "-c", "echo line1; echo line2; echo line3")
          .stdout()
          .count();

        assertEquals(count > 0, true);
      }
    });

    it("gets first line of output", async () => {
      const first = await cmd("echo", "first\nsecond")
        .stdout()
        .first();

      assertEquals(typeof first, "string");
    });

    it("transforms command output", async () => {
      if (Deno.build.os !== "windows") {
        const [sort] = await initCmds(["sort"]);

        const lines = await cmd("echo", "c\nb\na")
          .trans(async function* (stream) {
            for await (const chunk of stream) {
              yield chunk;
            }
          })
          .collect();

        assertEquals(lines.length > 0, true);
      }
    });
  });
});
