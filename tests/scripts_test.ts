/**
 * Tests for runtime/scripts.ts - Background script control
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  launchCodeScript,
  launchCommandScript,
  getScriptOutput,
  killScript,
  streamScriptOutput,
} from "../src/runtime/scripts.ts";
import { createShellManager } from "../src/runtime/shell.ts";
import type { SafeShellConfig, Shell } from "../src/core/types.ts";

describe("Background Script Control", () => {
  let config: SafeShellConfig;
  let shell: Shell;
  const shellManager = createShellManager("/tmp/test");

  beforeEach(() => {
    // Basic config with minimal permissions
    config = {
      permissions: {
        read: ["/tmp"],
        write: ["/tmp"],
        run: ["echo", "sleep", "cat", "ls"],
      },
      env: {
        allow: ["HOME", "PATH"],
      },
    };

    // Create a test shell
    shell = shellManager.create({ cwd: "/tmp" });
  });

  afterEach(async () => {
    // Clean up any running scripts
    for (const script of shell.scripts.values()) {
      if (script.status === "running" && script.process) {
        try {
          script.process.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }
    }

    // Give processes time to clean up
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe("launchCodeScript", () => {
    it("launches a background script from code", async () => {
      const script = await launchCodeScript(
        'console.log("Hello from background script");',
        config,
        shell,
      );

      assertExists(script.id);
      assertExists(script.pid);
      assertEquals(script.status, "running");
      assertEquals(script.code, 'console.log("Hello from background script");');
      assertEquals(script.stdout, "");
      assertEquals(script.stderr, "");
      assertExists(script.startedAt);

      // Wait for script to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check output was captured
      assertEquals(script.stdout.trim(), "Hello from background script");
      assertEquals(script.status, "completed");
      assertEquals(script.exitCode, 0);
    });

    it("captures stderr from code script", async () => {
      const script = await launchCodeScript(
        'console.error("Error message");',
        config,
        shell,
      );

      // Wait for script to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(script.stderr.trim(), "Error message");
      assertEquals(script.status, "completed");
    });

    it("handles failing code", async () => {
      const script = await launchCodeScript(
        'throw new Error("Test error");',
        config,
        shell,
      );

      // Wait for script to fail
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode !== 0, true);
    });

    it("sets failed status for non-zero exit", async () => {
      const script = await launchCodeScript(
        "Deno.exit(1);",
        config,
        shell,
      );

      // Wait for script to exit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode, 1);
    });
  });

  describe("launchCommandScript", () => {
    it("launches a background script from command", async () => {
      const script = await launchCommandScript("echo", ["Hello", "World"], config, shell);

      assertExists(script.id);
      assertExists(script.pid);
      assertEquals(script.status, "running");
      assertEquals(script.code, "echo Hello World");
      assertEquals(script.background, true);
      assertExists(script.startedAt);

      // Wait for script to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script.stdout.trim(), "Hello World");
      assertEquals(script.status, "completed");
      assertEquals(script.exitCode, 0);
    });

    it("captures command output", async () => {
      const script = await launchCommandScript("ls", ["-la", "/tmp"], config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script.stdout.length > 0, true);
      assertEquals(script.status, "completed");
    });

    it("handles command failure", async () => {
      // Try to cat a non-existent file
      const script = await launchCommandScript(
        "cat",
        ["/tmp/nonexistent-file-12345.txt"],
        config,
        shell,
      );

      // Wait for failure
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode !== 0, true);
      assertEquals(script.stderr.length > 0, true);
    });
  });

  describe("getScriptOutput", () => {
    it("returns buffered output", async () => {
      const script = await launchCodeScript(
        'console.log("Line 1"); console.log("Line 2");',
        config,
        shell,
      );

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output = getScriptOutput(script);

      assertEquals(output.stdout.includes("Line 1"), true);
      assertEquals(output.stdout.includes("Line 2"), true);
      assertEquals(output.offset > 0, true);
    });

    it("supports incremental reads with offset", async () => {
      const script = await launchCodeScript(
        'console.log("First output");',
        config,
        shell,
      );

      // Wait for initial output
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output1 = getScriptOutput(script);
      const offset = output1.offset;

      // Get incremental output (should be empty since script completed)
      const output2 = getScriptOutput(script, offset);

      assertEquals(output2.stdout, "");
      assertEquals(output2.offset >= offset, true);
    });

    it("returns stderr separately", async () => {
      const script = await launchCodeScript(
        'console.log("stdout"); console.error("stderr");',
        config,
        shell,
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output = getScriptOutput(script);

      assertEquals(output.stdout.includes("stdout"), true);
      assertEquals(output.stderr.includes("stderr"), true);
    });
  });

  describe("killScript", () => {
    it("kills a running script", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      assertEquals(script.status, "running");

      // Kill the script
      await killScript(script, "SIGTERM");

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode, -1);
    });

    it("supports different signals", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      // Kill with SIGKILL
      await killScript(script, "SIGKILL");

      assertEquals(script.status, "failed");
    });

    it("throws error if script not running", async () => {
      const script = await launchCodeScript('console.log("done");', config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      let errorThrown = false;
      try {
        await killScript(script, "SIGTERM");
      } catch (error) {
        errorThrown = true;
        // After completion, process handle is cleared so error will be about process not available
        assertEquals(
          error instanceof Error &&
            (error.message.includes("not running") ||
             error.message.includes("not available")),
          true,
        );
      }

      assertEquals(errorThrown, true);
    });
  });

  describe("streamScriptOutput", () => {
    it("streams output from running script", async () => {
      const script = await launchCodeScript(
        'console.log("Stream test");',
        config,
        shell,
      );

      const chunks: Array<{ type: string; data?: string; code?: number }> = [];

      for await (const chunk of streamScriptOutput(script)) {
        chunks.push(chunk);
      }

      // Should have stdout and exit chunks
      assertEquals(chunks.length >= 2, true);

      const stdoutChunks = chunks.filter((c) => c.type === "stdout");
      const exitChunks = chunks.filter((c) => c.type === "exit");

      assertEquals(stdoutChunks.length > 0, true);
      assertEquals(exitChunks.length, 1);
      assertEquals(exitChunks[0]?.code, 0);
    });

    it("streams both stdout and stderr", async () => {
      const script = await launchCodeScript(
        'console.log("out"); console.error("err");',
        config,
        shell,
      );

      const chunks: Array<{ type: string; data?: string }> = [];

      for await (const chunk of streamScriptOutput(script)) {
        if (chunk.type !== "exit") {
          chunks.push(chunk);
        }
      }

      const stdoutChunks = chunks.filter((c) => c.type === "stdout");
      const stderrChunks = chunks.filter((c) => c.type === "stderr");

      assertEquals(stdoutChunks.length > 0, true);
      assertEquals(stderrChunks.length > 0, true);
    });

    it("buffers output in script while streaming", async () => {
      const script = await launchCodeScript(
        'console.log("buffered");',
        config,
        shell,
      );

      for await (const _chunk of streamScriptOutput(script)) {
        // Just consume the stream
      }

      // Script should have buffered the output
      assertEquals(script.stdout.includes("buffered"), true);
    });

    it("updates script status after streaming completes", async () => {
      const script = await launchCodeScript(
        'console.log("done");',
        config,
        shell,
      );

      for await (const _chunk of streamScriptOutput(script)) {
        // Consume stream
      }

      assertEquals(script.status, "completed");
      assertEquals(script.exitCode, 0);
    });

    it("marks script as failed on non-zero exit", async () => {
      const script = await launchCodeScript(
        "Deno.exit(1);",
        config,
        shell,
      );

      for await (const _chunk of streamScriptOutput(script)) {
        // Consume stream
      }

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode, 1);
    });
  });

  describe("Integration with ShellManager", () => {
    it("scripts are automatically stored in shell", async () => {
      const script = await launchCodeScript('console.log("test");', config, shell);

      // Script should already be in shell (added by launchCodeScript)
      const retrieved = shellManager.getScript(shell.id, script.id);
      assertEquals(retrieved, script);
    });

    it("scripts are added to shell by launch functions", async () => {
      const script1 = await launchCodeScript('console.log("1");', config, shell);
      const script2 = await launchCodeScript('console.log("2");', config, shell);

      // Scripts should already be in shell
      const scripts = shellManager.listScripts(shell.id);
      assertEquals(scripts.length >= 2, true);

      // Verify scripts are present
      assertEquals(shell.scripts.has(script1.id), true);
      assertEquals(shell.scripts.has(script2.id), true);
    });

    it("scripts can be looked up by PID", async () => {
      const script = await launchCodeScript('console.log("test");', config, shell);

      // Should be able to find script by PID
      const retrieved = shellManager.getScriptByPid(shell.id, script.pid);
      assertEquals(retrieved, script);
    });

    it("shell cleanup kills running scripts", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      // Script is already in shell
      assertEquals(script.status, "running");

      // End shell
      shellManager.end(shell.id);

      // Script should be killed
      assertEquals(script.status, "failed");
    });

    it("script completedAt and duration are set", async () => {
      const script = await launchCodeScript('console.log("done");', config, shell);

      // Wait for script to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertExists(script.completedAt);
      assertExists(script.duration);
      assertEquals(script.duration >= 0, true);
    });
  });
});
