/**
 * Integration test for session consistency across the permission flow
 *
 * Tests that session data propagates correctly through the entire permission
 * handling system, including multiple command additions and fallback behavior.
 */

import { assertEquals, assert } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  addSessionCommands,
  getSessionAllowedCommands,
  mergeSessionPermissions,
} from "../../src/core/session.ts";
import { findProjectRoot } from "../../src/core/project-root.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

const testDir = `${REAL_TMP}/safesh-session-consistency-test`;
const projectDir = `${testDir}/project`;

describe("Session consistency integration tests", { sanitizeResources: false, sanitizeOps: false }, () => {
  beforeEach(async () => {
    // Create test project with .git marker
    await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
    Deno.env.set("CLAUDE_SESSION_ID", "consistency-test-session");
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    Deno.env.delete("CLAUDE_SESSION_ID");
  });

  it("projectDir flows through permission flow to session file", async () => {
    // Simulate the full flow: projectDir → addSessionCommands → file written
    const testProjectDir = projectDir;

    // Add commands with projectDir
    await addSessionCommands(["curl", "wget"], testProjectDir);

    // Verify session file was created in the correct location
    const sessionFile = `${testProjectDir}/.temp/safesh/session-consistency-test-session.json`;
    const stat = Deno.statSync(sessionFile);
    assert(stat.isFile, "Session file should be created in project .temp directory");

    // Verify commands can be read back
    const commands = getSessionAllowedCommands(testProjectDir);
    assert(commands.has("curl"), "curl should be in session");
    assert(commands.has("wget"), "wget should be in session");
  });

  it("session persists across multiple addSessionCommands() calls", async () => {
    // First call - add initial commands
    await addSessionCommands(["git", "docker"], projectDir);

    // Verify first batch
    let commands = getSessionAllowedCommands(projectDir);
    assert(commands.has("git"), "git should be in session after first call");
    assert(commands.has("docker"), "docker should be in session after first call");
    assertEquals(commands.size, 2, "Should have 2 commands after first call");

    // Second call - add more commands
    await addSessionCommands(["npm", "node"], projectDir);

    // Verify all commands are present
    commands = getSessionAllowedCommands(projectDir);
    assert(commands.has("git"), "git should still be in session");
    assert(commands.has("docker"), "docker should still be in session");
    assert(commands.has("npm"), "npm should be added to session");
    assert(commands.has("node"), "node should be added to session");
    assertEquals(commands.size, 4, "Should have 4 commands after second call");

    // Third call - add overlapping commands (test deduplication)
    await addSessionCommands(["git", "curl"], projectDir);

    // Verify deduplication works
    commands = getSessionAllowedCommands(projectDir);
    assertEquals(commands.size, 5, "Should have 5 unique commands (git not duplicated)");
    assert(commands.has("curl"), "curl should be added to session");
  });

  it("fallback to /tmp works when projectDir is null/undefined", async () => {
    // Add commands without projectDir (should use /tmp)
    await addSessionCommands(["ls", "cat"], undefined);

    // Verify session file was created in /tmp
    const sessionFile = `${REAL_TMP}/safesh/session-consistency-test-session.json`;
    const stat = Deno.statSync(sessionFile);
    assert(stat.isFile, "Session file should be created in /tmp/safesh when projectDir is undefined");

    // Verify commands can be read back
    const commands = getSessionAllowedCommands(undefined);
    assert(commands.has("ls"), "ls should be in session");
    assert(commands.has("cat"), "cat should be in session");

    // Verify it's NOT in project directory
    let projectSessionExists = false;
    try {
      Deno.statSync(`${projectDir}/.temp/safesh/session-consistency-test-session.json`);
      projectSessionExists = true;
    } catch {
      // Expected - file should not exist in project
    }
    assertEquals(projectSessionExists, false, "Session file should NOT be in project directory");
  });

  it("mergeSessionPermissions merges into config correctly", async () => {
    // Create a test config
    const config: SafeShellConfig = {
      permissions: {
        read: ["/existing/read"],
        write: ["/existing/write"],
        run: ["existing-cmd"],
      },
    };

    // Add session permissions
    await addSessionCommands(["session-cmd1", "session-cmd2"], projectDir);

    // Merge session into config
    mergeSessionPermissions(config, projectDir);

    // Verify config was updated with session permissions
    assert(config.permissions?.run?.includes("session-cmd1"), "session-cmd1 should be merged into run permissions");
    assert(config.permissions?.run?.includes("session-cmd2"), "session-cmd2 should be merged into run permissions");
    assert(config.permissions?.run?.includes("existing-cmd"), "existing-cmd should be preserved");

    // Verify existing permissions are preserved
    assert(config.permissions?.read?.includes("/existing/read"), "Existing read permissions should be preserved");
    assert(config.permissions?.write?.includes("/existing/write"), "Existing write permissions should be preserved");
  });
});
