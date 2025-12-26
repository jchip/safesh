/**
 * Tests for streaming execution functionality
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { executeCodeStreaming, runCommandStreaming } from "../src/runtime/executor_streaming.ts";
import type { SafeShellConfig, StreamChunk } from "../src/core/types.ts";

const testConfig: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
    run: ["echo", "deno"],
  },
  timeout: 5000,
};

Deno.test("executeCodeStreaming - streams stdout chunks", async () => {
  const chunks: StreamChunk[] = [];

  const code = `
    console.log("line 1");
    console.log("line 2");
    console.log("line 3");
  `;

  for await (const chunk of executeCodeStreaming(code, testConfig)) {
    chunks.push(chunk);
  }

  // Should have stdout chunks and an exit chunk
  const stdoutChunks = chunks.filter((c) => c.type === "stdout");
  const exitChunk = chunks.find((c) => c.type === "exit");

  assertEquals(stdoutChunks.length > 0, true, "Should have stdout chunks");
  assertEquals(exitChunk?.code, 0, "Should exit with code 0");

  // Combine all stdout data
  const allStdout = stdoutChunks.map((c) => c.data).join("");
  assertStringIncludes(allStdout, "line 1");
  assertStringIncludes(allStdout, "line 2");
  assertStringIncludes(allStdout, "line 3");
});

Deno.test("executeCodeStreaming - streams stderr chunks", async () => {
  const chunks: StreamChunk[] = [];

  const code = `
    console.error("error line 1");
    console.error("error line 2");
  `;

  for await (const chunk of executeCodeStreaming(code, testConfig)) {
    chunks.push(chunk);
  }

  const stderrChunks = chunks.filter((c) => c.type === "stderr");
  const allStderr = stderrChunks.map((c) => c.data).join("");

  assertStringIncludes(allStderr, "error line 1");
  assertStringIncludes(allStderr, "error line 2");
});

Deno.test("executeCodeStreaming - handles mixed stdout and stderr", async () => {
  const chunks: StreamChunk[] = [];

  const code = `
    console.log("stdout 1");
    console.error("stderr 1");
    console.log("stdout 2");
    console.error("stderr 2");
  `;

  for await (const chunk of executeCodeStreaming(code, testConfig)) {
    chunks.push(chunk);
  }

  const stdoutChunks = chunks.filter((c) => c.type === "stdout");
  const stderrChunks = chunks.filter((c) => c.type === "stderr");

  assertEquals(stdoutChunks.length > 0, true);
  assertEquals(stderrChunks.length > 0, true);

  const allStdout = stdoutChunks.map((c) => c.data).join("");
  const allStderr = stderrChunks.map((c) => c.data).join("");

  assertStringIncludes(allStdout, "stdout 1");
  assertStringIncludes(allStdout, "stdout 2");
  assertStringIncludes(allStderr, "stderr 1");
  assertStringIncludes(allStderr, "stderr 2");
});

Deno.test("executeCodeStreaming - returns non-zero exit code on error", async () => {
  const chunks: StreamChunk[] = [];

  const code = `throw new Error("test error");`;

  for await (const chunk of executeCodeStreaming(code, testConfig)) {
    chunks.push(chunk);
  }

  const exitChunk = chunks.find((c) => c.type === "exit");
  assertEquals(exitChunk !== undefined, true);
  assertEquals(exitChunk?.code !== 0, true, "Should have non-zero exit code");
});

Deno.test({
  name: "executeCodeStreaming - respects timeout",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const shortTimeoutConfig: SafeShellConfig = {
      ...testConfig,
      timeout: 100, // 100ms
    };

    try {
      const chunks: StreamChunk[] = [];
      for await (const chunk of executeCodeStreaming(
        'await new Promise(r => setTimeout(r, 5000));', // Sleep 5s
        shortTimeoutConfig,
      )) {
        chunks.push(chunk);
      }
      // Should not reach here
      assertEquals(true, false, "Should have thrown timeout error");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timed out");
    }
  },
});

Deno.test("runCommandStreaming - streams command output", async () => {
  const chunks: StreamChunk[] = [];

  for await (const chunk of runCommandStreaming(
    "echo",
    ["hello", "world"],
    Deno.cwd(),
    5000,
  )) {
    chunks.push(chunk);
  }

  const stdoutChunks = chunks.filter((c) => c.type === "stdout");
  const exitChunk = chunks.find((c) => c.type === "exit");

  const allStdout = stdoutChunks.map((c) => c.data).join("");
  assertStringIncludes(allStdout, "hello world");
  assertEquals(exitChunk?.code, 0);
});

Deno.test("runCommandStreaming - captures command stderr", async () => {
  const chunks: StreamChunk[] = [];

  // Use a command that outputs to stderr
  for await (const chunk of runCommandStreaming(
    "deno",
    ["eval", 'console.error("test error")'],
    Deno.cwd(),
    5000,
  )) {
    chunks.push(chunk);
  }

  const stderrChunks = chunks.filter((c) => c.type === "stderr");
  const allStderr = stderrChunks.map((c) => c.data).join("");

  assertStringIncludes(allStderr, "test error");
});

Deno.test("runCommandStreaming - returns non-zero exit code on command failure", async () => {
  const chunks: StreamChunk[] = [];

  // Use a command that will fail
  for await (const chunk of runCommandStreaming(
    "deno",
    ["eval", "Deno.exit(42)"],
    Deno.cwd(),
    5000,
  )) {
    chunks.push(chunk);
  }

  const exitChunk = chunks.find((c) => c.type === "exit");
  assertEquals(exitChunk?.code, 42);
});

Deno.test({
  name: "runCommandStreaming - respects timeout",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    try {
      const chunks: StreamChunk[] = [];
      for await (const chunk of runCommandStreaming(
        "deno",
        ["eval", 'await new Promise(r => setTimeout(r, 10000))'],
        Deno.cwd(),
        100, // 100ms timeout
      )) {
        chunks.push(chunk);
      }
      // Should not reach here
      assertEquals(true, false, "Should have thrown timeout error");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timed out");
    }
  },
});

Deno.test("executeCodeStreaming - streams output in real-time", async () => {
  const chunks: StreamChunk[] = [];
  const timestamps: number[] = [];

  const code = `
    console.log("chunk 1");
    await new Promise(r => setTimeout(r, 100));
    console.log("chunk 2");
    await new Promise(r => setTimeout(r, 100));
    console.log("chunk 3");
  `;

  for await (const chunk of executeCodeStreaming(code, testConfig)) {
    if (chunk.type === "stdout") {
      chunks.push(chunk);
      timestamps.push(Date.now());
    }
  }

  // Should receive chunks progressively, not all at once
  // Check that we got multiple stdout chunks
  assertEquals(chunks.length >= 3, true, "Should receive at least 3 stdout chunks");

  // If timestamps differ by at least 50ms, it confirms streaming
  if (timestamps.length >= 2) {
    const timeDiff = timestamps[timestamps.length - 1]! - timestamps[0]!;
    assertEquals(timeDiff > 50, true, "Chunks should arrive over time, not all at once");
  }
});
