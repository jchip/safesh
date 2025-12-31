/**
 * logs command - View script output
 */

import { loadState } from "../lib/state.ts";
import { colors } from "@std/fmt/colors";

export async function logsCommand(scriptId: string): Promise<void> {
  const state = await loadState();

  if (!state) {
    console.error("No state file found. MCP server has not been started yet.");
    Deno.exit(1);
  }

  const script = state.scripts[scriptId];

  if (!script) {
    console.error(`Script not found: ${scriptId}`);
    Deno.exit(1);
  }

  // Current limitation: logs are stored in memory during MCP server runtime
  // They are not persisted to disk
  console.log(colors.yellow("\n⚠ Log Limitation:"));
  console.log("Script output is currently stored in memory during MCP server runtime.");
  console.log("Logs are not persisted to disk and cannot be retrieved after server restart.");
  console.log("");
  console.log(colors.dim("Future enhancement: Persist logs to .local/state/safesh/logs/\n"));

  // Show what we know from state
  console.log(colors.bold(`Script: ${scriptId}\n`));
  console.log(`  Status:   ${script.status}`);
  console.log(`  Shell:    ${script.shellId}`);
  console.log(`  Started:  ${new Date(script.startedAt).toISOString()}`);

  if (script.completedAt) {
    console.log(`  Completed: ${new Date(script.completedAt).toISOString()}`);
  }

  if (script.exitCode !== undefined) {
    console.log(`  Exit Code: ${script.exitCode}`);
  }

  if (script.command) {
    console.log(`  Command:  ${script.command}`);
  }

  console.log("");
  console.log(colors.dim("To view live output, use the MCP 'getScriptOutput' tool while server is running."));
  console.log("");
}
