/**
 * Tests for Command Execution
 */

import { assertEquals, assert } from "@std/assert";
import { cmd, git, type StreamChunk } from "./command.ts";
import { lines } from "./transforms.ts";

Deno.test("cmd() - executes simple command", async () => {
  const result = await cmd("echo", ["hello"]).exec();

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "hello");
  assertEquals(result.stderr, "");
});

Deno.test("cmd() - captures stdout", async () => {
  const result = await cmd("echo", ["test output"]).exec();

  assertEquals(result.stdout.trim(), "test output");
  assertEquals(result.stderr, "");
  assertEquals(result.success, true);
});

Deno.test("cmd() - captures stderr", async () => {
  // Use a command that writes to stderr
  const result = await cmd("sh", [
    "-c",
    "echo error >&2",
  ]).exec();

  assertEquals(result.stdout, "");
  assertEquals(result.stderr.trim(), "error");
  assertEquals(result.success, true);
});

Deno.test("cmd() - handles non-zero exit codes", async () => {
  const result = await cmd("sh", ["-c", "exit 1"]).exec();

  assertEquals(result.success, false);
  assertEquals(result.code, 1);
});

Deno.test("cmd() - exec() with separate streams (default)", async () => {
  const result = await cmd("sh", [
    "-c",
    "echo stdout && echo stderr >&2",
  ]).exec();

  assertEquals(result.stdout.trim(), "stdout");
  assertEquals(result.stderr.trim(), "stderr");
  assertEquals(result.output, undefined);
});

Deno.test("cmd() - exec() with merged streams", async () => {
  const result = await cmd("sh", [
    "-c",
    "echo first && echo second >&2 && echo third",
  ], { mergeStreams: true }).exec();

  assert(result.output);
  assert(result.output.includes("first"));
  assert(result.output.includes("second"));
  assert(result.output.includes("third"));
  assertEquals(result.stdout, "");
  assertEquals(result.stderr, "");
});

Deno.test("cmd() - stream() yields stdout chunks", async () => {
  const chunks: StreamChunk[] = [];

  for await (const chunk of cmd("echo", ["test"]).stream()) {
    chunks.push(chunk);
  }

  const stdoutChunks = chunks.filter((c) => c.type === "stdout");
  const exitChunks = chunks.filter((c) => c.type === "exit");

  assertEquals(stdoutChunks.length, 1);
  assertEquals(stdoutChunks[0]?.data?.trim(), "test");
  assertEquals(exitChunks.length, 1);
  assertEquals(exitChunks[0]?.code, 0);
});

Deno.test("cmd() - stream() yields stderr chunks", async () => {
  const chunks: StreamChunk[] = [];

  for await (
    const chunk of cmd("sh", ["-c", "echo error >&2"]).stream()
  ) {
    chunks.push(chunk);
  }

  const stderrChunks = chunks.filter((c) => c.type === "stderr");

  assertEquals(stderrChunks.length >= 1, true);
  const allStderr = stderrChunks.map((c) => c.data).join("");
  assertEquals(allStderr.trim(), "error");
});

Deno.test("cmd() - stream() with mergeStreams", async () => {
  const chunks: StreamChunk[] = [];

  for await (
    const chunk of cmd("sh", [
      "-c",
      "echo out && echo err >&2",
    ], { mergeStreams: true }).stream()
  ) {
    chunks.push(chunk);
  }

  // With mergeStreams, all should be 'stdout' type
  const stdoutChunks = chunks.filter((c) => c.type === "stdout");
  const stderrChunks = chunks.filter((c) => c.type === "stderr");

  assertEquals(stderrChunks.length, 0);
  assert(stdoutChunks.length > 0);
});

Deno.test("cmd() - stdout() returns Stream", async () => {
  const lines_output = await cmd("echo", ["line1\nline2\nline3"])
    .stdout()
    .pipe(lines())
    .collect();

  assertEquals(lines_output.length, 3);
  assertEquals(lines_output[0], "line1");
  assertEquals(lines_output[1], "line2");
  assertEquals(lines_output[2], "line3");
});

Deno.test("cmd() - stderr() returns Stream", async () => {
  const stderr_output = await cmd("sh", [
    "-c",
    "echo err1 >&2 && echo err2 >&2",
  ])
    .stderr()
    .pipe(lines())
    .collect();

  assertEquals(stderr_output.length >= 1, true);
  const joined = stderr_output.join("\n");
  assert(joined.includes("err1"));
  assert(joined.includes("err2"));
});

Deno.test("cmd() - stdout() filters only stdout", async () => {
  const output = await cmd("sh", [
    "-c",
    "echo out && echo err >&2",
  ])
    .stdout()
    .collect();

  const text = output.join("");
  assert(text.includes("out"));
  assert(!text.includes("err"));
});

Deno.test("cmd() - stderr() filters only stderr", async () => {
  const output = await cmd("sh", [
    "-c",
    "echo out && echo err >&2",
  ])
    .stderr()
    .collect();

  const text = output.join("").trim();
  // stderr should contain "err" but not "out"
  assert(text.length > 0, "stderr should have content");
  assert(text.includes("err"), `Expected stderr to include "err", got: ${text}`);
  assert(
    !output.some((chunk) => chunk.includes("out")),
    `Expected stderr to not include "out", got: ${text}`,
  );
});

Deno.test("cmd() - works with cwd option", async () => {
  const tmpDir = await Deno.makeTempDir();

  try {
    await Deno.writeTextFile(`${tmpDir}/test.txt`, "content");

    const result = await cmd("cat", ["test.txt"], { cwd: tmpDir }).exec();

    assertEquals(result.stdout.trim(), "content");
    assertEquals(result.success, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("cmd() - works with env option", async () => {
  const result = await cmd("sh", ["-c", "echo $TEST_VAR"], {
    env: { TEST_VAR: "hello" },
  }).exec();

  assertEquals(result.stdout.trim(), "hello");
});

Deno.test("cmd() - clearEnv option", async () => {
  const result = await cmd("sh", ["-c", "echo TEST:$TEST_VAR"], {
    clearEnv: true,
    env: { TEST_VAR: "value" },
  }).exec();

  // With clearEnv, only explicitly set env vars should be present
  assertEquals(result.stdout.trim(), "TEST:value");
});

Deno.test("git() - executes git command", async () => {
  const result = await git("--version").exec();

  assertEquals(result.success, true);
  assert(result.stdout.includes("git version"));
});

Deno.test("git() - with multiple arguments", async () => {
  const tmpDir = await Deno.makeTempDir();

  try {
    // Initialize git repo
    await cmd("git", ["init"], { cwd: tmpDir }).exec();

    const result = await git({ cwd: tmpDir }, "status", "--short").exec();

    assertEquals(result.success, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("git() - with options first", async () => {
  const tmpDir = await Deno.makeTempDir();

  try {
    await cmd("git", ["init"], { cwd: tmpDir }).exec();

    const result = await git({ cwd: tmpDir }, "status").exec();

    assertEquals(result.success, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("integration - command stdout piped through transforms", async () => {
  const result = await cmd("echo", ["apple\nbanana\ncherry"])
    .stdout()
    .pipe(lines())
    .pipe(async function* (stream) {
      for await (const line of stream) {
        yield line.toUpperCase();
      }
    })
    .collect();

  assertEquals(result, ["APPLE", "BANANA", "CHERRY"]);
});

Deno.test("integration - filter command output", async () => {
  const result = await cmd("echo", ["line1\nerror: bad\nline2\nerror: fail"])
    .stdout()
    .pipe(lines())
    .pipe(async function* (stream) {
      for await (const line of stream) {
        if (line.includes("error")) {
          yield line;
        }
      }
    })
    .collect();

  assertEquals(result.length, 2);
  assertEquals(result[0], "error: bad");
  assertEquals(result[1], "error: fail");
});

Deno.test("integration - process both stdout and stderr", async () => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  // Need to create separate command instances for concurrent access
  const cmd1 = cmd("sh", [
    "-c",
    "echo out1 && echo out2",
  ]);

  const cmd2 = cmd("sh", [
    "-c",
    "echo err1 >&2 && echo err2 >&2",
  ]);

  // Process streams
  await cmd1.stdout().pipe(lines()).forEach((line) => {
    stdoutLines.push(line);
  });

  await cmd2.stderr().pipe(lines()).forEach((line) => {
    stderrLines.push(line);
  });

  assert(stdoutLines.join("").includes("out1"));
  assert(stdoutLines.join("").includes("out2"));
  assert(stderrLines.join("").includes("err1"));
  assert(stderrLines.join("").includes("err2"));
});

// ==================== stdin tests ====================

Deno.test("cmd() - stdin with string", async () => {
  const result = await cmd("cat", [], { stdin: "hello world" }).exec();

  assertEquals(result.stdout, "hello world");
  assertEquals(result.success, true);
});

Deno.test("cmd() - stdin with multi-line string (heredoc style)", async () => {
  const result = await cmd("sort", [], {
    stdin: `cherry
apple
banana`,
  }).exec();

  assertEquals(result.stdout, "apple\nbanana\ncherry\n");
  assertEquals(result.success, true);
});

Deno.test("cmd() - stdin with Uint8Array", async () => {
  const data = new TextEncoder().encode("binary data");
  const result = await cmd("cat", [], { stdin: data }).exec();

  assertEquals(result.stdout, "binary data");
  assertEquals(result.success, true);
});

Deno.test("cmd() - stdin with ReadableStream", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("stream "));
      controller.enqueue(new TextEncoder().encode("data"));
      controller.close();
    },
  });

  const result = await cmd("cat", [], { stdin: stream }).exec();

  assertEquals(result.stdout, "stream data");
  assertEquals(result.success, true);
});

Deno.test("cmd() - stdin with stream() method", async () => {
  const chunks: StreamChunk[] = [];

  for await (const chunk of cmd("cat", [], { stdin: "test input" }).stream()) {
    chunks.push(chunk);
  }

  const stdout = chunks
    .filter((c) => c.type === "stdout")
    .map((c) => c.data)
    .join("");
  assertEquals(stdout, "test input");

  const exitChunk = chunks.find((c) => c.type === "exit");
  assertEquals(exitChunk?.code, 0);
});

Deno.test("cmd() - stdin with stdout() method", async () => {
  const result = await cmd("cat", [], { stdin: "piped data" })
    .stdout()
    .collect();

  assertEquals(result.join(""), "piped data");
});

Deno.test("cmd() - stdin piped through sort (practical example)", async () => {
  const result = await cmd("sort", [], {
    stdin: "z\na\nm\n",
  })
    .stdout()
    .pipe(lines())
    .collect();

  assertEquals(result, ["a", "m", "z"]);
});

Deno.test("cmd() - stdin with large data (no deadlock)", async () => {
  // Generate 100KB of data to verify no deadlock
  const largeData = "x".repeat(100 * 1024);

  const result = await cmd("wc", ["-c"], { stdin: largeData }).exec();

  // wc -c should report the byte count
  const count = parseInt(result.stdout.trim(), 10);
  assertEquals(count, 100 * 1024);
  assertEquals(result.success, true);
});
