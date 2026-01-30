/**
 * Integration test for project root consistency
 *
 * Tests that project root discovery and config directory creation work
 * consistently across the codebase, especially for:
 * - CLAUDE_PROJECT_DIR environment variable
 * - .config/safesh directory creation
 */

import { assertEquals, assert } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import { findProjectRoot } from "../../src/core/project-root.ts";
import { getProjectConfigDir } from "../../src/core/config.ts";
import { REAL_TMP } from "../helpers.ts";

const testDir = `${REAL_TMP}/safesh-project-root-test`;
const projectDir1 = `${testDir}/project1`;
const projectDir2 = `${testDir}/project2`;

describe("Project root consistency integration tests", { sanitizeResources: false, sanitizeOps: false }, () => {
  beforeEach(async () => {
    // Create two test projects
    await Deno.mkdir(`${projectDir1}/.git`, { recursive: true });
    await Deno.mkdir(`${projectDir2}/.git`, { recursive: true });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    Deno.env.delete("CLAUDE_PROJECT_DIR");
  });

  it("both respect CLAUDE_PROJECT_DIR environment variable", () => {
    // Set CLAUDE_PROJECT_DIR to override discovery
    Deno.env.set("CLAUDE_PROJECT_DIR", projectDir1);

    // Test from a subdirectory of project2 (should still use env var)
    const subdir = `${projectDir2}/subdir`;
    Deno.mkdirSync(subdir, { recursive: true });

    // findProjectRoot should use CLAUDE_PROJECT_DIR
    const root = findProjectRoot(subdir);
    assertEquals(root, projectDir1, "findProjectRoot should use CLAUDE_PROJECT_DIR override");

    // getProjectConfigDir should also use the same root
    const configDir = getProjectConfigDir(root);
    assertEquals(configDir, `${projectDir1}/.config/safesh`, "Config directory should be based on CLAUDE_PROJECT_DIR");

    // Verify it's NOT using the actual .git parent directory
    assertEquals(root !== projectDir2, true, "Should not use .git directory when env var is set");
  });

  it("both create .config/safesh in same location", () => {
    // Test without CLAUDE_PROJECT_DIR - use natural discovery
    const subdir = `${projectDir1}/src/components`;
    Deno.mkdirSync(subdir, { recursive: true });

    // Find project root from deep subdirectory
    const root = findProjectRoot(subdir);
    assertEquals(root, projectDir1, "Should find project root from subdirectory");

    // Get config directory path
    const configDir = getProjectConfigDir(root);
    assertEquals(configDir, `${projectDir1}/.config/safesh`, "Config directory should be at project root");

    // Create the config directory (simulating what the system would do)
    Deno.mkdirSync(configDir, { recursive: true });

    // Verify directory was created in the right place
    const stat = Deno.statSync(configDir);
    assert(stat.isDirectory, "Config directory should exist");

    // Verify it's at the project root, not in the subdirectory
    let wrongConfigExists = false;
    try {
      Deno.statSync(`${subdir}/.config/safesh`);
      wrongConfigExists = true;
    } catch {
      // Expected - config should not be in subdirectory
    }
    assertEquals(wrongConfigExists, false, "Config should not be created in subdirectory");

    // Test that config files would be written to the same location
    const configFilePath = `${configDir}/config.local.json`;
    Deno.writeTextFileSync(configFilePath, JSON.stringify({ test: true }, null, 2));

    // Verify file exists at project root
    const fileStat = Deno.statSync(configFilePath);
    assert(fileStat.isFile, "Config file should be created at project root");

    // Clean up test file
    Deno.removeSync(configFilePath);
  });

  it("project root discovery is consistent across multiple calls", () => {
    // Create a deep directory structure
    const deepSubdir = `${projectDir1}/a/b/c/d/e/f`;
    Deno.mkdirSync(deepSubdir, { recursive: true });

    // Test from multiple depths
    const root1 = findProjectRoot(`${projectDir1}/a`);
    const root2 = findProjectRoot(`${projectDir1}/a/b/c`);
    const root3 = findProjectRoot(deepSubdir);
    const root4 = findProjectRoot(projectDir1); // From root itself

    // All should return the same root
    assertEquals(root1, projectDir1, "Should find root from depth 1");
    assertEquals(root2, projectDir1, "Should find root from depth 3");
    assertEquals(root3, projectDir1, "Should find root from depth 6");
    assertEquals(root4, projectDir1, "Should find root from root itself");

    // All should be exactly the same
    assertEquals(root1, root2, "All calls should return identical root");
    assertEquals(root2, root3, "All calls should return identical root");
    assertEquals(root3, root4, "All calls should return identical root");
  });

  it("session files use project-consistent paths", () => {
    // Test that session file location is consistent with project root
    const subdir = `${projectDir1}/nested/deep`;
    Deno.mkdirSync(subdir, { recursive: true });

    const root = findProjectRoot(subdir);
    assertEquals(root, projectDir1, "Should find project root");

    // Session file should be at {projectRoot}/.temp/safesh/
    const expectedSessionDir = `${root}/.temp/safesh`;
    const sessionId = "test-session-123";
    const expectedSessionFile = `${expectedSessionDir}/session-${sessionId}.json`;

    // Create session directory to simulate usage
    Deno.mkdirSync(expectedSessionDir, { recursive: true });

    // Verify directory structure
    const stat = Deno.statSync(expectedSessionDir);
    assert(stat.isDirectory, "Session directory should exist at project root");

    // Write a test session file
    const sessionData = { allowedCommands: ["test"] };
    Deno.writeTextFileSync(expectedSessionFile, JSON.stringify(sessionData, null, 2));

    // Verify file exists and is readable
    const fileStat = Deno.statSync(expectedSessionFile);
    assert(fileStat.isFile, "Session file should exist at expected location");

    const content = Deno.readTextFileSync(expectedSessionFile);
    const parsed = JSON.parse(content);
    assertEquals(parsed.allowedCommands[0], "test", "Session file should be readable");

    // Verify session file is NOT in subdirectory
    let wrongSessionExists = false;
    try {
      Deno.statSync(`${subdir}/.temp/safesh/session-${sessionId}.json`);
      wrongSessionExists = true;
    } catch {
      // Expected - session should be at project root
    }
    assertEquals(wrongSessionExists, false, "Session file should not be in subdirectory");
  });
});
