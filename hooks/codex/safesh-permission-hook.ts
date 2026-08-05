#!/usr/bin/env -S deno run --allow-read --allow-write=/tmp/safesh
/** Auto-approve only SafeShell runner commands registered by the Codex Bash prehook. */

import { consumeSafeShellApprovalRecord } from "../../src/hooks/approval-records.ts";

interface PermissionHookInput {
  session_id?: string;
  turn_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
  };
}

export function shouldApproveSafeShellRunner(input: PermissionHookInput): boolean {
  if (input.hook_event_name !== "PermissionRequest") return false;
  if (input.tool_name !== "Bash") return false;
  if (!input.session_id || !input.turn_id || !input.cwd || !input.tool_input?.command) return false;

  return consumeSafeShellApprovalRecord({
    sessionId: input.session_id,
    turnId: input.turn_id,
    cwd: input.cwd,
    command: input.tool_input.command,
  });
}

async function main(): Promise<void> {
  const input = JSON.parse(await new Response(Deno.stdin.readable).text()) as PermissionHookInput;
  if (!shouldApproveSafeShellRunner(input)) return;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  }));
}

if (import.meta.main) {
  await main();
}
