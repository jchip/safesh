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
import { createSessionManager } from "../src/runtime/session.ts";
import type { SafeShellConfig, Session } from "../src/core/types.ts";

describe("Background Job Control", () => {
  let config: SafeShellConfig;
  let session: Session;
  const sessionManager = createSessionManager("/tmp/test");

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

    // Create a test session
    session = sessionManager.create({ cwd: "/tmp" });
  });

  afterEach(async () => {
    // Clean up any running jobs
    for (const job of session.jobs.values()) {
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
        session,
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
        session,
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
        session,
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
        session,
      );

      // Wait for job to exit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode, 1);
    });
  });

  describe("launchCommandJob", () => {
    it("launches a background job from command", async () => {
      const job = await launchCommandJob("echo", ["Hello", "World"], config, session);

      assertExists(job.id);
      assertExists(job.pid);
      assertEquals(job.status, "running");
      assertEquals(job.command, "echo Hello World");
      assertExists(job.startedAt);

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(job.stdout.trim(), "Hello World");
      assertEquals(job.status, "completed");
      assertEquals(job.exitCode, 0);
    });

    it("captures command output", async () => {
      const job = await launchCommandJob("ls", ["-la", "/tmp"], config, session);

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
        session,
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
        session,
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
        session,
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
        session,
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const output = getJobOutput(job);

      assertEquals(output.stdout.includes("stdout"), true);
      assertEquals(output.stderr.includes("stderr"), true);
    });
  });

  describe("killJob", () => {
    it("kills a running job", async () => {
      const job = await launchCommandJob("sleep", ["10"], config, session);

      assertEquals(job.status, "running");

      // Kill the job
      await killJob(job, "SIGTERM");

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode, -1);
    });

    it("supports different signals", async () => {
      const job = await launchCommandJob("sleep", ["10"], config, session);

      // Kill with SIGKILL
      await killJob(job, "SIGKILL");

      assertEquals(job.status, "failed");
    });

    it("throws error if job not running", async () => {
      const job = await launchCodeJob('console.log("done");', config, session);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      let errorThrown = false;
      try {
        await killJob(job, "SIGTERM");
      } catch (error) {
        errorThrown = true;
        assertEquals(
          error instanceof Error &&
            error.message.includes("not running"),
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
        session,
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
        session,
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
        session,
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
        session,
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
        session,
      );

      for await (const _chunk of streamJobOutput(job)) {
        // Consume stream
      }

      assertEquals(job.status, "failed");
      assertEquals(job.exitCode, 1);
    });
  });

  describe("Integration with SessionManager", () => {
    it("jobs are stored in session", async () => {
      const job = await launchCodeJob('console.log("test");', config, session);

      sessionManager.addJob(session.id, job);

      const retrieved = sessionManager.getJob(session.id, job.id);
      assertEquals(retrieved, job);
    });

    it("lists all jobs in session", async () => {
      const job1 = await launchCodeJob('console.log("1");', config, session);
      const job2 = await launchCodeJob('console.log("2");', config, session);

      sessionManager.addJob(session.id, job1);
      sessionManager.addJob(session.id, job2);

      const jobs = sessionManager.listJobs(session.id);
      assertEquals(jobs.length, 2);
    });

    it("session cleanup kills running jobs", async () => {
      const job = await launchCommandJob("sleep", ["10"], config, session);
      sessionManager.addJob(session.id, job);

      assertEquals(job.status, "running");

      // End session
      sessionManager.end(session.id);

      // Job should be killed
      assertEquals(job.status, "failed");
    });
  });
});
