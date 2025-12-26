/**
 * Command Execution with Stream Handling
 *
 * Provides a clean API for executing external commands with proper
 * stdout/stderr separation and streaming capabilities.
 *
 * @module
 */

import { createStream, type Stream } from "./stream.ts";

/**
 * Result from executing a command (buffered mode)
 */
export interface CommandResult {
  /** Standard output (when mergeStreams is false) */
  stdout: string;

  /** Standard error (when mergeStreams is false) */
  stderr: string;

  /** Combined output (only present when mergeStreams is true) */
  output?: string;

  /** Exit code */
  code: number;

  /** True if exit code is 0 */
  success: boolean;
}

/**
 * Stream chunk from command execution (streaming mode)
 */
export interface StreamChunk {
  /** Type of chunk */
  type: "stdout" | "stderr" | "exit";

  /** Data (for stdout/stderr chunks) */
  data?: string;

  /** Exit code (for exit chunks) */
  code?: number;
}

/**
 * Options for command execution
 */
export interface CommandOptions {
  /** Merge stderr into stdout (preserves order) */
  mergeStreams?: boolean;

  /** Working directory */
  cwd?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Clear environment (don't inherit from parent) */
  clearEnv?: boolean;
}

/**
 * Command class for executing external commands
 *
 * Provides both buffered (exec) and streaming (stream) execution modes.
 * By default, keeps stdout and stderr separate for clarity.
 */
export class Command {
  constructor(
    private cmd: string,
    private args: string[] = [],
    private options: CommandOptions = {},
  ) {}

  /**
   * Execute command and buffer output
   *
   * @returns Promise with command result
   *
   * @example
   * ```ts
   * // Separate streams (default)
   * const result = await cmd("git", ["status"]).exec();
   * console.log("OUT:", result.stdout);
   * console.error("ERR:", result.stderr);
   *
   * // Merged streams
   * const result = await cmd("git", ["status"], { mergeStreams: true }).exec();
   * console.log(result.output);
   * ```
   */
  async exec(): Promise<CommandResult> {
    if (this.options.mergeStreams) {
      // Merge mode: collect everything into output
      return await this.execMerged();
    } else {
      // Separate mode: keep stdout and stderr separate
      return await this.execSeparate();
    }
  }

  /**
   * Execute with separate stdout/stderr buffers
   */
  private async execSeparate(): Promise<CommandResult> {
    const command = new Deno.Command(this.cmd, {
      args: this.args,
      cwd: this.options.cwd,
      env: this.options.env,
      clearEnv: this.options.clearEnv,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    const decoder = new TextDecoder();

    // Read both streams concurrently
    const [stdoutBytes, stderrBytes, status] = await Promise.all([
      this.readStream(process.stdout),
      this.readStream(process.stderr),
      process.status,
    ]);

    return {
      stdout: decoder.decode(stdoutBytes),
      stderr: decoder.decode(stderrBytes),
      code: status.code,
      success: status.success,
    };
  }

  /**
   * Execute with merged output (order preserved)
   */
  private async execMerged(): Promise<CommandResult> {
    let output = "";
    let code = 0;

    // Use streaming to preserve order
    for await (const chunk of this.stream()) {
      if (chunk.type === "stdout" || chunk.type === "stderr") {
        if (chunk.data) {
          output += chunk.data;
        }
      } else if (chunk.type === "exit") {
        code = chunk.code ?? 0;
      }
    }

    return {
      stdout: "",
      stderr: "",
      output,
      code,
      success: code === 0,
    };
  }

  /**
   * Stream command output in real-time
   *
   * Yields chunks as they arrive. By default, chunks are tagged with
   * their source (stdout/stderr). With mergeStreams, all chunks are
   * yielded as 'stdout' type.
   *
   * @example
   * ```ts
   * // Process chunks in real-time
   * for await (const chunk of cmd("git", ["log"]).stream()) {
   *   if (chunk.type === "stdout") {
   *     console.log("OUT:", chunk.data);
   *   } else if (chunk.type === "stderr") {
   *     console.error("ERR:", chunk.data);
   *   } else if (chunk.type === "exit") {
   *     console.log("Exit code:", chunk.code);
   *   }
   * }
   * ```
   */
  async *stream(): AsyncGenerator<StreamChunk> {
    const command = new Deno.Command(this.cmd, {
      args: this.args,
      cwd: this.options.cwd,
      env: this.options.env,
      clearEnv: this.options.clearEnv,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    if (this.options.mergeStreams) {
      yield* this.mergeStreams(process.stdout, process.stderr);
    } else {
      yield* this.separateStreams(process.stdout, process.stderr);
    }

    const status = await process.status;
    yield { type: "exit", code: status.code };
  }

  /**
   * Get stdout as a Stream
   *
   * Spawns the process and streams only stdout data.
   * Each call to stdout() spawns a new process.
   *
   * @returns Stream of stdout chunks
   *
   * @example
   * ```ts
   * // Pipe stdout through transforms
   * await cmd("git", ["log"])
   *   .stdout()
   *   .pipe(lines())
   *   .pipe(grep(/fix:/))
   *   .pipe(stdout())
   *   .forEach(() => {});
   * ```
   */
  stdout(): Stream<string> {
    const self = this;
    return createStream(
      (async function* () {
        const command = new Deno.Command(self.cmd, {
          args: self.args,
          cwd: self.options.cwd,
          env: self.options.env,
          clearEnv: self.options.clearEnv,
          stdout: "piped",
          stderr: "piped",
        });

        const process = command.spawn();
        const decoder = new TextDecoder();

        // Drain stderr in background to prevent deadlock
        const stderrDrain = (async () => {
          const reader = process.stderr.getReader();
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } finally {
            reader.releaseLock();
          }
        })();

        // Stream stdout
        const reader = process.stdout.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              yield decoder.decode(value, { stream: true });
            }
          }
        } finally {
          reader.releaseLock();
          await stderrDrain;
          await process.status;
        }
      })(),
    );
  }

  /**
   * Get stderr as a Stream
   *
   * Spawns the process and streams only stderr data.
   * Each call to stderr() spawns a new process.
   *
   * @returns Stream of stderr chunks
   *
   * @example
   * ```ts
   * // Process stderr separately
   * await cmd("git", ["status"])
   *   .stderr()
   *   .pipe(lines())
   *   .pipe(stderr())
   *   .forEach(() => {});
   * ```
   */
  stderr(): Stream<string> {
    const self = this;
    return createStream(
      (async function* () {
        const command = new Deno.Command(self.cmd, {
          args: self.args,
          cwd: self.options.cwd,
          env: self.options.env,
          clearEnv: self.options.clearEnv,
          stdout: "piped",
          stderr: "piped",
        });

        const process = command.spawn();
        const decoder = new TextDecoder();

        // Drain stdout in background to prevent deadlock
        const stdoutDrain = (async () => {
          const reader = process.stdout.getReader();
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } finally {
            reader.releaseLock();
          }
        })();

        // Stream stderr
        const reader = process.stderr.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              yield decoder.decode(value, { stream: true });
            }
          }
        } finally {
          reader.releaseLock();
          await stdoutDrain;
          await process.status;
        }
      })(),
    );
  }

  /**
   * Read all bytes from a ReadableStream
   */
  private async readStream(
    stream: ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Stream stdout and stderr separately, preserving order
   */
  private async *separateStreams(
    stdout: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>,
  ): AsyncGenerator<StreamChunk> {
    const decoder = new TextDecoder();
    const stdoutReader = stdout.getReader();
    const stderrReader = stderr.getReader();

    // Track pending reads
    type PendingRead = {
      reader: ReadableStreamDefaultReader<Uint8Array>;
      type: "stdout" | "stderr";
      promise: Promise<ReadableStreamReadResult<Uint8Array>>;
    };

    const pending: PendingRead[] = [
      {
        reader: stdoutReader,
        type: "stdout",
        promise: stdoutReader.read(),
      },
      {
        reader: stderrReader,
        type: "stderr",
        promise: stderrReader.read(),
      },
    ];

    // Race: yield whichever stream has data first
    while (pending.length > 0) {
      const racePromises = pending.map((p, idx) =>
        p.promise.then((result) => ({ result, idx, type: p.type }))
      );

      const { result, idx, type } = await Promise.race(racePromises);

      if (result.done) {
        // Remove completed stream
        pending[idx]!.reader.releaseLock();
        pending.splice(idx, 1);
      } else if (result.value) {
        // Yield the data
        yield {
          type,
          data: decoder.decode(result.value, { stream: true }),
        };

        // Start a new read for this stream
        pending[idx]!.promise = pending[idx]!.reader.read();
      }
    }
  }

  /**
   * Stream stdout and stderr merged, preserving order
   */
  private async *mergeStreams(
    stdout: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>,
  ): AsyncGenerator<StreamChunk> {
    // Use separateStreams but yield all as 'stdout' type
    for await (const chunk of this.separateStreams(stdout, stderr)) {
      if (chunk.type !== "exit") {
        yield { type: "stdout", data: chunk.data };
      }
    }
  }
}

/**
 * Create a command
 *
 * @param command - Command name or path
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Command instance
 *
 * @example
 * ```ts
 * // Simple command
 * const result = await cmd("echo", ["hello"]).exec();
 *
 * // With options
 * const result = await cmd("npm", ["test"], { cwd: "/project" }).exec();
 * ```
 */
export function cmd(
  command: string,
  args: string[] = [],
  options?: CommandOptions,
): Command {
  return new Command(command, args, options);
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
export function git(options: CommandOptions, ...args: string[]): Command;
export function git(...args: string[]): Command;
export function git(...args: unknown[]): Command {
  // Check if first arg is options object
  if (
    args.length > 0 &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    const options = args[0] as CommandOptions;
    const gitArgs = args.slice(1) as string[];
    return new Command("git", gitArgs, options);
  } else {
    return new Command("git", args as string[], {});
  }
}
