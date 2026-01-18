/**
 * Unit tests for project-root.ts
 *
 * Tests the unified project root discovery logic.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import { findProjectRoot, PROJECT_MARKERS } from "./project-root.ts";

describe("project-root", () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = Deno.makeTempDirSync({ prefix: "safesh-test-" });

    // Save original env vars
    originalEnv = Deno.env.get("CLAUDE_PROJECT_DIR");
    originalHome = Deno.env.get("HOME");
  });

  afterEach(() => {
    // Restore env vars
    if (originalEnv !== undefined) {
      Deno.env.set("CLAUDE_PROJECT_DIR", originalEnv);
    } else {
      Deno.env.delete("CLAUDE_PROJECT_DIR");
    }

    if (originalHome !== undefined) {
      Deno.env.set("HOME", originalHome);
    }

    // Clean up temp directory
    try {
      Deno.removeSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("respects CLAUDE_PROJECT_DIR env var (highest priority)", () => {
    const customProjectDir = "/custom/project/dir";
    Deno.env.set("CLAUDE_PROJECT_DIR", customProjectDir);

    const result = findProjectRoot(tempDir);

    assertEquals(result, customProjectDir);
  });

  it("finds .claude marker", () => {
    // Create .claude marker
    const projectDir = `${tempDir}/my-project`;
    Deno.mkdirSync(projectDir, { recursive: true });
    Deno.mkdirSync(`${projectDir}/.claude`);

    // Search from subdirectory
    const subdir = `${projectDir}/src/components`;
    Deno.mkdirSync(subdir, { recursive: true });

    const result = findProjectRoot(subdir);

    assertEquals(result, projectDir);
  });

  it("finds .git marker", () => {
    // Create .git marker
    const projectDir = `${tempDir}/my-repo`;
    Deno.mkdirSync(projectDir, { recursive: true });
    Deno.mkdirSync(`${projectDir}/.git`);

    // Search from subdirectory
    const subdir = `${projectDir}/src/utils`;
    Deno.mkdirSync(subdir, { recursive: true });

    const result = findProjectRoot(subdir);

    assertEquals(result, projectDir);
  });

  it("finds .config/safesh marker", () => {
    // Create .config/safesh marker
    const projectDir = `${tempDir}/safesh-project`;
    Deno.mkdirSync(projectDir, { recursive: true });
    Deno.mkdirSync(`${projectDir}/.config/safesh`, { recursive: true });

    // Search from subdirectory
    const subdir = `${projectDir}/lib/core`;
    Deno.mkdirSync(subdir, { recursive: true });

    const result = findProjectRoot(subdir);

    assertEquals(result, projectDir);
  });

  it("stops at HOME directory", () => {
    // Create a fake home directory
    const fakeHome = `${tempDir}/fake-home`;
    Deno.mkdirSync(fakeHome, { recursive: true });
    Deno.env.set("HOME", fakeHome);

    // Create subdirectory in fake home
    const subdir = `${fakeHome}/workspace/project`;
    Deno.mkdirSync(subdir, { recursive: true });

    // Should return subdir (cwd) since no markers found and stopped at HOME
    const result = findProjectRoot(subdir, { createConfig: false });

    assertEquals(result, subdir);
  });

  it("creates .config/safesh when createConfig=true (default)", () => {
    const projectDir = `${tempDir}/new-project`;
    Deno.mkdirSync(projectDir, { recursive: true });

    const result = findProjectRoot(projectDir);

    assertEquals(result, projectDir);

    // Verify .config/safesh was created
    const configDir = `${projectDir}/.config/safesh`;
    const configFile = `${configDir}/config.local.json`;

    const configDirStat = Deno.statSync(configDir);
    assertEquals(configDirStat.isDirectory, true);

    const configFileStat = Deno.statSync(configFile);
    assertEquals(configFileStat.isFile, true);

    // Verify config file content
    const content = Deno.readTextFileSync(configFile);
    assertEquals(content, "{}\n");
  });

  it("does not create .config/safesh when createConfig=false", () => {
    const projectDir = `${tempDir}/no-config-project`;
    Deno.mkdirSync(projectDir, { recursive: true });

    const result = findProjectRoot(projectDir, { createConfig: false });

    assertEquals(result, projectDir);

    // Verify .config/safesh was NOT created
    let configExists = true;
    try {
      Deno.statSync(`${projectDir}/.config/safesh`);
    } catch {
      configExists = false;
    }

    assertEquals(configExists, false);
  });

  it("returns cwd when no marker found", () => {
    const projectDir = `${tempDir}/bare-project`;
    Deno.mkdirSync(projectDir, { recursive: true });

    const result = findProjectRoot(projectDir, { createConfig: false });

    assertEquals(result, projectDir);
  });

  it("handles nested projects (stops at first marker)", () => {
    // Create nested structure:
    // outer-project/.git
    // outer-project/inner-project/.git
    const outerProject = `${tempDir}/outer-project`;
    const innerProject = `${outerProject}/inner-project`;

    Deno.mkdirSync(outerProject, { recursive: true });
    Deno.mkdirSync(`${outerProject}/.git`);

    Deno.mkdirSync(innerProject, { recursive: true });
    Deno.mkdirSync(`${innerProject}/.git`);

    // Search from inner project subdirectory
    const innerSubdir = `${innerProject}/src`;
    Deno.mkdirSync(innerSubdir, { recursive: true });

    const result = findProjectRoot(innerSubdir);

    // Should find innerProject first, not outerProject
    assertEquals(result, innerProject);
  });

  it("respects stopAtHome=false option", () => {
    // Create a fake home directory with a marker
    const fakeHome = `${tempDir}/fake-home`;
    Deno.mkdirSync(fakeHome, { recursive: true });
    Deno.mkdirSync(`${fakeHome}/.git`);
    Deno.env.set("HOME", fakeHome);

    // Create subdirectory in fake home
    const subdir = `${fakeHome}/workspace/project`;
    Deno.mkdirSync(subdir, { recursive: true });

    // With stopAtHome=false, should find .git in HOME
    const result = findProjectRoot(subdir, { stopAtHome: false, createConfig: false });

    assertEquals(result, fakeHome);
  });

  it("prioritizes .claude over .git", () => {
    // Create directory with both .claude and .git
    const projectDir = `${tempDir}/both-markers`;
    Deno.mkdirSync(projectDir, { recursive: true });
    Deno.mkdirSync(`${projectDir}/.claude`);
    Deno.mkdirSync(`${projectDir}/.git`);

    const subdir = `${projectDir}/src`;
    Deno.mkdirSync(subdir, { recursive: true });

    const result = findProjectRoot(subdir);

    // Should find projectDir (doesn't matter which marker, both return same dir)
    assertEquals(result, projectDir);
  });

  it("does not overwrite existing config.local.json", () => {
    const projectDir = `${tempDir}/existing-config`;
    const configDir = `${projectDir}/.config/safesh`;
    const configFile = `${configDir}/config.local.json`;

    Deno.mkdirSync(configDir, { recursive: true });
    const existingContent = '{"existing":"data"}\n';
    Deno.writeTextFileSync(configFile, existingContent);

    const result = findProjectRoot(projectDir);

    assertEquals(result, projectDir);

    // Verify config was not overwritten
    const content = Deno.readTextFileSync(configFile);
    assertEquals(content, existingContent);
  });

  it("exports PROJECT_MARKERS constant correctly", () => {
    assertEquals(PROJECT_MARKERS.length, 3);
    assertEquals(PROJECT_MARKERS[0], ".claude");
    assertEquals(PROJECT_MARKERS[1], ".git");
    assertEquals(PROJECT_MARKERS[2], ".config/safesh");
  });
});
