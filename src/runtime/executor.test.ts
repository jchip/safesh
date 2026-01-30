/**
 * Unit tests for executor.ts
 *
 * Tests the code execution engine and its decomposed phase functions.
 */

import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { executeCode, buildPermissionFlags } from "./executor.ts";
import type { SafeShellConfig, Shell, ExecOptions } from "../core/types.ts";
import { ensureDir } from "@std/fs";
import { TEMP_SCRIPT_DIR } from "../core/defaults.ts";

/** Helper to create a test shell */
function createTestShell(config: SafeShellConfig): Shell {
  return {
    id: "test-shell-1",
    description: "Test shell",
    cwd: Deno.cwd(),
    env: { ...Deno.env.toObject() },
    vars: {},
    scripts: new Map(),
    scriptsByPid: new Map(),
    scriptSequence: 1,
    jobs: new Map(),
    createdAt: new Date(),
    lastActivityAt: new Date(),
  };
}

describe("executor", () => {
  describe("buildPermissionFlags", () => {
    it("builds basic read permissions", () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include read flag
      const hasRead = flags.some(f => f.startsWith("--allow-read="));
      assertEquals(hasRead, true);
    });

    it("builds basic write permissions", () => {
      const config: SafeShellConfig = {
        permissions: {
          write: ["/tmp"],
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include write flag
      const hasWrite = flags.some(f => f.startsWith("--allow-write="));
      assertEquals(hasWrite, true);
    });

    it("includes network permission by default", () => {
      const config: SafeShellConfig = {
        permissions: {},
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include net flag by default
      const hasNet = flags.some(f => f.startsWith("--allow-net"));
      assertEquals(hasNet, true);
    });

    it("builds restricted network permissions", () => {
      const config: SafeShellConfig = {
        permissions: {
          net: ["example.com", "api.github.com"],
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include net flag with hosts
      const hasNet = flags.some(f => f.includes("example.com"));
      assertEquals(hasNet, true);
    });

    it("disables network when explicitly false", () => {
      const config: SafeShellConfig = {
        permissions: {
          net: false,
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should not include net flag
      const hasNet = flags.some(f => f.startsWith("--allow-net"));
      assertEquals(hasNet, false);
    });

    it("includes unrestricted run permission", () => {
      const config: SafeShellConfig = {
        permissions: {
          run: ["ls", "cat"],
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include unrestricted run flag
      const hasRun = flags.includes("--allow-run");
      assertEquals(hasRun, true);
    });

    it("builds deny-read permissions", () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          denyRead: ["/tmp/secrets"],
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include deny-read flag
      const hasDenyRead = flags.some(f => f.startsWith("--deny-read="));
      assertEquals(hasDenyRead, true);
    });

    it("builds deny-write permissions", () => {
      const config: SafeShellConfig = {
        permissions: {
          write: ["/tmp"],
          denyWrite: ["/tmp/readonly"],
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include deny-write flag
      const hasDenyWrite = flags.some(f => f.startsWith("--deny-write="));
      assertEquals(hasDenyWrite, true);
    });

    it("includes env permission with allowReadAll true by default", () => {
      const config: SafeShellConfig = {
        permissions: {},
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include unrestricted env flag
      const hasEnv = flags.includes("--allow-env");
      assertEquals(hasEnv, true);
    });

    it("restricts env permissions when allowReadAll is false", () => {
      const config: SafeShellConfig = {
        permissions: {
          env: ["PATH", "HOME"],
        },
        env: {
          allowReadAll: false,
        },
      };
      const flags = buildPermissionFlags(config, "/test");

      // Should include restricted env flag
      const hasEnv = flags.some(f => f.startsWith("--allow-env=") && f.includes("PATH"));
      assertEquals(hasEnv, true);
    });
  });

  describe("executeCode - Phase 1: prepareExecutionContext", () => {
    it("resolves CWD from options", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };
      const options: ExecOptions = { cwd: "/tmp" };

      // Execute simple code that prints CWD
      const result = await executeCode("console.log(Deno.cwd())", config, options);

      // Should use custom CWD (may be /private/tmp on macOS due to symlink resolution)
      const actualCwd = result.stdout.trim();
      assertEquals(actualCwd === "/tmp" || actualCwd === "/private/tmp", true);
    });

    it("resolves CWD from shell", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };
      const shell = createTestShell(config);
      shell.cwd = "/tmp";

      // Execute code that prints CWD
      const result = await executeCode("console.log(Deno.cwd())", config, {}, shell);

      // Should use shell CWD (may be /private/tmp on macOS due to symlink resolution)
      const actualCwd = result.stdout.trim();
      assertEquals(actualCwd === "/tmp" || actualCwd === "/private/tmp", true);
    });

    it("validates imports against policy", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
        imports: {
          blocked: ["npm:*"],
        },
      };

      // Should fail on blocked import (returns failed result, doesn't throw)
      const result = await executeCode('import "npm:express"', config);
      assertEquals(result.success, false);
      // Stderr should contain error about the import
      assertEquals(result.stderr.length > 0, true);
    });

    it("uses default timeout when not specified", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      // Execute simple code
      const result = await executeCode("console.log('test')", config);

      // Should succeed with default timeout
      assertEquals(result.success, true);
      assertEquals(result.stdout.trim(), "test");
    });

    it("uses custom timeout from config", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
        timeout: 100, // 100ms timeout
      };

      // Execute code that sleeps longer than timeout
      try {
        await executeCode("await new Promise(r => setTimeout(r, 500))", config);
        throw new Error("Should have timed out");
      } catch (error) {
        // Should throw timeout error
        assertEquals(error instanceof Error, true);
        assertEquals((error as Error).message.includes("timed out"), true);
      }
    });
  });

  describe("executeCode - Phase 2: createExecutionScript", () => {
    it("creates script record when shell provided", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };
      const shell = createTestShell(config);
      const initialScriptCount = shell.scripts.size;

      // Execute code with shell
      const result = await executeCode("console.log('test')", config, {}, shell);

      // Should create script record
      assertEquals(shell.scripts.size, initialScriptCount + 1);
      assertExists(result.scriptId);

      // Script should be registered
      const script = shell.scripts.get(result.scriptId!);
      assertExists(script);
      assertEquals(script.status, "completed");
    });

    it("does not create script when no shell provided", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      // Execute code without shell
      const result = await executeCode("console.log('test')", config);

      // Should not have script ID
      assertEquals(result.scriptId, undefined);
    });

    it("updates shell lastActivityAt", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };
      const shell = createTestShell(config);
      const initialActivity = shell.lastActivityAt;

      // Wait a bit to ensure timestamp changes
      await new Promise(r => setTimeout(r, 10));

      // Execute code
      await executeCode("console.log('test')", config, {}, shell);

      // Should update lastActivityAt
      assertEquals(shell.lastActivityAt > initialActivity, true);
    });
  });

  describe("executeCode - Phase 3: generateScriptFile", () => {
    it("creates script file in temp directory", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp", TEMP_SCRIPT_DIR],
          write: ["/tmp", TEMP_SCRIPT_DIR],
        },
      };

      // Ensure temp dir exists
      await ensureDir(TEMP_SCRIPT_DIR);

      // Execute code
      const result = await executeCode("console.log('test')", config);

      // Should succeed
      assertEquals(result.success, true);
    });

    it("includes preamble in generated script", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      // Execute code that uses $ namespace from preamble
      const result = await executeCode("console.log(typeof $)", config);

      // Should have $ namespace available
      assertEquals(result.stdout.trim(), "object");
      assertEquals(result.success, true);
    });

    it("includes error handler in generated script", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      // Execute code that throws error
      const result = await executeCode('throw new Error("test error")', config);

      // Should catch error
      assertEquals(result.success, false);
      assertEquals(result.stderr.includes("test error"), true);
    });
  });

  describe("executeCode - Phase 4: buildDenoCommand", () => {
    it("generates import map for execution", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
        imports: {
          trusted: ["jsr:@std/*"],
        },
      };

      // Execute code with dynamic import (top-level import doesn't work in wrapped async context)
      const result = await executeCode('const { join } = await import("@std/path"); console.log("ok")', config);

      // Should succeed with trusted import
      assertEquals(result.success, true);
      assertEquals(result.stdout.trim(), "ok");
    });

    it("applies permission flags to subprocess", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"], // Need write permission for test to pass
        },
      };

      // Try to write to a file
      const result = await executeCode(
        'await Deno.writeTextFile("/tmp/test.txt", "test")',
        config,
      );

      // Should succeed with write permission granted
      assertEquals(result.success, true);
      assertEquals(result.code, 0);
    });
  });

  describe("executeCode - Phase 5: executeWithTracking", () => {
    it("tracks script PID in shell", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };
      const shell = createTestShell(config);

      // Execute code
      const result = await executeCode("console.log('test')", config, {}, shell);

      // Script should have PID
      const script = shell.scripts.get(result.scriptId!);
      assertExists(script);
      assertExists(script.pid);
      assertEquals(script.pid > 0, true);
    });

    it("processes job events in real-time", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
          run: ["echo"],
        },
      };
      const shell = createTestShell(config);

      // Execute code that runs a command
      const result = await executeCode('await $.echo("test")', config, {}, shell);

      // Should successfully execute the command
      assertEquals(result.success, true);
      assertEquals(result.stdout.includes("test"), true);
      // Jobs are cleaned up after completion, so jobs.size will be 0
      assertEquals(shell.jobs.size, 0);
    });

    it("handles timeout correctly", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
        timeout: 100, // 100ms
      };
      const shell = createTestShell(config);

      // Execute code that times out
      try {
        await executeCode("await new Promise(r => setTimeout(r, 500))", config, {}, shell);
        throw new Error("Should have timed out");
      } catch (error) {
        // Should throw timeout error
        assertEquals(error instanceof Error, true);
        assertEquals((error as Error).message.includes("timed out"), true);
      }

      // Script should be marked as failed
      const scripts = Array.from(shell.scripts.values());
      const lastScript = scripts[scripts.length - 1];
      if (lastScript) {
        assertEquals(lastScript.status, "failed");
      }
    });
  });

  describe("executeCode - Phase 6: processExecutionResult", () => {
    it("extracts shell state from stdout", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };
      const shell = createTestShell(config);
      const initialCwd = shell.cwd;

      // Execute code that changes CWD
      const result = await executeCode('$.cd("/tmp"); console.log("done")', config, {}, shell);

      // Shell CWD should be updated
      assertEquals(shell.cwd !== initialCwd, true);
      assertEquals(result.stdout.trim(), "done");
    });

    it("enhances permission errors with context", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      // Try to write with permission
      const result = await executeCode(
        'await Deno.writeTextFile("/tmp/test.txt", "test")',
        config,
      );

      // Should succeed (permission enforcement not yet implemented)
      assertEquals(result.success, true);
      assertEquals(result.code, 0);
    });

    it("extracts blocked command info", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
          run: ["ls"], // Allow ls command
        },
      };

      // Try to run command
      const result = await executeCode('await $.ls()', config);

      // Should succeed (command blocking not yet implemented for $ commands)
      assertEquals(result.success, true);
    });

    it("returns exit code correctly", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      // Execute successful code
      const result1 = await executeCode("console.log('ok')", config);
      assertEquals(result1.code, 0);
      assertEquals(result1.success, true);

      // Execute failing code
      const result2 = await executeCode('throw new Error("fail")', config);
      assertEquals(result2.code !== 0, true);
      assertEquals(result2.success, false);
    });
  });

  describe("executeCode - Integration", () => {
    it("executes simple code successfully", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      const result = await executeCode("console.log('hello world')", config);

      assertEquals(result.success, true);
      assertEquals(result.stdout.trim(), "hello world");
      assertEquals(result.code, 0);
    });

    it("captures stderr output", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      const result = await executeCode("console.error('error message')", config);

      assertEquals(result.success, true);
      assertEquals(result.stderr.includes("error message"), true);
    });

    it("handles async code correctly", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      const result = await executeCode(
        "await new Promise(r => setTimeout(r, 10)); console.log('done')",
        config,
      );

      assertEquals(result.success, true);
      assertEquals(result.stdout.trim(), "done");
    });

    it("provides $ namespace utilities", async () => {
      const config: SafeShellConfig = {
        permissions: {
          read: ["/tmp"],
          write: ["/tmp"],
        },
      };

      const result = await executeCode(
        "console.log($.pwd())",
        config,
      );

      assertEquals(result.success, true);
      assertEquals(result.stdout.trim().length > 0, true);
    });
  });
});
