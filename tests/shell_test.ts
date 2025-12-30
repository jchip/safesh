/**
 * Tests for runtime/shell.ts
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { describe, it, beforeEach } from "@std/testing/bdd";
import { ShellManager, createShellManager } from "../src/runtime/shell.ts";

describe("ShellManager", () => {
  let manager: ShellManager;

  beforeEach(() => {
    manager = createShellManager("/tmp/test");
  });

  describe("create", () => {
    it("creates shell with defaults", () => {
      const shell = manager.create();

      assertNotEquals(shell.id, "");
      assertEquals(shell.cwd, "/tmp/test");
      assertEquals(shell.env, {});
      assertEquals(shell.vars, {});
      assertEquals(shell.scripts.size, 0);
      assertEquals(shell.jobs.size, 0);
    });

    it("creates shell with custom cwd", () => {
      const shell = manager.create({ cwd: "/custom/path" });

      assertEquals(shell.cwd, "/custom/path");
    });

    it("creates shell with initial env", () => {
      const shell = manager.create({ env: { FOO: "bar", BAZ: "qux" } });

      assertEquals(shell.env, { FOO: "bar", BAZ: "qux" });
    });
  });

  describe("get", () => {
    it("returns shell by ID", () => {
      const created = manager.create();
      const retrieved = manager.get(created.id);

      assertEquals(retrieved, created);
    });

    it("returns undefined for unknown ID", () => {
      const result = manager.get("nonexistent");
      assertEquals(result, undefined);
    });
  });

  describe("getOrTemp", () => {
    it("returns existing shell when ID provided", () => {
      const shell = manager.create();
      const { shell: retrieved, isTemporary } = manager.getOrTemp(shell.id);

      assertEquals(retrieved, shell);
      assertEquals(isTemporary, false);
    });

    it("creates temporary shell when ID not found", () => {
      const { shell, isTemporary } = manager.getOrTemp("nonexistent");

      assertEquals(isTemporary, true);
      assertEquals(shell.cwd, "/tmp/test"); // Uses default cwd
    });

    it("creates temporary shell when ID undefined", () => {
      const { shell, isTemporary } = manager.getOrTemp(undefined);

      assertEquals(isTemporary, true);
    });

    it("uses fallback options for temporary shell", () => {
      const { shell, isTemporary } = manager.getOrTemp(undefined, {
        cwd: "/fallback",
        env: { KEY: "value" },
      });

      assertEquals(isTemporary, true);
      assertEquals(shell.cwd, "/fallback");
      assertEquals(shell.env, { KEY: "value" });
    });
  });

  describe("update", () => {
    it("updates shell cwd", () => {
      const shell = manager.create();
      manager.update(shell.id, { cwd: "/new/path" });

      assertEquals(shell.cwd, "/new/path");
    });

    it("merges env vars", () => {
      const shell = manager.create({ env: { A: "1" } });
      manager.update(shell.id, { env: { B: "2" } });

      assertEquals(shell.env, { A: "1", B: "2" });
    });

    it("merges vars", () => {
      const shell = manager.create();
      shell.vars = { x: 1 };
      manager.update(shell.id, { vars: { y: 2 } });

      assertEquals(shell.vars, { x: 1, y: 2 });
    });

    it("returns undefined for unknown ID", () => {
      const result = manager.update("nonexistent", { cwd: "/new" });
      assertEquals(result, undefined);
    });
  });

  describe("setEnv/unsetEnv", () => {
    it("sets environment variable", () => {
      const shell = manager.create();
      manager.setEnv(shell.id, "MY_VAR", "my_value");

      assertEquals(shell.env["MY_VAR"], "my_value");
    });

    it("unsets environment variable", () => {
      const shell = manager.create({ env: { TO_REMOVE: "value" } });
      manager.unsetEnv(shell.id, "TO_REMOVE");

      assertEquals(shell.env["TO_REMOVE"], undefined);
    });

    it("returns false for unknown shell", () => {
      assertEquals(manager.setEnv("bad", "key", "val"), false);
      assertEquals(manager.unsetEnv("bad", "key"), false);
    });
  });

  describe("cd", () => {
    it("changes working directory", () => {
      const shell = manager.create();
      manager.cd(shell.id, "/new/dir");

      assertEquals(shell.cwd, "/new/dir");
    });

    it("returns false for unknown shell", () => {
      assertEquals(manager.cd("bad", "/path"), false);
    });
  });

  describe("setVar/getVar", () => {
    it("stores and retrieves variables", () => {
      const shell = manager.create();
      manager.setVar(shell.id, "counter", 42);

      assertEquals(manager.getVar(shell.id, "counter"), 42);
    });

    it("stores complex objects", () => {
      const shell = manager.create();
      const obj = { nested: { value: [1, 2, 3] } };
      manager.setVar(shell.id, "data", obj);

      assertEquals(manager.getVar(shell.id, "data"), obj);
    });
  });

  describe("script management", () => {
    it("adds and retrieves scripts", () => {
      const shell = manager.create();
      const script = {
        id: "script-1",
        pid: 12345,
        code: "console.log('test')",
        status: "running" as const,
        startedAt: new Date(),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        background: true,
        jobIds: [],
      };

      manager.addScript(shell.id, script);
      const retrieved = manager.getScript(shell.id, "script-1");

      assertEquals(retrieved, script);
    });

    it("retrieves scripts by PID", () => {
      const shell = manager.create();
      const script = {
        id: "script-1",
        pid: 12345,
        code: "console.log('test')",
        status: "running" as const,
        startedAt: new Date(),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        background: true,
        jobIds: [],
      };

      manager.addScript(shell.id, script);
      const retrieved = manager.getScriptByPid(shell.id, 12345);

      assertEquals(retrieved, script);
    });

    it("updates script status", () => {
      const shell = manager.create();
      manager.addScript(shell.id, {
        id: "script-1",
        pid: 12345,
        code: "console.log('test')",
        status: "running",
        startedAt: new Date(),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        background: true,
        jobIds: [],
      });

      manager.updateScript(shell.id, "script-1", {
        status: "completed",
        exitCode: 0,
        completedAt: new Date(),
        duration: 100,
      });
      const script = manager.getScript(shell.id, "script-1");

      assertEquals(script?.status, "completed");
      assertEquals(script?.exitCode, 0);
      assertEquals(script?.duration, 100);
    });

    it("lists scripts with filter", () => {
      const shell = manager.create();
      const now = new Date();
      manager.addScript(shell.id, {
        id: "script-1",
        pid: 123,
        code: "cmd1",
        status: "running",
        startedAt: now,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        background: true,
        jobIds: [],
      });
      manager.addScript(shell.id, {
        id: "script-2",
        pid: 456,
        code: "cmd2",
        status: "completed",
        startedAt: new Date(now.getTime() + 1000),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        background: false,
        jobIds: [],
      });

      const allScripts = manager.listScripts(shell.id);
      assertEquals(allScripts.length, 2);

      const runningScripts = manager.listScripts(shell.id, { status: "running" });
      assertEquals(runningScripts.length, 1);
      assertEquals(runningScripts[0]!.id, "script-1");

      const bgScripts = manager.listScripts(shell.id, { background: true });
      assertEquals(bgScripts.length, 1);
      assertEquals(bgScripts[0]!.id, "script-1");
    });
  });

  describe("end", () => {
    it("removes shell", () => {
      const shell = manager.create();
      const ended = manager.end(shell.id);

      assertEquals(ended, true);
      assertEquals(manager.get(shell.id), undefined);
    });

    it("returns false for unknown shell", () => {
      assertEquals(manager.end("nonexistent"), false);
    });
  });

  describe("list", () => {
    it("lists all shells", () => {
      manager.create();
      manager.create();
      manager.create();

      assertEquals(manager.list().length, 3);
    });
  });

  describe("count", () => {
    it("returns shell count", () => {
      assertEquals(manager.count(), 0);
      manager.create();
      assertEquals(manager.count(), 1);
      manager.create();
      assertEquals(manager.count(), 2);
    });
  });

  describe("cleanup", () => {
    it("removes expired shells", () => {
      // Create a shell with old timestamp
      const shell = manager.create();
      (shell as { createdAt: Date }).createdAt = new Date(Date.now() - 100000);

      // Cleanup with 1 second max age
      const cleaned = manager.cleanup(1000);

      assertEquals(cleaned, 1);
      assertEquals(manager.count(), 0);
    });

    it("keeps recent shells", () => {
      manager.create();

      const cleaned = manager.cleanup(60000);

      assertEquals(cleaned, 0);
      assertEquals(manager.count(), 1);
    });
  });

  describe("serialize", () => {
    it("serializes shell for response", () => {
      const shell = manager.create({ cwd: "/my/dir", env: { FOO: "bar" } });
      shell.vars = { count: 5 };
      manager.addScript(shell.id, {
        id: "script-1",
        pid: 123,
        code: "test command",
        status: "running",
        startedAt: new Date(),
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        background: true,
        jobIds: [],
      });

      const serialized = manager.serialize(shell);

      assertEquals(serialized.shellId, shell.id);
      assertEquals(serialized.cwd, "/my/dir");
      assertEquals(serialized.env, { FOO: "bar" });
      assertEquals(serialized.vars, { count: 5 });
      assertEquals(serialized.scripts.length, 1);
      assertEquals(serialized.scripts[0]!.id, "script-1");
      assertEquals(serialized.scripts[0]!.background, true);
    });
  });

  describe("shell limits", () => {
    it("has lastActivityAt field", () => {
      const shell = manager.create();
      assertEquals(shell.lastActivityAt instanceof Date, true);
    });

    it("has scriptSequence field", () => {
      const shell = manager.create();
      assertEquals(shell.scriptSequence, 0);
    });

    it("has scriptsByPid map", () => {
      const shell = manager.create();
      assertEquals(shell.scriptsByPid instanceof Map, true);
      assertEquals(shell.scriptsByPid.size, 0);
    });
  });

  describe("pending retries", () => {
    it("creates pending retry with unique ID", () => {
      const retry = manager.createPendingRetry(
        "await cmd('cargo', ['build']).exec()",
        "cargo",
        { cwd: "/project", timeout: 30000 },
        undefined,
      );

      assertNotEquals(retry.id, "");
      assertEquals(retry.id.startsWith("retry-"), false); // IDs are rt1, rt2 etc now
      assertEquals(retry.code, "await cmd('cargo', ['build']).exec()");
      assertEquals(retry.blockedCommand, "cargo");
      assertEquals(retry.context.cwd, "/project");
      assertEquals(retry.context.timeout, 30000);
    });

    it("gets pending retry by ID", () => {
      const created = manager.createPendingRetry(
        "test code",
        "rustc",
        { cwd: "/tmp" },
      );

      const retrieved = manager.getPendingRetry(created.id);

      assertEquals(retrieved?.id, created.id);
      assertEquals(retrieved?.code, "test code");
    });

    it("consumes pending retry (get and delete)", () => {
      const created = manager.createPendingRetry(
        "test code",
        "make",
        { cwd: "/tmp" },
      );

      const consumed = manager.consumePendingRetry(created.id);
      assertEquals(consumed?.id, created.id);

      // Should be gone after consume
      const again = manager.getPendingRetry(created.id);
      assertEquals(again, undefined);
    });

    it("returns undefined for unknown retry ID", () => {
      const result = manager.getPendingRetry("retry-nonexistent");
      assertEquals(result, undefined);
    });

    it("stores shellId when provided", () => {
      const shell = manager.create();
      const retry = manager.createPendingRetry(
        "code",
        "cmd",
        { cwd: "/tmp" },
        shell.id,
      );

      assertEquals(retry.shellId, shell.id);
    });
  });

  describe("session allowed commands", () => {
    it("starts with empty session allowlist", () => {
      const commands = manager.getSessionAllowedCommands();
      assertEquals(commands.length, 0);
    });

    it("adds commands to session allowlist", () => {
      manager.addSessionAllowedCommands(["cargo", "rustc"]);

      const commands = manager.getSessionAllowedCommands();
      assertEquals(commands.includes("cargo"), true);
      assertEquals(commands.includes("rustc"), true);
    });

    it("checks if command is session allowed", () => {
      manager.addSessionAllowedCommands(["cargo"]);

      assertEquals(manager.isSessionAllowed("cargo"), true);
      assertEquals(manager.isSessionAllowed("rustc"), false);
    });

    it("merges with existing session commands", () => {
      manager.addSessionAllowedCommands(["cargo"]);
      manager.addSessionAllowedCommands(["rustc", "make"]);

      const commands = manager.getSessionAllowedCommands();
      assertEquals(commands.includes("cargo"), true);
      assertEquals(commands.includes("rustc"), true);
      assertEquals(commands.includes("make"), true);
    });

    it("does not duplicate commands", () => {
      manager.addSessionAllowedCommands(["cargo", "rustc"]);
      manager.addSessionAllowedCommands(["cargo", "make"]);

      const commands = manager.getSessionAllowedCommands();
      const cargoCount = commands.filter((c) => c === "cargo").length;
      assertEquals(cargoCount, 1);
    });
  });
});