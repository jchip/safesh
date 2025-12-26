/**
 * Tests for runtime/session.ts
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { describe, it, beforeEach } from "@std/testing/bdd";
import { SessionManager, createSessionManager } from "../src/runtime/session.ts";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = createSessionManager("/tmp/test");
  });

  describe("create", () => {
    it("creates session with defaults", () => {
      const session = manager.create();

      assertNotEquals(session.id, "");
      assertEquals(session.cwd, "/tmp/test");
      assertEquals(session.env, {});
      assertEquals(session.vars, {});
      assertEquals(session.jobs.size, 0);
    });

    it("creates session with custom cwd", () => {
      const session = manager.create({ cwd: "/custom/path" });

      assertEquals(session.cwd, "/custom/path");
    });

    it("creates session with initial env", () => {
      const session = manager.create({ env: { FOO: "bar", BAZ: "qux" } });

      assertEquals(session.env, { FOO: "bar", BAZ: "qux" });
    });
  });

  describe("get", () => {
    it("returns session by ID", () => {
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
    it("returns existing session when ID provided", () => {
      const session = manager.create();
      const { session: retrieved, isTemporary } = manager.getOrTemp(session.id);

      assertEquals(retrieved, session);
      assertEquals(isTemporary, false);
    });

    it("creates temporary session when ID not found", () => {
      const { session, isTemporary } = manager.getOrTemp("nonexistent");

      assertEquals(isTemporary, true);
      assertEquals(session.cwd, "/tmp/test"); // Uses default cwd
    });

    it("creates temporary session when ID undefined", () => {
      const { session, isTemporary } = manager.getOrTemp(undefined);

      assertEquals(isTemporary, true);
    });

    it("uses fallback options for temporary session", () => {
      const { session, isTemporary } = manager.getOrTemp(undefined, {
        cwd: "/fallback",
        env: { KEY: "value" },
      });

      assertEquals(isTemporary, true);
      assertEquals(session.cwd, "/fallback");
      assertEquals(session.env, { KEY: "value" });
    });
  });

  describe("update", () => {
    it("updates session cwd", () => {
      const session = manager.create();
      manager.update(session.id, { cwd: "/new/path" });

      assertEquals(session.cwd, "/new/path");
    });

    it("merges env vars", () => {
      const session = manager.create({ env: { A: "1" } });
      manager.update(session.id, { env: { B: "2" } });

      assertEquals(session.env, { A: "1", B: "2" });
    });

    it("merges vars", () => {
      const session = manager.create();
      session.vars = { x: 1 };
      manager.update(session.id, { vars: { y: 2 } });

      assertEquals(session.vars, { x: 1, y: 2 });
    });

    it("returns undefined for unknown ID", () => {
      const result = manager.update("nonexistent", { cwd: "/new" });
      assertEquals(result, undefined);
    });
  });

  describe("setEnv/unsetEnv", () => {
    it("sets environment variable", () => {
      const session = manager.create();
      manager.setEnv(session.id, "MY_VAR", "my_value");

      assertEquals(session.env["MY_VAR"], "my_value");
    });

    it("unsets environment variable", () => {
      const session = manager.create({ env: { TO_REMOVE: "value" } });
      manager.unsetEnv(session.id, "TO_REMOVE");

      assertEquals(session.env["TO_REMOVE"], undefined);
    });

    it("returns false for unknown session", () => {
      assertEquals(manager.setEnv("bad", "key", "val"), false);
      assertEquals(manager.unsetEnv("bad", "key"), false);
    });
  });

  describe("cd", () => {
    it("changes working directory", () => {
      const session = manager.create();
      manager.cd(session.id, "/new/dir");

      assertEquals(session.cwd, "/new/dir");
    });

    it("returns false for unknown session", () => {
      assertEquals(manager.cd("bad", "/path"), false);
    });
  });

  describe("setVar/getVar", () => {
    it("stores and retrieves variables", () => {
      const session = manager.create();
      manager.setVar(session.id, "counter", 42);

      assertEquals(manager.getVar(session.id, "counter"), 42);
    });

    it("stores complex objects", () => {
      const session = manager.create();
      const obj = { nested: { value: [1, 2, 3] } };
      manager.setVar(session.id, "data", obj);

      assertEquals(manager.getVar(session.id, "data"), obj);
    });
  });

  describe("job management", () => {
    it("adds and retrieves jobs", () => {
      const session = manager.create();
      const job = {
        id: "job-1",
        pid: 12345,
        command: "sleep 10",
        status: "running" as const,
        startedAt: Date.now(),
        stdout: "",
        stderr: "",
      };

      manager.addJob(session.id, job);
      const retrieved = manager.getJob(session.id, "job-1");

      assertEquals(retrieved, job);
    });

    it("updates job status", () => {
      const session = manager.create();
      manager.addJob(session.id, {
        id: "job-1",
        pid: 12345,
        command: "sleep 10",
        status: "running",
        startedAt: Date.now(),
        stdout: "",
        stderr: "",
      });

      manager.updateJob(session.id, "job-1", { status: "completed", exitCode: 0 });
      const job = manager.getJob(session.id, "job-1");

      assertEquals(job?.status, "completed");
      assertEquals(job?.exitCode, 0);
    });

    it("lists jobs", () => {
      const session = manager.create();
      manager.addJob(session.id, {
        id: "job-1",
        pid: 123,
        command: "cmd1",
        status: "running",
        startedAt: Date.now(),
        stdout: "",
        stderr: "",
      });
      manager.addJob(session.id, {
        id: "job-2",
        pid: 456,
        command: "cmd2",
        status: "completed",
        startedAt: Date.now(),
        stdout: "",
        stderr: "",
      });

      const jobs = manager.listJobs(session.id);
      assertEquals(jobs.length, 2);
    });
  });

  describe("end", () => {
    it("removes session", () => {
      const session = manager.create();
      const ended = manager.end(session.id);

      assertEquals(ended, true);
      assertEquals(manager.get(session.id), undefined);
    });

    it("returns false for unknown session", () => {
      assertEquals(manager.end("nonexistent"), false);
    });
  });

  describe("list", () => {
    it("lists all sessions", () => {
      manager.create();
      manager.create();
      manager.create();

      assertEquals(manager.list().length, 3);
    });
  });

  describe("count", () => {
    it("returns session count", () => {
      assertEquals(manager.count(), 0);
      manager.create();
      assertEquals(manager.count(), 1);
      manager.create();
      assertEquals(manager.count(), 2);
    });
  });

  describe("cleanup", () => {
    it("removes expired sessions", () => {
      // Create a session with old timestamp
      const session = manager.create();
      (session as { createdAt: Date }).createdAt = new Date(Date.now() - 100000);

      // Cleanup with 1 second max age
      const cleaned = manager.cleanup(1000);

      assertEquals(cleaned, 1);
      assertEquals(manager.count(), 0);
    });

    it("keeps recent sessions", () => {
      manager.create();

      const cleaned = manager.cleanup(60000);

      assertEquals(cleaned, 0);
      assertEquals(manager.count(), 1);
    });
  });

  describe("serialize", () => {
    it("serializes session for response", () => {
      const session = manager.create({ cwd: "/my/dir", env: { FOO: "bar" } });
      session.vars = { count: 5 };
      manager.addJob(session.id, {
        id: "job-1",
        pid: 123,
        command: "test",
        status: "running",
        startedAt: Date.now(),
        stdout: "",
        stderr: "",
      });

      const serialized = manager.serialize(session);

      assertEquals(serialized.sessionId, session.id);
      assertEquals(serialized.cwd, "/my/dir");
      assertEquals(serialized.env, { FOO: "bar" });
      assertEquals(serialized.vars, { count: 5 });
      assertEquals(serialized.jobs.length, 1);
      assertEquals(serialized.jobs[0]!.id, "job-1");
    });
  });
});
