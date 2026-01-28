/**
 * Integration test for SSH-378 session-allow bug fix
 *
 * The bug: desh retry --choice=3 wrote to {projectDir}/.temp but
 * bash-prehook read from /tmp, causing session permissions to be lost.
 *
 * This test verifies the fix ensures both use the same file location.
 */

import { assertEquals, assert } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  addSessionCommands,
  getSessionAllowedCommands,
} from "../../src/core/session.ts";
import { findProjectRoot } from "../../src/core/project-root.ts";
import { REAL_TMP } from "../helpers.ts";

const testDir = `${REAL_TMP}/safesh-regression-test`;
const projectDir = `${testDir}/project`;

describe("SSH-378 session-allow regression", { sanitizeResources: false, sanitizeOps: false }, () => {
  beforeEach(async () => {
    // Create test project with .git marker
    await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
    Deno.env.set("CLAUDE_SESSION_ID", "regression-test-session");
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    Deno.env.delete("CLAUDE_SESSION_ID");
  });

  it("desh retry and bash-prehook use same session file location", async () => {
    // Simulate desh retry --choice=3 writing session commands
    await addSessionCommands(["curl", "git"], projectDir);

    // Simulate bash-prehook reading session commands
    const allowedCommands = getSessionAllowedCommands(projectDir);

    // Verify: Both should see the same commands
    assert(allowedCommands.has("curl"), "curl should be in session-allowed commands");
    assert(allowedCommands.has("git"), "git should be in session-allowed commands");
  });

  it("session file is created in project .temp directory", async () => {
    await addSessionCommands(["test-cmd"], projectDir);

    // Verify session file exists in project directory
    const sessionFile = `${projectDir}/.temp/safesh/session-regression-test-session.json`;
    const stat = Deno.statSync(sessionFile);
    assert(stat.isFile, "Session file should exist in project .temp directory");

    // Verify it's NOT in /tmp
    let tmpSessionExists = false;
    try {
      Deno.statSync(`${REAL_TMP}/safesh/session-regression-test-session.json`);
      tmpSessionExists = true;
    } catch {
      // Expected - file should not exist in /tmp
    }
    assertEquals(tmpSessionExists, false, "Session file should NOT be in /tmp");
  });

  it("findProjectRoot returns same directory for both", () => {
    const subdir = `${projectDir}/subdir`;
    Deno.mkdirSync(subdir, { recursive: true });

    // Both should find the same project root
    const root1 = findProjectRoot(projectDir);
    const root2 = findProjectRoot(subdir);

    assertEquals(root1, root2, "Both should find same project root");
    assertEquals(root1, projectDir, "Should find project root");
  });
});
