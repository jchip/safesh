/**
 * Tests for runtime/jobs.ts - Background job control
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  launchCodeJob,
  launchCommandJob,
  getJobOutput,
  killJob,
  streamJobOutput,
} from "../src/runtime/jobs.ts";
import { createShellManager } from "../src/runtime/shell.ts";
import type { SafeShellConfig, Shell } from "../src/core/types.ts";

describe("Background Job Control", () => {
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
    // Clean up any running jobs
    for (const job of shell.jobs.values()) {
      if (job.status === "running" && job.process) {
        try {
          job.process.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }
    }

    // Give processes time to clean up
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe("launchCodeJob", () => {
    it("launches a background job from code", async () => {
      const job = await launchCodeJob(
        'console.log("Hello from background job");',
        config,
        shell,
      );

      assertExists(job.id);
      assertExists(job.pid);
      assertEquals(job.status, "running");
      assertEquals(job.code, 'console.log("Hello from background job");');
      assertEquals(job.stdout, "");
      assertEquals(job.stderr, "");
      assertExists(job.startedAt);

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check output was captured
      assertEquals(job.stdout.trim(), "Hello from background job");
      assertEquals(job.status, "completed");
      assertEquals(job.exitCode, 0);
    });

    it("captures stderr from code job", async () => {
      const job = await launchCodeJob(
        'console.error("Error message");',
        config,
        shell,
      );

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(job.stderr.trim(), "Error message");
      assertEquals(job.status, "completed");
    });

    it("handles failing code", async () => {
      const job = await launchCodeJob(
        'throw new Error("Test error");',
        config,
        shell,
      );

      // Wait for job to fail
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode !== 0, true);
    });

    it("sets failed status for non-zero exit", async () => {
      const job = await launchCodeJob(
        "Deno.exit(1);",
        config,
        shell,
      );

      // Wait for job to exit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode, 1);
    });
  });

  describe("launchCommandJob", () => {
    it("launches a background job from command", async () => {
      const job = await launchCommandJob("echo", ["Hello", "World"], config, shell);

      assertExists(job.id);
      assertExists(job.pid);
      assertEquals(job.status, "running");
      assertEquals(job.code, "echo Hello World");
      assertEquals(job.background, true);
      assertExists(job.startedAt);

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(job.stdout.trim(), "Hello World");
      assertEquals(job.status, "completed");
      assertEquals(job.exitCode, 0);
    });

    it("captures command output", async () => {
      const job = await launchCommandJob("ls", ["-la", "/tmp"], config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(job.stdout.length > 0, true);
      assertEquals(job.status, "completed");
    });

    it("handles command failure", async () => {
      // Try to cat a non-existent file
      const job = await launchCommandJob(
        "cat",
        ["/tmp/nonexistent-file-12345.txt"],
        config,
        shell,
      );

      // Wait for failure
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode !== 0, true);
      assertEquals(job.stderr.length > 0, true);
    });
  });

  describe("getJobOutput", () => {
    it("returns buffered output", async () => {
      const job = await launchCodeJob(
        'console.log("Line 1"); console.log("Line 2");',
        config,
        shell,
      );

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output = getJobOutput(job);

      assertEquals(output.stdout.includes("Line 1"), true);
      assertEquals(output.stdout.includes("Line 2"), true);
      assertEquals(output.offset > 0, true);
    });

    it("supports incremental reads with offset", async () => {
      const job = await launchCodeJob(
        'console.log("First output");',
        config,
        shell,
      );

      // Wait for initial output
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output1 = getJobOutput(job);
      const offset = output1.offset;

      // Get incremental output (should be empty since job completed)
      const output2 = getJobOutput(job, offset);

      assertEquals(output2.stdout, "");
      assertEquals(output2.offset >= offset, true);
    });

    it("returns stderr separately", async () => {
      const job = await launchCodeJob(
        'console.log("stdout"); console.error("stderr");',
        config,
        shell,
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output = getJobOutput(job);

      assertEquals(output.stdout.includes("stdout"), true);
      assertEquals(output.stderr.includes("stderr"), true);
    });
  });

  describe("killJob", () => {
    it("kills a running job", async () => {
      const job = await launchCommandJob("sleep", ["10"], config, shell);

      assertEquals(job.status, "running");

      // Kill the job
      await killJob(job, "SIGTERM");

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode, -1);
    });

    it("supports different signals", async () => {
      const job = await launchCommandJob("sleep", ["10"], config, shell);

      // Kill with SIGKILL
      await killJob(job, "SIGKILL");

      assertEquals(job.status, "failed");
    });

    it("throws error if job not running", async () => {
      const job = await launchCodeJob('console.log("done");', config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      let errorThrown = false;
      try {
        await killJob(job, "SIGTERM");
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

  describe("streamJobOutput", () => {
    it("streams output from running job", async () => {
      const job = await launchCodeJob(
        'console.log("Stream test");',
        config,
        shell,
      );

      const chunks: Array<{ type: string; data?: string; code?: number }> = [];

      for await (const chunk of streamJobOutput(job)) {
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
      const job = await launchCodeJob(
        'console.log("out"); console.error("err");',
        config,
        shell,
      );

      const chunks: Array<{ type: string; data?: string }> = [];

      for await (const chunk of streamJobOutput(job)) {
        if (chunk.type !== "exit") {
          chunks.push(chunk);
        }
      }

      const stdoutChunks = chunks.filter((c) => c.type === "stdout");
      const stderrChunks = chunks.filter((c) => c.type === "stderr");

      assertEquals(stdoutChunks.length > 0, true);
      assertEquals(stderrChunks.length > 0, true);
    });

    it("buffers output in job while streaming", async () => {
      const job = await launchCodeJob(
        'console.log("buffered");',
        config,
        shell,
      );

      for await (const _chunk of streamJobOutput(job)) {
        // Just consume the stream
      }

      // Job should have buffered the output
      assertEquals(job.stdout.includes("buffered"), true);
    });

    it("updates job status after streaming completes", async () => {
      const job = await launchCodeJob(
        'console.log("done");',
        config,
        shell,
      );

      for await (const _chunk of streamJobOutput(job)) {
        // Consume stream
      }

      assertEquals(job.status, "completed");
      assertEquals(job.exitCode, 0);
    });

    it("marks job as failed on non-zero exit", async () => {
      const job = await launchCodeJob(
        "Deno.exit(1);",
        config,
        shell,
      );

      for await (const _chunk of streamJobOutput(job)) {
        // Consume stream
      }

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode, 1);
    });
  });

  describe("Integration with SessionManager", () => {
    it("jobs are automatically stored in shell", async () => {
      const job = await launchCodeJob('console.log("test");', config, shell);

      // Job should already be in shell (added by launchCodeJob)
      const retrieved = shellManager.getJob(shell.id, job.id);
      assertEquals(retrieved, job);
    });

    it("jobs are added to shell by launch functions", async () => {
      const job1 = await launchCodeJob('console.log("1");', config, shell);
      const job2 = await launchCodeJob('console.log("2");', config, shell);

      // Jobs should already be in shell
      const jobs = shellManager.listJobs(shell.id);
      assertEquals(jobs.length >= 2, true);

      // Verify jobs are present
      assertEquals(shell.jobs.has(job1.id), true);
      assertEquals(shell.jobs.has(job2.id), true);
    });

    it("jobs can be looked up by PID", async () => {
      const job = await launchCodeJob('console.log("test");', config, shell);

      // Should be able to find job by PID
      const retrieved = shellManager.getJobByPid(shell.id, job.pid);
      assertEquals(retrieved, job);
    });

    it("shell cleanup kills running jobs", async () => {
      const job = await launchCommandJob("sleep", ["10"], config, shell);

      // Job is already in shell
      assertEquals(job.status, "running");

      // End shell
      shellManager.end(shell.id);

      // Job should be killed
      assertEquals(job.status, "failed");
    });

    it("job completedAt and duration are set", async () => {
      const job = await launchCodeJob('console.log("done");', config, shell);

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertExists(job.completedAt);
      assertExists(job.duration);
      assertEquals(job.duration >= 0, true);
    });
  });
});
