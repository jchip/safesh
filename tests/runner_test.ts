/**
 * Tests for external command runner
 */

import { assertEquals, assertRejects } from "@std/assert";
import { runExternal } from "../src/external/runner.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";

// ============================================================================
// Basic Execution Tests
// ============================================================================

Deno.test("runExternal - executes whitelisted command successfully", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["echo"],
    },
    external: {
      echo: { allow: true },
    },
  };

  const result = await runExternal("echo", ["hello", "world"], config);

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "hello world");
  assertEquals(result.stderr, "");
});

Deno.test("runExternal - captures stderr output", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sh"],
    },
    external: {
      sh: { allow: true },
    },
  };

  const result = await runExternal(
    "sh",
    ["-c", "echo 'error message' >&2"],
    config,
  );

  assertEquals(result.success, true);
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "");
  assertEquals(result.stderr.trim(), "error message");
});

Deno.test("runExternal - handles non-zero exit codes", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sh"],
    },
    external: {
      sh: { allow: true },
    },
  };

  const result = await runExternal("sh", ["-c", "exit 42"], config);

  assertEquals(result.success, false);
  assertEquals(result.code, 42);
});

Deno.test("runExternal - captures both stdout and stderr", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sh"],
    },
    external: {
      sh: { allow: true },
    },
  };

  const result = await runExternal(
    "sh",
    ["-c", "echo 'out'; echo 'err' >&2"],
    config,
  );

  assertEquals(result.success, true);
  assertEquals(result.stdout.trim(), "out");
  assertEquals(result.stderr.trim(), "err");
});

// ============================================================================
// Validation Tests
// ============================================================================

Deno.test("runExternal - rejects non-whitelisted command", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: [],
    },
    external: {},
  };

  await assertRejects(
    async () => {
      await runExternal("rm", ["-rf", "/"], config);
    },
    SafeShellError,
    "not whitelisted",
  );
});

Deno.test("runExternal - validates subcommands", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["git"],
    },
    external: {
      git: { allow: ["status", "log"] },
    },
  };

  // Allowed subcommand should work
  const result1 = await runExternal("git", ["status"], config);
  assertEquals(result1.success, true);

  // Disallowed subcommand should fail
  await assertRejects(
    async () => {
      await runExternal("git", ["push"], config);
    },
    SafeShellError,
    "not allowed",
  );
});

Deno.test("runExternal - respects denied flags", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["git"],
    },
    external: {
      git: {
        allow: true,
        denyFlags: ["--force", "-f"],
      },
    },
  };

  // Normal command should work
  const result1 = await runExternal("git", ["status"], config);
  assertEquals(result1.success, true);

  // Command with denied flag should fail
  await assertRejects(
    async () => {
      await runExternal("git", ["push", "--force"], config);
    },
    SafeShellError,
    "not allowed",
  );
});

// ============================================================================
// Timeout Tests
// ============================================================================

Deno.test("runExternal - respects timeout option", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sleep"],
    },
    external: {
      sleep: { allow: true },
    },
  };

  await assertRejects(
    async () => {
      await runExternal("sleep", ["10"], config, { timeout: 100 });
    },
    SafeShellError,
    "timed out",
  );
});

Deno.test("runExternal - uses config timeout if not specified", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sleep"],
    },
    external: {
      sleep: { allow: true },
    },
    timeout: 100,
  };

  await assertRejects(
    async () => {
      await runExternal("sleep", ["10"], config);
    },
    SafeShellError,
    "timed out",
  );
});

// ============================================================================
// Working Directory Tests
// ============================================================================

Deno.test("runExternal - respects cwd option", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["pwd"],
    },
    external: {
      pwd: { allow: true },
    },
  };

  const result = await runExternal("pwd", [], config, { cwd: "/tmp" });

  assertEquals(result.success, true);
  // On macOS, /tmp is a symlink to /private/tmp
  const output = result.stdout.trim();
  assertEquals(output === "/tmp" || output === "/private/tmp", true);
});

// ============================================================================
// Environment Variable Tests
// ============================================================================

Deno.test("runExternal - passes allowed environment variables", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sh"],
    },
    external: {
      sh: { allow: true },
    },
    env: {
      allow: ["PATH", "HOME"],
    },
  };

  const result = await runExternal(
    "sh",
    ["-c", "echo $HOME"],
    config,
  );

  assertEquals(result.success, true);
  // Should output HOME value (not empty)
  assertEquals(result.stdout !== "\n", true);
});

Deno.test("runExternal - masks secret environment variables", async () => {
  // Set a test secret
  Deno.env.set("TEST_SECRET_KEY", "secret-value");

  const config: SafeShellConfig = {
    permissions: {
      run: ["sh"],
    },
    external: {
      sh: { allow: true },
    },
    env: {
      allow: ["TEST_SECRET_KEY", "PATH"],
      mask: ["*_SECRET_*"],
    },
  };

  const result = await runExternal(
    "sh",
    ["-c", "echo $TEST_SECRET_KEY"],
    config,
  );

  assertEquals(result.success, true);
  // Should be empty because TEST_SECRET_KEY is masked
  assertEquals(result.stdout.trim(), "");

  // Cleanup
  Deno.env.delete("TEST_SECRET_KEY");
});

Deno.test("runExternal - merges additional env vars from options", async () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["sh"],
    },
    external: {
      sh: { allow: true },
    },
    env: {
      allow: ["CUSTOM_VAR"],
    },
  };

  const result = await runExternal(
    "sh",
    ["-c", "echo $CUSTOM_VAR"],
    config,
    { env: { CUSTOM_VAR: "test-value" } },
  );

  assertEquals(result.success, true);
  assertEquals(result.stdout.trim(), "test-value");
});
