/**
 * kill command - Send SIGTERM to a script
 */

import { loadState, isPidRunning } from "../lib/state.ts";
import { colors } from "@std/fmt/colors";

export async function killCommand(scriptId: string): Promise<void> {
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

  if (script.status !== "running") {
    console.error(`Script is not running (status: ${script.status})`);
    Deno.exit(1);
  }

  if (!script.pid) {
    console.error("Script has no PID recorded");
    Deno.exit(1);
  }

  // Check if process is actually alive
  if (!isPidRunning(script.pid)) {
    console.log(colors.yellow(`⚠ Process ${script.pid} is already dead`));
    console.log("State may be stale. Run 'safesh clean' to update.");
    Deno.exit(1);
  }

  // Send SIGTERM
  try {
    Deno.kill(script.pid, "SIGTERM");
    console.log(colors.green(`✓ Sent SIGTERM to script ${scriptId} (PID ${script.pid})`));
    console.log("");
    console.log("The script should terminate gracefully.");
    console.log("If it doesn't, you can use system tools to force kill:");
    console.log(colors.dim(`  kill -9 ${script.pid}`));
  } catch (error) {
    console.error(colors.red(`Failed to kill script: ${error instanceof Error ? error.message : String(error)}`));
    Deno.exit(1);
  }
}
