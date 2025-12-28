/**
 * Command Execution with Stream Handling
 *
 * Provides a clean API for executing external commands with proper
 * stdout/stderr separation and streaming capabilities.
 *
 * @module
 */

import { createStream, type Stream } from "./stream.ts";
import { writeStdin } from "./io.ts";

// Job tracking marker for communication with main process
const JOB_MARKER = "__SAFESH_JOB__:";

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const scriptId = Deno.env.get("SAFESH_SCRIPT_ID");
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
  const shellId = Deno.env.get("SAFESH_SHELL_ID");
  const scriptId = Deno.env.get("SAFESH_SCRIPT_ID");
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
  const shellId = Deno.env.get("SAFESH_SHELL_ID");
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
export class Command {
  /** Upstream command whose stdout becomes this command's stdin */
  private upstream?: Command;

  constructor(
    private cmd: string,
    private args: string[] = [],
    private options: CommandOptions = {},
  ) {}

  /**
   * Create a Deno.Command with standard configuration
   */
  private createCommand(hasStdin: boolean): Deno.Command {
    return new Deno.Command(this.cmd, {
      args: this.args,
      cwd: this.options.cwd,
      env: this.options.env,
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
      if (
        err instanceof Deno.errors.NotCapable ||
        (err instanceof Error && err.message.includes("NotCapable"))
      ) {
        throw new Error(
          `Command "${this.cmd}" is not allowed. Add it to permissions.run in safesh.toml.`,
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
   * @param command - Command name to pipe to
   * @param args - Arguments for the target command
   * @param options - Options for the target command
   * @returns New Command instance configured with this command as upstream
   *
   * @example
   * ```ts
   * // Simple pipe
   * await cmd("cat", ["file.txt"]).pipe("grep", ["pattern"]).exec();
   *
   * // Multi-stage pipeline
   * await cmd("cat", ["file.txt"])
   *   .pipe("grep", ["pattern"])
   *   .pipe("sort")
   *   .pipe("uniq", ["-c"])
   *   .exec();
   * ```
   */
  pipe(command: string, args: string[] = [], options?: CommandOptions): Command {
    const next = new Command(command, args, options ?? {});
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
      this.readStream(process.stdout),
      this.readStream(process.stderr),
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
  stdout(): Stream<string> {
    return this.streamOne("stdout");
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
    return this.streamOne("stderr");
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
 * // Heredoc-style: sort lines
 * const result = await str(`cherry
 * apple
 * banana`).pipe("sort").exec();
 *
 * // With variable interpolation
 * const name = "world";
 * const result = await str(`Hello ${name}`).pipe("cat").exec();
 *
 * // Multi-stage pipeline
 * const result = await str(`line1
 * line2
 * line3`).pipe("grep", ["line2"]).pipe("wc", ["-l"]).exec();
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

/**
 * Transform type for stream operations
 */
type Transform<T, U> = (stream: AsyncIterable<T>) => AsyncIterable<U>;

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
        `toCmd failed: ${command} exited with code ${result.code}`,
      );
    }

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
        `toCmdLines failed: ${command} exited with code ${result.code}`,
      );
    }

    // Yield each line from stdout
    const outputLines = result.stdout.split("\n");
    for (const line of outputLines) {
      if (line.length > 0) {
        yield line;
      }
    }
  };
}
