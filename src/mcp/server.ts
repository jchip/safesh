/**
 * SafeShell MCP Server
 *
 * Exposes SafeShell capabilities as MCP tools:
 * - run: Execute JS/TS code (scripts) in sandboxed Deno runtime
 * - startShell: Create a new persistent shell
 * - endShell: Destroy a shell
 * - updateShell: Modify shell state (cwd, env)
 * - listShells: List active shells
 * - listScripts, getScriptOutput, waitScript: Script management
 * - killJob: Kill a spawned process
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
  launchCodeScript,
  getScriptOutput,
  killScript,
} from "../runtime/scripts.ts";
import { runTask, listTasks } from "../runner/tasks.ts";

// Tool schemas
const RunSchema = z.object({
  code: z.string().describe("JavaScript/TypeScript code to execute"),
  shellId: z.string().optional().describe("Shell ID to use"),
  background: z.boolean().optional().describe("Run in background (async), returns { scriptId, pid }"),
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

// Script management schemas (SSH-90)
const ListScriptsSchema = z.object({
  shellId: z.string().describe("Shell ID to list scripts from"),
  filter: z.object({
    status: z.enum(["running", "completed", "failed"]).optional(),
    background: z.boolean().optional(),
    limit: z.number().optional(),
  }).optional().describe("Optional filter criteria"),
});

const GetScriptOutputSchema = z.object({
  shellId: z.string().describe("Shell ID"),
  scriptId: z.string().describe("Script ID"),
  since: z.number().optional().describe("Byte offset to start from"),
});

const WaitScriptSchema = z.object({
  shellId: z.string().describe("Shell ID"),
  scriptId: z.string().describe("Script ID to wait for"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
});

const ListJobsSchema = z.object({
  shellId: z.string().describe("Shell ID to list jobs from"),
  filter: z.object({
    scriptId: z.string().optional().describe("Filter by parent script ID"),
    status: z.enum(["running", "completed", "failed"]).optional(),
    limit: z.number().optional(),
  }).optional().describe("Optional filter criteria"),
});

// Job (process) management - for killing spawned processes
const KillJobSchema = z.object({
  shellId: z.string().describe("Shell ID"),
  scriptId: z.string().describe("Script ID containing the process"),
  signal: z.string().optional().describe("Signal to send (default: SIGTERM)"),
});

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
          name: "run",
          description:
            "Run JavaScript/TypeScript code (script) in a sandboxed Deno runtime - MCPU usage: infoc\n\n" +
            "Use shellId for persistent state between calls. " +
            "Set background: true to run asynchronously (returns { scriptId, pid }).\n" +
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
                description: "Shell ID for persistent state (env, cwd, vars). Required for background scripts.",
              },
              background: {
                type: "boolean",
                description: "Run in background (default: false). Returns { scriptId, pid } instead of waiting for completion.",
              },
              timeout: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000). Ignored for background scripts.",
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
        // Script management tools (SSH-90)
        {
          name: "listScripts",
          description:
            "List scripts (code executions) in a shell with optional filtering. " +
            "Returns scripts sorted by start time (newest first).",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID to list scripts from",
              },
              filter: {
                type: "object",
                properties: {
                  status: {
                    type: "string",
                    enum: ["running", "completed", "failed"],
                    description: "Filter by script status",
                  },
                  background: {
                    type: "boolean",
                    description: "Filter by background/foreground scripts",
                  },
                  limit: {
                    type: "number",
                    description: "Maximum number of scripts to return",
                  },
                },
                description: "Optional filter criteria",
              },
            },
            required: ["shellId"],
          },
        },
        {
          name: "getScriptOutput",
          description:
            "Get buffered output from a script. " +
            "Supports incremental reads via 'since' offset.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID containing the script",
              },
              scriptId: {
                type: "string",
                description: "Script ID to get output from",
              },
              since: {
                type: "number",
                description: "Byte offset to start reading from (for incremental reads)",
              },
            },
            required: ["shellId", "scriptId"],
          },
        },
        {
          name: "killScript",
          description:
            "Kill a running script by sending a signal. " +
            "Default signal is SIGTERM. Use SIGKILL for force kill.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID containing the script",
              },
              scriptId: {
                type: "string",
                description: "Script ID to kill",
              },
              signal: {
                type: "string",
                description: "Signal to send (SIGTERM, SIGKILL, etc.)",
              },
            },
            required: ["shellId", "scriptId"],
          },
        },
        {
          name: "waitScript",
          description:
            "Wait for a background script to complete. " +
            "Returns the script output and exit status when done.",
          inputSchema: {
            type: "object",
            properties: {
              shellId: {
                type: "string",
                description: "Shell ID containing the script",
              },
              scriptId: {
                type: "string",
                description: "Script ID to wait for",
              },
              timeout: {
                type: "number",
                description: "Maximum time to wait in milliseconds",
              },
            },
            required: ["shellId", "scriptId"],
          },
        },
        // Job listing (SSH-91)
        {
          name: "listJobs",
          description:
            "List jobs (spawned processes) in a shell. " +
            "Jobs are child processes created by scripts via cmd(), git(), docker(), etc. " +
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
                  scriptId: {
                    type: "string",
                    description: "Filter by parent script ID",
                  },
                  status: {
                    type: "string",
                    enum: ["running", "completed", "failed"],
                    description: "Filter by job status",
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
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "run": {
          const parsed = RunSchema.parse(args);

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

          // Background execution: launch script and return immediately
          if (parsed.background) {
            const script = await launchCodeScript(parsed.code, config, shell);
            // Restore original env
            shell.env = originalEnv;

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    scriptId: script.id,
                    pid: script.pid,
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
                text: formatRunResult(result, parsed.shellId, result.scriptId),
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

        // Script management tools (SSH-90)
        case "listScripts": {
          const parsed = ListScriptsSchema.parse(args);
          const scripts = shellManager.listScripts(parsed.shellId, parsed.filter);

          if (scripts.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No scripts found",
                },
              ],
            };
          }

          // Serialize scripts (newest first, already sorted by listScripts)
          const serialized = scripts.map((s) => ({
            id: s.id,
            code: s.code.length > 100 ? `${s.code.slice(0, 100)}...` : s.code,
            pid: s.pid,
            status: s.status,
            background: s.background,
            startedAt: s.startedAt.toISOString(),
            duration: s.duration,
            exitCode: s.exitCode,
            jobIds: s.jobIds,
            truncated: {
              stdout: s.stdoutTruncated,
              stderr: s.stderrTruncated,
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

        case "getScriptOutput": {
          const parsed = GetScriptOutputSchema.parse(args);
          const script = shellManager.getScript(parsed.shellId, parsed.scriptId);

          if (!script) {
            return {
              content: [
                {
                  type: "text",
                  text: `Script not found: ${parsed.scriptId}`,
                },
              ],
              isError: true,
            };
          }

          const output = getScriptOutput(script, parsed.since);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  scriptId: script.id,
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

        case "killScript": {
          const parsed = KillJobSchema.parse(args);
          const script = shellManager.getScript(parsed.shellId, parsed.scriptId);

          if (!script) {
            return {
              content: [
                {
                  type: "text",
                  text: `Script not found: ${parsed.scriptId}`,
                },
              ],
              isError: true,
            };
          }

          const signal = (parsed.signal ?? "SIGTERM") as Deno.Signal;
          await killScript(script, signal);

          return {
            content: [
              {
                type: "text",
                text: `Script ${parsed.scriptId} killed with ${signal}`,
              },
            ],
          };
        }

        case "waitScript": {
          const parsed = WaitScriptSchema.parse(args);
          const script = shellManager.getScript(parsed.shellId, parsed.scriptId);

          if (!script) {
            return {
              content: [
                {
                  type: "text",
                  text: `Script not found: ${parsed.scriptId}`,
                },
              ],
              isError: true,
            };
          }

          if (script.status !== "running") {
            // Script already completed
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    scriptId: script.id,
                    status: script.status,
                    stdout: script.stdout,
                    stderr: script.stderr,
                    exitCode: script.exitCode,
                    duration: script.duration,
                    truncated: {
                      stdout: script.stdoutTruncated,
                      stderr: script.stderrTruncated,
                    },
                  }, null, 2),
                },
              ],
              isError: script.status === "failed",
            };
          }

          // Wait for script completion with optional timeout
          const startTime = Date.now();
          const timeoutMs = parsed.timeout ?? 30000;

          while (script.status === "running") {
            if (Date.now() - startTime > timeoutMs) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Timeout waiting for script ${parsed.scriptId}`,
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
                  scriptId: script.id,
                  status: script.status,
                  stdout: script.stdout,
                  stderr: script.stderr,
                  exitCode: script.exitCode,
                  duration: script.duration,
                  truncated: {
                    stdout: script.stdoutTruncated,
                    stderr: script.stderrTruncated,
                  },
                }, null, 2),
              },
            ],
            isError: script.status === "failed",
          };
        }

        case "listJobs": {
          const parsed = ListJobsSchema.parse(args);
          const jobs = shellManager.listJobs(parsed.shellId, parsed.filter);

          // Serialize jobs (newest first, already sorted by listJobs)
          const serialized = jobs.map((job) => ({
            id: job.id,
            scriptId: job.scriptId,
            command: job.command,
            args: job.args,
            pid: job.pid,
            status: job.status,
            exitCode: job.exitCode,
            startedAt: job.startedAt.toISOString(),
            completedAt: job.completedAt?.toISOString(),
            duration: job.duration,
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

  /**
   * Format run result for MCP response
   */
  function formatRunResult(
    result: {
      stdout: string;
      stderr: string;
      code: number;
      success: boolean;
    },
    shellId?: string,
    scriptId?: string,
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
    if (scriptId) meta.push(`script: ${scriptId}`);
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

  return server;
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
