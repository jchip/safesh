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
  env: Record<string, string> = {},
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
      CLAUDE_SESSION_ID: "ssh-83-variable-expansion",
      ...(denoDir ? { DENO_DIR: denoDir } : {}),
      ...env,
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
      assert(
        result.stdout.includes('permissionDecision":"allow'),
        `should allow/rewrite: ${result.stdout}`,
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
      assert(
        result.stdout.includes('permissionDecision":"allow'),
        `should allow/rewrite: ${result.stdout}`,
      );
    });
  });
});
