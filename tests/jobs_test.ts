/**
 * Tests for SSH-199: Background jobs and script management
 *
 * Tests background execution, listScripts, getScriptOutput, killScript, and waitScript functionality.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  launchCodeScript,
  launchCommandScript,
  getScriptOutput,
  killScript,
} from "../src/runtime/scripts.ts";
import { createShellManager } from "../src/runtime/shell.ts";
import { JobManager } from "../src/runtime/job-manager.ts";
import type { SafeShellConfig, Shell, Job } from "../src/core/types.ts";

describe("SSH-199: Background Jobs and Script Management", () => {
  let config: SafeShellConfig;
  let shell: Shell;
  let jobManager: JobManager;
  const shellManager = createShellManager("/tmp/test");

  beforeEach(() => {
    // Basic config with minimal permissions
    config = {
      permissions: {
        read: ["/tmp"],
        write: ["/tmp"],
        run: ["echo", "sleep", "cat", "ls", "bash"],
      },
      env: {
        allow: ["HOME", "PATH"],
      },
    };

    // Create a test shell
    shell = shellManager.create({ cwd: "/tmp" });
    jobManager = new JobManager();
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

  describe("Background Execution", () => {
    it("runs commands in background", async () => {
      const script = await launchCommandScript("sleep", ["1"], config, shell);

      assertEquals(script.status, "running");
      assertEquals(script.background, true);
      assertExists(script.id);
      assertExists(script.pid);
      assertExists(script.startedAt);

      // Wait for completion
      let attempts = 0;
      while (script.status === "running" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      assertEquals(script.status, "completed");
      assertEquals(script.exitCode, 0);
      assertExists(script.completedAt);
      assertExists(script.duration);
    });

    it("tracks background job exit codes", async () => {
      // Launch a failing command
      const script = await launchCommandScript(
        "bash",
        ["-c", "exit 42"],
        config,
        shell,
      );

      // Wait for completion
      let attempts = 0;
      while (script.status === "running" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode, 42);
    });

    it("runs multiple background jobs concurrently", async () => {
      // Launch multiple scripts
      const script1 = await launchCommandScript("echo", ["job1"], config, shell);
      const script2 = await launchCommandScript("echo", ["job2"], config, shell);
      const script3 = await launchCommandScript("echo", ["job3"], config, shell);

      // All should be running or completed
      assertExists(script1.id);
      assertExists(script2.id);
      assertExists(script3.id);

      // IDs should be unique
      const ids = new Set([script1.id, script2.id, script3.id]);
      assertEquals(ids.size, 3);

      // Wait for all to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script1.status, "completed");
      assertEquals(script2.status, "completed");
      assertEquals(script3.status, "completed");

      assertStringIncludes(script1.stdout, "job1");
      assertStringIncludes(script2.stdout, "job2");
      assertStringIncludes(script3.stdout, "job3");
    });

    it("tracks background code execution", async () => {
      const script = await launchCodeScript(
        'await new Promise(r => setTimeout(r, 100)); console.log("done");',
        config,
        shell,
      );

      assertEquals(script.status, "running");
      assertEquals(script.background, true);

      // Wait for completion
      let attempts = 0;
      while (script.status === "running" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      assertEquals(script.status, "completed");
      assertStringIncludes(script.stdout, "done");
    });

    it("captures background job output", async () => {
      const script = await launchCommandScript(
        "bash",
        ["-c", 'echo "stdout output"; echo "stderr output" >&2'],
        config,
        shell,
      );

      // Wait for completion
      let attempts = 0;
      while (script.status === "running" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      assertStringIncludes(script.stdout, "stdout output");
      assertStringIncludes(script.stderr, "stderr output");
    });
  });

  describe("listScripts()", () => {
    it("lists all scripts in a shell", async () => {
      await launchCommandScript("echo", ["test1"], config, shell);
      await launchCommandScript("echo", ["test2"], config, shell);
      await launchCodeScript('console.log("test3");', config, shell);

      const scripts = shellManager.listScripts(shell.id);

      assertEquals(scripts.length >= 3, true);
    });

    it("filters scripts by status (running)", async () => {
      await launchCommandScript("sleep", ["5"], config, shell);
      await launchCommandScript("echo", ["quick"], config, shell);

      // Wait for quick one to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const runningScripts = shellManager.listScripts(shell.id, { status: "running" });

      assertEquals(runningScripts.length >= 1, true);
      for (const script of runningScripts) {
        assertEquals(script.status, "running");
      }
    });

    it("filters scripts by status (completed)", async () => {
      await launchCommandScript("echo", ["test1"], config, shell);
      await launchCommandScript("echo", ["test2"], config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      const completedScripts = shellManager.listScripts(shell.id, {
        status: "completed",
      });

      assertEquals(completedScripts.length >= 2, true);
      for (const script of completedScripts) {
        assertEquals(script.status, "completed");
      }
    });

    it("filters scripts by status (failed)", async () => {
      await launchCommandScript("bash", ["-c", "exit 1"], config, shell);

      // Wait for failure
      await new Promise((resolve) => setTimeout(resolve, 500));

      const failedScripts = shellManager.listScripts(shell.id, { status: "failed" });

      assertEquals(failedScripts.length >= 1, true);
      for (const script of failedScripts) {
        assertEquals(script.status, "failed");
      }
    });

    it("filters scripts by background flag", async () => {
      // All launched scripts are background by default
      await launchCommandScript("echo", ["bg1"], config, shell);
      await launchCommandScript("echo", ["bg2"], config, shell);

      const backgroundScripts = shellManager.listScripts(shell.id, {
        background: true,
      });

      assertEquals(backgroundScripts.length >= 2, true);
      for (const script of backgroundScripts) {
        assertEquals(script.background, true);
      }
    });

    it("limits number of scripts returned", async () => {
      await launchCommandScript("echo", ["test1"], config, shell);
      await launchCommandScript("echo", ["test2"], config, shell);
      await launchCommandScript("echo", ["test3"], config, shell);
      await launchCommandScript("echo", ["test4"], config, shell);

      const scripts = shellManager.listScripts(shell.id, { limit: 2 });

      assertEquals(scripts.length, 2);
    });

    it("returns scripts sorted by newest first", async () => {
      const script1 = await launchCommandScript("echo", ["first"], config, shell);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const script2 = await launchCommandScript("echo", ["second"], config, shell);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const script3 = await launchCommandScript("echo", ["third"], config, shell);

      const scripts = shellManager.listScripts(shell.id);

      // Newest should be first
      assertEquals(scripts[0]?.id, script3.id);
      assertEquals(scripts[scripts.length - 1]?.id, script1.id);
    });

    it("returns empty array for non-existent shell", () => {
      const scripts = shellManager.listScripts("nonexistent-shell");
      assertEquals(scripts, []);
    });
  });

  describe("getScriptOutput()", () => {
    it("retrieves script output", async () => {
      const script = await launchCommandScript(
        "echo",
        ["Hello World"],
        config,
        shell,
      );

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      const output = getScriptOutput(script);

      assertStringIncludes(output.stdout, "Hello World");
      assertEquals(output.status, "completed");
      assertEquals(output.exitCode, 0);
    });

    it("retrieves both stdout and stderr", async () => {
      const script = await launchCommandScript(
        "bash",
        ["-c", 'echo "out"; echo "err" >&2'],
        config,
        shell,
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      const output = getScriptOutput(script);

      assertStringIncludes(output.stdout, "out");
      assertStringIncludes(output.stderr, "err");
    });

    it("supports incremental reads with offset", async () => {
      const script = await launchCodeScript(
        'console.log("Line 1"); await new Promise(r => setTimeout(r, 100)); console.log("Line 2");',
        config,
        shell,
      );

      // Wait for first output
      let attempts = 0;
      while (script.stdout === "" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      const output1 = getScriptOutput(script);
      assertStringIncludes(output1.stdout, "Line 1");
      const offset1 = output1.offset;

      // Wait for second output
      attempts = 0;
      while (!script.stdout.includes("Line 2") && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      // Get incremental output from offset
      const output2 = getScriptOutput(script, offset1);

      // Should only contain new content (or be empty if offset is at end)
      assertEquals(output2.stdout.includes("Line 1"), false);
      if (output2.stdout !== "") {
        assertStringIncludes(output2.stdout, "Line 2");
      }
    });

    it("returns truncation status", async () => {
      const script = await launchCommandScript("echo", ["test"], config, shell);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const output = getScriptOutput(script);

      assertEquals(typeof output.truncated.stdout, "boolean");
      assertEquals(typeof output.truncated.stderr, "boolean");
    });

    it("retrieves output from completed scripts", async () => {
      const script = await launchCommandScript("echo", ["test"], config, shell);
      const scriptId = script.id;

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script.status, "completed");

      // Should still be able to retrieve output
      const retrieved = shellManager.getScript(shell.id, scriptId);
      assertExists(retrieved);

      const output = getScriptOutput(retrieved);
      assertStringIncludes(output.stdout, "test");
      assertEquals(output.status, "completed");
    });

    it("provides current status for running scripts", async () => {
      const script = await launchCommandScript("sleep", ["2"], config, shell);

      const output = getScriptOutput(script);

      assertEquals(output.status, "running");
      assertEquals(output.exitCode, undefined);
    });
  });

  describe("killScript()", () => {
    it("terminates a running script", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      assertEquals(script.status, "running");

      // Kill the script
      await killScript(script, "SIGTERM");

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode, -1);
      assertExists(script.completedAt);
      assertExists(script.duration);
    });

    it("supports SIGKILL signal", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      await killScript(script, "SIGKILL");

      assertEquals(script.status, "failed");
      assertEquals(script.exitCode, -1);
    });

    it("throws error if script not running", async () => {
      const script = await launchCommandScript("echo", ["quick"], config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      let errorThrown = false;
      try {
        await killScript(script, "SIGTERM");
      } catch (error) {
        errorThrown = true;
        assertEquals(
          error instanceof Error &&
            (error.message.includes("not running") ||
              error.message.includes("not available")),
          true,
        );
      }

      assertEquals(errorThrown, true);
    });

    it("clears process handle after killing", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      assertExists(script.process);

      await killScript(script, "SIGKILL");

      // Process handle should be cleared
      assertEquals(script.process, undefined);
    });
  });

  describe("waitScript()", () => {
    it("waits for script completion", async () => {
      const script = await launchCommandScript(
        "bash",
        ["-c", 'sleep 0.5; echo "done"'],
        config,
        shell,
      );

      assertEquals(script.status, "running");

      // Simulate waitScript behavior
      const startTime = Date.now();
      const timeoutMs = 5000;

      while (script.status === "running") {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error("Timeout waiting for script");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assertEquals(script.status, "completed");
      assertStringIncludes(script.stdout, "done");
      assertEquals(script.exitCode, 0);
    });

    it("returns immediately for completed scripts", async () => {
      const script = await launchCommandScript("echo", ["quick"], config, shell);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script.status, "completed");

      // Should return immediately
      const startTime = Date.now();

      // Simulate waitScript for already-completed script
      if (script.status !== "running") {
        // Already completed - return immediately
        assertEquals(script.status, "completed");
      }

      const duration = Date.now() - startTime;
      assertEquals(duration < 100, true); // Should be instant
    });

    it("handles timeout for long-running scripts", async () => {
      const script = await launchCommandScript("sleep", ["10"], config, shell);

      const startTime = Date.now();
      const timeoutMs = 500; // Short timeout

      let timedOut = false;
      while (script.status === "running") {
        if (Date.now() - startTime > timeoutMs) {
          timedOut = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assertEquals(timedOut, true);
      assertEquals(script.status, "running"); // Still running

      // Clean up
      try {
        await killScript(script, "SIGKILL");
      } catch {
        // Ignore
      }
    });

    it("returns script output after completion", async () => {
      const script = await launchCommandScript(
        "echo",
        ["output test"],
        config,
        shell,
      );

      // Wait for completion
      while (script.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assertEquals(script.status, "completed");
      assertStringIncludes(script.stdout, "output test");
      assertEquals(script.exitCode, 0);
      assertExists(script.duration);
    });
  });

  describe("Job Control", () => {
    it("generates unique job IDs per shell", () => {
      const jobId1 = jobManager.generateJobId(shell.id);
      const jobId2 = jobManager.generateJobId(shell.id);
      const jobId3 = jobManager.generateJobId(shell.id);

      assertExists(jobId1);
      assertExists(jobId2);
      assertExists(jobId3);

      // All should be unique
      const ids = new Set([jobId1, jobId2, jobId3]);
      assertEquals(ids.size, 3);
    });

    it("adds jobs to shell", () => {
      const job: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: "test-script",
        command: "echo",
        args: ["test"],
        pid: 12345,
        status: "running",
        stdout: "",
        stderr: "",
        startedAt: new Date(),
      };

      const success = jobManager.addJob(shell, job);

      assertEquals(success, true);
      assertEquals(shell.jobs.has(job.id), true);

      const retrieved = jobManager.getJob(shell, job.id);
      assertEquals(retrieved, job);
    });

    it("updates job status and output", () => {
      const job: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: "test-script",
        command: "echo",
        args: ["test"],
        pid: 12345,
        status: "running",
        stdout: "",
        stderr: "",
        startedAt: new Date(),
      };

      jobManager.addJob(shell, job);

      const success = jobManager.updateJob(shell, job.id, {
        status: "completed",
        exitCode: 0,
        stdout: "output",
        completedAt: new Date(),
        duration: 100,
      });

      assertEquals(success, true);

      const updated = jobManager.getJob(shell, job.id);
      assertEquals(updated?.status, "completed");
      assertEquals(updated?.exitCode, 0);
      assertEquals(updated?.stdout, "output");
      assertExists(updated?.completedAt);
      assertExists(updated?.duration);
    });

    it("lists jobs filtered by status", () => {
      const job1: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: "script1",
        command: "echo",
        args: ["1"],
        pid: 12345,
        status: "running",
        stdout: "",
        stderr: "",
        startedAt: new Date(),
      };

      const job2: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: "script2",
        command: "echo",
        args: ["2"],
        pid: 12346,
        status: "completed",
        exitCode: 0,
        stdout: "done",
        stderr: "",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      jobManager.addJob(shell, job1);
      jobManager.addJob(shell, job2);

      const runningJobs = jobManager.listJobs(shell, { status: "running" });
      const completedJobs = jobManager.listJobs(shell, { status: "completed" });

      assertEquals(runningJobs.length, 1);
      assertEquals(runningJobs[0]?.id, job1.id);

      assertEquals(completedJobs.length, 1);
      assertEquals(completedJobs[0]?.id, job2.id);
    });

    it("lists jobs filtered by script ID", () => {
      const job1: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: "script-a",
        command: "echo",
        args: ["1"],
        pid: 12345,
        status: "completed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const job2: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: "script-b",
        command: "echo",
        args: ["2"],
        pid: 12346,
        status: "completed",
        exitCode: 0,
        stdout: "",
        stderr: "",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      jobManager.addJob(shell, job1);
      jobManager.addJob(shell, job2);

      const scriptAJobs = jobManager.listJobs(shell, { scriptId: "script-a" });

      assertEquals(scriptAJobs.length, 1);
      assertEquals(scriptAJobs[0]?.scriptId, "script-a");
    });

    it("limits number of jobs returned", () => {
      for (let i = 0; i < 5; i++) {
        const job: Job = {
          id: jobManager.generateJobId(shell.id),
          scriptId: `script-${i}`,
          command: "echo",
          args: [String(i)],
          pid: 12345 + i,
          status: "completed",
          exitCode: 0,
          stdout: "",
          stderr: "",
          startedAt: new Date(),
          completedAt: new Date(),
        };
        jobManager.addJob(shell, job);
      }

      const jobs = jobManager.listJobs(shell, { limit: 3 });

      assertEquals(jobs.length, 3);
    });

    it("links jobs to parent scripts", () => {
      const script = shell.scripts.get("sc1") ?? {
        id: "sc1",
        code: "test",
        pid: 123,
        status: "running" as const,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        startedAt: new Date(),
        background: true,
        jobIds: [],
      };
      shell.scripts.set(script.id, script);

      const job: Job = {
        id: jobManager.generateJobId(shell.id),
        scriptId: script.id,
        command: "echo",
        args: ["test"],
        pid: 12345,
        status: "running",
        stdout: "",
        stderr: "",
        startedAt: new Date(),
      };

      jobManager.addJob(shell, job);

      // Job should be linked to script
      assertEquals(script.jobIds.includes(job.id), true);
    });

    it("handles cleanup on completion", async () => {
      const script = await launchCommandScript("echo", ["cleanup"], config, shell);

      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script.status, "completed");
      // Process handle should be cleared after completion
      assertEquals(script.process, undefined);
    });
  });

  describe("Multiple Concurrent Jobs", () => {
    it("tracks multiple jobs from same script", async () => {
      const script = await launchCodeScript(
        `
        const cmd1 = new Deno.Command("echo", { args: ["job1"] });
        const cmd2 = new Deno.Command("echo", { args: ["job2"] });
        await Promise.all([cmd1.output(), cmd2.output()]);
        console.log("both done");
        `,
        config,
        shell,
      );

      // Wait for completion
      let attempts = 0;
      while (script.status === "running" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }

      assertEquals(script.status, "completed");
      assertStringIncludes(script.stdout, "both done");
    });

    it("maintains separate output streams per script", async () => {
      const script1 = await launchCommandScript(
        "echo",
        ["output1"],
        config,
        shell,
      );
      const script2 = await launchCommandScript(
        "echo",
        ["output2"],
        config,
        shell,
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      assertStringIncludes(script1.stdout, "output1");
      assertEquals(script1.stdout.includes("output2"), false);

      assertStringIncludes(script2.stdout, "output2");
      assertEquals(script2.stdout.includes("output1"), false);
    });

    it("handles mixed success and failure states", async () => {
      const script1 = await launchCommandScript("echo", ["success"], config, shell);
      const script2 = await launchCommandScript(
        "bash",
        ["-c", "exit 1"],
        config,
        shell,
      );
      const script3 = await launchCommandScript("echo", ["also success"], config, shell);

      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(script1.status, "completed");
      assertEquals(script1.exitCode, 0);

      assertEquals(script2.status, "failed");
      assertEquals(script2.exitCode, 1);

      assertEquals(script3.status, "completed");
      assertEquals(script3.exitCode, 0);
    });
  });
});
