/**
 * Unit tests for config-persistence.ts
 *
 * Tests configuration persistence utilities.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import {
  updateConfigLocal,
  addCommandsToConfig,
  addPathsToConfig,
} from "./config-persistence.ts";
import { join } from "@std/path";

describe("config-persistence", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = Deno.makeTempDirSync({ prefix: "safesh-test-config-" });
    configPath = join(tempDir, ".config", "safesh", "config.local.json");
  });

  afterEach(() => {
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("updateConfigLocal", () => {
    it("creates config file if it doesn't exist", async () => {
      await updateConfigLocal(tempDir, { commands: ["ls"] }, { silent: true });

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.allowedCommands, ["ls"]);
    });

    it("merges commands with existing config", async () => {
      // Create initial config
      await updateConfigLocal(tempDir, { commands: ["ls"] }, { silent: true });

      // Add more commands
      await updateConfigLocal(tempDir, { commands: ["cat", "grep"] }, { silent: true });

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.allowedCommands.length, 3);
      assertEquals(config.allowedCommands.includes("ls"), true);
      assertEquals(config.allowedCommands.includes("cat"), true);
      assertEquals(config.allowedCommands.includes("grep"), true);
    });

    it("avoids duplicate commands when merging", async () => {
      await updateConfigLocal(tempDir, { commands: ["ls"] }, { silent: true });
      await updateConfigLocal(tempDir, { commands: ["ls"] }, { silent: true });

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.allowedCommands, ["ls"]);
    });

    it("updates read paths", async () => {
      await updateConfigLocal(
        tempDir,
        { readPaths: ["/tmp", "/var"] },
        { silent: true }
      );

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.permissions?.read?.length, 2);
      assertEquals(config.permissions?.read?.includes("/tmp"), true);
      assertEquals(config.permissions?.read?.includes("/var"), true);
    });

    it("updates write paths", async () => {
      await updateConfigLocal(
        tempDir,
        { writePaths: ["/tmp"] },
        { silent: true }
      );

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.permissions?.write, ["/tmp"]);
    });

    it("merges read and write paths", async () => {
      await updateConfigLocal(
        tempDir,
        { readPaths: ["/tmp"] },
        { silent: true }
      );

      await updateConfigLocal(
        tempDir,
        { readPaths: ["/var"], writePaths: ["/tmp"] },
        { silent: true }
      );

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.permissions?.read?.length, 2);
      assertEquals(config.permissions?.write, ["/tmp"]);
    });

    it("updates all types at once", async () => {
      await updateConfigLocal(
        tempDir,
        {
          commands: ["ls", "cat"],
          readPaths: ["/tmp"],
          writePaths: ["/var"],
        },
        { silent: true }
      );

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.allowedCommands?.length, 2);
      assertEquals(config.permissions?.read, ["/tmp"]);
      assertEquals(config.permissions?.write, ["/var"]);
    });

    it("replaces values when merge is false", async () => {
      await updateConfigLocal(tempDir, { commands: ["ls", "cat"] }, { silent: true });

      await updateConfigLocal(
        tempDir,
        { commands: ["grep"] },
        { merge: false, silent: true }
      );

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.allowedCommands, ["grep"]);
    });
  });

  describe("addCommandsToConfig", () => {
    it("adds commands to config", async () => {
      await addCommandsToConfig(["ls", "cat"], tempDir);

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.allowedCommands?.length, 2);
    });
  });

  describe("addPathsToConfig", () => {
    it("adds paths to config", async () => {
      await addPathsToConfig(["/tmp"], ["/var"], tempDir);

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.permissions?.read, ["/tmp"]);
      assertEquals(config.permissions?.write, ["/var"]);
    });
  });
});
