#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net
/** Codex-specific SafeShell Bash hook policy and approval correlation. */

import { main } from "../bash-prehook.ts";
import { writeSafeShellApprovalRecord } from "../../src/hooks/approval-records.ts";

await main({
  routeAllCommands: true,
  onRewrite: ({ command, cwd, sessionId, turnId }) => {
    if (!sessionId || !turnId || !cwd) return;
    writeSafeShellApprovalRecord({ sessionId, turnId, cwd, command });
  },
});
