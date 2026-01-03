/**
 * Command Transform Functions
 *
 * Provides transforms that pipe stream content to external commands.
 * Used for integrating external tools into stream pipelines.
 *
 * NOTE: All functions require CommandFn from initCmds() to enforce permission checks.
 * Raw string command names are not allowed.
 *
 * @module
 */

import { cmd, type CommandOptions, type CommandResult, type CommandFn, CMD_NAME_SYMBOL } from "./command.ts";

/**
 * Transform type for stream operations
 */
type Transform<T, U> = (stream: AsyncIterable<T>) => AsyncIterable<U>;

/**
 * Helper to collect stream, pipe to command, and return result
 *
 * @param stream - Input stream to collect
 * @param commandFn - CommandFn from initCmds()
 * @param args - Command arguments
 * @param options - Command options
 * @param fnName - Function name for error messages
 * @returns Command execution result
 */
export async function execStreamToCmd(
  stream: AsyncIterable<string>,
  commandFn: CommandFn,
  args: string[],
  options: CommandOptions | undefined,
  fnName: string,
): Promise<CommandResult> {
  const command = commandFn[CMD_NAME_SYMBOL];
  if (!command) {
    throw new Error(`${fnName}() requires a CommandFn from initCmds(). Raw string command names are not allowed.`);
  }
  // Collect all items from stream
  const items: string[] = [];
  for await (const item of stream) {
    items.push(item);
  }

  // Join with newlines and pass as stdin
  const input = items.join("\n");
  const result = await cmd(command, args, {
    ...options,
    stdin: input,
  }).exec();

  if (!result.success) {
    throw new Error(
      `${fnName} failed: ${command} exited with code ${result.code}`,
    );
  }

  return result;
}

/**
 * Create a transform that pipes stream content to a command
 *
 * Collects all items from the stream, joins them with newlines,
 * and passes them as stdin to the specified command.
 * Yields the command's stdout as output.
 *
 * NOTE: Requires CommandFn from initCmds() to enforce permission checks.
 *
 * @param commandFn - CommandFn from initCmds()
 * @param args - Command arguments
 * @param options - Command options
 * @returns Transform that pipes stream to command
 *
 * @example
 * ```ts
 * const [sort, jq] = await initCmds(["sort", "jq"]);
 *
 * // Filter and sort with external command
 * await cat("input.txt")
 *   .pipe(lines())
 *   .pipe(grep(/pattern/))
 *   .pipe(toCmd(sort))
 *   .first();
 *
 * // Process stream through external tool
 * await glob("*.json")
 *   .pipe(map(f => f.contents))
 *   .pipe(toCmd(jq, [".name"]))
 *   .collect();
 * ```
 */
export function toCmd(
  commandFn: CommandFn,
  args: string[] = [],
  options?: CommandOptions,
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    const result = await execStreamToCmd(stream, commandFn, args, options, "toCmd");

    // Yield stdout
    yield result.stdout;
  };
}

/**
 * Create a transform that pipes stream content to a command and yields lines
 *
 * Like toCmd, but splits the command's stdout into lines and yields each line.
 *
 * NOTE: Requires CommandFn from initCmds() to enforce permission checks.
 *
 * @param commandFn - CommandFn from initCmds()
 * @param args - Command arguments
 * @param options - Command options
 * @returns Transform that pipes stream to command and yields lines
 *
 * @example
 * ```ts
 * const [sort] = await initCmds(["sort"]);
 *
 * // Sort lines through external sort
 * const sorted = await cat("input.txt")
 *   .pipe(lines())
 *   .pipe(toCmdLines(sort, ["-r"]))
 *   .collect();
 * ```
 */
export function toCmdLines(
  commandFn: CommandFn,
  args: string[] = [],
  options?: CommandOptions,
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    const result = await execStreamToCmd(stream, commandFn, args, options, "toCmdLines");

    // Yield each line from stdout
    const outputLines = result.stdout.split("\n");
    for (const line of outputLines) {
      if (line.length > 0) {
        yield line;
      }
    }
  };
}
