/**
 * CLI tests
 *
 * Tests the command-line interface for all commands:
 * - exec: Execute JS/TS code
 * - run: Run external commands
 * - task: Run task definitions
 * - repl: Interactive REPL (manual testing only)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const CLI_PATH = join(Deno.cwd(), "src/cli/main.ts");

async function runCLI(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const command = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      CLI_PATH,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout, stderr, code } = await command.output();

  return {
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    code,
  };
}

// ============================================================================
// Help and Version
// ============================================================================

Deno.test("CLI: --help shows usage", async () => {
  const result = await runCLI(["--help"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "SafeShell");
  assertStringIncludes(result.stdout, "USAGE:");
  assertStringIncludes(result.stdout, "exec");
  assertStringIncludes(result.stdout, "run");
  assertStringIncludes(result.stdout, "task");
  assertStringIncludes(result.stdout, "repl");
});

Deno.test("CLI: --version shows version", async () => {
  const result = await runCLI(["--version"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "safesh");
  assertStringIncludes(result.stdout, "0.1.0");
});

// ============================================================================
// Exec Command
// ============================================================================

Deno.test("CLI: exec executes JS code", async () => {
  const result = await runCLI(["exec", "console.log('hello cli')"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "hello cli");
});

Deno.test("CLI: exec handles errors", async () => {
  const result = await runCLI(["exec", "throw new Error('test error')"]);

  assertEquals(result.code, 1);
});

Deno.test("CLI: exec requires code argument", async () => {
  const result = await runCLI(["exec"]);

  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage:");
});

// ============================================================================
// Run Command
// ============================================================================

Deno.test("CLI: run executes external command", async () => {
  // Create a test config with echo allowed
  const configPath = join(Deno.cwd(), ".temp", "cli-test-config.ts");
  await Deno.mkdir(join(Deno.cwd(), ".temp"), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `export default {
      permissions: { run: ["echo"], env: ["PATH"] },
      external: { echo: { allow: true } },
      env: { allow: ["PATH"], mask: [] },
      imports: { trusted: [], allowed: [], blocked: [] },
      timeout: 30000,
    };`,
  );

  const result = await runCLI([
    "-c",
    ".temp/cli-test-config.ts",
    "run",
    "echo",
    "test output",
  ]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "test output");
});

Deno.test("CLI: run requires command argument", async () => {
  const result = await runCLI(["run"]);

  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage:");
});

// ============================================================================
// Task Command
// ============================================================================

Deno.test("CLI: task runs simple cmd task", async () => {
  const configPath = join(Deno.cwd(), ".temp", "cli-task-simple.ts");
  await Deno.mkdir(join(Deno.cwd(), ".temp"), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `export default {
      permissions: { read: ["/tmp"], write: ["/tmp"], env: [] },
      external: {},
      env: { allow: [], mask: [] },
      imports: { trusted: ["jsr:@std/*"], allowed: [], blocked: [] },
      tasks: {
        hello: { cmd: "console.log('task hello')" },
      },
      timeout: 30000,
    };`,
  );

  const result = await runCLI(["-c", ".temp/cli-task-simple.ts", "task", "hello"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "task hello");
});

Deno.test("CLI: task runs serial tasks", async () => {
  const configPath = join(Deno.cwd(), ".temp", "cli-task-serial.ts");
  await Deno.mkdir(join(Deno.cwd(), ".temp"), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `export default {
      permissions: { read: ["/tmp"], write: ["/tmp"], env: [] },
      external: {},
      env: { allow: [], mask: [] },
      imports: { trusted: ["jsr:@std/*"], allowed: [], blocked: [] },
      tasks: {
        task1: { cmd: "console.log('first')" },
        task2: { cmd: "console.log('second')" },
        serial: { serial: ["task1", "task2"] },
      },
      timeout: 30000,
    };`,
  );

  const result = await runCLI(["-c", ".temp/cli-task-serial.ts", "task", "serial"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "first");
  assertStringIncludes(result.stdout, "second");
});

Deno.test("CLI: task runs parallel tasks", async () => {
  const configPath = join(Deno.cwd(), ".temp", "cli-task-parallel.ts");
  await Deno.mkdir(join(Deno.cwd(), ".temp"), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `export default {
      permissions: { read: ["/tmp"], write: ["/tmp"], env: [] },
      external: {},
      env: { allow: [], mask: [] },
      imports: { trusted: ["jsr:@std/*"], allowed: [], blocked: [] },
      tasks: {
        task1: { cmd: "console.log('parallel1')" },
        task2: { cmd: "console.log('parallel2')" },
        parallel: { parallel: ["task1", "task2"] },
      },
      timeout: 30000,
    };`,
  );

  const result = await runCLI([
    "-c",
    ".temp/cli-task-parallel.ts",
    "task",
    "parallel",
  ]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "parallel1");
  assertStringIncludes(result.stdout, "parallel2");
});

Deno.test("CLI: task handles task references", async () => {
  const configPath = join(Deno.cwd(), ".temp", "cli-task-ref.ts");
  await Deno.mkdir(join(Deno.cwd(), ".temp"), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `export default {
      permissions: { read: ["/tmp"], write: ["/tmp"], env: [] },
      external: {},
      env: { allow: [], mask: [] },
      imports: { trusted: ["jsr:@std/*"], allowed: [], blocked: [] },
      tasks: {
        base: { cmd: "console.log('base task')" },
        ref: "base",
      },
      timeout: 30000,
    };`,
  );

  const result = await runCLI(["-c", ".temp/cli-task-ref.ts", "task", "ref"]);

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "base task");
});

Deno.test("CLI: task shows error for missing task", async () => {
  const configPath = join(Deno.cwd(), ".temp", "cli-task-missing.ts");
  await Deno.mkdir(join(Deno.cwd(), ".temp"), { recursive: true });
  await Deno.writeTextFile(
    configPath,
    `export default {
      permissions: { read: ["/tmp"], write: ["/tmp"], env: [] },
      external: {},
      env: { allow: [], mask: [] },
      imports: { trusted: [], allowed: [], blocked: [] },
      tasks: {},
      timeout: 30000,
    };`,
  );

  const result = await runCLI([
    "-c",
    ".temp/cli-task-missing.ts",
    "task",
    "nonexistent",
  ]);

  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "not found");
});

Deno.test("CLI: task requires task name", async () => {
  const result = await runCLI(["task"]);

  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage:");
});

// ============================================================================
// Error Handling
// ============================================================================

Deno.test("CLI: unknown command shows error", async () => {
  const result = await runCLI(["unknown"]);

  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Unknown command");
});
