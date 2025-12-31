/**
 * Command Transform Functions
 *
 * Provides transforms that pipe stream content to external commands.
 * Used for integrating external tools into stream pipelines.
 *
 * @module
 */

import { cmd, type CommandOptions, type CommandResult } from "./command.ts";

/**
 * Transform type for stream operations
 */
type Transform<T, U> = (stream: AsyncIterable<T>) => AsyncIterable<U>;

/**
 * Helper to collect stream, pipe to command, and return result
 *
 * @param stream - Input stream to collect
 * @param command - Command to execute
 * @param args - Command arguments
 * @param options - Command options
 * @param fnName - Function name for error messages
 * @returns Command execution result
 */
export async function execStreamToCmd(
  stream: AsyncIterable<string>,
  command: string,
  args: string[],
  options: CommandOptions | undefined,
  fnName: string,
): Promise<CommandResult> {
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
 * @param command - Command to pipe to
 * @param args - Command arguments
 * @param options - Command options
 * @returns Transform that pipes stream to command
 *
 * @example
 * ```ts
 * // Filter and sort with external command
 * await cat("input.txt")
 *   .pipe(lines())
 *   .pipe(grep(/pattern/))
 *   .pipe(toCmd("sort"))
 *   .first();
 *
 * // Process stream through external tool
 * await glob("*.json")
 *   .pipe(map(f => f.contents))
 *   .pipe(toCmd("jq", [".name"]))
 *   .collect();
 * ```
 */
export function toCmd(
  command: string,
  args: string[] = [],
  options?: CommandOptions,
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    const result = await execStreamToCmd(stream, command, args, options, "toCmd");

    // Yield stdout
    yield result.stdout;
  };
}

/**
 * Create a transform that pipes stream content to a command and yields lines
 *
 * Like toCmd, but splits the command's stdout into lines and yields each line.
 *
 * @param command - Command to pipe to
 * @param args - Command arguments
 * @param options - Command options
 * @returns Transform that pipes stream to command and yields lines
 *
 * @example
 * ```ts
 * // Sort lines through external sort
 * const sorted = await cat("input.txt")
 *   .pipe(lines())
 *   .pipe(toCmdLines("sort", ["-r"]))
 *   .collect();
 * ```
 */
export function toCmdLines(
  command: string,
  args: string[] = [],
  options?: CommandOptions,
): Transform<string, string> {
  return async function* (stream: AsyncIterable<string>) {
    const result = await execStreamToCmd(stream, command, args, options, "toCmdLines");

    // Yield each line from stdout
    const outputLines = result.stdout.split("\n");
    for (const line of outputLines) {
      if (line.length > 0) {
        yield line;
      }
    }
  };
}
