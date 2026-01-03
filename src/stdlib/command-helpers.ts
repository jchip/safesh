/**
 * Command Helper Factory Functions
 *
 * Provides convenience factory functions for common commands like git, docker, deno.
 * Also includes heredoc-style helpers (str, bytes) for piping data to commands.
 *
 * @module
 */

import { Command, type CommandOptions, type CommandResult } from "./command.ts";

/**
 * Overloaded command function type with options-first pattern.
 * Used internally for git, docker, deno convenience functions.
 */
type OverloadedCommandFn = {
  (options: CommandOptions, ...args: string[]): Command;
  (...args: string[]): Command;
};

/**
 * Create a command factory for a specific command
 *
 * Returns a function that creates Command instances for the specified command.
 * Supports both `cmd(...args)` and `cmd(options, ...args)` signatures.
 *
 * @param commandName - The command to create a factory for (e.g., "git", "docker")
 * @returns A function that creates Command instances
 */
export function createCommandFactory(commandName: string): OverloadedCommandFn {
  return function (...args: unknown[]): Command {
    // Check if first arg is options object
    if (
      args.length > 0 &&
      typeof args[0] === "object" &&
      !Array.isArray(args[0])
    ) {
      const options = args[0] as CommandOptions;
      const cmdArgs = args.slice(1) as string[];
      return new Command(commandName, cmdArgs, options);
    } else {
      return new Command(commandName, args as string[], {});
    }
  } as OverloadedCommandFn;
}

/**
 * Create a git command
 *
 * Convenience function for git commands with optional options.
 *
 * @example
 * ```ts
 * // Simple git command
 * const result = await git("status").exec();
 *
 * // With arguments
 * const result = await git("commit", "-m", "message").exec();
 *
 * // With options
 * const result = await git({ cwd: "/repo" }, "status").exec();
 * ```
 */
export const git: OverloadedCommandFn = createCommandFactory("git");

/**
 * Create a docker command
 */
export const docker: OverloadedCommandFn = createCommandFactory("docker");

/** Commands that need a delay after execution to avoid race conditions */
const TMUX_DELAY_COMMANDS = ["send-keys", "send"];
const TMUX_DELAY_MS = 100;

/**
 * Create a tmux command with auto-delay for send-keys
 *
 * Automatically adds a small delay after send-keys commands to prevent
 * race conditions where keystrokes arrive faster than the shell can process.
 *
 * @example
 * ```ts
 * await tmux("send-keys", "-t", "mywindow", "echo hello", "C-m");
 * // 10ms delay automatically added after send-keys
 * await tmux("capture-pane", "-t", "mywindow", "-p");
 * ```
 */
export const tmux: OverloadedCommandFn = function (...args: unknown[]): Command {
  const baseCmd = createCommandFactory("tmux");
  const command = baseCmd(...(args as Parameters<OverloadedCommandFn>));

  // Check if this is a send-keys command (first string arg after options)
  const firstArg = typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])
    ? args[1]
    : args[0];

  const needsDelay = typeof firstArg === "string" &&
    TMUX_DELAY_COMMANDS.includes(firstArg);

  if (!needsDelay) {
    return command;
  }

  // Wrap exec() to add delay after send-keys
  const originalExec = command.exec.bind(command);
  command.exec = async () => {
    const result = await originalExec();
    await new Promise(r => setTimeout(r, TMUX_DELAY_MS));
    return result;
  };

  // Also wrap then() since Command is thenable
  const originalThen = command.then.bind(command);
  command.then = (<TResult1, TResult2>(
    onFulfilled?: ((value: CommandResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => {
    return originalThen(async (result) => {
      await new Promise(r => setTimeout(r, TMUX_DELAY_MS));
      return onFulfilled ? onFulfilled(result) : result as unknown as TResult1;
    }, onRejected);
  }) as typeof command.then;

  return command;
} as OverloadedCommandFn;

/**
 * Submit text to a tmux pane, handling CLI paste mode detection.
 *
 * CLIs like claude-code detect paste mode, so Enter must be sent separately.
 * This helper sends the text, waits, then sends Enter.
 *
 * @param target - Target pane (e.g., "mywindow", "session:window.pane")
 * @param text - Text to send (can be multi-line)
 * @param targetClient - Optional target client for send-keys -c
 */
export async function tmuxSubmit(
  target: string,
  text: string,
  targetClient?: string,
): Promise<CommandResult> {
  const baseArgs = ["-t", target];
  if (targetClient) {
    baseArgs.push("-c", targetClient);
  }

  // Send text (without Enter)
  await tmux("send-keys", ...baseArgs, text);

  // Send Enter separately (seen as normal keypress, not part of paste)
  return tmux("send-keys", ...baseArgs, "C-m");
}

/**
 * Create a data source for piping text to commands (heredoc equivalent)
 *
 * Returns a Command-like object that can be piped to other commands.
 * The text becomes stdin for the first command in the pipeline.
 *
 * @param content - Text content (string or template literal)
 * @returns Command that can be piped
 *
 * @example
 * ```ts
 * const [sort, cat, grep, wc] = await initCmds(["sort", "cat", "grep", "wc"]);
 *
 * // Heredoc-style: sort lines
 * const result = await str(`cherry
 * apple
 * banana`).pipe(sort).exec();
 *
 * // With variable interpolation
 * const name = "world";
 * const result = await str(`Hello ${name}`).pipe(cat).exec();
 *
 * // Multi-stage pipeline
 * const result = await str(`line1
 * line2
 * line3`).pipe(grep, ["line2"]).pipe(wc, ["-l"]).exec();
 * ```
 */
export function str(content: string): Command {
  // Use 'cat' as a pass-through with stdin
  return new Command("cat", [], { stdin: content });
}

/**
 * Create a data source for piping binary data to commands
 *
 * Returns a Command-like object that can be piped to other commands.
 * The data becomes stdin for the first command in the pipeline.
 *
 * @param content - Binary data (Uint8Array)
 * @returns Command that can be piped
 *
 * @example
 * ```ts
 * // Pipe binary data
 * const raw = new TextEncoder().encode("hello");
 * const result = await bytes(raw).pipe("xxd").exec();
 *
 * // Read file and process
 * const content = await Deno.readFile("image.png");
 * const result = await bytes(content).pipe("file", ["-"]).exec();
 * ```
 */
export function bytes(content: Uint8Array): Command {
  // Use 'cat' as a pass-through with stdin
  return new Command("cat", [], { stdin: content });
}
