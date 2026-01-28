/**
 * Unit tests for config path helper functions
 *
 * Tests the config path construction helpers to ensure they generate
 * correct paths for different scenarios.
 */

import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  getGlobalConfigDir,
  getProjectConfigDir,
  getLocalConfigPath,
  getLocalJsonConfigPath,
  getGlobalConfigPath,
  getGlobalConfigJsonPath,
  getProjectConfigPath,
  getProjectConfigJsonPath,
} from "./config.ts";

describe("Config Path Helpers", () => {
  describe("getGlobalConfigDir", () => {
    it("returns path in user's home directory", () => {
      const dir = getGlobalConfigDir();

      // Should contain .config/safesh
      assertMatch(dir, /\.config\/safesh$/);
    });

    it("uses HOME environment variable", () => {
      const home = Deno.env.get("HOME");
      const dir = getGlobalConfigDir();

      if (home) {
        assertEquals(dir, `${home}/.config/safesh`);
      } else {
        // If HOME is not set, should return .config/safesh
        assertEquals(dir, ".config/safesh");
      }
    });
  });

  describe("getProjectConfigDir", () => {
    it("returns correct path for project directory", () => {
      const projectDir = "/Users/jc/dev/safesh";
      const expected = "/Users/jc/dev/safesh/.config/safesh";

      assertEquals(getProjectConfigDir(projectDir), expected);
    });

    it("handles path without trailing slash", () => {
      const projectDir = "/tmp/test-project";
      const expected = "/tmp/test-project/.config/safesh";

      assertEquals(getProjectConfigDir(projectDir), expected);
    });

    it("handles relative paths", () => {
      const projectDir = "./my-project";
      // join() normalizes ./ to empty string
      const expected = "my-project/.config/safesh";

      assertEquals(getProjectConfigDir(projectDir), expected);
    });
  });

  describe("getLocalConfigPath", () => {
    it("returns correct TypeScript config path", () => {
      const projectDir = "/Users/jc/dev/safesh";
      const expected = "/Users/jc/dev/safesh/.config/safesh/config.local.ts";

      assertEquals(getLocalConfigPath(projectDir), expected);
    });

    it("uses getProjectConfigDir internally", () => {
      const projectDir = "/test/project";
      const path = getLocalConfigPath(projectDir);
      const configDir = getProjectConfigDir(projectDir);

      // Path should start with the config dir
      assertEquals(path.startsWith(configDir), true);
    });
  });

  describe("getLocalJsonConfigPath", () => {
    it("returns correct JSON config path", () => {
      const projectDir = "/Users/jc/dev/safesh";
      const expected = "/Users/jc/dev/safesh/.config/safesh/config.local.json";

      assertEquals(getLocalJsonConfigPath(projectDir), expected);
    });

    it("has .json extension", () => {
      const projectDir = "/test/project";
      const path = getLocalJsonConfigPath(projectDir);

      assertMatch(path, /\.json$/);
    });

    it("contains config.local.json filename", () => {
      const projectDir = "/any/path";
      const path = getLocalJsonConfigPath(projectDir);

      assertMatch(path, /config\.local\.json$/);
    });
  });

  describe("Global config paths", () => {
    it("getGlobalConfigPath returns TypeScript config path", () => {
      const path = getGlobalConfigPath();

      assertMatch(path, /\.config\/safesh\/config\.ts$/);
    });

    it("getGlobalConfigJsonPath returns JSON config path", () => {
      const path = getGlobalConfigJsonPath();

      assertMatch(path, /\.config\/safesh\/config\.json$/);
    });
  });

  describe("Project config paths", () => {
    it("getProjectConfigPath returns TypeScript config path", () => {
      const projectDir = "/test/project";
      const path = getProjectConfigPath(projectDir);

      assertEquals(path, "/test/project/.config/safesh/config.ts");
    });

    it("getProjectConfigJsonPath returns JSON config path", () => {
      const projectDir = "/test/project";
      const path = getProjectConfigJsonPath(projectDir);

      assertEquals(path, "/test/project/.config/safesh/config.json");
    });
  });

  describe("Path consistency", () => {
    it("all paths use consistent .config/safesh directory", () => {
      const projectDir = "/test/project";
      const expectedDir = "/test/project/.config/safesh";

      assertEquals(getProjectConfigDir(projectDir), expectedDir);
      assertEquals(getLocalConfigPath(projectDir), `${expectedDir}/config.local.ts`);
      assertEquals(getLocalJsonConfigPath(projectDir), `${expectedDir}/config.local.json`);
      assertEquals(getProjectConfigPath(projectDir), `${expectedDir}/config.ts`);
      assertEquals(getProjectConfigJsonPath(projectDir), `${expectedDir}/config.json`);
    });
  });
});
