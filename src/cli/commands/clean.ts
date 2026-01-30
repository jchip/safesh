/**
 * clean command - Remove stale state
 */

import { loadState, isPidRunning } from "../lib/state.ts";
import { getStateFilePath } from "../../runtime/state-persistence.ts";
import type { PersistedState } from "../../runtime/state-persistence.ts";
import { bold, yellow, green, red } from "@std/fmt/colors";
import { writeJsonFile } from "../../core/io-utils.ts";

export async function cleanCommand(): Promise<void> {
  const state = await loadState();

  if (!state) {
    console.log("No state file found. Nothing to clean.");
    return;
  }

  console.log(bold("Cleaning stale state...\n"));

  let cleaned = 0;

  // Check each running script
  for (const [scriptId, script] of Object.entries(state.scripts)) {
    if (script.status === "running" && script.pid) {
      if (!isPidRunning(script.pid)) {
        console.log(yellow(`  ⚠ Script ${scriptId} (PID ${script.pid}) is dead - marking as failed`));
        script.status = "failed";
        script.completedAt = new Date().toISOString();
        cleaned++;
      }
    }
  }

  if (cleaned === 0) {
    console.log(green("✓ No stale scripts found"));
    return;
  }

  // Save cleaned state
  try {
    const stateFile = getStateFilePath(state.projectDir);
    state.updatedAt = new Date().toISOString();
    await writeJsonFile(stateFile, state);
    console.log("");
    console.log(green(`✓ Cleaned ${cleaned} stale script(s)`));
  } catch (error) {
    console.error(red(`Failed to save cleaned state: ${error instanceof Error ? error.message : String(error)}`));
    Deno.exit(1);
  }
}
