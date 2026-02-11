/**
 * SSH-429: Test that commands spawning daemons don't hang
 *
 * Tests the fix for commands that spawn background processes inheriting
 * stdout/stderr file descriptors, causing the command to hang indefinitely.
 */

import { assertEquals, assert } from "@std/assert";
import { cmd } from "../../src/stdlib/command.ts";

Deno.test("SSH-429 - command that spawns daemon doesn't hang", async () => {
  // Create a temporary script that:
  // 1. Spawns a background process that keeps stdout open
  // 2. Exits the parent immediately
  // 3. The background process should not block command completion

  const scriptContent = `#!/bin/sh
# Parent script prints and exits
echo "Parent process started"

# Spawn a daemon that keeps stdout open
(sleep 10 && echo "Daemon output" > /dev/null) &

# Parent exits immediately
echo "Parent process exiting"
exit 0
`;

  const tmpDir = await Deno.makeTempDir();
  const scriptPath = `${tmpDir}/spawn-daemon.sh`;

  try {
    // Write the test script
    await Deno.writeTextFile(scriptPath, scriptContent);
    await Deno.chmod(scriptPath, 0o755);

    // Execute the script - should complete within 2 seconds (1s grace period + buffer)
    // If the bug exists, this would hang for 10+ seconds waiting for daemon to exit
    const startTime = Date.now();
    const result = await cmd("sh", [scriptPath]).exec();
    const duration = Date.now() - startTime;

    // Assertions
    assertEquals(result.success, true, "Command should succeed");
    assertEquals(result.code, 0, "Exit code should be 0");
    assert(result.stdout.includes("Parent process started"), "Should capture parent stdout");
    assert(result.stdout.includes("Parent process exiting"), "Should capture parent exit message");

    // Should complete quickly (not wait for daemon)
    // Allow up to 3 seconds (1s timeout + test overhead)
    assert(
      duration < 3000,
      `Command should complete quickly (took ${duration}ms), not wait for daemon`
    );

    console.log(`✓ Command completed in ${duration}ms (expected < 3000ms)`);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-429 - stream timeout doesn't lose output", async () => {
  // Test that when stream timeout triggers, we don't lose collected output
  // This command produces output then sleeps briefly

  const scriptContent = `#!/bin/sh
echo "Line 1"
echo "Line 2"
echo "Line 3"
# Brief sleep to ensure output is flushed
sleep 0.1
exit 0
`;

  const tmpDir = await Deno.makeTempDir();
  const scriptPath = `${tmpDir}/output-test.sh`;

  try {
    await Deno.writeTextFile(scriptPath, scriptContent);
    await Deno.chmod(scriptPath, 0o755);

    const result = await cmd("sh", [scriptPath]).exec();

    // All output should be captured
    assertEquals(result.success, true);
    assert(result.stdout.includes("Line 1"), "Should capture Line 1");
    assert(result.stdout.includes("Line 2"), "Should capture Line 2");
    assert(result.stdout.includes("Line 3"), "Should capture Line 3");

    console.log("✓ All output captured correctly");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-429 - stderr collected properly with timeout", async () => {
  // Test that stderr is also collected properly with the timeout mechanism

  const scriptContent = `#!/bin/sh
echo "stdout message"
echo "stderr message" >&2
exit 0
`;

  const tmpDir = await Deno.makeTempDir();
  const scriptPath = `${tmpDir}/stderr-test.sh`;

  try {
    await Deno.writeTextFile(scriptPath, scriptContent);
    await Deno.chmod(scriptPath, 0o755);

    const result = await cmd("sh", [scriptPath]).exec();

    assertEquals(result.success, true);
    assertEquals(result.stdout.trim(), "stdout message");
    assertEquals(result.stderr.trim(), "stderr message");

    console.log("✓ Both stdout and stderr captured correctly");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-429 - exit code preserved when streams timeout", async () => {
  // Test that non-zero exit codes are preserved when stream timeout triggers

  const scriptContent = `#!/bin/sh
echo "Error occurred"
# Spawn daemon to keep fd open
(sleep 5) &
exit 42
`;

  const tmpDir = await Deno.makeTempDir();
  const scriptPath = `${tmpDir}/exitcode-test.sh`;

  try {
    await Deno.writeTextFile(scriptPath, scriptContent);
    await Deno.chmod(scriptPath, 0o755);

    const result = await cmd("sh", [scriptPath]).exec();

    // Exit code should be preserved
    assertEquals(result.code, 42, "Exit code should be preserved");
    assertEquals(result.success, false, "Should not be successful");
    assert(result.stdout.includes("Error occurred"), "Should capture output");

    console.log("✓ Exit code preserved correctly");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-565 - stdout().lines().pipe(head()) doesn't hang on early exit", async () => {
  // When head() breaks the for-await loop after N items, the upstream
  // subprocess must be killed so drainPromise and process.status don't hang.
  const tmpDir = await Deno.makeTempDir();
  const scriptPath = `${tmpDir}/many-lines.sh`;

  try {
    // Script that outputs many lines (more than we'll consume)
    await Deno.writeTextFile(scriptPath, `#!/bin/sh
for i in $(seq 1 1000); do
  echo "line $i"
done
`);
    await Deno.chmod(scriptPath, 0o755);

    const startTime = Date.now();

    // Only consume 5 lines from a command that outputs 1000
    const lines = await cmd("sh", [scriptPath])
      .stdout()
      .lines()
      .head(5)
      .collect();

    const duration = Date.now() - startTime;

    assertEquals(lines.length, 5, "Should collect exactly 5 lines");
    assertEquals(lines[0], "line 1");
    assertEquals(lines[4], "line 5");

    // Should complete quickly, not hang waiting for the full 1000 lines
    assert(duration < 5000, `Should complete quickly (took ${duration}ms)`);
    console.log(`✓ head(5) pipeline completed in ${duration}ms`);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-565 - stdout().pipe(head()) with long-running process", async () => {
  // Simulate the exact scenario: find piped through head
  // find would run for a long time, but head(5) should kill it
  const startTime = Date.now();

  const lines = await cmd("find", ["/usr", "-type", "f"])
    .stdout()
    .lines()
    .head(5)
    .collect();

  const duration = Date.now() - startTime;

  assertEquals(lines.length, 5, "Should collect exactly 5 lines");
  assert(duration < 10000, `Should complete quickly (took ${duration}ms)`);
  console.log(`✓ find | head(5) completed in ${duration}ms`);
});
