/**
 * tasks command - List scripts/jobs with optional filters
 */

import { loadState, formatDuration, formatRelativeTime, isPidRunning } from "../lib/state.ts";
import { colors } from "@std/fmt/colors";
import type { PersistedScript } from "../../runtime/state-persistence.ts";

export interface TasksOptions {
  running?: boolean;
  shellId?: string;
  status?: "running" | "completed" | "failed";
}

function getStatusColor(status: string): (str: string) => string {
  switch (status) {
    case "running":
      return colors.green;
    case "completed":
      return colors.blue;
    case "failed":
      return colors.red;
    default:
      return colors.dim;
  }
}

function getStatusSymbol(script: PersistedScript): string {
  if (script.status === "running") {
    // Check if PID is actually alive
    if (script.pid && !isPidRunning(script.pid)) {
      return colors.yellow("⚠");
    }
    return colors.green("▶");
  }
  if (script.status === "completed") {
    return colors.blue("✓");
  }
  return colors.red("✗");
}

export async function tasksCommand(options: TasksOptions = {}): Promise<void> {
  const state = await loadState();

  if (!state) {
    console.log("No state file found. MCP server has not been started yet.");
    return;
  }

  let scripts = Object.values(state.scripts);

  // Apply filters
  if (options.running) {
    scripts = scripts.filter((s) => s.status === "running");
  }
  if (options.shellId) {
    scripts = scripts.filter((s) => s.shellId === options.shellId);
  }
  if (options.status) {
    scripts = scripts.filter((s) => s.status === options.status);
  }

  if (scripts.length === 0) {
    if (options.running || options.shellId || options.status) {
      console.log("No tasks matching filters");
    } else {
      console.log("No tasks found");
    }
    return;
  }

  // Sort by start time (newest first)
  scripts.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  // Header
  const filterDesc = [];
  if (options.running) filterDesc.push("running");
  if (options.shellId) filterDesc.push(`shell:${options.shellId}`);
  if (options.status) filterDesc.push(`status:${options.status}`);
  const filterStr = filterDesc.length > 0 ? ` (${filterDesc.join(", ")})` : "";

  console.log(colors.bold(`\nTasks (${scripts.length})${filterStr}:\n`));

  for (const script of scripts) {
    const symbol = getStatusSymbol(script);
    const statusColor = getStatusColor(script.status);
    const started = formatRelativeTime(script.startedAt);

    console.log(`${symbol} ${colors.cyan(script.id)}`);
    console.log(`    Status:  ${statusColor(script.status.toUpperCase())}`);
    console.log(`    Shell:   ${script.shellId}`);
    console.log(`    Started: ${started}`);

    if (script.pid) {
      const alive = isPidRunning(script.pid);
      const pidStr = alive ? `${script.pid}` : `${script.pid} ${colors.yellow("(dead)")}`;
      console.log(`    PID:     ${pidStr}`);
    }

    if (script.status === "running") {
      const duration = formatDuration(script.startedAt);
      console.log(`    Running: ${duration}`);
    } else if (script.completedAt) {
      const duration = formatDuration(script.startedAt, script.completedAt);
      console.log(`    Duration: ${duration}`);
    }

    if (script.exitCode !== undefined) {
      const exitColor = script.exitCode === 0 ? colors.green : colors.red;
      console.log(`    Exit:    ${exitColor(script.exitCode.toString())}`);
    }

    if (script.command) {
      console.log(`    Command: ${colors.dim(script.command)}`);
    }

    if (script.background) {
      console.log(`    Mode:    ${colors.yellow("background")}`);
    }

    console.log("");
  }

  console.log(colors.dim(`  State updated: ${formatRelativeTime(state.updatedAt)}\n`));
}
