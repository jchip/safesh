/**
 * SafeShell MCP Server
 *
 * Exposes SafeShell capabilities as MCP tools:
 * - exec: Execute JS/TS code in sandboxed Deno runtime
 * - run: Execute whitelisted external commands
 */

import { Server } from "@mcp/sdk/server/index.js";
import { StdioServerTransport } from "@mcp/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@mcp/sdk/types.js";
import { z } from "zod";
import { executeCode } from "../runtime/executor.ts";
import { loadConfig } from "../core/config.ts";
import { createRegistry } from "../external/registry.ts";
import { validateExternal } from "../external/validator.ts";
import { SafeShellError } from "../core/errors.ts";
import type { SafeShellConfig } from "../core/types.ts";

// Tool schemas
const ExecSchema = z.object({
  code: z.string().describe("JavaScript/TypeScript code to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

const RunSchema = z.object({
  command: z.string().describe("External command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  cwd: z.string().optional().describe("Working directory"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
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
            (permSummary ? `Permissions: ${permSummary}` : "No permissions configured."),
          inputSchema: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "JavaScript/TypeScript code to execute",
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
              cwd: {
                type: "string",
                description: "Working directory (defaults to project root)",
              },
              timeout: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000)",
              },
            },
            required: ["command"],
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

          // Create a temporary session if env vars provided
          const session = parsed.env
            ? {
                id: crypto.randomUUID(),
                cwd,
                env: parsed.env,
                vars: {},
                jobs: new Map(),
                createdAt: new Date(),
              }
            : undefined;

          const result = await executeCode(
            parsed.code,
            config,
            { timeout: parsed.timeout, cwd },
            session,
          );

          return {
            content: [
              {
                type: "text",
                text: formatExecResult(result),
              },
            ],
            isError: !result.success,
          };
        }

        case "run": {
          const parsed = RunSchema.parse(args);
          const cmdArgs = parsed.args ?? [];
          const workDir = parsed.cwd ?? cwd;
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

          // Execute the command with timeout
          const result = await runCommand(
            parsed.command,
            cmdArgs,
            workDir,
            timeoutMs,
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
): Promise<{ stdout: string; stderr: string; code: number; success: boolean }> {
  const cmd = new Deno.Command(command, {
    args,
    cwd,
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
function formatExecResult(result: {
  stdout: string;
  stderr: string;
  code: number;
  success: boolean;
}): string {
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
