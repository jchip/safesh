/**
 * Scripts the agent writes in its Claude Code session scratchpad run without
 * a permission prompt. A script anywhere else still needs approval.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { runBashPrehook, withTestDir } from "../helpers.ts";
import { getSessionAllowedCommands } from "../../src/core/session.ts";

const uid = Deno.uid();

describe("scratchpad script auto-allow", { ignore: uid === null }, () => {
  it("allows a scratchpad script and records it for the desh run", async () => {
    const root = `/tmp/claude-${uid}`;
    let createdRoot = false;
    try {
      await Deno.stat(root);
    } catch {
      await Deno.mkdir(root, { mode: 0o700 });
      createdRoot = true;
    }
    const sid = `safesh-test-${crypto.randomUUID()}`;
    const proj = `${root}/safesh-test-${sid}`;
    const pad = `${proj}/${sid}/scratchpad`;
    try {
      await withTestDir("scratchpad-allow", async (projectDir) => {
        await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
        await Deno.mkdir(pad, { recursive: true });
        await Deno.writeTextFile(`${pad}/run.sh`, "#!/bin/sh\necho hi\n", { mode: 0o755 });
        const env = { CLAUDE_PROJECT_DIR: projectDir };

        const inside = await runBashPrehook(`${pad}/run.sh && echo ===`, projectDir, {
          sessionId: sid,
          env,
        });
        const decision = JSON.parse(inside.stdout) as {
          hookSpecificOutput: { permissionDecision: string; updatedInput: { command: string } };
        };
        assertEquals(decision.hookSpecificOutput.permissionDecision, "allow", inside.stdout);
        assert(getSessionAllowedCommands(projectDir, sid).has(`${pad}/run.sh`));

        // The desh run re-checks permissions, so it must allow the script too.
        const run = await new Deno.Command("/bin/bash", {
          args: ["-c", decision.hookSpecificOutput.updatedInput.command],
          cwd: projectDir,
          env: { ...env, CLAUDE_SESSION_ID: sid },
          stdout: "piped",
          stderr: "piped",
        }).output();
        const out = new TextDecoder().decode(run.stdout);
        assertStringIncludes(out, "hi", new TextDecoder().decode(run.stderr));

        // A relative call from the scratchpad runs too, but only the resolved
        // path is granted, so `./run.sh` elsewhere stays blocked.
        const rel = await runBashPrehook(`./run.sh && echo ===`, pad, { sessionId: sid, env });
        const relDecision = JSON.parse(rel.stdout) as {
          hookSpecificOutput: { permissionDecision: string; updatedInput: { command: string } };
        };
        assertEquals(relDecision.hookSpecificOutput.permissionDecision, "allow", rel.stdout);
        assert(!getSessionAllowedCommands(projectDir, sid).has("./run.sh"));
        const relRun = await new Deno.Command("/bin/bash", {
          args: ["-c", relDecision.hookSpecificOutput.updatedInput.command],
          cwd: pad,
          env: { ...env, CLAUDE_SESSION_ID: sid },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertStringIncludes(
          new TextDecoder().decode(relRun.stdout),
          "hi",
          new TextDecoder().decode(relRun.stderr),
        );
        const away = `${proj}/elsewhere`;
        await Deno.mkdir(away, { recursive: true });
        await Deno.writeTextFile(`${away}/run.sh`, "#!/bin/sh\necho hi\n", { mode: 0o755 });
        const elsewhere = await runBashPrehook(`./run.sh && echo ===`, away, {
          sessionId: sid,
          env,
        });
        assertStringIncludes(elsewhere.stdout, "BLOCKED");

        // Same session, but the script lives under another session's scratchpad.
        const otherPad = `${proj}/other-session/scratchpad`;
        await Deno.mkdir(otherPad, { recursive: true });
        await Deno.writeTextFile(`${otherPad}/run.sh`, "#!/bin/sh\necho hi\n", { mode: 0o755 });
        const other = await runBashPrehook(`${otherPad}/run.sh && echo ===`, projectDir, {
          sessionId: sid,
          env,
        });
        assertStringIncludes(other.stdout, "BLOCKED");
      });
    } finally {
      await Deno.remove(proj, { recursive: true }).catch(() => {});
      if (createdRoot) await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  });
});
