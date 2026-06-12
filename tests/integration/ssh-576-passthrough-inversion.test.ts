/**
 * Integration tests for SSH-576 passthrough inversion.
 *
 * The prehook should pass statically-analyzable, fully-allowed commands
 * through to native bash (empty hook output), while carriers, nested
 * disallowed commands, out-of-root redirects, and the config kill-switch
 * keep the existing transpile/deny behavior.
 */

import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { withTestDir } from "../helpers.ts";

let denoDirPromise: Promise<string | undefined> | undefined;

async function getCurrentDenoDir(): Promise<string | undefined> {
  if (!denoDirPromise) {
    denoDirPromise = (async () => {
      const configured = Deno.env.get("DENO_DIR");
      if (configured) return configured;
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["info", "--json"],
        stdout: "piped",
        stderr: "null",
      }).output();
      if (output.code !== 0) return undefined;
      const info = JSON.parse(new TextDecoder().decode(output.stdout)) as { denoDir?: string };
      return info.denoDir;
    })();
  }
  return denoDirPromise;
}

async function runBashPrehook(
  commandText: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const denoDir = await getCurrentDenoDir();
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
      BASH_PREHOOK_CWD: cwd,
      CLAUDE_SESSION_ID: "ssh-576-passthrough-inversion",
      ...(denoDir ? { DENO_DIR: denoDir } : {}),
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
        tool_input: { command: commandText },
      }),
    ),
  );
  await writer.close();
  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function setupProject(projectDir: string): Promise<void> {
  await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
  await Deno.writeTextFile(`${projectDir}/data.txt`, "beta\nalpha\nfoo bar\n");
}

/** Passthrough = the hook stays silent and exits 0. */
function assertPassthrough(
  result: { code: number; stdout: string; stderr: string },
  label: string,
): void {
  assertEquals(result.code, 0, `${label}: exit code (stderr=${result.stderr})`);
  assertEquals(result.stdout, "", `${label}: passthrough must emit no stdout`);
}

/** Transpile fallback = an allow decision rewriting the command to desh. */
function assertRewriteToDesh(
  result: { code: number; stdout: string; stderr: string },
  label: string,
): void {
  assertEquals(result.code, 0, `${label}: exit code (stderr=${result.stderr})`);
  assert(result.stdout.includes('"permissionDecision":"allow"'), `${label}: expected allow JSON`);
  assert(result.stdout.includes("desh"), `${label}: expected desh rewrite`);
}

describe("SSH-576 passthrough inversion", () => {
  it("passes through an analyzable allowed pipeline", async () => {
    await withTestDir("ssh576-pipeline", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "grep -n foo data.txt | sort | head -2",
        projectDir,
      );
      assertPassthrough(result, "allowed pipeline");
    });
  });

  it("passes through command substitution with allowed commands", async () => {
    await withTestDir("ssh576-cmdsub", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "echo $(sort data.txt | head -1)",
        projectDir,
      );
      assertPassthrough(result, "allowed cmdsub");
    });
  });

  it("passes through redirects within the project", async () => {
    await withTestDir("ssh576-redirect-ok", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "sort data.txt > sorted.txt 2>/dev/null",
        projectDir,
      );
      assertPassthrough(result, "in-project redirect");
    });
  });

  it("falls back to transpile for carrier commands", async () => {
    await withTestDir("ssh576-carrier", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "echo hi | xargs wc -l",
        projectDir,
      );
      assertRewriteToDesh(result, "xargs carrier");
    });
  });

  it("falls back when a command substitution contains a disallowed command", async () => {
    await withTestDir("ssh576-nested-disallowed", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "echo $(definitely-not-allowed-cmd-xyz)",
        projectDir,
      );
      // The runtime command check still guards the nested command; the
      // important part is that it does NOT silently pass through.
      assertEquals(result.code, 0, `stderr=${result.stderr}`);
      assert(result.stdout !== "", "nested disallowed command must not pass through");
    });
  });

  it("falls back when a redirect writes outside workspace roots", async () => {
    await withTestDir("ssh576-redirect-outside", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "sort data.txt > /etc/ssh576-test-output.txt",
        projectDir,
      );
      assertEquals(result.code, 0, `stderr=${result.stderr}`);
      assert(result.stdout !== "", "out-of-root redirect must not pass through");
    });
  });

  it("still denies disallowed top-level commands with retry prompt", async () => {
    await withTestDir("ssh576-disallowed", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook(
        "definitely-not-allowed-cmd-xyz --help",
        projectDir,
      );
      assert(
        result.stdout.includes('"permissionDecision":"deny"'),
        `expected deny JSON, got: ${result.stdout}`,
      );
    });
  });

  it("honors passthroughAnalyzable: false", async () => {
    await withTestDir("ssh576-config-off", async (projectDir) => {
      await setupProject(projectDir);
      await Deno.mkdir(`${projectDir}/.config/safesh`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/.config/safesh/config.json`,
        JSON.stringify({ passthroughAnalyzable: false }),
      );
      const result = await runBashPrehook(
        "grep -n foo data.txt | sort | head -2",
        projectDir,
      );
      assertRewriteToDesh(result, "config kill-switch");
    });
  });
});
