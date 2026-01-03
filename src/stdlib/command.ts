/**
 * Command Execution with Stream Handling
 *
 * Provides a clean API for executing external commands with proper
 * stdout/stderr separation and streaming capabilities.
 *
 * @module
 */

import { createStream, type Stream } from "./stream.ts";
import { FluentStream } from "./fluent-stream.ts";
import { writeStdin } from "./io.ts";
import { collectStreamBytes } from "../core/utils.ts";
import { CMD_NAME_SYMBOL, type CommandFn } from "./command-init.ts";
import {
  JOB_MARKER,
  CMD_ERROR_MARKER,
  ENV_SHELL_ID,
  ENV_SCRIPT_ID,
} from "../core/constants.ts";

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const scriptId = Deno.env.get(ENV_SCRIPT_ID);
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  if (scriptId) {
    // Extract shell ID prefix from script ID (script-{shellId}-{seq})
    const shellPrefix = scriptId.replace(/^script-/, "").split("-")[0];
    return `job-${shellPrefix}-${random?.toString(16) ?? "0"}`;
  }
  return `job-${random?.toString(16) ?? "0"}`;
}

/**
 * Emit a job event marker to stderr (for main process to parse)
 */
function emitJobStart(jobId: string, command: string, args: string[], pid: number): void {
  const shellId = Deno.env.get(ENV_SHELL_ID);
  const scriptId = Deno.env.get(ENV_SCRIPT_ID);
  if (!shellId || !scriptId) return; // Not running in a tracked context

  const event = {
    type: "start",
    id: jobId,
    scriptId,
    shellId,
    command,
    args,
    pid,
    startedAt: new Date().toISOString(),
  };
  console.error(`${JOB_MARKER}${JSON.stringify(event)}`);
}

/**
 * Emit a job completion event marker
 */
function emitJobEnd(
  jobId: string,
  exitCode: number,
  startTime: number,
): void {
  const shellId = Deno.env.get(ENV_SHELL_ID);
  if (!shellId) return;

  const completedAt = new Date();
  const event = {
    type: "end",
    id: jobId,
    exitCode,
    completedAt: completedAt.toISOString(),
    duration: completedAt.getTime() - startTime,
  };
  console.error(`${JOB_MARKER}${JSON.stringify(event)}`);
}

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

  /** Standard input data to write to the command */
  stdin?: string | Uint8Array | ReadableStream<Uint8Array>;
}

/**
 * Command class for executing external commands
 *
 * Provides both buffered (exec) and streaming (stream) execution modes.
 * By default, keeps stdout and stderr separate for clarity.
 */
export class Command implements PromiseLike<CommandResult> {
  /** Upstream command whose stdout becomes this command's stdin */
  private upstream?: Command;

  constructor(
    private cmd: string,
    private args: string[] = [],
    private options: CommandOptions = {},
  ) {}

  /**
   * Make Command thenable - auto-exec when awaited
   * @example await $.git('status') // returns CommandResult directly
   */
  then<TResult1 = CommandResult, TResult2 = never>(
    onfulfilled?: ((value: CommandResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /**
   * Handle rejection - makes Command fully Promise-like
   * @example await $.cmd('pkill', ['-f', 'foo']).catch(() => {})
   */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<CommandResult | TResult> {
    return this.exec().catch(onrejected);
  }

  /**
   * Run cleanup regardless of success/failure
   * @example await $.cmd('test').finally(() => console.log('done'))
   */
  finally(onfinally?: (() => void) | null): Promise<CommandResult> {
    return this.exec().finally(onfinally);
  }

  /**
   * Create a Deno.Command with standard configuration
   * Child processes inherit Deno.env (which includes $.ENV) plus any options.env
   */
  private createCommand(hasStdin: boolean): Deno.Command {
    // Merge options.env with current Deno.env if provided, otherwise inherit
    const env = this.options.env
      ? { ...Deno.env.toObject(), ...this.options.env }
      : undefined;

    return new Deno.Command(this.cmd, {
      args: this.args,
      cwd: this.options.cwd,
      env,
      clearEnv: this.options.clearEnv,
      stdout: "piped",
      stderr: "piped",
      stdin: hasStdin ? "piped" : undefined,
    });
  }

  /**
   * Set up stdin writing for a process
   * Returns a promise that resolves when stdin is fully written, or undefined if no stdin
   */
  private setupStdin(
    process: Deno.ChildProcess,
    stdinData: string | Uint8Array | ReadableStream<Uint8Array> | undefined,
  ): Promise<void> | undefined {
    if (stdinData !== undefined && process.stdin) {
      return writeStdin(process.stdin, stdinData);
    }
    return undefined;
  }

  /**
   * Spawn a process with improved error handling
   */
  private spawnProcess(command: Deno.Command): Deno.ChildProcess {
    try {
      return command.spawn();
    } catch (err: unknown) {
      // Handle permission denied
      if (
        err instanceof Deno.errors.NotCapable ||
        (err instanceof Error && err.message.includes("NotCapable"))
      ) {
        // Emit command error marker for retry workflow
        const errorEvent = {
          type: "COMMAND_NOT_ALLOWED",
          command: this.cmd,
        };
        console.error(`${CMD_ERROR_MARKER}${JSON.stringify(errorEvent)}`);

        throw new Error(
          `Command "${this.cmd}" is not allowed. Add it to permissions.run in safesh.config.ts.`,
        );
      }

      // Handle command not found
      if (
        err instanceof Deno.errors.NotFound ||
        (err instanceof Error && err.message.includes("entity not found"))
      ) {
        throw new Error(
          `Command not found: "${this.cmd}". Is it installed and in your PATH?`,
        );
      }

      throw err;
    }
  }

  /**
   * Pipe this command's stdout to another command's stdin
   *
   * Creates a pipeline where this command's stdout becomes the next
   * command's stdin. Can be chained for multi-stage pipelines.
   *
   * @param command - Command name (string) or CommandFn from initCmds()
   * @param args - Arguments for the target command
   * @param options - Options for the target command
   * @returns New Command instance configured with this command as upstream
   *
   * @example
   * ```ts
   * // Simple pipe with string
   * await cmd("cat", ["file.txt"]).pipe("grep", ["pattern"]).exec();
   *
   * // With CommandFn from initCmds
   * const [grep] = await initCmds(["grep"]);
   * await str("hello\nworld").pipe(grep, ["hello"]).exec();
   *
   * // Multi-stage pipeline
   * await cmd("cat", ["file.txt"])
   *   .pipe("grep", ["pattern"])
   *   .pipe("sort")
   *   .pipe("uniq", ["-c"])
   *   .exec();
   * ```
   */
  pipe(command: string | CommandFn, args: string[] = [], options?: CommandOptions): Command {
    // Extract command name from CommandFn if needed
    let cmdName: string;
    if (typeof command === "function") {
      const name = command[CMD_NAME_SYMBOL];
      if (!name) {
        throw new Error("pipe() received a function without a command name. Use a string command name or a function from initCmds().");
      }
      cmdName = name;
    } else {
      cmdName = command;
    }

    const next = new Command(cmdName, args, options ?? {});
    next.upstream = this;
    return next;
  }

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
    // Get stdin from upstream command or options
    const stdinData = await this.resolveStdin();
    const hasStdin = stdinData !== undefined;

    const process = this.spawnProcess(this.createCommand(hasStdin));
    const decoder = new TextDecoder();

    // Emit job start event
    const jobId = generateJobId();
    const startTime = Date.now();
    emitJobStart(jobId, this.cmd, this.args, process.pid);

    // Write stdin, read outputs, and wait for status concurrently
    const promises: Promise<unknown>[] = [
      collectStreamBytes(process.stdout),
      collectStreamBytes(process.stderr),
      process.status,
    ];
    const stdinPromise = this.setupStdin(process, stdinData);
    if (stdinPromise) {
      promises.push(stdinPromise);
    }

    const [stdoutBytes, stderrBytes, status] = (await Promise.all(promises)) as [
      Uint8Array,
      Uint8Array,
      Deno.CommandStatus,
    ];

    // Emit job end event
    emitJobEnd(jobId, status.code, startTime);

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
    // Get stdin from upstream command or options
    const stdinData = await this.resolveStdin();
    const hasStdin = stdinData !== undefined;

    const process = this.spawnProcess(this.createCommand(hasStdin));

    // Emit job start event
    const jobId = generateJobId();
    const startTime = Date.now();
    emitJobStart(jobId, this.cmd, this.args, process.pid);

    // Start writing stdin in background (don't await yet)
    const stdinPromise = this.setupStdin(process, stdinData);

    if (this.options.mergeStreams) {
      yield* this.mergeStreams(process.stdout, process.stderr);
    } else {
      yield* this.separateStreams(process.stdout, process.stderr);
    }

    // Wait for stdin to finish writing
    if (stdinPromise) {
      await stdinPromise;
    }

    const status = await process.status;

    // Emit job end event
    emitJobEnd(jobId, status.code, startTime);

    yield { type: "exit", code: status.code };
  }

  /**
   * Stream one output (stdout or stderr), draining the other
   */
  private streamOne(target: "stdout" | "stderr"): Stream<string> {
    const self = this;
    return createStream(
      (async function* () {
        // Get stdin from upstream command or options
        const stdinData = await self.resolveStdin();
        const hasStdin = stdinData !== undefined;

        const process = self.spawnProcess(self.createCommand(hasStdin));
        const decoder = new TextDecoder();

        // Emit job start event
        const jobId = generateJobId();
        const startTime = Date.now();
        emitJobStart(jobId, self.cmd, self.args, process.pid);

        // Start writing stdin in background
        const stdinPromise = self.setupStdin(process, stdinData);

        // Select streams based on target
        const streamToRead = target === "stdout" ? process.stdout : process.stderr;
        const streamToDrain = target === "stdout" ? process.stderr : process.stdout;

        // Drain the other stream in background to prevent deadlock
        const drainPromise = (async () => {
          const reader = streamToDrain.getReader();
          try {
            while (true) {
              const { done } = await reader.read();
              if (done) break;
            }
          } finally {
            reader.releaseLock();
          }
        })();

        // Stream target output
        const reader = streamToRead.getReader();
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
          if (stdinPromise) await stdinPromise;
          await drainPromise;
          const status = await process.status;
          // Emit job end event
          emitJobEnd(jobId, status.code, startTime);
        }
      })(),
    );
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
  stdout(): FluentStream<string> {
    return new FluentStream(this.streamOne("stdout"));
  }

  /**
   * Get stderr as a FluentStream
   *
   * Spawns the process and streams only stderr data.
   * Each call to stderr() spawns a new process.
   *
   * @returns FluentStream of stderr chunks
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
  stderr(): FluentStream<string> {
    return new FluentStream(this.streamOne("stderr"));
  }


  /**
   * Resolve stdin data from upstream command or options
   * If upstream command exists, execute it and use its stdout
   * Otherwise, return options.stdin if set
   */
  private async resolveStdin(): Promise<
    string | Uint8Array | ReadableStream<Uint8Array> | undefined
  > {
    if (this.upstream) {
      // Execute upstream command and get its stdout
      const result = await this.upstream.exec();
      if (!result.success) {
        throw new Error(
          `Pipeline failed: upstream command exited with code ${result.code}`,
        );
      }
      return result.stdout;
    }
    return this.options.stdin;
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
 * Supports multiple calling conventions:
 * - `cmd("ls")` - simple command
 * - `cmd("git", "status")` - variadic args
 * - `cmd("git", ["status"])` - array args (legacy)
 * - `cmd({ cwd: "/tmp" }, "ls", "-la")` - options first
 *
 * @example
 * ```ts
 * const result = await cmd("ls").exec();
 * const result = await cmd("git", "status", "-s").exec();
 * const result = await cmd({ cwd: "/project" }, "npm", "test").exec();
 * ```
 */
export function cmd(...params: unknown[]): Command {
  // Check if first arg is options object
  if (
    params.length > 0 &&
    typeof params[0] === "object" &&
    params[0] !== null &&
    !Array.isArray(params[0])
  ) {
    const options = params[0] as CommandOptions;
    const command = params[1] as string;
    const args = params.slice(2) as string[];
    return new Command(command, args, options);
  }

  const command = params[0] as string;
  const rest = params.slice(1);

  // Legacy: cmd("git", ["status"]) - array as second arg
  if (rest.length === 1 && Array.isArray(rest[0])) {
    return new Command(command, rest[0] as string[], {});
  }

  // Legacy: cmd("git", ["status"], { cwd: ... }) - array + options
  if (rest.length === 2 && Array.isArray(rest[0])) {
    return new Command(command, rest[0] as string[], rest[1] as CommandOptions);
  }

  // Variadic: cmd("git", "status", "-s")
  return new Command(command, rest as string[], {});
}

// ============================================================================
// Re-exports from split modules for backwards compatibility
// ============================================================================

// Command helpers (git, docker, tmux, tmuxSubmit, str, bytes)
export {
  createCommandFactory,
  git,
  docker,
  tmux,
  tmuxSubmit,
  str,
  bytes,
} from "./command-helpers.ts";

// Command transforms (toCmd, toCmdLines)
export { toCmd, toCmdLines, execStreamToCmd } from "./command-transforms.ts";

// Command initialization (initCmds)
export { initCmds, type CommandFn } from "./command-init.ts";

// Legacy alias for backwards compatibility
export { initCmds as init } from "./command-init.ts";
