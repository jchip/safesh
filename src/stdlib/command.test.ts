/**
 * Tests for Command Execution
 */

import { assertEquals, assert } from "@std/assert";
import { cmd, Command, git, str, bytes, toCmd, toCmdLines, initCmds, type StreamChunk, type CommandFn } from "./command.ts";
import { lines, grep } from "./transforms.ts";
import { createStream } from "./stream.ts";
import { FluentStream } from "./fluent-stream.ts";

// Test commands - initialized once and reused
let _cat!: CommandFn;
let _grep!: CommandFn;
let _sort!: CommandFn;
let _head!: CommandFn;
let _wc!: CommandFn;
let _sh!: CommandFn;
let _initialized = false;

// Initialize test commands
async function initTestCmds() {
  if (_initialized) return;
  const cmds = await initCmds(["cat", "grep", "sort", "head", "wc", "sh"]);
  _cat = cmds[0]!;
  _grep = cmds[1]!;
  _sort = cmds[2]!;
  _head = cmds[3]!;
  _wc = cmds[4]!;
  _sh = cmds[5]!;
  _initialized = true;
}

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
    .trans(lines())
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
    .trans(lines())
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
    .trans(lines())
    .map((line) => line.toUpperCase())
    .collect();

  assertEquals(result, ["APPLE", "BANANA", "CHERRY"]);
});

Deno.test("integration - filter command output", async () => {
  const result = await cmd("echo", ["line1\nerror: bad\nline2\nerror: fail"])
    .stdout()
    .trans(lines())
    .filter((line) => line.includes("error"))
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
  await cmd1.stdout().trans(lines()).forEach((line) => {
    stdoutLines.push(line);
  });

  await cmd2.stderr().trans(lines()).forEach((line) => {
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
    .trans(lines())
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

// ==================== pipe() tests ====================

Deno.test("cmd().pipe() - simple two-command pipe", async () => {
  await initTestCmds();
  const result = await cmd("echo", ["hello world"]).pipe(_cat).exec();

  assertEquals(result.stdout.trim(), "hello world");
  assertEquals(result.success, true);
});

Deno.test("cmd().pipe() - pipe with filtering (grep)", async () => {
  await initTestCmds();
  const result = await cmd("echo", ["line1\nline2\nline3"])
    .pipe(_grep, ["line2"])
    .exec();

  assertEquals(result.stdout.trim(), "line2");
  assertEquals(result.success, true);
});

Deno.test("cmd().pipe() - multi-stage pipeline", async () => {
  await initTestCmds();
  const result = await cmd("echo", ["cherry\napple\nbanana"])
    .pipe(_sort)
    .pipe(_head, ["-n", "2"])
    .exec();

  assertEquals(result.stdout, "apple\nbanana\n");
  assertEquals(result.success, true);
});

Deno.test("cmd().pipe() - pipeline with transform", async () => {
  await initTestCmds();
  // Echo -> grep -> count lines
  const result = await cmd("echo", ["a\nb\nc\nd\ne"])
    .pipe(_grep, ["[aeiou]"]) // Filter vowels
    .pipe(_wc, ["-l"])
    .exec();

  // Should have 2 vowels: a, e
  const count = parseInt(result.stdout.trim(), 10);
  assertEquals(count, 2);
});

Deno.test("cmd().pipe() - with stdout() stream", async () => {
  await initTestCmds();
  const result = await cmd("echo", ["apple\nbanana\ncherry"])
    .pipe(_sort, ["-r"]) // reverse sort
    .stdout()
    .trans(lines())
    .collect();

  assertEquals(result, ["cherry", "banana", "apple"]);
});

Deno.test("cmd().pipe() - upstream failure throws error", async () => {
  await initTestCmds();
  // Use a command that will fail
  try {
    await cmd("sh", ["-c", "exit 1"]).pipe(_cat).exec();
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof Error);
    assert(error.message.includes("Pipeline failed"));
    assert(error.message.includes("code 1"));
  }
});

// ==================== str() and bytes() tests ====================

Deno.test("str() - simple heredoc-style usage", async () => {
  const result = await str("hello world").exec();

  assertEquals(result.stdout, "hello world");
  assertEquals(result.success, true);
});

Deno.test("str() - multi-line heredoc", async () => {
  const result = await str(`line 1
line 2
line 3`).exec();

  assertEquals(result.stdout, "line 1\nline 2\nline 3");
  assertEquals(result.success, true);
});

Deno.test("str() - piped to sort (heredoc equivalent)", async () => {
  await initTestCmds();
  const result = await str(`cherry
apple
banana`).pipe(_sort).exec();

  assertEquals(result.stdout, "apple\nbanana\ncherry\n");
  assertEquals(result.success, true);
});

Deno.test("str() - with variable interpolation", async () => {
  await initTestCmds();
  const name = "world";
  const result = await str(`Hello ${name}!`).pipe(_cat).exec();

  assertEquals(result.stdout, "Hello world!");
  assertEquals(result.success, true);
});

Deno.test("str() - multi-stage pipeline", async () => {
  await initTestCmds();
  const result = await str(`a
b
c
d
e`)
    .pipe(_grep, ["[aeiou]"])
    .pipe(_wc, ["-l"])
    .exec();

  const count = parseInt(result.stdout.trim(), 10);
  assertEquals(count, 2); // a, e
});

Deno.test("str() - with stdout() stream", async () => {
  await initTestCmds();
  const result = await str(`line1
line2
line3`)
    .pipe(_sort, ["-r"])
    .stdout()
    .trans(lines())
    .collect();

  assertEquals(result, ["line3", "line2", "line1"]);
});

Deno.test("bytes() - binary data passthrough", async () => {
  const raw = new TextEncoder().encode("binary data");
  const result = await bytes(raw).exec();

  assertEquals(result.stdout, "binary data");
  assertEquals(result.success, true);
});

Deno.test("bytes() - piped to command", async () => {
  await initTestCmds();
  const raw = new TextEncoder().encode("hello\nworld\n");
  const result = await bytes(raw).pipe(_wc, ["-l"]).exec();

  const count = parseInt(result.stdout.trim(), 10);
  assertEquals(count, 2);
});

// ==================== toCmd() and toCmdLines() tests ====================
// Note: toCmd/toCmdLines are low-level transforms. FluentStream.pipe() uses toCmdLines internally.

Deno.test("FluentStream.pipe() - pipes stream to command", async () => {
  await initTestCmds();
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "cherry";
      yield "apple";
      yield "banana";
    })(),
  ));

  const result = await stream.pipe(_sort).first();

  assertEquals(result, "apple");
});

Deno.test("FluentStream.pipe() - with command arguments", async () => {
  await initTestCmds();
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "cherry";
      yield "apple";
      yield "banana";
    })(),
  ));

  const result = await stream.pipe(_sort, ["-r"]).first();

  assertEquals(result, "cherry");
});

Deno.test("FluentStream.pipe() - collects all lines", async () => {
  await initTestCmds();
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "cherry";
      yield "apple";
      yield "banana";
    })(),
  ));

  const result = await stream.pipe(_sort).collect();

  assertEquals(result, ["apple", "banana", "cherry"]);
});

Deno.test("FluentStream.pipe() - with reverse sort", async () => {
  await initTestCmds();
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "a";
      yield "c";
      yield "b";
    })(),
  ));

  const result = await stream.pipe(_sort, ["-r"]).collect();

  assertEquals(result, ["c", "b", "a"]);
});

Deno.test("Command.trans() and FluentStream.pipe() - chained", async () => {
  await initTestCmds();
  const result = await cmd("echo", ["cherry\napple\nbanana"])
    .trans(lines())
    .pipe(_sort)
    .first();

  assertEquals(result, "apple");
});

Deno.test("toCmd() - failure throws error", async () => {
  await initTestCmds();
  const stream = createStream(
    (async function* () {
      yield "test";
    })(),
  );

  try {
    await new FluentStream(stream).pipe(_sh, ["-c", "exit 1"]).first();
    assert(false, "Should have thrown");
  } catch (error) {
    assert(error instanceof Error);
    assert(error.message.includes("toCmdLines failed"));
  }
});

// ==================== SSH-422: Command.pipe() with Transform functions ====================

Deno.test("SSH-422 - Command.pipe() with Transform function (grep)", async () => {
  // This test reproduces the bug where piping a Command to a Transform fails
  // Example: git("show", "commit:file").pipe(grep(/pattern/))
  // Now it returns a FluentStream, so we use collect() instead of exec()

  const result = await cmd("echo", ["line1\nline2 match\nline3"])
    .pipe(grep(/match/))
    .collect();

  // Should successfully pipe and filter
  assertEquals(result, ["line2 match"]);
});

Deno.test("SSH-422 - git().pipe() with grep transform", async () => {
  // Real-world example: git show commit:file | grep pattern
  // This simulates: git("log", "--oneline").pipe(grep(/pattern/))
  // Returns FluentStream, so we collect the results

  const result = await git("log", "--oneline", "-n", "5")
    .pipe(grep(/SSH-/))
    .collect();

  // Should successfully execute and filter git log output
  assert(result.length > 0, "Should find commits with SSH- prefix");
  assert(result.every(line => line.includes("SSH-")));
});

Deno.test("SSH-422 - Command.pipe() chaining with multiple transforms", async () => {
  // Test chaining: command | transform | transform
  const stream = await cmd("echo", ["apple\nbanana\ncherry\napricot"])
    .pipe(grep(/^a/))  // Filter lines starting with 'a'
    .pipe(lines())     // Split into lines
    .collect();

  assertEquals(stream, ["apple", "apricot"]);
});

// ==================== SSH-557: toCmdLines/toCmd with Command objects ====================

Deno.test("SSH-557 - toCmdLines accepts Command object directly", async () => {
  // Reproduces the bug: transpiler generates $.toCmdLines($.cmd("sed", ...))
  // which passes a Command object, not a CommandFn
  const stream = createStream(
    (async function* () {
      yield "hello world";
      yield "foo bar";
    })(),
  );

  const transform = toCmdLines(cmd("sort", ["-r"]));
  const result: string[] = [];
  for await (const line of transform(stream)) {
    result.push(line);
  }

  assertEquals(result, ["hello world", "foo bar"]);
});

Deno.test("SSH-557 - toCmd accepts Command object directly", async () => {
  const stream = createStream(
    (async function* () {
      yield "cherry";
      yield "apple";
      yield "banana";
    })(),
  );

  const transform = toCmd(cmd("sort"));
  const result: string[] = [];
  for await (const line of transform(stream)) {
    result.push(line);
  }

  assertEquals(result, ["apple\nbanana\ncherry\n"]);
});

Deno.test("SSH-557 - FluentStream.pipe() with Command object", async () => {
  // Simulates the transpiler pattern: stream.pipe($.cmd("sort"))
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "cherry";
      yield "apple";
      yield "banana";
    })(),
  ));

  const result = await stream.pipe(cmd("sort")).collect();

  assertEquals(result, ["apple", "banana", "cherry"]);
});

Deno.test("SSH-557 - FluentStream.pipe() with Command with args", async () => {
  // Simulates: stream.pipe($.cmd("sort", ["-r"]))
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "apple";
      yield "cherry";
      yield "banana";
    })(),
  ));

  const result = await stream.pipe(cmd("sort", ["-r"])).collect();

  assertEquals(result, ["cherry", "banana", "apple"]);
});

Deno.test("SSH-557 - chained: stream | grep | cmd(sed) | grep", async () => {
  // Simulates the transpiler pattern for:
  // echo "..." | grep pattern | sed 's/foo/bar/' | grep bar
  // After grep (a fluent transform), sed is a Command piped via toCmdLines
  const stream = new FluentStream(createStream(
    (async function* () {
      yield "3 match_foo";
      yield "1 no";
      yield "2 match_foo";
    })(),
  ));

  const result = await stream
    .pipe(grep(/match/))                                      // fluent transform
    .pipe(cmd("sed", ["s/match_foo/match_bar/"]))             // Command object via toCmdLines
    .pipe(grep(/match_bar/))                                  // fluent transform
    .collect();

  assertEquals(result, ["3 match_bar", "2 match_bar"]);
});
