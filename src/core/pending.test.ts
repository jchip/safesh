/**
 * Unit tests for pending.ts
 *
 * Tests the unified pending command/path management logic.
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import {
  deletePending,
  generatePendingId,
  type PendingCommand,
  type PendingPathRequest,
  readPendingCommand,
  readPendingPath,
  writePendingCommand,
  writePendingPath,
} from "./pending.ts";
import { getPendingFilePath, getPendingPathFilePath } from "./temp.ts";

describe("pending", () => {
  const testIds: string[] = [];

  afterEach(() => {
    // Clean up any test files
    for (const id of testIds) {
      try {
        deletePending(id, "command");
      } catch {
        // Ignore
      }
      try {
        deletePending(id, "path");
      } catch {
        // Ignore
      }
    }
    testIds.length = 0;
  });

  describe("generatePendingId", () => {
    it("creates unique IDs", async () => {
      const id1 = generatePendingId();
      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 2));
      const id2 = generatePendingId();

      testIds.push(id1, id2);

      assertNotEquals(id1, id2);
      assertEquals(typeof id1, "string");
      assertEquals(typeof id2, "string");
      assertEquals(id1.length > 0, true);
      assertEquals(id2.length > 0, true);
    });

    it("follows timestamp-pid format", () => {
      const id = generatePendingId();
      testIds.push(id);

      // Should match pattern: {timestamp}-{pid}
      const parts = id.split("-");
      assertEquals(parts.length, 2);

      const timestamp = parseInt(parts[0]!, 10);
      const pid = parseInt(parts[1]!, 10);

      assertEquals(isNaN(timestamp), false);
      assertEquals(isNaN(pid), false);
      assertEquals(timestamp > 0, true);
      assertEquals(pid > 0, true);
    });
  });

  describe("writePendingCommand", () => {
    it("creates file with correct format", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "abc123",
        commands: ["docker", "kubectl"],
        cwd: "/test/cwd",
        timeout: 5000,
        runInBackground: false,
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(pending);

      // Verify file exists
      const filePath = getPendingFilePath(id);
      const stat = Deno.statSync(filePath);
      assertEquals(stat.isFile, true);

      // Verify content
      const content = Deno.readTextFileSync(filePath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.id, pending.id);
      assertEquals(parsed.scriptHash, pending.scriptHash);
      assertEquals(parsed.commands, pending.commands);
      assertEquals(parsed.cwd, pending.cwd);
      assertEquals(parsed.timeout, pending.timeout);
      assertEquals(parsed.runInBackground, pending.runInBackground);
      assertEquals(parsed.createdAt, pending.createdAt);
    });

    it("handles optional fields", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "xyz789",
        commands: ["git"],
        cwd: "/another/cwd",
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(pending);

      const filePath = getPendingFilePath(id);
      const content = Deno.readTextFileSync(filePath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.timeout, undefined);
      assertEquals(parsed.runInBackground, undefined);
    });
  });

  describe("writePendingPath", () => {
    it("creates file with correct format", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingPathRequest = {
        id,
        path: "/etc/hosts",
        operation: "read",
        cwd: "/test/cwd",
        scriptHash: "def456",
        createdAt: new Date().toISOString(),
      };

      writePendingPath(pending);

      // Verify file exists
      const filePath = getPendingPathFilePath(id);
      const stat = Deno.statSync(filePath);
      assertEquals(stat.isFile, true);

      // Verify content
      const content = Deno.readTextFileSync(filePath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.id, pending.id);
      assertEquals(parsed.path, pending.path);
      assertEquals(parsed.operation, pending.operation);
      assertEquals(parsed.cwd, pending.cwd);
      assertEquals(parsed.scriptHash, pending.scriptHash);
      assertEquals(parsed.createdAt, pending.createdAt);
    });

    it("handles write operation", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingPathRequest = {
        id,
        path: "/var/log/app.log",
        operation: "write",
        cwd: "/app",
        scriptHash: "ghi789",
        createdAt: new Date().toISOString(),
      };

      writePendingPath(pending);

      const filePath = getPendingPathFilePath(id);
      const content = Deno.readTextFileSync(filePath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.operation, "write");
    });
  });

  describe("readPendingCommand", () => {
    it("reads existing file", () => {
      const id = generatePendingId();
      testIds.push(id);

      const original: PendingCommand = {
        id,
        scriptHash: "jkl012",
        commands: ["npm", "yarn"],
        cwd: "/project",
        timeout: 3000,
        runInBackground: true,
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(original);

      const read = readPendingCommand(id);

      assertEquals(read !== null, true);
      assertEquals(read!.id, original.id);
      assertEquals(read!.scriptHash, original.scriptHash);
      assertEquals(read!.commands, original.commands);
      assertEquals(read!.cwd, original.cwd);
      assertEquals(read!.timeout, original.timeout);
      assertEquals(read!.runInBackground, original.runInBackground);
      assertEquals(read!.createdAt, original.createdAt);
    });

    it("returns null for missing file", () => {
      const id = "nonexistent-12345";

      const read = readPendingCommand(id);

      assertEquals(read, null);
    });

    it("returns null for corrupted file", () => {
      const id = generatePendingId();
      testIds.push(id);

      // Write invalid JSON
      const filePath = getPendingFilePath(id);
      Deno.writeTextFileSync(filePath, "{ invalid json }");

      const read = readPendingCommand(id);

      assertEquals(read, null);
    });
  });

  describe("readPendingPath", () => {
    it("reads existing file", () => {
      const id = generatePendingId();
      testIds.push(id);

      const original: PendingPathRequest = {
        id,
        path: "/home/user/.bashrc",
        operation: "read",
        cwd: "/home/user",
        scriptHash: "mno345",
        createdAt: new Date().toISOString(),
      };

      writePendingPath(original);

      const read = readPendingPath(id);

      assertEquals(read !== null, true);
      assertEquals(read!.id, original.id);
      assertEquals(read!.path, original.path);
      assertEquals(read!.operation, original.operation);
      assertEquals(read!.cwd, original.cwd);
      assertEquals(read!.scriptHash, original.scriptHash);
      assertEquals(read!.createdAt, original.createdAt);
    });

    it("returns null for missing file", () => {
      const id = "nonexistent-67890";

      const read = readPendingPath(id);

      assertEquals(read, null);
    });

    it("returns null for corrupted file", () => {
      const id = generatePendingId();
      testIds.push(id);

      // Write invalid JSON
      const filePath = getPendingPathFilePath(id);
      Deno.writeTextFileSync(filePath, "not valid json at all");

      const read = readPendingPath(id);

      assertEquals(read, null);
    });
  });

  describe("deletePending", () => {
    it("removes command file", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "pqr678",
        commands: ["rm", "mv"],
        cwd: "/tmp",
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(pending);

      // Verify file exists
      const filePath = getPendingFilePath(id);
      let fileExists = true;
      try {
        Deno.statSync(filePath);
      } catch {
        fileExists = false;
      }
      assertEquals(fileExists, true);

      // Delete it
      deletePending(id, "command");

      // Verify file is gone
      fileExists = true;
      try {
        Deno.statSync(filePath);
      } catch {
        fileExists = false;
      }
      assertEquals(fileExists, false);
    });

    it("removes path file", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingPathRequest = {
        id,
        path: "/etc/passwd",
        operation: "read",
        cwd: "/",
        scriptHash: "stu901",
        createdAt: new Date().toISOString(),
      };

      writePendingPath(pending);

      // Verify file exists
      const filePath = getPendingPathFilePath(id);
      let fileExists = true;
      try {
        Deno.statSync(filePath);
      } catch {
        fileExists = false;
      }
      assertEquals(fileExists, true);

      // Delete it
      deletePending(id, "path");

      // Verify file is gone
      fileExists = true;
      try {
        Deno.statSync(filePath);
      } catch {
        fileExists = false;
      }
      assertEquals(fileExists, false);
    });

    it("handles missing command file gracefully", () => {
      const id = "missing-command-12345";

      // Should not throw
      deletePending(id, "command");
    });

    it("handles missing path file gracefully", () => {
      const id = "missing-path-67890";

      // Should not throw
      deletePending(id, "path");
    });

    it("can be called multiple times on same file", () => {
      const id = generatePendingId();
      testIds.push(id);

      const pending: PendingCommand = {
        id,
        scriptHash: "vwx234",
        commands: ["echo"],
        cwd: "/home",
        createdAt: new Date().toISOString(),
      };

      writePendingCommand(pending);

      // Delete multiple times - should not throw
      deletePending(id, "command");
      deletePending(id, "command");
      deletePending(id, "command");
    });
  });
});
