/**
 * Integration tests for SSH-580 state trailer.
 *
 * Transpiled (rewrite-to-desh) commands must apply their cd/export deltas
 * back to the calling shell via a sourced trailer snippet, matching the
 * natural state persistence that passthrough commands get from the Bash
 * tool's persistent shell. Exit codes must survive the trailer chain.
 *
 * Note: test commands include `echo ===` (a zsh-hazard token) to force the
 * transpile path even for otherwise passthrough-eligible commands.
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { runBashPrehook, withTestDir } from "../helpers.ts";

/** Run the prehook and return the rewritten desh command from the allow JSON. */
async function getRewrittenCommand(
  commandText: string,
  cwd: string,
  runInBackground = false,
): Promise<string> {
  const result = await runBashPrehook(commandText, cwd, {
    sessionId: "ssh-580-state-trailer",
    runInBackground,
  });
  const parsed = JSON.parse(result.stdout) as {
    hookSpecificOutput: { updatedInput: { command: string } };
  };
  return parsed.hookSpecificOutput.updatedInput.command;
}

/** Execute a rewritten command in a bash wrapper and report wrapper state. */
async function runInBashWrapper(
  rewritten: string,
  cwd: string,
  probes: string,
): Promise<string> {
  const result = await new Deno.Command("/bin/bash", {
    args: ["-c", `${rewritten}; ${probes}`],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(result.stdout);
}

describe("SSH-580 state trailer", () => {
  it("rewrites transpiled commands with a sourced state trailer", async () => {
    await withTestDir("ssh580-format", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      const rewritten = await getRewrittenCommand("echo ===", projectDir);
      assert(rewritten.includes("--state-trailer"), `missing flag: ${rewritten}`);
      assert(rewritten.includes("&& . '"), `missing sourcing: ${rewritten}`);
      assert(rewritten.includes("[ -O '"), `missing ownership check: ${rewritten}`);
      assert(rewritten.includes("(exit $__safesh_rc)"), `missing exit chain: ${rewritten}`);
    });
  });

  it("omits the trailer for background runs", async () => {
    await withTestDir("ssh580-background", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      const rewritten = await getRewrittenCommand("echo ===", projectDir, true);
      assert(!rewritten.includes("--state-trailer"), `unexpected trailer: ${rewritten}`);
    });
  });

  it("applies cd and export back to the calling shell", async () => {
    await withTestDir("ssh580-apply", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      await Deno.mkdir(`${projectDir}/sub`, { recursive: true });
      const rewritten = await getRewrittenCommand(
        "cd sub && export SSH580_E2E=hello && echo ===",
        projectDir,
      );
      const out = await runInBashWrapper(
        rewritten,
        projectDir,
        'echo "PWD=$(pwd)"; echo "ENV=$SSH580_E2E"',
      );
      assert(out.includes("PWD=") && out.includes("/sub"), `cd not applied: ${out}`);
      assert(out.includes("ENV=hello"), `export not applied: ${out}`);
    });
  });

  it("preserves the desh exit code through the trailer chain", async () => {
    await withTestDir("ssh580-exit", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      const rewritten = await getRewrittenCommand("echo === && exit 7", projectDir);
      const out = await runInBashWrapper(rewritten, projectDir, 'echo "RC=$?"');
      assert(out.includes("RC=7"), `exit code not preserved: ${out}`);
    });
  });

  it("leaves shell state untouched when the script changes nothing", async () => {
    await withTestDir("ssh580-noop", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      const rewritten = await getRewrittenCommand("echo ===", projectDir);
      const out = await runInBashWrapper(rewritten, projectDir, 'echo "PWD=$(pwd)"');
      const lines = out.trim().split("\n");
      assertEquals(lines[lines.length - 1], `PWD=${await Deno.realPath(projectDir)}`);

      // The trailer file must not linger
      const match = rewritten.match(/--state-trailer '([^']+)'/);
      assert(match, `trailer path not found in: ${rewritten}`);
      let exists = true;
      try {
        await Deno.stat(match[1]!);
      } catch {
        exists = false;
      }
      assertEquals(exists, false, "trailer file should not exist after the run");
    });
  });
});
