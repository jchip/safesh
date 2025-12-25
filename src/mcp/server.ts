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
import type { SafeShellConfig } from "../core/types.ts";

// Tool schemas
const ExecSchema = z.object({
  code: z.string().describe("JavaScript/TypeScript code to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
});

const RunSchema = z.object({
  command: z.string().describe("External command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  cwd: z.string().optional().describe("Working directory"),
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

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "exec",
          description:
            "Execute JavaScript/TypeScript code in a sandboxed Deno runtime. " +
            "Code runs with configured permissions and has access to Deno APIs.",
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
            },
            required: ["code"],
          },
        },
        {
          name: "run",
          description:
            "Execute a whitelisted external command. " +
            `Available commands: ${registry.list().join(", ") || "(none configured)"}`,
          inputSchema: {
            type: "object",
            properties: {
              command: {
                type: "string",
                description: "External command to run",
              },
              args: {
                type: "array",
                items: { type: "string" },
                description: "Command arguments",
              },
              cwd: {
                type: "string",
                description: "Working directory",
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
          const result = await executeCode(parsed.code, config, {
            timeout: parsed.timeout,
            cwd,
          });

          return {
            content: [
              {
                type: "text",
                text: formatExecResult(result),
              },
            ],
          };
        }

        case "run": {
          const parsed = RunSchema.parse(args);
          const cmdArgs = parsed.args ?? [];
          const workDir = parsed.cwd ?? cwd;

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

          // Execute the command
          const result = await runCommand(
            parsed.command,
            cmdArgs,
            workDir,
            config,
          );

          return {
            content: [
              {
                type: "text",
                text: formatExecResult(result),
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
 * Run an external command
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  _config: SafeShellConfig,
): Promise<{ stdout: string; stderr: string; code: number; success: boolean }> {
  const cmd = new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  const decoder = new TextDecoder();

  return {
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
    code: output.code,
    success: output.code === 0,
  };
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
