import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runBashPrehook } from "../helpers.ts";

interface HookDecision {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
    updatedInput?: { command: string };
  };
}

function parseDecision(stdout: string): HookDecision {
  return JSON.parse(stdout.trim()) as HookDecision;
}

async function runPermissionHook(input: Record<string, unknown>) {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write=/tmp/safesh",
      "hooks/codex/safesh-permission-hook.ts",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(input)));
  await writer.close();
  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("SSH-669: Codex hook config is a user-install source, not a project layer", async () => {
  let projectConfigExists = true;
  try {
    await Deno.stat(".codex/config.toml");
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) projectConfigExists = false;
    else throw error;
  }
  assertEquals(projectConfigExists, false);

  const config = await Deno.readTextFile("hooks/codex/config.toml");
  assertStringIncludes(config, 'matcher = "^Bash$"');
  assertStringIncludes(config, 'command = "__SAFESH_CODEX_BASH_PREHOOK__"');
  assertStringIncludes(config, 'statusMessage = "Routing Bash through SafeShell"');
  assertStringIncludes(config, "[[hooks.PermissionRequest]]");
  assertStringIncludes(config, 'command = "__SAFESH_CODEX_PERMISSION_HOOK__"');
});

Deno.test("SSH-657: Codex simple Bash command is rewritten to desh", async () => {
  const result = await runBashPrehook("echo hello", Deno.cwd(), { client: "codex" });

  assertEquals(result.code, 0, result.stderr);
  const decision = parseDecision(result.stdout);
  assertEquals(decision.hookSpecificOutput.hookEventName, "PreToolUse");
  assertEquals(decision.hookSpecificOutput.permissionDecision, "allow");
  assert(decision.hookSpecificOutput.updatedInput);
  assertStringIncludes(decision.hookSpecificOutput.updatedInput.command, "src/cli/desh.ts");
});

Deno.test("SSH-666: Claude simple Bash command remains native passthrough", async () => {
  const command = "echo hello";
  const sessionId = `ssh-666-claude-${crypto.randomUUID()}`;
  const turnId = `ssh-666-claude-turn-${crypto.randomUUID()}`;
  const cwd = Deno.cwd();
  const result = await runBashPrehook(command, cwd, {
    client: "claude",
    sessionId,
  });

  assertEquals(result.code, 0, result.stderr);
  assertEquals(result.stdout, "");

  const permission = await runPermissionHook({
    session_id: sessionId,
    turn_id: turnId,
    cwd,
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command },
  });
  assertEquals(permission.code, 0, permission.stderr);
  assertEquals(permission.stdout, "");
});

Deno.test("SSH-660: only the registered SafeShell runner gets one approval", async () => {
  const sessionId = `ssh-660-session-${crypto.randomUUID()}`;
  const turnId = `ssh-660-turn-${crypto.randomUUID()}`;
  const cwd = Deno.cwd();
  const result = await runBashPrehook("echo approval", cwd, {
    client: "codex",
    sessionId,
    turnId,
  });

  assertEquals(result.code, 0, result.stderr);
  const decision = parseDecision(result.stdout);
  const command = decision.hookSpecificOutput.updatedInput?.command;
  assert(command);

  const permissionInput = {
    session_id: sessionId,
    turn_id: turnId,
    cwd,
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command },
  };

  const allowed = await runPermissionHook(permissionInput);
  assertEquals(allowed.code, 0, allowed.stderr);
  assertEquals(JSON.parse(allowed.stdout), {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });

  const replay = await runPermissionHook(permissionInput);
  assertEquals(replay.code, 0, replay.stderr);
  assertEquals(replay.stdout, "");

  const modified = await runPermissionHook({
    ...permissionInput,
    tool_input: { command: `${command} # modified` },
  });
  assertEquals(modified.code, 0, modified.stderr);
  assertEquals(modified.stdout, "");
});

Deno.test("SSH-650: Codex SafeShell TypeScript command is rewritten to desh", async () => {
  const result = await runBashPrehook('/*#*/ console.log("codex")', Deno.cwd(), {
    client: "codex",
  });

  assertEquals(result.code, 0, result.stderr);
  const decision = parseDecision(result.stdout);
  assertEquals(decision.hookSpecificOutput.hookEventName, "PreToolUse");
  assertEquals(decision.hookSpecificOutput.permissionDecision, "allow");
  assert(decision.hookSpecificOutput.updatedInput);
  assertStringIncludes(decision.hookSpecificOutput.updatedInput.command, "src/cli/desh.ts");
});

Deno.test("SSH-650: Codex disallowed complex command is denied by SafeShell", async () => {
  const result = await runBashPrehook("if true; then definitely-not-allowed; fi", Deno.cwd(), {
    client: "codex",
  });

  assertEquals(result.code, 0, result.stderr);
  const decision = parseDecision(result.stdout);
  assertEquals(decision.hookSpecificOutput.hookEventName, "PreToolUse");
  assertEquals(decision.hookSpecificOutput.permissionDecision, "deny");
  assertStringIncludes(
    decision.hookSpecificOutput.permissionDecisionReason ?? "",
    "[SAFESH] BLOCKED",
  );
  assertEquals(decision.hookSpecificOutput.updatedInput, undefined);
});
