/**
 * Command Execution with Stream Handling
 *
 * Provides a clean API for executing external commands with proper
 * stdout/stderr separation and streaming capabilities.
 *
 * @module
 */

import { createStream, type Stream, type Transform } from "./stream.ts";
import { FluentStream } from "./fluent-stream.ts";
import { writeStdin } from "./io.ts";
import { collectStreamBytes, collectStreamBytesWithTimeout } from "../core/utils.ts";
import { CMD_NAME_SYMBOL, type CommandFn } from "./command-init.ts";
import { lines } from "./transforms.ts";
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
 * Options for file redirection
 */
export interface RedirectOptions {
  /** Append to file instead of overwriting */
  append?: boolean;
  /** Force overwrite even if noclobber is set */
  force?: boolean;
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

  /** Redirect stdout to file */
  stdoutFile?: { path: string; options?: RedirectOptions };

  /** Redirect stderr to file */
  stderrFile?: { path: string; options?: RedirectOptions };
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
   * Spawn command as a background process and return child process
   * Used by bash transpiler for background jobs (&)
   * @returns Deno.ChildProcess with .pid property
   */
  spawnBackground(): Deno.ChildProcess {
    const command = this.createCommand(false);
    return this.spawnProcess(command);
  }

  /**
   * Pipe this command's stdout to another command's stdin or to a transform
   *
   * Creates a pipeline where this command's stdout becomes the next
   * command's stdin. Can be chained for multi-stage pipelines.
   *
   * Accepts either:
   * - CommandFn from initCmds() with args → returns Command
   * - Command object directly (for transpiler-generated pipelines) → returns Command
   * - Transform function (e.g., grep, head, tail) → returns FluentStream
   *
   * When piping to a Transform, automatically splits stdout into lines first.
   *
   * @param command - CommandFn, Command object, or Transform function
   * @param args - Arguments for the target command (only used with CommandFn)
   * @param options - Options for the target command (only used with CommandFn)
   * @returns New Command or FluentStream depending on the target type
   *
   * @example
   * ```ts
   * // With CommandFn from initCmds
   * const [grep, sort, uniq] = await initCmds(["grep", "sort", "uniq"]);
   * await str("hello\nworld").pipe(grep, ["hello"]).exec();
   *
   * // With Command object (transpiler-generated)
   * await cmd("echo", ["hello"]).pipe(cmd("tr", ["a-z", "A-Z"])).exec();
   *
   * // With Transform function (SSH-422)
   * await git("log", "--oneline").pipe(grep(/pattern/)).exec();
   *
   * // Multi-stage pipeline
   * await $.cat("file.txt").stdout()
   *   .pipe(toCmd(grep, ["pattern"]))
   *   .pipe(toCmd(sort))
   *   .collect();
   * ```
   */
  pipe(command: CommandFn | Command, args?: string[], options?: CommandOptions): Command;
  pipe<U>(transform: Transform<string, U>): FluentStream<U>;
  pipe<U>(
    command: CommandFn | Command | Transform<string, U>,
    args: string[] = [],
    options?: CommandOptions,
  ): Command | FluentStream<U> {
    // Handle Command object directly (SSH-365: command-to-command pipelines)
    if (command instanceof Command) {
      command.upstream = this;
      return command;
    }

    // Check if it's a CommandFn from initCmds() or a Transform function
    if (typeof command === "function") {
      const cmdName = (command as CommandFn)[CMD_NAME_SYMBOL];

      if (cmdName) {
        // It's a CommandFn from initCmds() - create command pipeline
        const next = new Command(cmdName, args, options ?? {});
        next.upstream = this;
        return next;
      } else {
        // SSH-422: It's a Transform function - convert stdout to line stream and apply transform
        const transform = command as Transform<string, U>;
        return this.stdout().pipe(lines()).pipe(transform);
      }
    }

    throw new Error("pipe() requires a CommandFn from initCmds(), a Command object, or a Transform function.");
  }

  /**
   * Set stdin for this command (for heredocs and here-strings)
   *
   * Creates a new Command with the same cmd/args but with stdin set.
   * This enables heredoc syntax like: cat <<EOF ... EOF
   *
   * @param content - String content to provide as stdin
   * @param _options - Optional settings (reserved for stripTabs support)
   * @returns New Command instance with stdin configured
   *
   * @example
   * ```ts
   * // Heredoc style
   * await cmd("cat", []).stdin("hello world").exec();
   *
   * // Equivalent to: cat <<EOF
   * //                hello world
   * //                EOF
   * ```
   */
  stdin(content: string, _options?: { stripTabs?: boolean }): Command {
    // Create new command with stdin set
    // Note: stripTabs is handled at transpile time, not runtime
    return new Command(this.cmd, this.args, { ...this.options, stdin: content });
  }

  /**
   * Execute command and return stdout as string
   *
   * Convenience method for command substitution $(...)
   * Executes the command and returns just the stdout content.
   *
   * @returns Promise with stdout string
   *
   * @example
   * ```ts
   * // Get command output as string
   * const branch = await cmd("git", ["branch", "--show-current"]).text();
   *
   * // Used in command substitution: $(git branch --show-current)
   * ```
   */
  async text(): Promise<string> {
    const result = await this.exec();
    return result.stdout;
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

    // SSH-426: Set up timeout if specified
    let timeoutId: number | undefined;
    let timedOut = false;
    if (this.options.timeout && this.options.timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          process.kill("SIGTERM");
          // Give it a moment to terminate gracefully, then force kill
          setTimeout(() => {
            try {
              process.kill("SIGKILL");
            } catch {
              // Process may have already terminated
            }
          }, 100);
        } catch {
          // Process may have already terminated
        }
      }, this.options.timeout);
    }

    try {
      // SSH-429: Wait for process to exit first, then collect streams with timeout
      // This prevents hanging when child processes spawn daemons that inherit stdio

      // Write stdin and wait for process to exit concurrently
      const stdinPromise = this.setupStdin(process, stdinData);
      const statusPromise = process.status;

      // Wait for process to exit (and stdin to finish if applicable)
      const status = stdinPromise
        ? (await Promise.all([statusPromise, stdinPromise]))[0]
        : await statusPromise;

      // After process exits, give streams a grace period to flush
      // If a daemon inherited the streams, they won't close - so we timeout
      const STREAM_FLUSH_TIMEOUT_MS = 1000; // 1 second
      const abortController = new AbortController();

      // Set timeout to abort stream collection if streams don't close
      const streamTimeoutId = setTimeout(() => {
        abortController.abort();
      }, STREAM_FLUSH_TIMEOUT_MS);

      // Collect streams with timeout support
      const [stdoutBytes, stderrBytes] = await Promise.all([
        collectStreamBytesWithTimeout(process.stdout, abortController.signal),
        collectStreamBytesWithTimeout(process.stderr, abortController.signal),
      ]);

      // Clear stream timeout
      clearTimeout(streamTimeoutId);

      // Clear timeout if command completed normally
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      // Emit job end event
      const exitCode = timedOut ? 124 : status.code;
      emitJobEnd(jobId, exitCode, startTime);

      const stdoutStr = decoder.decode(stdoutBytes);
      const stderrStr = decoder.decode(stderrBytes);

      // Handle file redirections
      if (this.options.stdoutFile) {
        await this.writeToFile(
          this.options.stdoutFile.path,
          stdoutStr,
          this.options.stdoutFile.options,
        );
      }
      if (this.options.stderrFile) {
        await this.writeToFile(
          this.options.stderrFile.path,
          stderrStr,
          this.options.stderrFile.options,
        );
      }

      return {
        stdout: stdoutStr,
        stderr: stderrStr,
        code: exitCode,
        success: exitCode === 0,
      };
    } catch (err) {
      // Clear timeout on error
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      throw err;
    }
  }

  /**
   * Write content to a file (for redirections)
   */
  private async writeToFile(
    path: string,
    content: string,
    options?: RedirectOptions,
  ): Promise<void> {
    const writeOptions: Deno.WriteFileOptions = {};
    if (options?.append) {
      writeOptions.append = true;
    }
    // Note: 'force' option is for noclobber override - not currently enforced
    await Deno.writeTextFile(path, content, writeOptions);
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

    // SSH-426: Set up timeout if specified
    let timeoutId: number | undefined;
    let killTimeoutId: number | undefined;
    let timedOut = false;
    if (this.options.timeout && this.options.timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          process.kill("SIGTERM");
          killTimeoutId = setTimeout(() => {
            try {
              process.kill("SIGKILL");
            } catch {
              // Process may have already terminated
            }
          }, 100);
        } catch {
          // Process may have already terminated
        }
      }, this.options.timeout);
    }

    try {
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

      // Clear timeout if command completed normally
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (killTimeoutId !== undefined) {
        clearTimeout(killTimeoutId);
      }

      // Emit job end event
      const exitCode = timedOut ? 124 : status.code;
      emitJobEnd(jobId, exitCode, startTime);

      yield { type: "exit", code: exitCode };
    } catch (err) {
      // Clear timeout on error
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (killTimeoutId !== undefined) {
        clearTimeout(killTimeoutId);
      }
      throw err;
    }
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
   * Get stdout as a Stream (no arguments) or redirect to file (with file path)
   *
   * Without arguments: Spawns the process and streams only stdout data.
   * With file path: Returns a new Command with stdout redirected to the file.
   *
   * @param file - Optional file path to redirect stdout to
   * @param options - Optional redirect options (append, force)
   * @returns FluentStream when no args, Command when file specified
   *
   * @example
   * ```ts
   * // Stream stdout
   * await cmd("git", ["log"])
   *   .stdout()
   *   .pipe(lines())
   *   .forEach(() => {});
   *
   * // Redirect to file
   * await cmd("echo", ["hello"]).stdout("output.txt").exec();
   * await cmd("echo", ["more"]).stdout("output.txt", { append: true }).exec();
   * ```
   */
  stdout(): FluentStream<string>;
  stdout(file: string, options?: RedirectOptions): Command;
  stdout(file?: string, options?: RedirectOptions): FluentStream<string> | Command {
    if (file !== undefined) {
      // File redirection mode - return new Command with stdoutFile set
      const next = new Command(this.cmd, this.args, {
        ...this.options,
        stdoutFile: { path: file, options },
      });
      next.upstream = this.upstream;
      return next;
    }
    // Stream mode
    return new FluentStream(this.streamOne("stdout"));
  }

  /**
   * Get stderr as a FluentStream (no arguments) or redirect to file (with file path)
   *
   * Without arguments: Spawns the process and streams only stderr data.
   * With file path: Returns a new Command with stderr redirected to the file.
   *
   * @param file - Optional file path to redirect stderr to
   * @param options - Optional redirect options (append, force)
   * @returns FluentStream when no args, Command when file specified
   *
   * @example
   * ```ts
   * // Stream stderr
   * await cmd("git", ["status"])
   *   .stderr()
   *   .pipe(lines())
   *   .forEach(() => {});
   *
   * // Redirect to file
   * await cmd("npm", ["install"]).stderr("errors.log").exec();
   * await cmd("npm", ["test"]).stderr("errors.log", { append: true }).exec();
   * ```
   */
  stderr(): FluentStream<string>;
  stderr(file: string, options?: RedirectOptions): Command;
  stderr(file?: string, options?: RedirectOptions): FluentStream<string> | Command {
    if (file !== undefined) {
      // File redirection mode - return new Command with stderrFile set
      const next = new Command(this.cmd, this.args, {
        ...this.options,
        stderrFile: { path: file, options },
      });
      next.upstream = this.upstream;
      return next;
    }
    // Stream mode
    return new FluentStream(this.streamOne("stderr"));
  }

  /**
   * Apply a transform to command's stdout
   *
   * Convenience method that gets stdout as stream and applies a transform.
   * Equivalent to .stdout().trans(transform).
   *
   * @param transform - Transform function to apply
   * @returns FluentStream for chaining
   *
   * @example
   * ```ts
   * // Apply transforms to command output
   * await $.git('log', '--oneline')
   *   .trans(lines())
   *   .head(10)
   *   .collect();
   * ```
   */
  trans<U>(transform: Transform<string, U>): FluentStream<U> {
    return this.stdout().trans(transform);
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
export { initCmds, type CommandFn, CMD_NAME_SYMBOL } from "./command-init.ts";

// Legacy alias for backwards compatibility
export { initCmds as init } from "./command-init.ts";
