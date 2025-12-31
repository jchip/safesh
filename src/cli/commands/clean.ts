/**
 * clean command - Remove stale state
 */

import { loadState, isPidRunning } from "../lib/state.ts";
import { getStateFilePath } from "../../runtime/state-persistence.ts";
import type { PersistedState } from "../../runtime/state-persistence.ts";
import { colors } from "@std/fmt/colors";

export async function cleanCommand(): Promise<void> {
  const state = await loadState();

  if (!state) {
    console.log("No state file found. Nothing to clean.");
    return;
  }

  console.log(colors.bold("Cleaning stale state...\n"));

  let cleaned = 0;

  // Check each running script
  for (const [scriptId, script] of Object.entries(state.scripts)) {
    if (script.status === "running" && script.pid) {
      if (!isPidRunning(script.pid)) {
        console.log(colors.yellow(`  ⚠ Script ${scriptId} (PID ${script.pid}) is dead - marking as failed`));
        script.status = "failed";
        script.completedAt = new Date().toISOString();
        cleaned++;
      }
    }
  }

  if (cleaned === 0) {
    console.log(colors.green("✓ No stale scripts found"));
    return;
  }

  // Save cleaned state
  try {
    const stateFile = getStateFilePath(state.projectDir);
    state.updatedAt = new Date().toISOString();
    await Deno.writeTextFile(stateFile, JSON.stringify(state, null, 2));
    console.log("");
    console.log(colors.green(`✓ Cleaned ${cleaned} stale script(s)`));
  } catch (error) {
    console.error(colors.red(`Failed to save cleaned state: ${error instanceof Error ? error.message : String(error)}`));
    Deno.exit(1);
  }
}
