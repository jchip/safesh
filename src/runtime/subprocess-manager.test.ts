/**
 * Unit tests for subprocess-manager.ts
 *
 * Tests the SubprocessManager class and its subprocess spawning capabilities.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { SubprocessManager, buildDenoArgs } from "./subprocess-manager.ts";
import type { DenoArgsOptions, SpawnOptions } from "./subprocess-manager.ts";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { TEMP_SCRIPT_DIR } from "../core/defaults.ts";

describe("subprocess-manager", () => {
  describe("buildDenoArgs", () => {
    it("builds basic command arguments", () => {
      const options: DenoArgsOptions = {
        permFlags: ["--allow-read=/tmp", "--allow-write=/tmp"],
        importMapPath: "/path/to/import_map.json",
        scriptPath: "/path/to/script.ts",
      };

      const args = buildDenoArgs(options);

      assertEquals(args[0], "run");
      assertEquals(args[1], "--no-prompt");
      assertEquals(args.includes("--import-map=/path/to/import_map.json"), true);
      assertEquals(args.includes("--allow-read=/tmp"), true);
      assertEquals(args.includes("--allow-write=/tmp"), true);
      assertEquals(args[args.length - 1], "/path/to/script.ts");
    });

    it("includes config path when provided", () => {
      const options: DenoArgsOptions = {
        permFlags: ["--allow-read=/tmp"],
        importMapPath: "/path/to/import_map.json",
        configPath: "/path/to/deno.json",
        scriptPath: "/path/to/script.ts",
      };

      const args = buildDenoArgs(options);

      assertEquals(args.includes("--config=/path/to/deno.json"), true);
    });

    it("includes custom Deno flags when provided", () => {
      const options: DenoArgsOptions = {
        permFlags: ["--allow-read=/tmp"],
        importMapPath: "/path/to/import_map.json",
        scriptPath: "/path/to/script.ts",
        denoFlags: ["--unstable", "--inspect"],
      };

      const args = buildDenoArgs(options);

      assertEquals(args.includes("--unstable"), true);
      assertEquals(args.includes("--inspect"), true);
    });

    it("maintains correct argument order", () => {
      const options: DenoArgsOptions = {
        permFlags: ["--allow-read=/tmp"],
        importMapPath: "/path/to/import_map.json",
        configPath: "/path/to/deno.json",
        scriptPath: "/path/to/script.ts",
        denoFlags: ["--unstable"],
      };

      const args = buildDenoArgs(options);

      // Order should be: run, --no-prompt, --import-map, denoFlags, permFlags, --config, scriptPath
      assertEquals(args[0], "run");
      assertEquals(args[1], "--no-prompt");
      assertEquals(args[2]?.startsWith("--import-map="), true);
      // Script path should be last
      assertEquals(args[args.length - 1], "/path/to/script.ts");
    });
  });

  describe("SubprocessManager", () => {
    it("can be instantiated", () => {
      const manager = new SubprocessManager();
      assertExists(manager);
    });

    it("provides buildDenoArgs method", () => {
      const manager = new SubprocessManager();
      const options: DenoArgsOptions = {
        permFlags: ["--allow-read=/tmp"],
        importMapPath: "/path/to/import_map.json",
        scriptPath: "/path/to/script.ts",
      };

      const args = manager.buildDenoArgs(options);

      assertEquals(Array.isArray(args), true);
      assertEquals(args[0], "run");
    });
  });

  describe("SubprocessManager.spawnAndCollectOutput", () => {
    it("spawns subprocess and collects output", async () => {
      const manager = new SubprocessManager();

      // Create a simple test script
      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-simple.ts");
      await Deno.writeTextFile(scriptPath, 'console.log("hello world");');

      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
      };

      const output = await manager.spawnAndCollectOutput(options);

      assertEquals(output.status.code, 0);
      assertEquals(output.stdout.trim(), "hello world");
      assertEquals(output.pid > 0, true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("captures stderr output", async () => {
      const manager = new SubprocessManager();

      // Create a script that writes to stderr
      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-stderr.ts");
      await Deno.writeTextFile(scriptPath, 'console.error("error message");');

      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
      };

      const output = await manager.spawnAndCollectOutput(options);

      assertEquals(output.status.code, 0);
      assertEquals(output.stderr.includes("error message"), true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("invokes onSpawn callback with PID", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-pid.ts");
      await Deno.writeTextFile(scriptPath, 'console.log("test");');

      let capturedPid = 0;
      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
        onSpawn: (pid) => {
          capturedPid = pid;
        },
      };

      const output = await manager.spawnAndCollectOutput(options);

      assertEquals(capturedPid > 0, true);
      assertEquals(capturedPid, output.pid);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("invokes onStderrLine callback for each line", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-stderr-lines.ts");
      await Deno.writeTextFile(scriptPath, `
        console.error("line 1");
        console.error("line 2");
        console.error("line 3");
      `);

      const lines: string[] = [];
      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
        onStderrLine: (line) => {
          lines.push(line);
        },
      };

      await manager.spawnAndCollectOutput(options);

      // Should capture all 3 lines
      const errorLines = lines.filter(l => l.includes("line"));
      assertEquals(errorLines.length >= 3, true);
      assertEquals(errorLines.some(l => l.includes("line 1")), true);
      assertEquals(errorLines.some(l => l.includes("line 2")), true);
      assertEquals(errorLines.some(l => l.includes("line 3")), true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("handles timeout correctly", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-timeout.ts");
      await Deno.writeTextFile(
        scriptPath,
        'await new Promise(r => setTimeout(r, 5000));',
      );

      let timeoutCallbackInvoked = false;
      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 100, // 100ms timeout
        onTimeout: () => {
          timeoutCallbackInvoked = true;
        },
      };

      await assertRejects(
        async () => {
          await manager.spawnAndCollectOutput(options);
        },
        Error,
        "timed out",
      );

      assertEquals(timeoutCallbackInvoked, true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("handles execution errors correctly", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-error.ts");
      await Deno.writeTextFile(scriptPath, 'throw new Error("test error");');

      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
      };

      const output = await manager.spawnAndCollectOutput(options);

      // Process exits with non-zero code
      assertEquals(output.status.code !== 0, true);
      assertEquals(output.stderr.includes("test error"), true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("passes environment variables to subprocess", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-env.ts");
      await Deno.writeTextFile(
        scriptPath,
        'console.log(Deno.env.get("TEST_VAR"));',
      );

      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", "--allow-env", scriptPath],
        cwd: Deno.cwd(),
        env: { TEST_VAR: "test_value" },
        timeoutMs: 5000,
      };

      const output = await manager.spawnAndCollectOutput(options);

      assertEquals(output.status.code, 0);
      assertEquals(output.stdout.includes("test_value"), true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("respects working directory", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-cwd.ts");
      await Deno.writeTextFile(scriptPath, 'console.log(Deno.cwd());');

      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: "/tmp",
        env: {},
        timeoutMs: 5000,
      };

      const output = await manager.spawnAndCollectOutput(options);

      assertEquals(output.status.code, 0);
      // Output should show /tmp or /private/tmp (macOS symlink)
      const actualCwd = output.stdout.trim();
      assertEquals(actualCwd === "/tmp" || actualCwd === "/private/tmp", true);

      // Cleanup
      await Deno.remove(scriptPath);
    });

    it("handles non-zero exit codes without error callback", async () => {
      const manager = new SubprocessManager();

      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-exit-code.ts");
      await Deno.writeTextFile(scriptPath, 'Deno.exit(1);');

      const options: SpawnOptions = {
        args: ["run", "--no-prompt", "--allow-read", scriptPath],
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
      };

      // Should complete successfully but with non-zero exit code
      const output = await manager.spawnAndCollectOutput(options);
      assertEquals(output.status.code, 1);

      // Cleanup
      await Deno.remove(scriptPath);
    });
  });

  describe("SubprocessManager - Integration", () => {
    it("can execute a complete Deno script with full pipeline", async () => {
      const manager = new SubprocessManager();

      // Create test script
      await ensureDir(TEMP_SCRIPT_DIR);
      const scriptPath = join(TEMP_SCRIPT_DIR, "test-integration.ts");
      await Deno.writeTextFile(
        scriptPath,
        `
        const data = [1, 2, 3, 4, 5];
        const result = data.map(x => x * 2).reduce((a, b) => a + b, 0);
        console.log(result);
      `,
      );

      // Build args using manager's method
      const args = manager.buildDenoArgs({
        permFlags: ["--allow-read=/tmp"],
        importMapPath: scriptPath.replace(".ts", "_import_map.json"),
        scriptPath,
      });

      // Create minimal import map
      const importMapPath = scriptPath.replace(".ts", "_import_map.json");
      await Deno.writeTextFile(importMapPath, '{"imports":{}}');

      // Execute
      const output = await manager.spawnAndCollectOutput({
        args,
        cwd: Deno.cwd(),
        env: {},
        timeoutMs: 5000,
      });

      assertEquals(output.status.code, 0);
      assertEquals(output.stdout.trim(), "30"); // (1+2+3+4+5)*2 = 30

      // Cleanup import map
      await Deno.remove(importMapPath);

      // Cleanup
      await Deno.remove(scriptPath);
    });
  });
});
