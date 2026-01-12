/**
 * shells command - List all active shells
 */

import { loadState, formatRelativeTime } from "../lib/state.ts";
import { bold, cyan, dim } from "@std/fmt/colors";

export async function shellsCommand(): Promise<void> {
  const state = await loadState();

  if (!state) {
    console.log("No state file found. MCP server has not been started yet.");
    return;
  }

  const shells = Object.values(state.shells);

  if (shells.length === 0) {
    console.log("No active shells");
    return;
  }

  console.log(bold(`\nShells (${shells.length}):\n`));

  // Sort by creation time (newest first)
  shells.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  for (const shell of shells) {
    const created = formatRelativeTime(shell.createdAt);
    const activity = formatRelativeTime(shell.lastActivityAt);

    console.log(cyan(`  ${shell.id}`));
    console.log(`    CWD:      ${shell.cwd}`);
    console.log(`    Created:  ${created}`);
    console.log(`    Activity: ${activity}`);

    if (shell.description) {
      console.log(`    Desc:     ${shell.description}`);
    }

    // Show some key env vars if they differ from defaults
    const interestingEnvs = ["PATH", "HOME", "NODE_ENV", "DENO_ENV"].filter(
      (key) => shell.env[key]
    );
    if (interestingEnvs.length > 0) {
      console.log(`    ENV:      ${interestingEnvs.join(", ")}`);
    }

    console.log("");
  }

  console.log(dim(`  State updated: ${formatRelativeTime(state.updatedAt)}\n`));
}
