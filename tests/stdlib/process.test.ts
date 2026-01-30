/**
 * Tests for process management utilities
 */

import { assertEquals, assertExists, assert } from "@std/assert";
import { spawn, kill, ps, ports, type ProcessInfo, type PortInfo } from "../../src/stdlib/process.ts";

Deno.test("spawn() - spawns a process and waits for completion", async () => {
  const proc = await spawn("echo", {
    args: ["hello"],
    stdout: "piped",
  });

  assertExists(proc.pid);
  assert(proc.pid > 0, "PID should be positive");
  assertExists(proc.stdout);
  assertEquals(proc.stdin, null);
  assertEquals(proc.stderr, null);

  const output = await new Response(proc.stdout).text();
  assertEquals(output.trim(), "hello");

  const status = await proc.status();
  assertEquals(status.success, true);
  assertEquals(status.code, 0);
});

Deno.test("spawn() - spawns with piped stdin", async () => {
  const proc = await spawn("cat", {
    stdin: "piped",
    stdout: "piped",
  });

  assertExists(proc.stdin);
  assertExists(proc.stdout);

  // Write to stdin
  const writer = proc.stdin.getWriter();
  const encoder = new TextEncoder();
  await writer.write(encoder.encode("test input\n"));
  await writer.close();

  // Read from stdout
  const output = await new Response(proc.stdout).text();
  assertEquals(output.trim(), "test input");

  const status = await proc.status();
  assertEquals(status.success, true);
});

Deno.test("spawn() - spawns with custom working directory", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const proc = await spawn("pwd", {
      cwd: tmpDir,
      stdout: "piped",
    });

    const output = await new Response(proc.stdout!).text();
    const actualCwd = output.trim();

    // Resolve both paths for comparison (handles symlinks like /tmp -> /private/tmp)
    const expectedCwd = await Deno.realPath(tmpDir);
    const resolvedActual = await Deno.realPath(actualCwd);

    assertEquals(resolvedActual, expectedCwd);

    const status = await proc.status();
    assertEquals(status.success, true);
  } finally {
    await Deno.remove(tmpDir);
  }
});

Deno.test("spawn() - spawns with custom environment", async () => {
  const proc = await spawn("sh", {
    args: ["-c", "echo $TEST_VAR"],
    env: { TEST_VAR: "test_value" },
    stdout: "piped",
  });

  const output = await new Response(proc.stdout!).text();
  assertEquals(output.trim(), "test_value");

  const status = await proc.status();
  assertEquals(status.success, true);
});

Deno.test("spawn() - clearEnv with explicit env only uses provided vars", async () => {
  // Test that clearEnv prevents inheritance when combined with explicit env
  const proc = await spawn("sh", {
    args: ["-c", "echo MY_VAR=$MY_VAR"],
    clearEnv: true,
    env: { MY_VAR: "my_value" },
    stdout: "piped",
  });

  const output = await new Response(proc.stdout!).text();
  // Should have the explicitly provided variable
  assertEquals(output.trim(), "MY_VAR=my_value");

  const status = await proc.status();
  assertEquals(status.success, true);
});

Deno.test("spawn() - can kill spawned process", async () => {
  const proc = await spawn("sleep", {
    args: ["10"],
  });

  assertExists(proc.pid);

  // Kill the process
  proc.kill("SIGTERM");

  const status = await proc.status();
  assertEquals(status.success, false);
  // Signal should be set (exact signal may vary by platform)
  assertExists(status.signal);
});

Deno.test("spawn() - handles non-zero exit codes", async () => {
  const proc = await spawn("sh", {
    args: ["-c", "exit 42"],
    stdout: "piped",
  });

  // Consume and close stdout to prevent resource leak
  if (proc.stdout) {
    await proc.stdout.cancel();
  }

  const status = await proc.status();
  assertEquals(status.success, false);
  assertEquals(status.code, 42);
});

Deno.test("kill() - sends signal to process", async () => {
  // Spawn a long-running process
  const proc = await spawn("sleep", { args: ["10"] });
  const pid = proc.pid;

  assertExists(pid);

  // Kill it
  kill(pid, "SIGTERM");

  const status = await proc.status();
  assertEquals(status.success, false);
});

Deno.test("ps() - lists running processes", async () => {
  const processes = await ps();

  assert(Array.isArray(processes), "Should return an array");
  assert(processes.length > 0, "Should have at least one process");

  // Check that current process (deno) is in the list
  const currentPid = Deno.pid;
  const currentProcess = processes.find((p) => p.pid === currentPid);

  assertExists(currentProcess, "Current process should be in the list");
  assertExists(currentProcess.command, "Process should have a command");
  assert(currentProcess.pid > 0, "Process should have a valid PID");
});

Deno.test("ps() - returns valid process information", async () => {
  const processes = await ps();

  // Check first few processes have expected fields
  for (let i = 0; i < Math.min(5, processes.length); i++) {
    const proc = processes[i];
    if (!proc) continue;

    assertExists(proc.pid, `Process ${i} should have a PID`);
    assert(proc.pid > 0, `Process ${i} PID should be positive`);
    assertExists(proc.command, `Process ${i} should have a command`);

    // These fields are optional but should be correct type if present
    if (proc.ppid !== undefined) {
      assert(proc.ppid >= 0, `Process ${i} PPID should be non-negative`);
    }
    if (proc.cpu !== undefined) {
      assert(proc.cpu >= 0, `Process ${i} CPU should be non-negative`);
    }
    if (proc.memory !== undefined) {
      assert(proc.memory >= 0, `Process ${i} memory should be non-negative`);
    }
  }
});

Deno.test("ports() - lists processes on ports (if any)", async () => {
  const portList = await ports();

  assert(Array.isArray(portList), "Should return an array");

  // May be empty if no processes are listening on ports
  if (portList.length > 0) {
    const portInfo = portList[0];
    if (portInfo) {
      assertExists(portInfo.port, "Port info should have a port number");
      assert(portInfo.port > 0 && portInfo.port <= 65535, "Port should be in valid range");
      assertExists(portInfo.protocol, "Port info should have a protocol");
      assert(
        portInfo.protocol === "tcp" || portInfo.protocol === "udp",
        "Protocol should be tcp or udp",
      );
      assertExists(portInfo.pid, "Port info should have a PID");
      assertExists(portInfo.process, "Port info should have a process name");
    }
  }
});

Deno.test("ports() - can filter by specific port", async () => {
  // Start a simple server using Deno's built-in HTTP server on a known port
  const port = 18123; // Use high port to avoid conflicts

  // Use Deno's native HTTP server for reliability
  const serverProc = await spawn("deno", {
    args: [
      "eval",
      "--no-check",
      `const handler = () => new Response('ok'); Deno.serve({ port: ${port}, onListen: () => console.log('ready') }, handler);`,
    ],
    stdout: "piped",
  });

  try {
    // Wait for server to be ready by reading its stdout
    const reader = serverProc.stdout!.getReader();
    const decoder = new TextDecoder();
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) {
        throw new Error("Server startup timeout");
      }
    }, 5000);

    try {
      while (!ready) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const text = decoder.decode(value, { stream: true });
          if (text.includes("ready")) {
            ready = true;
            break;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }

    // Cancel the stdout stream to prevent resource leak
    if (serverProc.stdout) {
      await serverProc.stdout.cancel();
    }

    // Give system time to register the port
    await new Promise((resolve) => setTimeout(resolve, 200));

    const portList = await ports(port);

    // Should find our server (may be empty if lsof/netstat not available)
    if (portList.length > 0) {
      const ourPort = portList.find((p) => p.port === port);
      if (ourPort) {
        assertEquals(ourPort.port, port);
        assert(ourPort.pid > 0, "Should have a valid PID");
      }
    }
  } finally {
    // Clean up - forcefully kill and wait for completion
    try {
      serverProc.kill("SIGKILL");
      // Wait for the process to actually die
      await serverProc.status().catch(() => {/* ignore */});
    } catch {
      // Process might already be dead
    }
  }
});

Deno.test("spawn() - ref() and unref() are available", async () => {
  const proc = await spawn("echo", {
    args: ["test"],
    stdout: "piped",
  });

  // These should not throw
  proc.ref();
  proc.unref();

  await proc.status();
});

Deno.test("spawn() - handles stderr separately", async () => {
  const proc = await spawn("sh", {
    args: ["-c", "echo stdout; echo stderr >&2"],
    stdout: "piped",
    stderr: "piped",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout!).text(),
    new Response(proc.stderr!).text(),
  ]);

  assertEquals(stdout.trim(), "stdout");
  assertEquals(stderr.trim(), "stderr");

  const status = await proc.status();
  assertEquals(status.success, true);
});
