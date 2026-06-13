import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type BashPrehookResult, runBashPrehook as spawnBashPrehook, withTestDir } from "../helpers.ts";

/** Run the prehook with this suite's session id and optional extra env. */
function runBashPrehook(
  commandText: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<BashPrehookResult> {
  return spawnBashPrehook(commandText, cwd, {
    sessionId: "ssh-83-variable-expansion",
    env,
  });
}

describe("SSH-83 bash-prehook variable command expansion", () => {
  it("resolves static variable command names before permission checks", async () => {
    await withTestDir("ssh83-variable-command", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      await Deno.mkdir(`${projectDir}/bin`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/bin/tool`, "#!/bin/sh\necho tool-ok\n");
      await Deno.chmod(`${projectDir}/bin/tool`, 0o755);

      const result = await runBashPrehook(
        `TOOL=./bin/tool\n"$TOOL" --version`,
        projectDir,
      );

      assertEquals(result.code, 0, `stdout=${result.stdout} stderr=${result.stderr}`);
      assert(
        !result.stdout.includes("[SAFESH] BLOCKED: $TOOL"),
        `should not block unresolved $TOOL: ${result.stdout}`,
      );
      // SSH-576: allowed analyzable commands pass through (empty output)
      assert(
        result.stdout === "" || result.stdout.includes('permissionDecision":"allow'),
        `should allow (passthrough or rewrite): ${result.stdout}`,
      );
    });
  });

  it("expands tilde in assigned variable command names", async () => {
    await withTestDir("ssh83-tilde-command", async (projectDir) => {
      await Deno.mkdir(`${projectDir}/.git`, { recursive: true });
      await Deno.mkdir(`${projectDir}/bin`, { recursive: true });
      await Deno.writeTextFile(`${projectDir}/bin/tool`, "#!/bin/sh\necho tool-ok\n");
      await Deno.chmod(`${projectDir}/bin/tool`, 0o755);

      const result = await runBashPrehook(
        `TOOL=~/bin/tool\n"$TOOL" --version`,
        projectDir,
        { HOME: projectDir },
      );

      assertEquals(result.code, 0, `stdout=${result.stdout} stderr=${result.stderr}`);
      assert(
        !result.stdout.includes("[SAFESH] BLOCKED: $TOOL"),
        `should not block unresolved $TOOL: ${result.stdout}`,
      );
      // SSH-576: allowed analyzable commands pass through (empty output)
      assert(
        result.stdout === "" || result.stdout.includes('permissionDecision":"allow'),
        `should allow (passthrough or rewrite): ${result.stdout}`,
      );
    });
  });
});
