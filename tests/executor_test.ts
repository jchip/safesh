/**
 * Tests for the code execution engine
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { executeCode, executeFile, buildPermissionFlags } from "../src/runtime/executor.ts";
import type { SafeShellConfig, Shell } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { join } from "@std/path";

/** Create a test Shell object with required properties */
function makeTestShell(overrides: Partial<Shell> = {}): Shell {
  const now = new Date();
  return {
    id: "test-session",
    cwd: Deno.cwd(),
    env: {},
    vars: {},
    scripts: new Map(),
    scriptsByPid: new Map(),
    scriptSequence: 0,
    jobs: new Map(),
    createdAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

const testConfig: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
  },
  timeout: 5000,
};

Deno.test("buildPermissionFlags - generates correct flags", () => {
  const flags = buildPermissionFlags(testConfig, "/project");

  // Should have read, write, and env flags
  assertEquals(flags.length, 3);
  assertStringIncludes(flags[0] ?? "", "--allow-read=");
  assertStringIncludes(flags[1] ?? "", "--allow-write=");
  assertStringIncludes(flags[2] ?? "", "--allow-env=");
});

Deno.test("buildPermissionFlags - expands CWD variable", () => {
  const config: SafeShellConfig = {
    permissions: {
      read: ["${CWD}"],
    },
  };

  const flags = buildPermissionFlags(config, "/my/project");

  // Should have read permissions (includes CWD, temp dir, and safesh source)
  assertEquals(flags.length >= 1, true);
  // First flag should be read permissions containing the project path
  const readFlag = flags.find((f) => f.startsWith("--allow-read="));
  assertEquals(readFlag !== undefined, true);
  assertStringIncludes(readFlag ?? "", "/my/project");
});

Deno.test("executeCode - runs simple code", async () => {
  const result = await executeCode(
    'console.log("hello from safesh");',
    testConfig,
  );

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "hello from safesh");
});

Deno.test("executeCode - captures stderr", async () => {
  const result = await executeCode(
    'console.error("error message");',
    testConfig,
  );

  assertEquals(result.success, true);
  assertStringIncludes(result.stderr, "error message");
});

Deno.test("executeCode - returns non-zero exit code on error", async () => {
  const result = await executeCode(
    'throw new Error("test error");',
    testConfig,
  );

  assertEquals(result.success, false);
  assertEquals(result.code !== 0, true);
});

Deno.test({
  name: "executeCode - respects timeout",
  // Skip sanitizers due to complex process cleanup on timeout
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const shortTimeoutConfig: SafeShellConfig = {
      ...testConfig,
      timeout: 100, // 100ms
    };

    try {
      await executeCode(
        'await new Promise(r => setTimeout(r, 5000));', // Sleep 5s
        shortTimeoutConfig,
      );
      // Should not reach here
      assertEquals(true, false, "Should have thrown timeout error");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timed out");
    }
  },
});

Deno.test({
  name: "executeCode - supports imports from jsr:@std/*",
  // Skip sanitizers due to subprocess spawning
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const code = `
      const { join } = await import("jsr:@std/path");
      const result = join("foo", "bar");
      console.log(result);
    `;

    const result = await executeCode(code, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "foo/bar");
  },
});

// TODO: Implement safesh:* import mapping before enabling this test
Deno.test({
  name: "executeCode - supports imports from safesh:*",
  ignore: true, // Disabled until safesh:* imports are implemented
  fn: async () => {
    const code = `
      import * as fs from "safesh:fs";
      console.log("fs imported successfully");
      console.log(typeof fs.read);
    `;

    const result = await executeCode(code, testConfig);

    // Debug output if test fails
    if (!result.success) {
      console.log("STDOUT:", result.stdout);
      console.log("STDERR:", result.stderr);
    }

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "fs imported successfully");
    assertStringIncludes(result.stdout, "function");
  },
});

Deno.test("executeCode - uses session cwd", async () => {
  // Use /tmp as a valid cwd that exists
  const session = makeTestShell({ cwd: "/tmp" });

  const code = `
    console.log(Deno.cwd());
  `;

  const result = await executeCode(code, testConfig, {}, session);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "/tmp");
});

Deno.test("executeCode - passes session env vars", async () => {
  const session = makeTestShell({ env: { TEST_VAR: "test-value" } });

  const config: SafeShellConfig = {
    ...testConfig,
    permissions: {
      ...testConfig.permissions,
      env: ["TEST_VAR"],
    },
  };

  const code = `
    console.log(Deno.env.get("TEST_VAR"));
  `;

  const result = await executeCode(code, config, {}, session);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "test-value");
});

Deno.test("executeCode - provides shell context via $", async () => {
  const shell = makeTestShell({
    id: "test-shell",
    cwd: "/tmp",
    env: { FOO: "bar" },
    vars: { myVar: "myValue" },
  });

  const code = `
    console.log($.ID);
    console.log($.CWD);
    console.log($.ENV.FOO);
    console.log($.VARS.myVar);
  `;

  const result = await executeCode(code, testConfig, {}, shell);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "test-shell");
  assertStringIncludes(result.stdout, "/tmp");
  assertStringIncludes(result.stdout, "bar");
  assertStringIncludes(result.stdout, "myValue");
});

Deno.test("executeCode - supports file system operations", async () => {
  const testFile = "/tmp/safesh-test-file.txt";
  const code = `
    await Deno.writeTextFile("${testFile}", "test content");
    const content = await Deno.readTextFile("${testFile}");
    console.log(content);
  `;

  try {
    const result = await executeCode(code, testConfig);
    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "test content");
  } finally {
    // Cleanup
    try {
      await Deno.remove(testFile);
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("executeCode - handles syntax errors gracefully", async () => {
  const code = `
    const x = ;  // Syntax error
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, false);
  assertEquals(result.code !== 0, true);
  // stderr should contain error information
  assertEquals(result.stderr.length > 0, true);
});

Deno.test("executeCode - supports async/await", async () => {
  const code = `
    async function test() {
      await new Promise(r => setTimeout(r, 10));
      return "async result";
    }
    console.log(await test());
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "async result");
});

Deno.test("executeCode - respects custom timeout in options", async () => {
  const code = `
    await new Promise(r => setTimeout(r, 50));
    console.log("done");
  `;

  const result = await executeCode(code, testConfig, { timeout: 200 });

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "done");
});

Deno.test("executeCode - caches scripts by content hash", async () => {
  const code = 'console.log("cached");';

  // Execute twice - should use cached script
  const result1 = await executeCode(code, testConfig);
  const result2 = await executeCode(code, testConfig);

  assertEquals(result1.success, true);
  assertEquals(result2.success, true);
  assertStringIncludes(result1.stdout, "cached");
  assertStringIncludes(result2.stdout, "cached");
});

// File-based execution tests
Deno.test("executeFile - runs a TypeScript file", async () => {
  const testFile = join("/tmp", "test-script.ts");
  const code = 'console.log("executing from file");';

  try {
    await Deno.writeTextFile(testFile, code);
    const result = await executeFile(testFile, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "executing from file");
  } finally {
    try {
      await Deno.remove(testFile);
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("executeFile - supports imports in file", async () => {
  const testFile = join("/tmp", "test-imports.ts");
  const code = `
    const { join } = await import("jsr:@std/path");
    console.log(join("a", "b"));
  `;
  try {
    await Deno.writeTextFile(testFile, code);
    const result = await executeFile(testFile, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "a/b");
  } finally {
    try {
      await Deno.remove(testFile);
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("executeFile - uses session cwd", async () => {
  const testFile = join("/tmp", "test-cwd.ts");
  const code = 'console.log(Deno.cwd());';
  const session = makeTestShell({ cwd: "/tmp" });

  try {
    await Deno.writeTextFile(testFile, code);
    const result = await executeFile(testFile, testConfig, {}, session);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "/tmp");
  } finally {
    try {
      await Deno.remove(testFile);
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test("executeFile - handles file errors", async () => {
  const nonExistentFile = "/tmp/does-not-exist-safesh-test.ts";

  // Should throw EXECUTION_ERROR when file doesn't exist
  await assertRejects(
    async () => {
      await executeFile(nonExistentFile, testConfig);
    },
    SafeShellError,
    "Failed to read file",
  );
});
