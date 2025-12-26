/**
 * SafeShell MCP Server
 *
 * Exposes SafeShell capabilities as MCP tools:
 * - exec: Execute JS/TS code in sandboxed Deno runtime
 * - run: Execute whitelisted external commands
 * - startSession: Create a new persistent session
 * - endSession: Destroy a session
 * - updateSession: Modify session state (cwd, env)
 * - listSessions: List active sessions
 */

import { Server } from "@mcp/sdk/server/index.js";
import { StdioServerTransport } from "@mcp/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@mcp/sdk/types.js";
import { z } from "zod";
import { executeCode } from "../runtime/executor.ts";
import { createSessionManager, type SessionManager } from "../runtime/session.ts";
import { loadConfig } from "../core/config.ts";
import { createRegistry } from "../external/registry.ts";
import { validateExternal } from "../external/validator.ts";
import { SafeShellError } from "../core/errors.ts";
import type { SafeShellConfig, Session } from "../core/types.ts";
import {
  launchCodeJob,
  launchCommandJob,
  getJobOutput,
  killJob,
  streamJobOutput,
} from "../runtime/jobs.ts";

// Tool schemas
const ExecSchema = z.object({
  code: z.string().describe("JavaScript/TypeScript code to execute"),
  sessionId: z.string().optional().describe("Session ID to use"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

const RunSchema = z.object({
  command: z.string().describe("External command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  sessionId: z.string().optional().describe("Session ID to use"),
  cwd: z.string().optional().describe("Working directory override"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
});

const StartSessionSchema = z.object({
  cwd: z.string().optional().describe("Initial working directory"),
  env: z.record(z.string()).optional().describe("Initial environment variables"),
});

const UpdateSessionSchema = z.object({
  sessionId: z.string().describe("Session ID to update"),
  cwd: z.string().optional().describe("New working directory"),
  env: z.record(z.string()).optional().describe("Environment variables to set/update"),
});

const EndSessionSchema = z.object({
  sessionId: z.string().describe("Session ID to end"),
});

const BgSchema = z.object({
  code: z.string().optional().describe("JS/TS code to run in background"),
  command: z.string().optional().describe("External command to run in background"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  sessionId: z.string().optional().describe("Session ID to use"),
});

const JobsSchema = z.object({
  sessionId: z.string().optional().describe("Filter by session ID"),
});

const JobOutputSchema = z.object({
  jobId: z.string().describe("Job ID"),
  since: z.number().optional().describe("Byte offset to start from"),
});

const KillSchema = z.object({
  jobId: z.string().describe("Job ID to kill"),
  signal: z.string().optional().describe("Signal to send (default: SIGTERM)"),
});

const FgSchema = z.object({
  jobId: z.string().describe("Job ID to bring to foreground"),
});

/**
 * Create and configure the MCP server
 */
export function createServer(config: SafeShellConfig, cwd: string): Server {
  const server = new Server(
    {
      name: "safesh",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const registry = createRegistry(config);
  const sessionManager = createSessionManager(cwd);

  // Build permission summary for tool descriptions
  const perms = config.permissions ?? {};
  const permSummary = [
    perms.read?.length ? `read: ${perms.read.slice(0, 3).join(", ")}${perms.read.length > 3 ? "..." : ""}` : null,
    perms.write?.length ? `write: ${perms.write.slice(0, 3).join(", ")}${perms.write.length > 3 ? "..." : ""}` : null,
    perms.net === true ? "net: all" : (Array.isArray(perms.net) && perms.net.length ? `net: ${perms.net.slice(0, 2).join(", ")}...` : null),
    perms.run?.length ? `run: ${perms.run.slice(0, 3).join(", ")}${perms.run.length > 3 ? "..." : ""}` : null,
  ].filter(Boolean).join("; ");

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "exec",
          description:
            "Execute JavaScript/TypeScript code in a sandboxed Deno runtime. " +
            "Code has access to Deno APIs and auto-imported: fs (file ops), text (processing), $ (shell). " +
            "Use sessionId for persistent state between calls. " +
            (permSummary ? `Permissions: ${permSummary}` : "No permissions configured."),
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "JavaScript/TypeScript code to execute",
              },
              sessionId: {
                type: "string",
                description: "Session ID for persistent state (env, cwd, vars)",
              },
              timeout: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000)",
              },
              env: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "Additional environment variables to set",
              },
            },
            required: ["code"],
          },
        },
        {
          name: "run",
          description:
            "Execute a whitelisted external command with validation. " +
            "Commands are validated against whitelist and denied flags. " +
            "Path arguments are validated against sandbox. " +
            "Use sessionId to inherit session's cwd and env. " +
            `Available: ${registry.list().join(", ") || "(none configured)"}`,
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "External command to run (must be whitelisted)",
              },
              args: {
                type: "array",
                items: { type: "string" },
                description: "Command arguments",
              },
              sessionId: {
                type: "string",
                description: "Session ID for cwd and env",
              },
              cwd: {
                type: "string",
                description: "Working directory override (ignores session)",
              },
              timeout: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000)",
              },
            },
            required: ["command"],
          },
        },
        {
          name: "startSession",
          description:
            "Create a new session for persistent state between exec/run calls. " +
            "Sessions maintain: cwd (working directory), env (environment variables), " +
            "and vars (persisted JS variables accessible via $session).",
          inputSchema: {
            type: "object",
            properties: {
              cwd: {
                type: "string",
                description: "Initial working directory (defaults to project root)",
              },
              env: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "Initial environment variables",
              },
            },
          },
        },
        {
          name: "updateSession",
          description:
            "Update session state: change working directory or set environment variables.",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: {
                type: "string",
                description: "Session ID to update",
              },
              cwd: {
                type: "string",
                description: "New working directory",
              },
              env: {
                type: "object",
                additionalProperties: { type: "string" },
                description: "Environment variables to set/update (merged with existing)",
              },
            },
            required: ["sessionId"],
          },
        },
        {
          name: "endSession",
          description:
            "End a session and clean up resources. Stops any background jobs.",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: {
                type: "string",
                description: "Session ID to end",
              },
            },
            required: ["sessionId"],
          },
        },
        {
          name: "listSessions",
          description:
            "List all active sessions with their current state.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "bg",
          description:
            "Launch a background job (code or external command). " +
            "Jobs run asynchronously and their output is buffered. " +
            "Use jobs() to list, jobOutput() to get buffered output, " +
            "fg() to stream output, or kill() to stop.",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "JS/TS code to run in background (exclusive with command)",
              },
              command: {
                type: "string",
                description: "External command to run (exclusive with code)",
              },
              args: {
                type: "array",
                items: { type: "string" },
                description: "Command arguments",
              },
              sessionId: {
                type: "string",
                description: "Session ID for cwd/env context",
              },
            },
          },
        },
        {
          name: "jobs",
          description:
            "List all running background jobs with their status and basic info.",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: {
                type: "string",
                description: "Filter jobs by session ID",
              },
            },
          },
        },
        {
          name: "jobOutput",
          description:
            "Get buffered output from a background job. " +
            "Returns stdout and stderr captured since job started (or since offset).",
          inputSchema: {
            type: "object",
            properties: {
              jobId: {
                type: "string",
                description: "Job ID to get output from",
              },
              since: {
                type: "number",
                description: "Byte offset to start reading from (for incremental reads)",
              },
            },
            required: ["jobId"],
          },
        },
        {
          name: "kill",
          description:
            "Stop a background job by sending a signal. " +
            "Default signal is SIGTERM. Use SIGKILL for force kill.",
          inputSchema: {
            type: "object",
            properties: {
              jobId: {
                type: "string",
                description: "Job ID to kill",
              },
              signal: {
                type: "string",
                description: "Signal to send (SIGTERM, SIGKILL, etc.)",
              },
            },
            required: ["jobId"],
          },
        },
        {
          name: "fg",
          description:
            "Bring a background job to foreground by streaming its output. " +
            "Returns an async stream of stdout/stderr chunks and exit code.",
          inputSchema: {
            type: "object",
            properties: {
              jobId: {
                type: "string",
                description: "Job ID to bring to foreground",
              },
            },
            required: ["jobId"],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "exec": {
          const parsed = ExecSchema.parse(args);

          // Get or create session
          const { session, isTemporary } = sessionManager.getOrTemp(
            parsed.sessionId,
            { cwd, env: parsed.env },
          );

          // Merge additional env vars
          const sessionEnv = parsed.env
            ? { ...session.env, ...parsed.env }
            : session.env;

          const execSession: Session = { ...session, env: sessionEnv };

          const result = await executeCode(
            parsed.code,
            config,
            { timeout: parsed.timeout, cwd: session.cwd },
            execSession,
          );

          // Update session vars if not temporary
          if (!isTemporary && result.success && execSession.vars) {
            sessionManager.update(session.id, { vars: execSession.vars });
          }

          return {
            content: [
              {
                type: "text",
                text: formatExecResult(result, parsed.sessionId),
              },
            ],
            isError: !result.success,
          };
        }

        case "run": {
          const parsed = RunSchema.parse(args);
          const cmdArgs = parsed.args ?? [];

          // Get session for cwd/env
          const { session } = sessionManager.getOrTemp(parsed.sessionId, { cwd });

          // Working directory: explicit > session > default
          const workDir = parsed.cwd ?? session.cwd;
          const timeoutMs = parsed.timeout ?? config.timeout ?? 30000;

          // Validate command before execution
          const validation = await validateExternal(
            parsed.command,
            cmdArgs,
            registry,
            config,
            workDir,
          );

          if (!validation.valid) {
            return {
              content: [
                {
                  type: "text",
                  text: formatError(validation.error!),
                },
              ],
              isError: true,
            };
          }

          // Execute the command with session env
          const result = await runCommand(
            parsed.command,
            cmdArgs,
            workDir,
            timeoutMs,
            session.env,
          );

          return {
            content: [
              {
                type: "text",
                text: formatRunResult(parsed.command, cmdArgs, result),
              },
            ],
            isError: !result.success,
          };
        }

        case "startSession": {
          const parsed = StartSessionSchema.parse(args);
          const session = sessionManager.create({
            cwd: parsed.cwd,
            env: parsed.env,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(sessionManager.serialize(session), null, 2),
              },
            ],
          };
        }

        case "updateSession": {
          const parsed = UpdateSessionSchema.parse(args);
          const session = sessionManager.update(parsed.sessionId, {
            cwd: parsed.cwd,
            env: parsed.env,
          });

          if (!session) {
            return {
              content: [
                {
                  type: "text",
                  text: `Session not found: ${parsed.sessionId}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(sessionManager.serialize(session), null, 2),
              },
            ],
          };
        }

        case "endSession": {
          const parsed = EndSessionSchema.parse(args);
          const ended = sessionManager.end(parsed.sessionId);

          if (!ended) {
            return {
              content: [
                {
                  type: "text",
                  text: `Session not found: ${parsed.sessionId}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Session ended: ${parsed.sessionId}`,
              },
            ],
          };
        }

        case "listSessions": {
          const sessions = sessionManager.list();

          if (sessions.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active sessions",
                },
              ],
            };
          }

          const serialized = sessions.map((s) => sessionManager.serialize(s));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(serialized, null, 2),
              },
            ],
          };
        }

        case "bg": {
          const parsed = BgSchema.parse(args);

          // Must provide either code or command (but not both)
          if ((!parsed.code && !parsed.command) || (parsed.code && parsed.command)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Must provide either 'code' or 'command' (but not both)",
                },
              ],
              isError: true,
            };
          }

          // Get or create session
          const { session } = sessionManager.getOrTemp(parsed.sessionId, { cwd });

          let job;
          if (parsed.code) {
            // Launch code job
            job = await launchCodeJob(parsed.code, config, session);
          } else if (parsed.command) {
            // Validate command
            const cmdArgs = parsed.args ?? [];
            const validation = await validateExternal(
              parsed.command,
              cmdArgs,
              registry,
              config,
              session.cwd,
            );

            if (!validation.valid) {
              return {
                content: [
                  {
                    type: "text",
                    text: formatError(validation.error!),
                  },
                ],
                isError: true,
              };
            }

            // Launch command job
            job = await launchCommandJob(parsed.command, cmdArgs, config, session);
          }

          // Add job to session
          if (job) {
            sessionManager.addJob(session.id, job);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    jobId: job.id,
                    pid: job.pid,
                    sessionId: session.id,
                  }, null, 2),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: "Failed to launch job",
              },
            ],
            isError: true,
          };
        }

        case "jobs": {
          const parsed = JobsSchema.parse(args);

          let allJobs;
          if (parsed.sessionId) {
            // Filter by session
            allJobs = sessionManager.listJobs(parsed.sessionId);
          } else {
            // List all jobs from all sessions
            allJobs = sessionManager.list().flatMap((s) =>
              Array.from(s.jobs.values())
            );
          }

          if (allJobs.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No jobs",
                },
              ],
            };
          }

          // Serialize jobs (exclude process handle)
          const serialized = allJobs.map((j) => ({
            id: j.id,
            pid: j.pid,
            command: j.command,
            code: j.code ? `${j.code.slice(0, 50)}...` : undefined,
            status: j.status,
            startedAt: j.startedAt,
            exitCode: j.exitCode,
            stdoutLength: j.stdout.length,
            stderrLength: j.stderr.length,
          }));

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(serialized, null, 2),
              },
            ],
          };
        }

        case "jobOutput": {
          const parsed = JobOutputSchema.parse(args);

          // Find job across all sessions
          let job;
          for (const session of sessionManager.list()) {
            job = session.jobs.get(parsed.jobId);
            if (job) break;
          }

          if (!job) {
            return {
              content: [
                {
                  type: "text",
                  text: `Job not found: ${parsed.jobId}`,
                },
              ],
              isError: true,
            };
          }

          const output = getJobOutput(job, parsed.since);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  jobId: job.id,
                  status: job.status,
                  stdout: output.stdout,
                  stderr: output.stderr,
                  offset: output.offset,
                  exitCode: job.exitCode,
                }, null, 2),
              },
            ],
          };
        }

        case "kill": {
          const parsed = KillSchema.parse(args);

          // Find job across all sessions
          let job;
          for (const session of sessionManager.list()) {
            job = session.jobs.get(parsed.jobId);
            if (job) break;
          }

          if (!job) {
            return {
              content: [
                {
                  type: "text",
                  text: `Job not found: ${parsed.jobId}`,
                },
              ],
              isError: true,
            };
          }

          // Parse signal
          const signal = (parsed.signal ?? "SIGTERM") as Deno.Signal;

          await killJob(job, signal);

          return {
            content: [
              {
                type: "text",
                text: `Job ${parsed.jobId} killed with ${signal}`,
              },
            ],
          };
        }

        case "fg": {
          const parsed = FgSchema.parse(args);

          // Find job across all sessions
          let job;
          for (const session of sessionManager.list()) {
            job = session.jobs.get(parsed.jobId);
            if (job) break;
          }

          if (!job) {
            return {
              content: [
                {
                  type: "text",
                  text: `Job not found: ${parsed.jobId}`,
                },
              ],
              isError: true,
            };
          }

          // Stream job output
          let output = "";
          for await (const chunk of streamJobOutput(job)) {
            if (chunk.type === "stdout" || chunk.type === "stderr") {
              output += chunk.data ?? "";
            } else if (chunk.type === "exit") {
              output += `\n[exit code: ${chunk.code}]`;
            }
          }

          return {
            content: [
              {
                type: "text",
                text: output || "(no output)",
              },
            ],
            isError: job.status === "failed",
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      // Handle SafeShellError with full formatting
      if (error instanceof SafeShellError) {
        return {
          content: [
            {
              type: "text",
              text: formatError(error),
            },
          ],
          isError: true,
        };
      }

      // Handle other errors
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run an external command with timeout
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number; success: boolean }> {
  // Merge session env with process env
  const processEnv = { ...Deno.env.toObject(), ...env };

  const cmd = new Deno.Command(command, {
    args,
    cwd,
    env: processEnv,
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const decoder = new TextDecoder();

  // Create timeout abort controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Collect output with timeout
    const outputPromise = (async () => {
      const [status, stdoutData, stderrData] = await Promise.all([
        process.status,
        collectOutput(process.stdout),
        collectOutput(process.stderr),
      ]);
      return { status, stdout: stdoutData, stderr: stderrData };
    })();

    // Race against timeout
    const result = await Promise.race([
      outputPromise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
        });
      }),
    ]);

    clearTimeout(timeoutId);

    return {
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
      code: result.status.code,
      success: result.status.code === 0,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Kill the process on timeout
    try {
      process.kill("SIGKILL");
    } catch {
      // Process may have already exited
    }

    throw error;
  }
}

/**
 * Collect stream output into Uint8Array
 */
async function collectOutput(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

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
 * Format execution result for MCP response
 */
function formatExecResult(
  result: {
    stdout: string;
    stderr: string;
    code: number;
    success: boolean;
  },
  sessionId?: string,
): string {
  const parts: string[] = [];

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    parts.push(`[stderr]\n${result.stderr}`);
  }

  if (!result.success) {
    parts.push(`[exit code: ${result.code}]`);
  }

  if (sessionId) {
    parts.push(`[session: ${sessionId}]`);
  }

  return parts.join("\n") || "(no output)";
}

/**
 * Format run command result with command info
 */
function formatRunResult(
  command: string,
  args: string[],
  result: { stdout: string; stderr: string; code: number; success: boolean },
): string {
  const parts: string[] = [];

  // Show command that was run
  const cmdLine = args.length > 0 ? `${command} ${args.join(" ")}` : command;
  parts.push(`$ ${cmdLine}`);
  parts.push("");

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    parts.push(`[stderr]\n${result.stderr}`);
  }

  if (!result.success) {
    parts.push(`\n[exit code: ${result.code}]`);
  }

  return parts.join("\n") || "(no output)";
}

/**
 * Format error for MCP response
 */
function formatError(error: {
  code: string;
  message: string;
  suggestion?: string;
}): string {
  let text = `Error [${error.code}]: ${error.message}`;
  if (error.suggestion) {
    text += `\n\nSuggestion: ${error.suggestion}`;
  }
  return text;
}

/**
 * Main entry point
 */
async function main() {
  // Load configuration
  const cwd = Deno.cwd();
  const config = await loadConfig(cwd);

  // Create server
  const server = createServer(config, cwd);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup (to stderr to not interfere with MCP protocol)
  console.error("SafeShell MCP Server started");
}

// Run if this is the main module
if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to start server:", error);
    Deno.exit(1);
  });
}

export { main };
