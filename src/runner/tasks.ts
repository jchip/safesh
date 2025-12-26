/**
 * Task runner - executes tasks defined in configuration
 *
 * Supports:
 * - Simple command tasks (cmd: string)
 * - Parallel task execution (parallel: string[])
 * - Serial task execution (serial: string[])
 * - Task references (string aliases)
 * - xrun-style array syntax ([a, b, c] or [-s, a, b, c])
 */

import { executeCode } from "../runtime/executor.ts";
import type { SafeShellConfig, Session, TaskConfig } from "../core/types.ts";
import { isXrunSyntax, parseXrun } from "./xrun-parser.ts";

export interface TaskResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Standard output from the task */
  stdout: string;
  /** Standard error from the task */
  stderr: string;
  /** Exit code (0 for success) */
  code: number;
}

export interface TaskRunOptions {
  /** Current working directory override */
  cwd?: string;
  /** Session for persistent state */
  session?: Session;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * Execute a task by name from the config
 */
export async function runTask(
  taskName: string,
  config: SafeShellConfig,
  options: TaskRunOptions = {},
): Promise<TaskResult> {
  const taskDef = config.tasks?.[taskName];

  if (!taskDef) {
    const available = Object.keys(config.tasks ?? {}).join(", ");
    throw new Error(
      `Task '${taskName}' not found. Available tasks: ${available || "(none)"}`,
    );
  }

  // Handle task reference (string alias)
  if (typeof taskDef === "string") {
    // Check if it's xrun syntax
    if (isXrunSyntax(taskDef)) {
      const { mainTask, additionalTasks } = parseXrun(taskDef);

      // Create a temporary config with the parsed tasks
      const tempConfig: SafeShellConfig = {
        ...config,
        tasks: {
          ...config.tasks,
          ...additionalTasks,
          [`__xrun_main_${taskName}`]: mainTask,
        },
      };

      // Run the main task
      return await runTask(`__xrun_main_${taskName}`, tempConfig, options);
    }

    // Regular task reference
    return await runTask(taskDef, config, options);
  }

  const task = taskDef as TaskConfig;

  if (options.verbose) {
    console.error(`Running task: ${taskName}`);
  }

  // Handle simple command task
  if (task.cmd) {
    const result = await executeCode(
      task.cmd,
      config,
      {
        cwd: task.cwd ?? options.cwd,
      },
      options.session,
    );

    return {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    };
  }

  // Handle parallel tasks
  if (task.parallel) {
    if (options.verbose) {
      console.error(`Running tasks in parallel: ${task.parallel.join(", ")}`);
    }

    const results = await Promise.allSettled(
      task.parallel.map((t) => runTask(t, config, options)),
    );

    // Combine outputs from all parallel tasks
    let combinedStdout = "";
    let combinedStderr = "";
    let anyFailed = false;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result) continue;

      const taskName = task.parallel[i];

      if (result.status === "rejected") {
        anyFailed = true;
        const reason = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        combinedStderr += `[${taskName}] Error: ${reason}\n`;
      } else {
        const taskResult = result.value;
        if (taskResult.stdout) {
          combinedStdout += `[${taskName}]\n${taskResult.stdout}\n`;
        }
        if (taskResult.stderr) {
          combinedStderr += `[${taskName}]\n${taskResult.stderr}\n`;
        }
        if (!taskResult.success) {
          anyFailed = true;
        }
      }
    }

    return {
      success: !anyFailed,
      stdout: combinedStdout.trim(),
      stderr: combinedStderr.trim(),
      code: anyFailed ? 1 : 0,
    };
  }

  // Handle serial tasks
  if (task.serial) {
    if (options.verbose) {
      console.error(`Running tasks in series: ${task.serial.join(", ")}`);
    }

    let combinedStdout = "";
    let combinedStderr = "";

    for (const t of task.serial) {
      const result = await runTask(t, config, options);

      if (result.stdout) {
        combinedStdout += `[${t}]\n${result.stdout}\n`;
      }
      if (result.stderr) {
        combinedStderr += `[${t}]\n${result.stderr}\n`;
      }

      if (!result.success) {
        // Stop on first failure in serial execution
        return {
          success: false,
          stdout: combinedStdout.trim(),
          stderr: combinedStderr.trim(),
          code: result.code,
        };
      }
    }

    return {
      success: true,
      stdout: combinedStdout.trim(),
      stderr: combinedStderr.trim(),
      code: 0,
    };
  }

  throw new Error(
    `Task '${taskName}' has no executable configuration (needs cmd, parallel, or serial)`,
  );
}

/**
 * List all available tasks in the config
 */
export function listTasks(config: SafeShellConfig): string[] {
  return Object.keys(config.tasks ?? {});
}

/**
 * Get task definition by name
 */
export function getTask(
  config: SafeShellConfig,
  taskName: string,
): string | TaskConfig | undefined {
  return config.tasks?.[taskName];
}
