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
  assertEquals(flags[2], "--allow-env"); // default: allow all env reads
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

// ============================================================================
// Bug Fix Regression Tests
// ============================================================================

Deno.test("SSH-202: $.fromArray().filter() works with FluentStream", async () => {
  const code = `
    const result = await $.fromArray([1, 2, 3, 4, 5])
      .filter(x => x > 2)
      .collect();
    console.log(JSON.stringify(result));
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "[3,4,5]");
});

Deno.test("SSH-202: $.fromArray().map().filter().collect() chain works", async () => {
  const code = `
    const result = await $.fromArray(['a', 'bb', 'ccc'])
      .map(s => s.length)
      .filter(n => n > 1)
      .collect();
    console.log(JSON.stringify(result));
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "[2,3]");
});

Deno.test("SSH-203: $.sleep() waits for specified time", async () => {
  const code = `
    const start = Date.now();
    await $.sleep(50);
    const elapsed = Date.now() - start;
    console.log(elapsed >= 45 ? "ok" : "too fast");
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "ok");
});

Deno.test("SSH-203: $.delay() is alias for $.sleep()", async () => {
  const code = `
    const start = Date.now();
    await $.delay(50);
    const elapsed = Date.now() - start;
    console.log(elapsed >= 45 ? "ok" : "too fast");
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "ok");
});

Deno.test("SSH-202: $.createStream() returns FluentStream with .filter()", async () => {
  const code = `
    const stream = $.createStream((async function*() {
      yield 1; yield 2; yield 3;
    })());
    const result = await stream.filter(x => x > 1).collect();
    console.log(JSON.stringify(result));
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "[2,3]");
});

Deno.test("SSH-202: $.empty() returns FluentStream", async () => {
  const code = `
    const stream = $.empty();
    const result = await stream.collect();
    console.log(JSON.stringify(result));
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "[]");
});

// Note: SSH-204 (shell.id in response) is tested manually via MCP integration.
// The fix changed server.ts line 416 from `shellId` to `shell.id`.
// SSH-201 and SSH-205 were documentation fixes, no code tests needed.

// ============================================================================
// SSH-206: file vs module execution tests
// ============================================================================

Deno.test("SSH-206: file param reads content and executes as code", async () => {
  // This tests that file content goes through the code execution path
  // (wrapped in async IIFE, same as inline code)
  const testFile = "/tmp/ssh206-file-test.ts";
  const fileContent = `
    console.log("from file");
    console.log(typeof $.sleep); // Should be function (from preamble)
  `;

  try {
    await Deno.writeTextFile(testFile, fileContent);

    // Use executeCode to simulate what handleRun does with file param:
    // read content and pass to code execution
    const code = await Deno.readTextFile(testFile);
    const result = await executeCode(code, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "from file");
    assertStringIncludes(result.stdout, "function"); // $.sleep should exist
  } finally {
    try { await Deno.remove(testFile); } catch { /* ignore */ }
  }
});

Deno.test("SSH-206: module execution supports top-level structure", async () => {
  // This tests that module execution (executeFile) works with module structure
  const testFile = "/tmp/ssh206-module-test.ts";
  const moduleContent = `
    // Module with top-level code
    console.log("module executed");
  `;

  try {
    await Deno.writeTextFile(testFile, moduleContent);
    const result = await executeFile(testFile, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "module executed");
  } finally {
    try { await Deno.remove(testFile); } catch { /* ignore */ }
  }
});

// ============================================================================
// SSH-209: $.CWD updates when directory changes
// ============================================================================

Deno.test("SSH-209: $.CWD updates after $.cd()", async () => {
  const code = `
    const initialCwd = $.CWD;
    await $.mkdir('/tmp/ssh209-test', { recursive: true });
    $.cd('/tmp/ssh209-test');
    const afterCd = $.CWD;
    console.log('initial:', initialCwd);
    console.log('after:', afterCd);
    console.log('matches:', afterCd === '/tmp/ssh209-test' || afterCd === '/private/tmp/ssh209-test');
  `;

  try {
    const result = await executeCode(code, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "matches: true");
  } finally {
    try { await Deno.remove("/tmp/ssh209-test", { recursive: true }); } catch { /* ignore */ }
  }
});

Deno.test("SSH-209: $.CWD updates after $.pushd()", async () => {
  const code = `
    await $.mkdir('/tmp/ssh209-pushd-test', { recursive: true });
    const initialCwd = $.CWD;
    $.pushd('/tmp/ssh209-pushd-test');
    const afterPushd = $.CWD;
    console.log('initial:', initialCwd);
    console.log('after:', afterPushd);
    console.log('matches:', afterPushd === '/tmp/ssh209-pushd-test' || afterPushd === '/private/tmp/ssh209-pushd-test');
  `;

  try {
    const result = await executeCode(code, testConfig);

    assertEquals(result.success, true);
    assertStringIncludes(result.stdout, "matches: true");
  } finally {
    try { await Deno.remove("/tmp/ssh209-pushd-test", { recursive: true }); } catch { /* ignore */ }
  }
});

// ============================================================================
// SSH-210: $.path utilities
// ============================================================================

Deno.test("SSH-210: $.path.join() works", async () => {
  const code = `
    const result = $.path.join('/foo', 'bar', 'baz.txt');
    console.log(result);
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "/foo/bar/baz.txt");
});

Deno.test("SSH-210: $.path.dirname() and $.path.basename() work", async () => {
  const code = `
    const dir = $.path.dirname('/foo/bar/baz.txt');
    const base = $.path.basename('/foo/bar/baz.txt');
    const ext = $.path.extname('/foo/bar/baz.txt');
    console.log('dir:', dir);
    console.log('base:', base);
    console.log('ext:', ext);
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "dir: /foo/bar");
  assertStringIncludes(result.stdout, "base: baz.txt");
  assertStringIncludes(result.stdout, "ext: .txt");
});

Deno.test("SSH-210: $.path.resolve() works", async () => {
  const code = `
    const result = $.path.resolve('/foo', './bar');
    console.log(result);
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "/foo/bar");
});

// ============================================================================
// SSH-211: $.path works with ShellString from $.pwd()
// ============================================================================

Deno.test("SSH-211: $.path.join() accepts $.pwd() ShellString", async () => {
  const code = `
    const cwd = $.pwd();
    const result = $.path.join(cwd, 'subdir', 'file.txt');
    console.log('success:', result.endsWith('subdir/file.txt'));
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "success: true");
});

Deno.test("SSH-211: $.path.dirname() accepts ShellString", async () => {
  const code = `
    const cwd = $.pwd();
    const parent = $.path.dirname(cwd);
    console.log('is-string:', typeof parent === 'string');
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "is-string: true");
});

// ============================================================================
// SSH-212: $.str().pipe() with CommandFn and stream composition
// ============================================================================

Deno.test("SSH-212: $.str().pipe() accepts CommandFn from initCmds", async () => {
  const config: SafeShellConfig = {
    ...testConfig,
    permissions: {
      ...testConfig.permissions,
      run: ["grep", "cat"],
    },
  };

  const code = `
    const [grep] = await $.initCmds(['grep']);
    const result = await $.str('foo\\nbar\\nbaz\\nfoo bar').pipe(grep, ['foo']).exec();
    console.log('stdout:', result.stdout.trim());
  `;

  const result = await executeCode(code, config);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "foo");
  assertStringIncludes(result.stdout, "foo bar");
});

Deno.test("SSH-212: $.str().stdout().lines().grep() chain works", async () => {
  const config: SafeShellConfig = {
    ...testConfig,
    permissions: {
      ...testConfig.permissions,
      run: ["cat"],
    },
  };

  const code = `
    const lines = await $.str('ERROR: fail\\nINFO: ok\\nERROR: bad\\nWARN: alert')
      .stdout()
      .lines()
      .grep(/ERROR/)
      .collect();
    console.log('count:', lines.length);
    console.log('lines:', JSON.stringify(lines));
  `;

  const result = await executeCode(code, config);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "count: 2");
});

Deno.test("SSH-212: FluentStream.grep() filters by pattern", async () => {
  const code = `
    const lines = await $.fromArray(['ERROR: one', 'INFO: two', 'ERROR: three'])
      .grep(/ERROR/)
      .collect();
    console.log('count:', lines.length);
  `;

  const result = await executeCode(code, testConfig);

  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "count: 2");
});
