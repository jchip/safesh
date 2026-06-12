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
import { deletePending, readPendingCommand } from "../../src/core/pending.ts";
import { applyPermissionChoice } from "../../src/cli/desh.ts";

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

  it("blocked hook retry records the command cwd override", async () => {
    const hookProjectDir = `${testDir}/hook-project`;
    await Deno.mkdir(`${hookProjectDir}/.git`, { recursive: true });

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        "hooks/bash-prehook.ts",
      ],
      cwd: Deno.cwd(),
      env: {
        BASH_PREHOOK_CWD: hookProjectDir,
        CLAUDE_SESSION_ID: "ssh-24-hook-cwd",
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const child = command.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({
          hookEventName: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ssh24blockedcmd --version" },
        }),
      ),
    );
    await writer.close();

    const output = await child.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    const match = stdout.match(/desh retry --id=([0-9-]+) --choice=/);
    assert(match, `Expected retry id in hook output. stdout=${stdout} stderr=${stderr}`);

    const pendingId = match[1]!;
    const originalError = console.error;
    try {
      const pending = readPendingCommand(pendingId);
      assert(pending, "Expected pending command to be written");
      assertEquals(pending.cwd, hookProjectDir);

      console.error = () => {};
      await applyPermissionChoice(3, pending, pendingId);
      const allowedCommands = getSessionAllowedCommands(hookProjectDir);
      assert(
        allowedCommands.has("ssh24blockedcmd"),
        "choice 3 should be visible to the hook project",
      );
    } finally {
      console.error = originalError;
      deletePending(pendingId, "command");
    }
  });

  it("bash-prehook honors session-allowed relative command after cd", async () => {
    const hookProjectDir = `${testDir}/hook-relative-project`;
    const packageDir = `${hookProjectDir}/packages/fyn`;
    await Deno.mkdir(`${packageDir}/node_modules/.bin`, { recursive: true });
    await Deno.mkdir(`${hookProjectDir}/.git`, { recursive: true });
    await Deno.writeTextFile(`${packageDir}/node_modules/.bin/mocha`, "#!/bin/sh\n");
    await addSessionCommands(["./node_modules/.bin/mocha"], hookProjectDir);

    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        "hooks/bash-prehook.ts",
      ],
      cwd: Deno.cwd(),
      env: {
        BASH_PREHOOK_CWD: hookProjectDir,
        CLAUDE_SESSION_ID: "regression-test-session",
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const child = command.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({
          hookEventName: "PreToolUse",
          tool_name: "Bash",
          tool_input: {
            command: `cd ${packageDir} && ./node_modules/.bin/mocha --version`,
          },
        }),
      ),
    );
    await writer.close();

    const output = await child.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);

    assertEquals(output.code, 0, `stdout=${stdout} stderr=${stderr}`);
    assert(!stdout.includes("[SAFESH] BLOCKED"), `should not block: ${stdout}`);
    // SSH-576: an allowed command may pass through to native bash (empty
    // hook output) instead of being rewritten to desh.
    assert(
      stdout === "" || stdout.includes('permissionDecision":"allow'),
      `should allow (passthrough or rewrite): ${stdout}`,
    );
  });

  it("choice 3 command allow is visible from canonical repo and worktree roots", async () => {
    const repoDir = `${testDir}/canonical-repo`;
    const worktreeDir = `${repoDir}/.worktrees/EXP-188`;

    await Deno.mkdir(`${repoDir}/.git/worktrees/EXP-188`, { recursive: true });
    await Deno.mkdir(worktreeDir, { recursive: true });
    await Deno.writeTextFile(
      `${worktreeDir}/.git`,
      `gitdir: ${repoDir}/.git/worktrees/EXP-188\n`,
    );

    const originalError = console.error;
    try {
      console.error = () => {};
      await applyPermissionChoice(3, {
        id: "ssh-25-worktree-session",
        scriptHash: "ssh-25-worktree-session",
        commands: ["tmux"],
        cwd: worktreeDir,
        createdAt: new Date().toISOString(),
      }, "ssh-25-worktree-session");
    } finally {
      console.error = originalError;
    }

    assert(
      getSessionAllowedCommands(repoDir).has("tmux"),
      "canonical repo session should include tmux",
    );
    assert(
      getSessionAllowedCommands(worktreeDir).has("tmux"),
      "worktree root session should include tmux",
    );
  });
});
