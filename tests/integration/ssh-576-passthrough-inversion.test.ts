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
import { type BashPrehookResult, runBashPrehook as spawnBashPrehook, withTestDir } from "../helpers.ts";

/** Run the prehook with this suite's session id. */
function runBashPrehook(commandText: string, cwd: string): Promise<BashPrehookResult> {
  return spawnBashPrehook(commandText, cwd, { sessionId: "ssh-576-passthrough-inversion" });
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

  it("passes through matching globs but falls back on non-matching ones (SSH-579)", async () => {
    await withTestDir("ssh579-globs", async (projectDir) => {
      await setupProject(projectDir);

      const matching = await runBashPrehook("wc -l *.txt", projectDir);
      assertPassthrough(matching, "matching glob");

      const nonMatching = await runBashPrehook("wc -l *.nomatch-ext", projectDir);
      assertRewriteToDesh(nonMatching, "non-matching glob");
    });
  });

  it("falls back on zsh =-expansion hazards (SSH-579)", async () => {
    await withTestDir("ssh579-equals", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook("echo ===", projectDir);
      assertRewriteToDesh(result, "=-expansion hazard");
    });
  });

  it("falls back on word-splitting expansions (SSH-579)", async () => {
    await withTestDir("ssh579-split", async (projectDir) => {
      await setupProject(projectDir);
      const result = await runBashPrehook('FLAGS="-l -a"\nls $FLAGS', projectDir);
      assertRewriteToDesh(result, "word-splitting expansion");
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
