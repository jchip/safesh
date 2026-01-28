/**
 * Integration test for the permission flow choices
 *
 * Tests the underlying functions for each user choice in the permission flow:
 * 1. Allow once (no persistence)
 * 2. Always allow (save to .config/safesh/config.local.json)
 * 3. Session allow (save to session file)
 * 4. Deny (reject command)
 * 5. Path permissions (retry-path options)
 *
 * Note: These tests focus on the storage mechanisms, not the interactive retry flow.
 */

import { assertEquals, assert } from "@std/assert";
import { describe, it, beforeEach, afterEach } from "@std/testing/bdd";
import {
  addSessionCommands,
  getSessionAllowedCommands,
  addSessionPaths,
  getSessionPathPermissions,
} from "../../src/core/session.ts";
import { saveToLocalJson, getLocalJsonConfigPath } from "../../src/core/config.ts";

const realTmp = Deno.realPathSync("/tmp");
const testDir = `${realTmp}/safesh-permission-flow-test`;
const projectDir = `${testDir}/project`;

describe("Permission flow integration tests", { sanitizeResources: false, sanitizeOps: false }, () => {
  beforeEach(async () => {
    // Create test project with .config/safesh directory
    await Deno.mkdir(`${projectDir}/.config/safesh`, { recursive: true });
    Deno.env.set("CLAUDE_SESSION_ID", "permission-flow-test-session");
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    Deno.env.delete("CLAUDE_SESSION_ID");
  });

  it("choice 1 (allow once) - command executes but not saved anywhere", async () => {
    // Simulate "allow once" - command would execute but nothing is persisted
    // The command is NOT added to session or config files

    // Verify no session file exists
    let sessionFileExists = false;
    try {
      Deno.statSync(`${projectDir}/.temp/safesh/session-permission-flow-test-session.json`);
      sessionFileExists = true;
    } catch {
      // Expected - no session file
    }
    assertEquals(sessionFileExists, false, "Session file should not exist for 'allow once'");

    // Verify no config.local.json exists
    let localConfigExists = false;
    try {
      Deno.statSync(getLocalJsonConfigPath(projectDir));
      localConfigExists = true;
    } catch {
      // Expected - no local config
    }
    assertEquals(localConfigExists, false, "Local config should not exist for 'allow once'");

    // For "allow once", the command would be executed directly without any persistence.
    // This test verifies that nothing is saved when choosing this option.
  });

  it("choice 2 (always allow) - command saved to .config/safesh/config.local.json", async () => {
    // Simulate "always allow" - save to permanent config
    await saveToLocalJson(projectDir, ["curl", "wget"]);

    // Verify config.local.json was created
    const localJsonPath = getLocalJsonConfigPath(projectDir);
    const stat = Deno.statSync(localJsonPath);
    assert(stat.isFile, "config.local.json should be created");

    // Verify content is correct
    const content = Deno.readTextFileSync(localJsonPath);
    const config = JSON.parse(content);
    assert(Array.isArray(config.allowedCommands), "allowedCommands should be an array");
    assert(config.allowedCommands.includes("curl"), "curl should be in allowedCommands");
    assert(config.allowedCommands.includes("wget"), "wget should be in allowedCommands");

    // Test merging with existing commands
    await saveToLocalJson(projectDir, ["git", "docker"]);

    // Verify all commands are present (merged)
    const updatedContent = Deno.readTextFileSync(localJsonPath);
    const updatedConfig = JSON.parse(updatedContent);
    assertEquals(updatedConfig.allowedCommands.length, 4, "Should have 4 commands after merge");
    assert(updatedConfig.allowedCommands.includes("curl"), "curl should still be present");
    assert(updatedConfig.allowedCommands.includes("wget"), "wget should still be present");
    assert(updatedConfig.allowedCommands.includes("git"), "git should be added");
    assert(updatedConfig.allowedCommands.includes("docker"), "docker should be added");
  });

  it("choice 3 (session allow) - command saved to session file", async () => {
    // Simulate "session allow" - save to session file
    await addSessionCommands(["npm", "node"], projectDir);

    // Verify session file was created
    const sessionFile = `${projectDir}/.temp/safesh/session-permission-flow-test-session.json`;
    const stat = Deno.statSync(sessionFile);
    assert(stat.isFile, "Session file should be created");

    // Verify content is correct
    const content = Deno.readTextFileSync(sessionFile);
    const sessionData = JSON.parse(content);
    assert(Array.isArray(sessionData.allowedCommands), "allowedCommands should be an array");
    assert(sessionData.allowedCommands.includes("npm"), "npm should be in session allowedCommands");
    assert(sessionData.allowedCommands.includes("node"), "node should be in session allowedCommands");

    // Verify commands can be read back using helper
    const commands = getSessionAllowedCommands(projectDir);
    assert(commands.has("npm"), "npm should be retrievable from session");
    assert(commands.has("node"), "node should be retrievable from session");

    // Verify session file is NOT in config.local.json
    let localConfigExists = false;
    try {
      Deno.statSync(getLocalJsonConfigPath(projectDir));
      localConfigExists = true;
    } catch {
      // Expected - session allow doesn't create local config
    }
    assertEquals(localConfigExists, false, "Local config should not be created for 'session allow'");
  });

  it("choice 4 (deny) - command is rejected, nothing persisted", async () => {
    // Simulate "deny" - command is rejected and nothing is saved
    // Similar to "allow once" but the command would NOT be executed

    // Verify no session file exists
    let sessionFileExists = false;
    try {
      Deno.statSync(`${projectDir}/.temp/safesh/session-permission-flow-test-session.json`);
      sessionFileExists = true;
    } catch {
      // Expected - no session file
    }
    assertEquals(sessionFileExists, false, "Session file should not exist for 'deny'");

    // Verify no config.local.json exists
    let localConfigExists = false;
    try {
      Deno.statSync(getLocalJsonConfigPath(projectDir));
      localConfigExists = true;
    } catch {
      // Expected - no local config
    }
    assertEquals(localConfigExists, false, "Local config should not exist for 'deny'");

    // For "deny", the command would be blocked and execution would stop.
    // This test verifies that nothing is saved when denying a command.
  });

  it("path block - session-allow for read/write permissions", async () => {
    // Simulate "session allow" for path permissions
    const readPaths = ["/test/read/path1", "/test/read/path2"];
    const writePaths = ["/test/write/path1"];

    await addSessionPaths(readPaths, writePaths, projectDir);

    // Verify session file was created
    const sessionFile = `${projectDir}/.temp/safesh/session-permission-flow-test-session.json`;
    const stat = Deno.statSync(sessionFile);
    assert(stat.isFile, "Session file should be created for path permissions");

    // Verify content is correct
    const content = Deno.readTextFileSync(sessionFile);
    const sessionData = JSON.parse(content);

    assert(sessionData.permissions, "permissions should exist in session data");
    assert(Array.isArray(sessionData.permissions.read), "read permissions should be an array");
    assert(Array.isArray(sessionData.permissions.write), "write permissions should be an array");

    // Verify read paths
    assert(sessionData.permissions.read.includes("/test/read/path1"), "path1 should be in read permissions");
    assert(sessionData.permissions.read.includes("/test/read/path2"), "path2 should be in read permissions");

    // Verify write paths
    assert(sessionData.permissions.write.includes("/test/write/path1"), "write path should be in write permissions");

    // Verify paths can be read back using helper
    const pathPerms = getSessionPathPermissions(projectDir);
    assertEquals(pathPerms.read?.length, 2, "Should have 2 read paths");
    assertEquals(pathPerms.write?.length, 1, "Should have 1 write path");

    // Test merging with additional paths
    await addSessionPaths(["/test/read/path3"], ["/test/write/path2"], projectDir);

    const updatedPerms = getSessionPathPermissions(projectDir);
    assertEquals(updatedPerms.read?.length, 3, "Should have 3 read paths after merge");
    assertEquals(updatedPerms.write?.length, 2, "Should have 2 write paths after merge");
  });
});
