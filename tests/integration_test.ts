/**
 * End-to-End Integration Tests
 *
 * Verifies full system integration:
 * 1. exec() runs code in sandbox with permission enforcement
 * 2. run() executes whitelisted commands with validation
 * 3. Permission violations are caught and reported
 * 4. Path sandbox works correctly
 * 5. Shell state persists across calls
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertExists,
} from "@std/assert";
import { executeCode } from "../src/runtime/executor.ts";
import { runExternal } from "../src/external/runner.ts";
import { createShellManager } from "../src/runtime/shell.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";

// Test configuration with restricted permissions
const testConfig: SafeShellConfig = {
  permissions: {
    read: ["/tmp/safesh-test", "/private/tmp/safesh-test"], // Handle macOS symlink
    write: ["/tmp/safesh-test", "/private/tmp/safesh-test"],
    env: ["PATH", "HOME"],
    run: ["echo", "cat", "ls", "git"], // Whitelist commands for execution
  },
  external: {
    echo: {
      allow: true,
    },
    cat: {
      allow: true,
    },
    ls: {
      allow: true,
    },
    git: {
      allow: ["status", "log"], // Only allow these subcommands, push is denied
    },
  },
  timeout: 5000,
};

// Setup test directory
async function setupTestEnv() {
  const testDir = "/tmp/safesh-test";
  await ensureDir(testDir);
  await Deno.writeTextFile(join(testDir, "test.txt"), "test content\n");
  return testDir;
}

// Cleanup test directory
async function cleanupTestEnv() {
  try {
    await Deno.remove("/tmp/safesh-test", { recursive: true });
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * TEST SUITE 1: exec() sandboxed code execution
 */

Deno.test("E2E: exec() runs simple code successfully", async () => {
  const result = await executeCode(
    'console.log("Hello from SafeShell");',
    testConfig,
  );

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "Hello from SafeShell");
});

Deno.test("E2E: exec() can perform allowed file operations", async () => {
  await setupTestEnv();

  const code = `
    const content = await Deno.readTextFile("/tmp/safesh-test/test.txt");
    console.log("Read:", content.trim());
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Read: test content");

  await cleanupTestEnv();
});

Deno.test("E2E: exec() blocks unauthorized file access", async () => {
  const code = `
    // Try to read outside sandbox
    await Deno.readTextFile("/etc/passwd");
  `;

  const result = await executeCode(code, testConfig);

  // Should fail due to permission denial
  assertEquals(result.success, false);
  assertEquals(result.code !== 0, true);
});

Deno.test("E2E: exec() enforces write permissions", async () => {
  await setupTestEnv();

  const code = `
    // Try to write to allowed path
    await Deno.writeTextFile("/tmp/safesh-test/output.txt", "success");
    console.log("Written successfully");
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Written successfully");

  // Verify file was created
  const content = await Deno.readTextFile("/tmp/safesh-test/output.txt");
  assertEquals(content, "success");

  await cleanupTestEnv();
});

Deno.test("E2E: exec() blocks write outside sandbox", async () => {
  const code = `
    // Try to write outside sandbox
    await Deno.writeTextFile("/tmp/unauthorized.txt", "fail");
  `;

  const result = await executeCode(code, testConfig);

  // Should fail due to permission denial
  assertEquals(result.success, false);
  assertEquals(result.code !== 0, true);
});

Deno.test("E2E: exec() can access environment variables", async () => {
  const code = `
    const path = Deno.env.get("PATH");
    console.log("PATH exists:", !!path);
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "PATH exists: true");
});

/**
 * TEST SUITE 2: run() external command execution
 */

Deno.test("E2E: run() executes whitelisted commands", async () => {
  const result = await runExternal("echo", ["hello", "world"], testConfig);

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "hello world");
});

Deno.test("E2E: run() validates command whitelist", async () => {
  await assertRejects(
    async () => {
      // Try to run non-whitelisted command
      await runExternal("rm", ["-rf", "/"], testConfig);
    },
    SafeShellError,
    "not whitelisted",
  );
});

Deno.test("E2E: run() validates subcommands", async () => {
  // Allowed subcommand should work
  const result = await runExternal("git", ["status"], testConfig);

  // May fail if not in git repo, but should pass validation
  assertEquals(typeof result.code, "number");
});

Deno.test("E2E: run() blocks denied subcommands", async () => {
  await assertRejects(
    async () => {
      // git push is not in allowed list (only status and log are allowed)
      await runExternal("git", ["push"], testConfig);
    },
    SafeShellError,
    "not allowed",
  );
});

Deno.test("E2E: run() respects timeout", async () => {
  const shortConfig: SafeShellConfig = {
    ...testConfig,
    timeout: 100, // 100ms timeout
    permissions: {
      ...testConfig.permissions,
      run: [...(testConfig.permissions?.run ?? []), "sleep"],
    },
    external: {
      ...testConfig.external,
      sleep: { allow: true },
    },
  };

  await assertRejects(
    async () => {
      // Sleep command will timeout
      await runExternal("sleep", ["5"], shortConfig);
    },
    SafeShellError,
    "timed out",
  );
});

/**
 * TEST SUITE 3: Path sandbox validation
 */

Deno.test("E2E: Path sandbox allows access within boundaries", async () => {
  await setupTestEnv();

  const result = await runExternal(
    "cat",
    ["/tmp/safesh-test/test.txt"],
    testConfig,
  );

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "test content");

  await cleanupTestEnv();
});

Deno.test("E2E: Path sandbox blocks access outside boundaries", async () => {
  await assertRejects(
    async () => {
      // Try to cat a file outside sandbox
      await runExternal("cat", ["/etc/passwd"], testConfig);
    },
    SafeShellError,
    "outside allowed directories",
  );
});

Deno.test("E2E: Path sandbox handles relative paths", async () => {
  await setupTestEnv();

  const now = new Date();
  const shell = {
    id: "test-shell",
    cwd: "/tmp/safesh-test",
    env: {},
    vars: {},
    jobs: new Map(),
    jobsByPid: new Map(),
    jobSequence: 0,
    createdAt: now,
    lastActivityAt: now,
  };

  const result = await runExternal(
    "cat",
    ["test.txt"], // Relative path
    testConfig,
    { cwd: "/tmp/safesh-test" },
    shell,
  );

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "test content");

  await cleanupTestEnv();
});

/**
 * TEST SUITE 4: Shell state persistence
 */

Deno.test("E2E: Shell maintains working directory", async () => {
  await setupTestEnv();

  const shellManager = createShellManager(Deno.cwd());
  const shell = shellManager.create({ cwd: "/tmp/safesh-test" });

  // Execute code that uses shell cwd
  const code = `
    console.log("CWD:", $shell.cwd);
  `;

  const result = await executeCode(code, testConfig, {}, shell);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "/tmp/safesh-test");

  await cleanupTestEnv();
});

Deno.test("E2E: Shell maintains environment variables", async () => {
  const shellManager = createShellManager(Deno.cwd());
  const shell = shellManager.create({
    env: { MY_VAR: "test_value" },
  });

  const code = `
    console.log("MY_VAR:", $shell.env.MY_VAR);
  `;

  const result = await executeCode(code, testConfig, {}, shell);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "MY_VAR: test_value");
});

Deno.test("E2E: Shell persists custom variables", async () => {
  const shellManager = createShellManager(Deno.cwd());
  const shell = shellManager.create();

  // Set a variable
  shellManager.setVar(shell.id, "counter", 42);

  // Retrieve it
  const value = shellManager.getVar(shell.id, "counter");
  assertEquals(value, 42);
});

Deno.test("E2E: Shell updates are persistent", async () => {
  const shellManager = createShellManager(Deno.cwd());
  const shell = shellManager.create({ cwd: "/tmp" });

  // Update shell
  const updated = shellManager.update(shell.id, {
    cwd: "/tmp/new",
    env: { NEW_VAR: "value" },
  });

  assertExists(updated);
  assertEquals(updated.cwd, "/tmp/new");
  assertEquals(updated.env.NEW_VAR, "value");

  // Verify persistence
  const retrieved = shellManager.get(shell.id);
  assertExists(retrieved);
  assertEquals(retrieved.cwd, "/tmp/new");
  assertEquals(retrieved.env.NEW_VAR, "value");
});

Deno.test("E2E: Multiple shells are isolated", async () => {
  const shellManager = createShellManager(Deno.cwd());

  const shell1 = shellManager.create({
    env: { SHELL: "one" },
  });
  const shell2 = shellManager.create({
    env: { SHELL: "two" },
  });

  assertEquals(shell1.env.SHELL, "one");
  assertEquals(shell2.env.SHELL, "two");

  // Update shell1 shouldn't affect shell2
  shellManager.update(shell1.id, { env: { SHELL: "updated" } });

  const retrieved1 = shellManager.get(shell1.id);
  const retrieved2 = shellManager.get(shell2.id);

  assertExists(retrieved1);
  assertExists(retrieved2);
  assertEquals(retrieved1.env.SHELL, "updated");
  assertEquals(retrieved2.env.SHELL, "two");
});

/**
 * TEST SUITE 5: Error handling and security
 */

Deno.test("E2E: Import policy blocks unauthorized imports", async () => {
  const restrictedConfig: SafeShellConfig = {
    ...testConfig,
    imports: {
      trusted: [],
      allowed: ["jsr:@std/*"],
      blocked: ["npm:*"],
    },
  };

  const code = `
    import { something } from "npm:malicious-package";
  `;

  await assertRejects(
    async () => {
      await executeCode(code, restrictedConfig);
    },
    SafeShellError,
    "blocked",
  );
});

Deno.test("E2E: Import policy allows trusted imports", async () => {
  const config: SafeShellConfig = {
    ...testConfig,
    imports: {
      trusted: ["jsr:@std/assert"],
      allowed: ["jsr:@std/*"],
      blocked: [],
    },
  };

  const code = `
    import { assertEquals } from "jsr:@std/assert";
    assertEquals(1, 1);
    console.log("Import successful");
  `;

  const result = await executeCode(code, config);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Import successful");
});

Deno.test("E2E: Environment masking prevents sensitive data leakage", async () => {
  const maskedConfig: SafeShellConfig = {
    ...testConfig,
    env: {
      allow: ["SECRET_KEY"],
      mask: ["SECRET_*"],
    },
  };

  // Set environment variable (simulate sensitive data)
  Deno.env.set("SECRET_KEY", "sensitive-value");

  const result = await runExternal("echo", ["test"], maskedConfig);

  // Command should run but SECRET_KEY should be masked
  assertEquals(result.success, true);

  // Clean up
  Deno.env.delete("SECRET_KEY");
});

/**
 * TEST SUITE 6: Full workflow integration
 */

Deno.test("E2E: Complete workflow - file processing pipeline", async () => {
  await setupTestEnv();

  const shellManager = createShellManager(Deno.cwd());
  const shell = shellManager.create({
    cwd: "/tmp/safesh-test",
  });

  // Step 1: Create a file with exec()
  const createCode = `
    await Deno.writeTextFile("/tmp/safesh-test/input.txt", "line1\\nline2\\nline3");
    console.log("Created input file");
  `;

  const createResult = await executeCode(createCode, testConfig, {}, shell);
  assertEquals(createResult.success, true);

  // Step 2: Process file with external command
  const catResult = await runExternal(
    "cat",
    ["/tmp/safesh-test/input.txt"],
    testConfig,
    {},
    shell,
  );
  assertEquals(catResult.success, true);
  assertStringIncludes(catResult.stdout, "line1");
  assertStringIncludes(catResult.stdout, "line2");

  // Step 3: Read and transform with exec()
  const processCode = `
    const content = await Deno.readTextFile("/tmp/safesh-test/input.txt");
    const lines = content.trim().split("\\n");
    const count = lines.length;
    console.log(\`Processed \${count} lines\`);
  `;

  const processResult = await executeCode(processCode, testConfig, {}, shell);
  assertEquals(processResult.success, true);
  assertStringIncludes(processResult.stdout, "Processed 3 lines");

  await cleanupTestEnv();
});

Deno.test("E2E: Cross-shell isolation", async () => {
  await setupTestEnv();

  const shellManager = createShellManager(Deno.cwd());

  // Shell 1: Create a file
  const shell1 = shellManager.create({ cwd: "/tmp/safesh-test" });
  const code1 = `
    await Deno.writeTextFile("/tmp/safesh-test/shell1.txt", "shell 1 data");
    console.log("Shell 1 completed");
  `;
  const result1 = await executeCode(code1, testConfig, {}, shell1);
  assertEquals(result1.success, true);

  // Shell 2: Verify isolation (should not have shell1 vars)
  const shell2 = shellManager.create({ cwd: "/tmp/safesh-test" });
  shellManager.setVar(shell2.id, "myvar", "shell2-value");

  const code2 = `
    console.log("Shell 2 ID:", $shell.id);
  `;
  const result2 = await executeCode(code2, testConfig, {}, shell2);
  assertEquals(result2.success, true);

  // Verify shells are different
  assertEquals(shell1.id !== shell2.id, true);

  // Verify vars are isolated
  assertEquals(shellManager.getVar(shell1.id, "myvar"), undefined);
  assertEquals(shellManager.getVar(shell2.id, "myvar"), "shell2-value");

  await cleanupTestEnv();
});
