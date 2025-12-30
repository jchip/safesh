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
import { collectStreamBytes } from "../core/utils.ts";

// Job tracking marker for communication with main process
const JOB_MARKER = "__SAFESH_JOB__:";

// Command permission error marker for retry workflow
const CMD_ERROR_MARKER = "__SAFESH_CMD_ERROR__:";

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
 * Create a docker command
 *
 * Convenience function for docker commands with optional options.
 *
 * @example
 * ```ts
 * // Simple docker command
 * const result = await docker("ps").exec();
 *
 * // With arguments
 * const result = await docker("run", "-it", "alpine").exec();
 *
 * // With options
 * const result = await docker({ cwd: "/project" }, "compose", "up").exec();
 * ```
 */
export function docker(options: CommandOptions, ...args: string[]): Command;
export function docker(...args: string[]): Command;
export function docker(...args: unknown[]): Command {
  if (
    args.length > 0 &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    const options = args[0] as CommandOptions;
    const dockerArgs = args.slice(1) as string[];
    return new Command("docker", dockerArgs, options);
  } else {
    return new Command("docker", args as string[], {});
  }
}

/**
 * Create a deno command
 *
 * Convenience function for deno commands with optional options.
 *
 * @example
 * ```ts
 * // Simple deno command
 * const result = await deno("--version").exec();
 *
 * // Run a script
 * const result = await deno("run", "script.ts").exec();
 *
 * // With options
 * const result = await deno({ cwd: "/project" }, "task", "build").exec();
 * ```
 */
export function deno(options: CommandOptions, ...args: string[]): Command;
export function deno(...args: string[]): Command;
export function deno(...args: unknown[]): Command {
  if (
    args.length > 0 &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    const options = args[0] as CommandOptions;
    const denoArgs = args.slice(1) as string[];
    return new Command("deno", denoArgs, options);
  } else {
    return new Command("deno", args as string[], {});
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

// ============================================================================
// Project Command Registration
// ============================================================================

/**
 * A registered command that can be executed
 */
export interface RegisteredCommand {
  /** Execute the command with arguments */
  exec(args?: string[]): Promise<CommandResult>;
  /** Execute and stream output */
  stream(args?: string[]): AsyncGenerator<StreamChunk>;
  /** Create a Command for piping */
  cmd(args?: string[]): Command;
  /** The path to the command */
  readonly path: string;
  /** The registered name */
  readonly name: string;
}

// Init error marker for permission check failures (parsed by executor)
const INIT_ERROR_MARKER = "__SAFESH_INIT_ERROR__:";

/**
 * Config interface injected by preamble for permission checking
 */
interface PreambleConfig {
  projectDir?: string;
  allowProjectCommands?: boolean;
  allowedCommands: string[];
  cwd: string;
}

// Reference to $config injected by preamble (may not exist in file execution mode)
declare const $config: PreambleConfig | undefined;

/**
 * Check if a command exists at the given path
 */
async function checkCommandExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

/**
 * Check if a command is in the allowed list
 */
function isInAllowedList(command: string, allowedCommands: string[]): boolean {
  return allowedCommands.includes(command);
}

/**
 * Get the basename of a path
 */
function getBasename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/**
 * Resolve a path relative to a directory
 */
function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative;
  // Simple path join
  const basePath = base.endsWith("/") ? base : base + "/";
  return basePath + relative;
}

/**
 * Permission check result
 */
type PermResult =
  | { allowed: true; resolvedPath: string }
  | { allowed: false; error: "COMMAND_NOT_ALLOWED"; command: string }
  | { allowed: false; error: "COMMAND_NOT_FOUND"; command: string };

/**
 * Check permission for a single command using the decision tree
 */
async function checkPermission(
  command: string,
  config: PreambleConfig,
): Promise<PermResult> {
  const { allowedCommands, projectDir, allowProjectCommands, cwd } = config;

  // Is command basic name only (no `/`)?
  if (!command.includes("/")) {
    if (isInAllowedList(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: "COMMAND_NOT_ALLOWED", command };
  }

  // Has `/` - check basename first
  const cmdBasename = getBasename(command);
  if (isInAllowedList(cmdBasename, allowedCommands)) {
    const resolvedPath = command.startsWith("/")
      ? command
      : resolvePath(cwd, command);
    return { allowed: true, resolvedPath };
  }

  // Full path (starts with `/`)? → allowed_check(verbatim)
  if (command.startsWith("/")) {
    if (isInAllowedList(command, allowedCommands)) {
      return { allowed: true, resolvedPath: command };
    }
    return { allowed: false, error: "COMMAND_NOT_ALLOWED", command };
  }

  // Relative path - check CWD first
  const cwdPath = resolvePath(cwd, command);
  if (await checkCommandExists(cwdPath)) {
    if (isInAllowedList(cwdPath, allowedCommands)) {
      return { allowed: true, resolvedPath: cwdPath };
    }
    return { allowed: false, error: "COMMAND_NOT_ALLOWED", command: cwdPath };
  }

  // Check projectDir
  if (projectDir) {
    const projectPath = resolvePath(projectDir, command);
    if (await checkCommandExists(projectPath)) {
      // config allows project cmds? → ALLOWED
      if (allowProjectCommands) {
        return { allowed: true, resolvedPath: projectPath };
      }
      if (isInAllowedList(projectPath, allowedCommands)) {
        return { allowed: true, resolvedPath: projectPath };
      }
      return { allowed: false, error: "COMMAND_NOT_ALLOWED", command: projectPath };
    }
  }

  // Not found
  return { allowed: false, error: "COMMAND_NOT_FOUND", command };
}

/**
 * Initialize commands for convenient access
 *
 * Validates permissions for ALL commands upfront. If any commands are blocked
 * or not found, throws an error with details about ALL failures (not just first).
 *
 * @param commands - Map of command names to paths
 * @param options - Optional command options (cwd, env, etc.)
 * @returns Object with registered command wrappers
 *
 * @example
 * ```ts
 * const commands = await init({
 *   cargo: "cargo",
 *   build: "./scripts/build.sh"
 * });
 *
 * await commands.cargo.exec(["build"]);
 * await commands.build.exec(["--release"]);
 *
 * // Can also get Command for piping
 * const result = await commands.build.cmd(["--json"]).pipe("jq", [".version"]).exec();
 * ```
 */
export async function init<T extends Record<string, string>>(
  commands: T,
  options?: CommandOptions,
): Promise<{ [K in keyof T]: RegisteredCommand }> {
  const result = {} as { [K in keyof T]: RegisteredCommand };

  // Check if $config is available (injected by preamble)
  // Using typeof to avoid ReferenceError if $config doesn't exist
  const config = typeof $config !== "undefined" ? $config : undefined;

  if (config) {
    // Check permissions for all commands upfront
    const notAllowed: string[] = [];
    const notFound: string[] = [];
    const resolvedPaths: Record<string, string> = {};

    const entries = Object.entries(commands);
    const checks = await Promise.all(
      entries.map(async ([name, path]) => {
        const result = await checkPermission(path, config);
        return { name, path, result };
      }),
    );

    for (const { name, path, result: permResult } of checks) {
      if (permResult.allowed) {
        resolvedPaths[name] = permResult.resolvedPath;
      } else if (permResult.error === "COMMAND_NOT_ALLOWED") {
        notAllowed.push(permResult.command);
      } else if (permResult.error === "COMMAND_NOT_FOUND") {
        notFound.push(permResult.command);
      }
    }

    // If any errors, emit marker and throw
    if (notAllowed.length > 0 || notFound.length > 0) {
      const errorEvent = {
        type: "COMMANDS_BLOCKED",
        notAllowed,
        notFound,
      };
      console.error(`${INIT_ERROR_MARKER}${JSON.stringify(errorEvent)}`);

      const errors: string[] = [];
      if (notAllowed.length > 0) {
        errors.push(`Commands not allowed: ${notAllowed.join(", ")}`);
      }
      if (notFound.length > 0) {
        errors.push(`Commands not found: ${notFound.join(", ")}`);
      }
      throw new Error(errors.join(". "));
    }

    // All permissions passed - create wrappers with resolved paths
    for (const [name, path] of entries) {
      const resolvedPath = resolvedPaths[name] ?? path;
      (result as Record<string, RegisteredCommand>)[name] = {
        name,
        path: resolvedPath,
        exec: async (args: string[] = []) => {
          return await new Command(resolvedPath, args, options).exec();
        },
        stream: (args: string[] = []) => {
          return new Command(resolvedPath, args, options).stream();
        },
        cmd: (args: string[] = []) => {
          return new Command(resolvedPath, args, options);
        },
      };
    }
  } else {
    // No config available (file execution mode) - create wrappers without permission check
    // Permissions will be enforced by Deno sandbox at execution time
    for (const [name, path] of Object.entries(commands)) {
      (result as Record<string, RegisteredCommand>)[name] = {
        name,
        path,
        exec: async (args: string[] = []) => {
          return await new Command(path, args, options).exec();
        },
        stream: (args: string[] = []) => {
          return new Command(path, args, options).stream();
        },
        cmd: (args: string[] = []) => {
          return new Command(path, args, options);
        },
      };
    }
  }

  return result;
}

/**
 * Simple command callable - just call it with args
 */
export type CommandFn = (...args: string[]) => Promise<CommandResult>;

/**
 * Initialize commands with a simpler API - returns callable functions
 *
 * @param commands - Map of command names to paths
 * @param options - Optional command options (cwd, env, etc.)
 * @returns Object with callable command functions
 *
 * @example
 * ```ts
 * const cmds = await initCmds({
 *   cargo: "cargo",
 *   build: "./scripts/build.sh"
 * });
 *
 * await cmds.cargo("build", "--release");
 * await cmds.build("--verbose");
 * ```
 */
export async function initCmds<T extends Record<string, string>>(
  commands: T,
  options?: CommandOptions,
): Promise<{ [K in keyof T]: CommandFn }> {
  // Use init() for permission checking
  const registered = await init(commands, options);

  const result = {} as { [K in keyof T]: CommandFn };

  for (const [name, reg] of Object.entries(registered)) {
    (result as Record<string, CommandFn>)[name] = (...args: string[]) => {
      return reg.exec(args);
    };
  }

  return result;
}
