/**
 * SafeShell MCP Server
 *
 * Exposes SafeShell capabilities as MCP tools:
 * - exec: Execute JS/TS code in sandboxed Deno runtime with streaming shell API
 * - startShell: Create a new persistent shell
 * - endShell: Destroy a shell
 * - updateShell: Modify shell state (cwd, env)
 * - listShells: List active shells
 * - bg, jobs, jobOutput, kill, fg: Background job management
 * - task: Execute configured tasks
 */

import { Server } from "@mcp/sdk/server/index.js";
import { StdioServerTransport } from "@mcp/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@mcp/sdk/types.js";
import { z } from "zod";
import { executeCode } from "../runtime/executor.ts";
import { createShellManager, type ShellManager } from "../runtime/shell.ts";
import { loadConfig } from "../core/config.ts";
import { createRegistry } from "../external/registry.ts";
import { validateExternal } from "../external/validator.ts";
import { SafeShellError } from "../core/errors.ts";
import type { SafeShellConfig, Shell } from "../core/types.ts";
import {
  launchCodeJob,
  launchCommandJob,
  getJobOutput,
  killJob,
  streamJobOutput,
} from "../runtime/jobs.ts";
import { runTask, listTasks } from "../runner/tasks.ts";

// Tool schemas
const ExecSchema = z.object({
  code: z.string().describe("JavaScript/TypeScript code to execute"),
  shellId: z.string().optional().describe("Shell ID to use"),
  background: z.boolean().optional().describe("Run in background (async), returns { jobId, pid }"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

const StartShellSchema = z.object({
  cwd: z.string().optional().describe("Initial working directory"),
  env: z.record(z.string()).optional().describe("Initial environment variables"),
});

const UpdateShellSchema = z.object({
  shellId: z.string().describe("Shell ID to update"),
  cwd: z.string().optional().describe("New working directory"),
  env: z.record(z.string()).optional().describe("Environment variables to set/update"),
});

const EndShellSchema = z.object({
  shellId: z.string().describe("Shell ID to end"),
});

// REMOVED: BgSchema (SSH-64) - Use exec with background:true instead

// New job management schemas (SSH-61/62)
const ListJobsSchema = z.object({
  shellId: z.string().describe("Shell ID to list jobs from"),
  filter: z.object({
    status: z.enum(["running", "completed", "failed"]).optional(),
    background: z.boolean().optional(),
    limit: z.number().optional(),
  }).optional().describe("Optional filter criteria"),
});

const GetJobOutputSchema = z.object({
  shellId: z.string().describe("Shell ID"),
  jobId: z.string().describe("Job ID"),
  since: z.number().optional().describe("Byte offset to start from"),
});

const KillJobSchema = z.object({
  shellId: z.string().describe("Shell ID"),
  jobId: z.string().describe("Job ID to kill"),
  signal: z.string().optional().describe("Signal to send (default: SIGTERM)"),
});

const WaitJobSchema = z.object({
  shellId: z.string().describe("Shell ID"),
  jobId: z.string().describe("Job ID to wait for"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
});

// REMOVED: JobsSchema, JobOutputSchema, KillSchema, FgSchema (SSH-64)
// Legacy tools replaced by shell-based versions

const TaskSchema = z.object({
  name: z.string().describe("Task name from config"),
  shellId: z.string().optional().describe("Shell ID for persistent state"),
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
  const shellManager = createShellManager(cwd);

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
            "Execute JavaScript/TypeScript code in a sandboxed Deno runtime - MCPU usage: infoc\n\n" +
            "Use shellId for persistent state between calls. " +
            "Set background: true to run asynchronously (returns { jobId, pid }).\n" +
            (permSummary ? `Permissions: ${permSummary}` : "No permissions configured.") +
            "\n\nIMPORTANT: Do NOT use shell pipes (|, >, etc). Use TypeScript streaming instead.\n" +
            "❌ BAD: cmd('sh', ['-c', 'git log | grep ERROR'])\n" +
            "✅ GOOD: git('log').stdout().pipe(lines()).pipe(grep(/ERROR/)).collect()\n\n" +
            "AUTO-IMPORTED FUNCTIONS:\n" +
            "• fs: read, write, readJson, writeJson, exists, copy, remove, readDir, walk\n" +
            "• text: read, grep, head, tail, wc\n" +
            "• Streaming: cat, glob, src, dest, lines, grep, filter, map, flatMap, take, stdout, stderr, tee, pipe, collect, forEach, count\n" +
            "• Commands: git, docker, deno, cmd - each returns Command with .exec(), .stdout(), .stderr()\n\n" +
            "STREAMING EXAMPLES:\n" +
            "await cat('file.log').pipe(lines()).pipe(grep(/ERROR/)).collect()\n" +
            "await glob('**/*.ts').pipe(filter(f => !f.path.includes('test'))).count()\n" +
            "await git('log', '--oneline').stdout().pipe(lines()).pipe(take(10)).collect()",
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "JavaScript/TypeScript code to execute. " +
                  "Example streaming: await cat('file.txt').pipe(lines()).pipe(grep(/ERROR/)).collect()",
              },
              shellId: {
                type: "string",
                description: "Shell ID for persistent state (env, cwd, vars). Required for background jobs.",
              },
              background: {
                type: "boolean",
                description: "Run in background (default: false). Returns { jobId, pid } instead of waiting for completion.",
              },
              timeout: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000). Ignored for background jobs.",
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
          name: "startShell",
          description:
            "Create a new shell for persistent state between exec calls. " +
            "Shells maintain: cwd (working directory), env (environment variables), " +
            "and vars (persisted JS variables accessible via $shell).",
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
          name: "updateShell",
          description:
            "Update shell state: change working directory or set environment variables.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID to update",
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
            required: ["shellId"],
          },
        },
        {
          name: "endShell",
          description:
            "End a shell and clean up resources. Stops any background jobs.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID to end",
              },
            },
            required: ["shellId"],
          },
        },
        {
          name: "listShells",
          description:
            "List all active shells with their current state.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        // REMOVED: bg, jobs, jobOutput, kill, fg (SSH-64)
        // Use: exec(background:true), listJobs, getJobOutput, killJob, waitJob instead
        {
          name: "task",
          description:
            "Execute a task defined in config. " +
            "Tasks can be simple commands (cmd), parallel execution (parallel), " +
            "or serial execution (serial). Supports task references (string aliases). " +
            `Available tasks: ${Object.keys(config.tasks ?? {}).join(", ") || "(none configured)"}`,
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Task name from config.tasks",
              },
              shellId: {
                type: "string",
                description: "Shell ID for persistent state and cwd/env context",
              },
            },
            required: ["name"],
          },
        },
        // New job management tools (SSH-61/62)
        {
          name: "listJobs",
          description:
            "List jobs in a shell with optional filtering. " +
            "Returns jobs sorted by start time (newest first).",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID to list jobs from",
              },
              filter: {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    enum: ["running", "completed", "failed"],
                    description: "Filter by job status",
                  },
                  background: {
                    type: "boolean",
                    description: "Filter by background/foreground jobs",
                  },
                  limit: {
                    type: "number",
                    description: "Maximum number of jobs to return",
                  },
                },
                description: "Optional filter criteria",
              },
            },
            required: ["shellId"],
          },
        },
        {
          name: "getJobOutput",
          description:
            "Get buffered output from a job. " +
            "Supports incremental reads via 'since' offset.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID containing the job",
              },
              jobId: {
                type: "string",
                description: "Job ID to get output from",
              },
              since: {
                type: "number",
                description: "Byte offset to start reading from (for incremental reads)",
              },
            },
            required: ["shellId", "jobId"],
          },
        },
        {
          name: "killJob",
          description:
            "Kill a running job by sending a signal. " +
            "Default signal is SIGTERM. Use SIGKILL for force kill.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID containing the job",
              },
              jobId: {
                type: "string",
                description: "Job ID to kill",
              },
              signal: {
                type: "string",
                description: "Signal to send (SIGTERM, SIGKILL, etc.)",
              },
            },
            required: ["shellId", "jobId"],
          },
        },
        {
          name: "waitJob",
          description:
            "Wait for a background job to complete. " +
            "Returns the job output and exit status when done.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID containing the job",
              },
              jobId: {
                type: "string",
                description: "Job ID to wait for",
              },
              timeout: {
                type: "number",
                description: "Maximum time to wait in milliseconds",
              },
            },
            required: ["shellId", "jobId"],
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

          // Background execution requires a shell
          if (parsed.background && !parsed.shellId) {
            return {
              content: [
                {
                  type: "text",
                  text: "shellId is required for background execution",
                },
              ],
              isError: true,
            };
          }

          // Get or create shell
          const { shell, isTemporary } = shellManager.getOrTemp(
            parsed.shellId,
            { cwd, env: parsed.env },
          );

          // Merge additional env vars into the actual shell temporarily
          const originalEnv = shell.env;
          if (parsed.env) {
            shell.env = { ...shell.env, ...parsed.env };
          }

          // Background execution: launch job and return immediately
          if (parsed.background) {
            const job = await launchCodeJob(parsed.code, config, shell);
            // Restore original env
            shell.env = originalEnv;

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    jobId: job.id,
                    pid: job.pid,
                    shellId: shell.id,
                    background: true,
                  }, null, 2),
                },
              ],
            };
          }

          // Foreground execution: wait for completion
          const result = await executeCode(
            parsed.code,
            config,
            { timeout: parsed.timeout, cwd: shell.cwd },
            shell,
          );

          // Restore original env
          shell.env = originalEnv;

          // Update shell vars if not temporary
          if (!isTemporary && result.success && shell.vars) {
            shellManager.update(shell.id, { vars: shell.vars });
          }

          return {
            content: [
              {
                type: "text",
                text: formatExecResult(result, parsed.shellId, result.jobId),
              },
            ],
            isError: !result.success,
          };
        }

        case "startShell": {
          const parsed = StartShellSchema.parse(args);
          const shell = shellManager.create({
            cwd: parsed.cwd,
            env: parsed.env,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(shellManager.serialize(shell), null, 2),
              },
            ],
          };
        }

        case "updateShell": {
          const parsed = UpdateShellSchema.parse(args);
          const shell = shellManager.update(parsed.shellId, {
            cwd: parsed.cwd,
            env: parsed.env,
          });

          if (!shell) {
            return {
              content: [
                {
                  type: "text",
                  text: `Shell not found: ${parsed.shellId}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(shellManager.serialize(shell), null, 2),
              },
            ],
          };
        }

        case "endShell": {
          const parsed = EndShellSchema.parse(args);
          const ended = shellManager.end(parsed.shellId);

          if (!ended) {
            return {
              content: [
                {
                  type: "text",
                  text: `Shell not found: ${parsed.shellId}`,
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Shell ended: ${parsed.shellId}`,
              },
            ],
          };
        }

        case "listShells": {
          const shells = shellManager.list();

          if (shells.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active shells",
                },
              ],
            };
          }

          const serialized = shells.map((s) => shellManager.serialize(s));
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(serialized, null, 2),
              },
            ],
          };
        }

        // REMOVED: bg, jobs, jobOutput, kill, fg handlers (SSH-64)
        // Use: exec(background:true), listJobs, getJobOutput, killJob, waitJob instead

        case "task": {
          const parsed = TaskSchema.parse(args);

          // Get shell for context
          const { shell } = shellManager.getOrTemp(parsed.shellId, { cwd });

          try {
            const result = await runTask(parsed.name, config, {
              cwd: shell.cwd,
              shell: shell,
            });

            return {
              content: [
                {
                  type: "text",
                  text: formatTaskResult(parsed.name, result),
                },
              ],
              isError: !result.success,
            };
          } catch (error) {
            // Handle task errors
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
        }

        // New job management tools (SSH-61/62)
        case "listJobs": {
          const parsed = ListJobsSchema.parse(args);
          const jobs = shellManager.listJobs(parsed.shellId, parsed.filter);

          if (jobs.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No jobs found",
                },
              ],
            };
          }

          // Serialize jobs (newest first, already sorted by listJobs)
          const serialized = jobs.map((j) => ({
            id: j.id,
            code: j.code.length > 100 ? `${j.code.slice(0, 100)}...` : j.code,
            pid: j.pid,
            status: j.status,
            background: j.background,
            startedAt: j.startedAt.toISOString(),
            duration: j.duration,
            exitCode: j.exitCode,
            truncated: {
              stdout: j.stdoutTruncated,
              stderr: j.stderrTruncated,
            },
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

        case "getJobOutput": {
          const parsed = GetJobOutputSchema.parse(args);
          const job = shellManager.getJob(parsed.shellId, parsed.jobId);

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
                  status: output.status,
                  stdout: output.stdout,
                  stderr: output.stderr,
                  offset: output.offset,
                  exitCode: output.exitCode,
                  truncated: output.truncated,
                }, null, 2),
              },
            ],
          };
        }

        case "killJob": {
          const parsed = KillJobSchema.parse(args);
          const job = shellManager.getJob(parsed.shellId, parsed.jobId);

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

        case "waitJob": {
          const parsed = WaitJobSchema.parse(args);
          const job = shellManager.getJob(parsed.shellId, parsed.jobId);

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

          if (job.status !== "running") {
            // Job already completed
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    jobId: job.id,
                    status: job.status,
                    stdout: job.stdout,
                    stderr: job.stderr,
                    exitCode: job.exitCode,
                    duration: job.duration,
                    truncated: {
                      stdout: job.stdoutTruncated,
                      stderr: job.stderrTruncated,
                    },
                  }, null, 2),
                },
              ],
              isError: job.status === "failed",
            };
          }

          // Wait for job completion with optional timeout
          const startTime = Date.now();
          const timeoutMs = parsed.timeout ?? 30000;

          while (job.status === "running") {
            if (Date.now() - startTime > timeoutMs) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Timeout waiting for job ${parsed.jobId}`,
                  },
                ],
                isError: true,
              };
            }
            await new Promise((r) => setTimeout(r, 100));
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  jobId: job.id,
                  status: job.status,
                  stdout: job.stdout,
                  stderr: job.stderr,
                  exitCode: job.exitCode,
                  duration: job.duration,
                  truncated: {
                    stdout: job.stdoutTruncated,
                    stderr: job.stderrTruncated,
                  },
                }, null, 2),
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
 * Format execution result for MCP response
 */
function formatExecResult(
  result: {
    stdout: string;
    stderr: string;
    code: number;
    success: boolean;
  },
  shellId?: string,
  jobId?: string,
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

  const meta: string[] = [];
  if (shellId) meta.push(`shell: ${shellId}`);
  if (jobId) meta.push(`job: ${jobId}`);
  if (meta.length > 0) {
    parts.push(`[${meta.join(", ")}]`);
  }

  return parts.join("\n") || "(no output)";
}

/**
 * Format task result for MCP response
 */
function formatTaskResult(
  taskName: string,
  result: { stdout: string; stderr: string; code: number; success: boolean },
): string {
  const parts: string[] = [];

  parts.push(`Task: ${taskName}`);
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
