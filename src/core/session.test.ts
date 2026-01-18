/**
 * Unit tests for session.ts
 *
 * Tests the unified session file management logic.
 * Includes regression test for the projectDir bug.
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import {
  addSessionCommands,
  addSessionPaths,
  getSessionAllowedCommands,
  getSessionAllowedCommandsArray,
  getSessionPathPermissions,
  readSessionFile,
  writeSessionFile,
} from "./session.ts";
import { getSessionFilePath } from "./temp.ts";

describe("session", () => {
  let tempProjectDir: string;
  const testSessionId = "test-session-" + Date.now();

  beforeEach(() => {
    // Create a temp project directory
    tempProjectDir = Deno.makeTempDirSync({ prefix: "safesh-session-test-" });
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      Deno.removeSync(tempProjectDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }

    // Clean up default /tmp session file if it exists
    try {
      const defaultSessionFile = getSessionFilePath(undefined, testSessionId);
      Deno.removeSync(defaultSessionFile);
    } catch {
      // Ignore
    }
  });

  describe("readSessionFile", () => {
    it("reads file when it exists with commands", async () => {
      const sessionFile = getSessionFilePath(tempProjectDir, testSessionId);
      const data = {
        allowedCommands: ["docker", "kubectl"],
      };
      await Deno.writeTextFile(sessionFile, JSON.stringify(data));

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.allowedCommands, ["docker", "kubectl"]);
    });

    it("reads file when it exists with path permissions", async () => {
      const sessionFile = getSessionFilePath(tempProjectDir, testSessionId);
      const data = {
        permissions: {
          read: ["/etc/hosts"],
          write: ["/var/log/app.log"],
        },
      };
      await Deno.writeTextFile(sessionFile, JSON.stringify(data));

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.permissions?.read, ["/etc/hosts"]);
      assertEquals(result.permissions?.write, ["/var/log/app.log"]);
    });

    it("returns empty object when file doesn't exist", () => {
      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result, {});
    });

    it("uses correct path with projectDir", () => {
      const sessionFile = getSessionFilePath(tempProjectDir, testSessionId);

      // Verify path is in project directory, not /tmp
      assertEquals(sessionFile.includes(tempProjectDir), true);
      assertEquals(sessionFile.includes("/.temp/safesh/"), true);
    });

    it("falls back to /tmp without projectDir", () => {
      const sessionFile = getSessionFilePath(undefined, testSessionId);

      // Verify path is in /tmp, not project directory
      assertEquals(sessionFile.includes("/tmp/safesh/"), true);
      assertEquals(sessionFile.includes(tempProjectDir), false);
    });
  });

  describe("writeSessionFile", () => {
    it("creates new file with commands", async () => {
      await writeSessionFile(
        { allowedCommands: ["git", "npm"] },
        tempProjectDir,
        testSessionId,
      );

      const sessionFile = getSessionFilePath(tempProjectDir, testSessionId);
      const content = await Deno.readTextFile(sessionFile);
      const parsed = JSON.parse(content);

      assertEquals(parsed.allowedCommands, ["git", "npm"]);
    });

    it("merges with existing data", async () => {
      // Write initial data
      await writeSessionFile(
        { allowedCommands: ["docker"] },
        tempProjectDir,
        testSessionId,
      );

      // Write more data (permissions)
      await writeSessionFile(
        {
          permissions: {
            read: ["/etc/passwd"],
          },
        },
        tempProjectDir,
        testSessionId,
      );

      const result = readSessionFile(tempProjectDir, testSessionId);

      // Both should be present
      assertEquals(result.allowedCommands, ["docker"]);
      assertEquals(result.permissions?.read, ["/etc/passwd"]);
    });

    it("overwrites fields when provided", async () => {
      await writeSessionFile(
        { allowedCommands: ["old", "command"] },
        tempProjectDir,
        testSessionId,
      );

      await writeSessionFile(
        { allowedCommands: ["new", "commands"] },
        tempProjectDir,
        testSessionId,
      );

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.allowedCommands, ["new", "commands"]);
    });
  });

  describe("addSessionCommands", () => {
    it("adds commands to empty file", async () => {
      await addSessionCommands(["docker", "kubectl"], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.allowedCommands?.length, 2);
      assertEquals(result.allowedCommands?.includes("docker"), true);
      assertEquals(result.allowedCommands?.includes("kubectl"), true);
    });

    it("merges with existing commands", async () => {
      await addSessionCommands(["docker"], tempProjectDir, testSessionId);
      await addSessionCommands(["kubectl"], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.allowedCommands?.length, 2);
      assertEquals(result.allowedCommands?.includes("docker"), true);
      assertEquals(result.allowedCommands?.includes("kubectl"), true);
    });

    it("deduplicates commands correctly", async () => {
      await addSessionCommands(["docker", "git"], tempProjectDir, testSessionId);
      await addSessionCommands(["docker", "npm"], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      // Should have 3 unique commands, not 4
      assertEquals(result.allowedCommands?.length, 3);
      assertEquals(result.allowedCommands?.includes("docker"), true);
      assertEquals(result.allowedCommands?.includes("git"), true);
      assertEquals(result.allowedCommands?.includes("npm"), true);
    });
  });

  describe("addSessionPaths", () => {
    it("adds read and write paths", async () => {
      await addSessionPaths(
        ["/etc/hosts"],
        ["/var/log/app.log"],
        tempProjectDir,
        testSessionId,
      );

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.permissions?.read, ["/etc/hosts"]);
      assertEquals(result.permissions?.write, ["/var/log/app.log"]);
    });

    it("merges with existing paths", async () => {
      await addSessionPaths(["/etc/hosts"], [], tempProjectDir, testSessionId);
      await addSessionPaths(["/etc/passwd"], [], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      assertEquals(result.permissions?.read?.length, 2);
      assertEquals(result.permissions?.read?.includes("/etc/hosts"), true);
      assertEquals(result.permissions?.read?.includes("/etc/passwd"), true);
    });

    it("deduplicates read paths", async () => {
      await addSessionPaths(["/etc/hosts", "/etc/passwd"], [], tempProjectDir, testSessionId);
      await addSessionPaths(["/etc/hosts", "/var/log"], [], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      // Should have 3 unique read paths, not 4
      assertEquals(result.permissions?.read?.length, 3);
    });

    it("deduplicates write paths separately from read", async () => {
      await addSessionPaths(["/etc/hosts"], ["/etc/hosts"], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      // Same path can be in both read and write
      assertEquals(result.permissions?.read, ["/etc/hosts"]);
      assertEquals(result.permissions?.write, ["/etc/hosts"]);
    });

    it("handles empty arrays gracefully", async () => {
      await addSessionPaths([], [], tempProjectDir, testSessionId);

      const result = readSessionFile(tempProjectDir, testSessionId);

      // Should create empty permissions object or not modify existing
      assertEquals(result.permissions !== undefined, true);
    });
  });

  describe("getSessionAllowedCommands", () => {
    it("returns Set with commands", async () => {
      await addSessionCommands(["docker", "git"], tempProjectDir, testSessionId);

      const result = getSessionAllowedCommands(tempProjectDir, testSessionId);

      assertEquals(result instanceof Set, true);
      assertEquals(result.size, 2);
      assertEquals(result.has("docker"), true);
      assertEquals(result.has("git"), true);
    });

    it("returns empty Set when no commands", () => {
      const result = getSessionAllowedCommands(tempProjectDir, testSessionId);

      assertEquals(result instanceof Set, true);
      assertEquals(result.size, 0);
    });
  });

  describe("getSessionAllowedCommandsArray", () => {
    it("returns array with commands", async () => {
      await addSessionCommands(["npm", "yarn"], tempProjectDir, testSessionId);

      const result = getSessionAllowedCommandsArray(tempProjectDir, testSessionId);

      assertEquals(Array.isArray(result), true);
      assertEquals(result.length, 2);
      assertEquals(result.includes("npm"), true);
      assertEquals(result.includes("yarn"), true);
    });

    it("returns empty array when no commands", () => {
      const result = getSessionAllowedCommandsArray(tempProjectDir, testSessionId);

      assertEquals(Array.isArray(result), true);
      assertEquals(result.length, 0);
    });
  });

  describe("getSessionPathPermissions", () => {
    it("returns permissions object", async () => {
      await addSessionPaths(["/etc/hosts"], ["/var/log"], tempProjectDir, testSessionId);

      const result = getSessionPathPermissions(tempProjectDir, testSessionId);

      assertEquals(result.read, ["/etc/hosts"]);
      assertEquals(result.write, ["/var/log"]);
    });

    it("returns empty object when no permissions", () => {
      const result = getSessionPathPermissions(tempProjectDir, testSessionId);

      assertEquals(result, {});
    });
  });

  describe("REGRESSION TEST: projectDir must flow through correctly", () => {
    it("read and write use same file when projectDir is provided", async () => {
      // This is the bug we fixed: desh retry --choice=3 writes to project dir
      // but bash-prehook reads from /tmp because projectDir wasn't passed

      // Simulate desh writing to session file with projectDir
      await addSessionCommands(["docker"], tempProjectDir, testSessionId);

      const projectSessionFile = getSessionFilePath(tempProjectDir, testSessionId);
      const tmpSessionFile = getSessionFilePath(undefined, testSessionId);

      // Verify files are in different locations
      assertEquals(projectSessionFile.includes(tempProjectDir), true);
      assertEquals(tmpSessionFile.includes("/tmp/safesh/"), true);
      assertNotEquals(projectSessionFile, tmpSessionFile);

      // Verify project session file exists
      let projectFileExists = true;
      try {
        Deno.statSync(projectSessionFile);
      } catch {
        projectFileExists = false;
      }
      assertEquals(projectFileExists, true, "Project session file should exist");

      // Verify /tmp session file does NOT exist (shouldn't have been created)
      let tmpFileExists = true;
      try {
        Deno.statSync(tmpSessionFile);
      } catch {
        tmpFileExists = false;
      }
      assertEquals(tmpFileExists, false, "/tmp session file should NOT exist");

      // Simulate bash-prehook reading with same projectDir
      const commands = getSessionAllowedCommands(tempProjectDir, testSessionId);

      // This should find the docker command because it's reading from the same file
      assertEquals(commands.has("docker"), true, "bash-prehook should find docker command");

      // Verify reading WITHOUT projectDir doesn't find it
      const commandsFromTmp = getSessionAllowedCommands(undefined, testSessionId);
      assertEquals(
        commandsFromTmp.has("docker"),
        false,
        "Reading from /tmp should NOT find docker",
      );
    });

    it("session file location changes based on projectDir parameter", () => {
      const projectSessionFile = getSessionFilePath(tempProjectDir, testSessionId);
      const tmpSessionFile = getSessionFilePath(undefined, testSessionId);

      // Should be different paths
      assertEquals(projectSessionFile !== tmpSessionFile, true);

      // Project path should include project directory
      assertEquals(projectSessionFile.startsWith(tempProjectDir), true);

      // Tmp path should not include project directory
      assertEquals(tmpSessionFile.includes(tempProjectDir), false);
      assertEquals(tmpSessionFile.includes("/tmp/safesh/"), true);
    });
  });
});
