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
  RootsListChangedNotificationSchema,
} from "@mcp/sdk/types.js";
import { z } from "zod";
import { executeCode, executeFile } from "../runtime/executor.ts";
import { createShellManager, type ShellManager } from "../runtime/shell.ts";
import { closeAllStatePersistence } from "../runtime/state-persistence.ts";
import { loadConfigWithArgs, mergeConfigs, saveToLocalJson, loadConfig, type McpInitArgs } from "../core/config.ts";
import { createRegistry, type CommandRegistry } from "../external/registry.ts";
import { SafeShellError } from "../core/errors.ts";
import type { SafeShellConfig, Shell } from "../core/types.ts";
import {
  ERROR_COMMAND_NOT_ALLOWED,
  ERROR_COMMAND_NOT_FOUND,
  ERROR_COMMANDS_BLOCKED,
} from "../core/constants.ts";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  SCRIPT_POLL_INTERVAL_MS,
  CODE_PREVIEW_LENGTH,
} from "../core/defaults.ts";
import {
  launchCodeScript,
  getScriptOutput,
  killScript,
} from "../runtime/scripts.ts";
import { parseShellCommand } from "../shell/parser.ts";
import {
  createRunToolDescription,
  START_SHELL_DESCRIPTION,
  UPDATE_SHELL_DESCRIPTION,
  END_SHELL_DESCRIPTION,
  LIST_SHELLS_DESCRIPTION,
  LIST_SCRIPTS_DESCRIPTION,
  GET_SCRIPT_OUTPUT_DESCRIPTION,
  KILL_SCRIPT_DESCRIPTION,
  WAIT_SCRIPT_DESCRIPTION,
  LIST_JOBS_DESCRIPTION,
} from "./tool-descriptions.ts";

// ============================================================================
// MCP Response Helpers (SSH-175)
// ============================================================================

/** Standard MCP response type - compatible with MCP SDK CallToolResult */
interface McpResponse {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Create a text MCP response
 */
function mcpTextResponse(text: string, isError = false): McpResponse {
  return { content: [{ type: "text" as const, text }], isError };
}

/**
 * Create a JSON MCP response
 */
function mcpJsonResponse(data: unknown, isError = false): McpResponse {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError };
}

// ============================================================================
// Tool Handler Types (SSH-176)
// ============================================================================

/** Mutable config holder - allows updating config after roots are received */
interface ConfigHolder {
  config: SafeShellConfig;
  cwd: string;
  rootsReceived: boolean;
}

/** Result of retry workflow processing */
interface RetryResult {
  success: true;
  code: string;
  shellId?: string;
  timeout?: number;
  background?: boolean;
  config: SafeShellConfig;
}

/** Error from retry workflow */
interface RetryError {
  success: false;
  response: McpResponse;
}

/** Context passed to tool handlers */
interface ToolContext {
  shellManager: ShellManager;
  getConfig: () => SafeShellConfig;
  getCwd: () => string;
  configHolder: ConfigHolder;
  registry: CommandRegistry;
  updateRegistry: (newRegistry: CommandRegistry) => void;
  rootsPromise: Promise<void>;
  handleRetryWorkflow: (retryId: string, userChoice: number | undefined) => Promise<RetryResult | RetryError>;
  handleFileExecution: (
    file: string,
    shellId: string | undefined,
    env: Record<string, string> | undefined,
    timeout: number | undefined,
    config: SafeShellConfig,
  ) => Promise<McpResponse>;
  formatBlockedCommandResponse: (
    code: string,
    blockedCommand: string,
    shell: Shell,
    env: Record<string, string> | undefined,
    timeout: number | undefined,
    background: boolean | undefined,
    shellId: string | undefined,
  ) => McpResponse;
  formatBlockedCommandsResponse: (
    code: string,
    blockedCommands: string[],
    notFoundCommands: string[],
    shell: Shell,
    env: Record<string, string> | undefined,
    timeout: number | undefined,
    background: boolean | undefined,
    shellId: string | undefined,
  ) => McpResponse;
  formatRunResult: (
    result: { stdout: string; stderr: string; code: number; success: boolean },
    shellId?: string,
    scriptId?: string,
  ) => string;
}

/** Tool handler function signature */
type ToolHandler = (args: unknown, ctx: ToolContext) => Promise<McpResponse>;

// ============================================================================
// MCP Roots Support
// ============================================================================

/** MCP Root from client */
interface McpRoot {
  uri: string;
  name?: string;
}

/**
 * Parse file:// URI to local path
 */
function parseFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) {
    return null;
  }
  // Handle file:///path/to/dir format
  // On Unix: file:///Users/foo -> /Users/foo
  // On Windows: file:///C:/foo -> C:/foo (but we're on Unix)
  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

/**
 * Apply MCP roots to config - updates permissions for root paths
 */
function applyRootsToConfig(
  config: SafeShellConfig,
  roots: McpRoot[],
): { config: SafeShellConfig; projectDir: string | undefined } {
  if (roots.length === 0) {
    return { config, projectDir: undefined };
  }

  // Parse all root URIs to paths
  const rootPaths = roots
    .map((r) => parseFileUri(r.uri))
    .filter((p): p is string => p !== null);

  if (rootPaths.length === 0) {
    return { config, projectDir: undefined };
  }

  // First root is projectDir (primary project)
  const projectDir = rootPaths[0];

  // Add all roots to read/write permissions
  const overrides: SafeShellConfig = {
    projectDir,
    permissions: {
      read: rootPaths,
      write: rootPaths,
    },
  };

  return {
    config: mergeConfigs(config, overrides),
    projectDir,
  };
}

// Tool schemas
const RunSchema = z.object({
  code: z.string().optional().describe("JavaScript/TypeScript code to execute"),
  shcmd: z.string().optional().describe("Shell command to execute (basic syntax: &&, ||, |, 2>&1, >, >>, &)"),
  file: z.string().optional().describe("Path to file - reads content and executes as code"),
  module: z.string().optional().describe("Path to .ts module to execute (supports top-level imports/exports)"),
  shellId: z.string().optional().describe("Shell ID to use"),
  background: z.boolean().optional().describe("Run in background (async), returns { scriptId, pid }"),
  timeout: z.number().optional().describe("Timeout in milliseconds"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
  retry_id: z.string().optional().describe("Retry ID from a previous COMMAND_NOT_ALLOWED error"),
  userChoice: z.number().min(1).max(3).optional().describe("User's permission choice: 1=once, 2=session, 3=always (save to .claude/safesh.local.json)"),
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

// ============================================================================
// Tool Handlers (SSH-176)
// ============================================================================

/**
 * Handle 'run' tool - execute code, shell commands, or files
 */
async function handleRun(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  // Wait for roots to be fetched before executing
  await ctx.rootsPromise;

  const parsed = RunSchema.parse(args);
  console.error(`[run] projectDir: ${ctx.configHolder.config.projectDir ?? "(none)"}, cwd: ${ctx.configHolder.cwd}`);

  // Determine execution context (code, config, shellId, etc.)
  let code: string;
  let shellId: string | undefined = parsed.shellId;
  let execTimeout: number | undefined = parsed.timeout;
  let background: boolean | undefined = parsed.background;
  let execConfig = ctx.configHolder.config;

  // Handle retry workflow
  if (parsed.retry_id) {
    const retryResult = await ctx.handleRetryWorkflow(
      parsed.retry_id,
      parsed.userChoice,
    );
    if (!retryResult.success) {
      return retryResult.response;
    }
    code = retryResult.code;
    shellId = retryResult.shellId;
    execTimeout = retryResult.timeout;
    background = retryResult.background;
    execConfig = retryResult.config;
  } else if (parsed.module) {
    // Module execution - delegate to helper (supports top-level imports/exports)
    return await ctx.handleFileExecution(
      parsed.module,
      shellId,
      parsed.env,
      execTimeout,
      execConfig,
    );
  } else if (parsed.file) {
    // File execution - read content and treat as code
    const cwd = ctx.configHolder.cwd;
    const absolutePath = parsed.file.startsWith("/") ? parsed.file : `${cwd}/${parsed.file}`;
    try {
      code = await Deno.readTextFile(absolutePath);
    } catch (error) {
      return mcpTextResponse(`Failed to read file '${parsed.file}': ${error instanceof Error ? error.message : String(error)}`, true);
    }
  } else if (parsed.shcmd) {
    // Shell command - parse and transpile to TypeScript
    try {
      const parseResult = parseShellCommand(parsed.shcmd);
      code = parseResult.code;
      // background param overrides trailing &
      if (background === undefined) {
        background = parseResult.isBackground;
      }
    } catch (error) {
      return mcpTextResponse(`Shell parse error: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  } else if (parsed.code) {
    code = parsed.code;
  } else {
    return mcpTextResponse("Either 'code', 'shcmd', 'file', 'module', or 'retry_id' must be provided", true);
  }

  // Merge session-level allowed commands into config
  const sessionCommands = ctx.shellManager.getSessionAllowedCommands();
  if (sessionCommands.length > 0) {
    execConfig = mergeConfigs(execConfig, {
      permissions: { run: sessionCommands },
      external: Object.fromEntries(sessionCommands.map((cmd) => [cmd, { allow: true }])),
    });
  }

  // Get or create shell (auto-creates and persists if not exists)
  const { shell } = ctx.shellManager.getOrCreate(
    shellId,
    { cwd: ctx.configHolder.cwd, env: parsed.env },
  );

  // Merge additional env vars into the actual shell temporarily
  const originalEnv = shell.env;
  if (parsed.env) {
    shell.env = { ...shell.env, ...parsed.env };
  }

  // Background execution: launch script and return immediately
  if (background) {
    const script = await launchCodeScript(code, execConfig, shell);
    shell.env = originalEnv;

    return mcpJsonResponse({ scriptId: script.id, pid: script.pid, shellId: shell.id, background: true });
  }

  // Foreground execution: wait for completion
  const result = await executeCode(code, execConfig, { timeout: execTimeout, cwd: shell.cwd }, shell);
  shell.env = originalEnv;

  // Check for blocked commands from init() (multiple commands)
  if (result.blockedCommands?.length || result.notFoundCommands?.length) {
    return ctx.formatBlockedCommandsResponse(
      code,
      result.blockedCommands ?? [],
      result.notFoundCommands ?? [],
      shell,
      parsed.env,
      execTimeout,
      background,
      shellId,
    );
  }

  // Check for blocked command (legacy single command)
  if (result.blockedCommand) {
    return ctx.formatBlockedCommandResponse(
      code,
      result.blockedCommand,
      shell,
      parsed.env,
      execTimeout,
      background,
      shellId,
    );
  }

  // Update shell vars on success
  if (result.success && shell.vars) {
    ctx.shellManager.update(shell.id, { vars: shell.vars });
  }

  return mcpTextResponse(ctx.formatRunResult(result, shell.id, result.scriptId), !result.success);
}

/**
 * Handle 'startShell' tool - create a new persistent shell
 */
async function handleStartShell(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = StartShellSchema.parse(args);
  const shell = ctx.shellManager.create({
    cwd: parsed.cwd,
    env: parsed.env,
  });

  return mcpJsonResponse(ctx.shellManager.serialize(shell));
}

/**
 * Handle 'updateShell' tool - modify shell state
 */
async function handleUpdateShell(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = UpdateShellSchema.parse(args);
  const shell = ctx.shellManager.update(parsed.shellId, {
    cwd: parsed.cwd,
    env: parsed.env,
  });

  if (!shell) {
    return mcpTextResponse(`Shell not found: ${parsed.shellId}`, true);
  }

  return mcpJsonResponse(ctx.shellManager.serialize(shell));
}

/**
 * Handle 'endShell' tool - destroy a shell
 */
async function handleEndShell(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = EndShellSchema.parse(args);
  const ended = ctx.shellManager.end(parsed.shellId);

  if (!ended) {
    return mcpTextResponse(`Shell not found: ${parsed.shellId}`, true);
  }

  return mcpTextResponse(`Shell ended: ${parsed.shellId}`);
}

/**
 * Handle 'listShells' tool - list active shells
 */
async function handleListShells(_args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const shells = ctx.shellManager.list();

  if (shells.length === 0) {
    return mcpTextResponse("No active shells");
  }

  const serialized = shells.map((s) => ctx.shellManager.serialize(s));
  return mcpJsonResponse(serialized);
}

/**
 * Handle 'listScripts' tool - list scripts in a shell
 */
async function handleListScripts(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = ListScriptsSchema.parse(args);
  const scripts = ctx.shellManager.listScripts(parsed.shellId, parsed.filter);

  if (scripts.length === 0) {
    return mcpTextResponse("No scripts found");
  }

  // Serialize scripts (newest first, already sorted by listScripts)
  const serialized = scripts.map((s) => ({
    id: s.id,
    code: s.code.length > CODE_PREVIEW_LENGTH ? `${s.code.slice(0, CODE_PREVIEW_LENGTH)}...` : s.code,
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

  return mcpJsonResponse(serialized);
}

/**
 * Handle 'getScriptOutput' tool - get output from a script
 */
async function handleGetScriptOutput(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = GetScriptOutputSchema.parse(args);
  const script = ctx.shellManager.getScript(parsed.shellId, parsed.scriptId);

  if (!script) {
    return mcpTextResponse(`Script not found: ${parsed.scriptId}`, true);
  }

  const output = getScriptOutput(script, parsed.since);

  return mcpJsonResponse({
    scriptId: script.id,
    status: output.status,
    stdout: output.stdout,
    stderr: output.stderr,
    offset: output.offset,
    exitCode: output.exitCode,
    truncated: output.truncated,
  });
}

/**
 * Handle 'killScript' tool - kill a running script
 */
async function handleKillScript(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = KillJobSchema.parse(args);
  const script = ctx.shellManager.getScript(parsed.shellId, parsed.scriptId);

  if (!script) {
    return mcpTextResponse(`Script not found: ${parsed.scriptId}`, true);
  }

  const signal = (parsed.signal ?? "SIGTERM") as Deno.Signal;
  await killScript(script, signal);

  return mcpTextResponse(`Script ${parsed.scriptId} killed with ${signal}`);
}

/**
 * Handle 'waitScript' tool - wait for script completion
 */
async function handleWaitScript(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = WaitScriptSchema.parse(args);
  const script = ctx.shellManager.getScript(parsed.shellId, parsed.scriptId);

  if (!script) {
    return mcpTextResponse(`Script not found: ${parsed.scriptId}`, true);
  }

  if (script.status !== "running") {
    // Script already completed
    return mcpJsonResponse({
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
    }, script.status === "failed");
  }

  // Wait for script completion with optional timeout
  const startTime = Date.now();
  const timeoutMs = parsed.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;

  while (script.status === "running") {
    if (Date.now() - startTime > timeoutMs) {
      return mcpTextResponse(`Timeout waiting for script ${parsed.scriptId}`, true);
    }
    await new Promise((r) => setTimeout(r, SCRIPT_POLL_INTERVAL_MS));
  }

  return mcpJsonResponse({
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
  }, script.status === "failed");
}

/**
 * Handle 'listJobs' tool - list jobs in a shell
 */
async function handleListJobs(args: unknown, ctx: ToolContext): Promise<McpResponse> {
  const parsed = ListJobsSchema.parse(args);
  const jobs = ctx.shellManager.listJobs(parsed.shellId, parsed.filter);

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

  return mcpJsonResponse(serialized);
}

/** Map tool names to handler functions */
const toolHandlers: Record<string, ToolHandler> = {
  run: handleRun,
  startShell: handleStartShell,
  updateShell: handleUpdateShell,
  endShell: handleEndShell,
  listShells: handleListShells,
  listScripts: handleListScripts,
  getScriptOutput: handleGetScriptOutput,
  killScript: handleKillScript,
  waitScript: handleWaitScript,
  listJobs: handleListJobs,
};

/**
 * Create and configure the MCP server
 */
export async function createServer(initialConfig: SafeShellConfig, initialCwd: string): Promise<Server> {
  // Mutable config holder - updated when roots are received
  const configHolder: ConfigHolder = {
    config: initialConfig,
    cwd: initialCwd,
    rootsReceived: false,
  };

  // Promise that resolves when roots are fetched (or times out)
  let rootsResolve: () => void;
  const rootsPromise = new Promise<void>((resolve) => {
    rootsResolve = resolve;
  });

  // Timeout for roots fetching (3 seconds)
  const ROOTS_TIMEOUT_MS = 3000;
  const rootsTimeout = setTimeout(() => {
    console.error("  Roots fetch timeout - proceeding without roots");
    rootsResolve();
  }, ROOTS_TIMEOUT_MS);

  // Getter for current config (used by tool handlers)
  const getConfig = () => configHolder.config;
  const getCwd = () => configHolder.cwd;

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

  // Create registry and shell manager (will use current config via getter)
  let registry = createRegistry(configHolder.config, configHolder.cwd);
  const shellManager = createShellManager(configHolder.cwd, configHolder.cwd);

  // Initialize from persisted state (restore shells from previous session)
  await shellManager.initFromPersistence();

  /**
   * Request and apply roots from client
   */
  async function fetchAndApplyRoots(): Promise<void> {
    const clientCaps = server.getClientCapabilities();
    if (!clientCaps?.roots) {
      console.error("  Client does not support roots capability");
      clearTimeout(rootsTimeout);
      rootsResolve();
      return;
    }

    try {
      const result = await server.listRoots();
      if (result.roots && result.roots.length > 0) {
        console.error(`  Received ${result.roots.length} root(s) from client:`);
        for (const root of result.roots) {
          console.error(`    - ${root.uri}${root.name ? ` (${root.name})` : ""}`);
        }

        // Apply roots to config
        const { config: newConfig, projectDir } = applyRootsToConfig(
          configHolder.config,
          result.roots,
        );
        configHolder.config = newConfig;
        configHolder.rootsReceived = true;

        // Update cwd to projectDir if available
        if (projectDir) {
          configHolder.cwd = projectDir;
          console.error(`  projectDir set to: ${projectDir}`);
          console.error(`  config.projectDir is now: ${configHolder.config.projectDir}`);
        }

        // Recreate registry with updated config
        registry = createRegistry(configHolder.config, configHolder.cwd);
      }

      // Resolve the roots promise now that we've processed them
      clearTimeout(rootsTimeout);
      rootsResolve();
    } catch (error) {
      console.error(`  Failed to get roots: ${error instanceof Error ? error.message : error}`);
      clearTimeout(rootsTimeout);
      rootsResolve();
    }
  }

  // Set up initialization callback to request roots
  server.oninitialized = () => {
    console.error("  Client initialized, requesting roots...");
    fetchAndApplyRoots().catch((err) => {
      console.error(`  Error fetching roots: ${err}`);
    });
  };

  // Handle roots list changed notifications
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    console.error("  Roots list changed, refreshing...");
    await fetchAndApplyRoots();
  });

  // ============================================================================
  // Run Tool Helper Functions
  // ============================================================================

  /**
   * Handle retry workflow - process retry_id and permission choices
   */
  async function handleRetryWorkflow(
    retryId: string,
    userChoice: number | undefined,
  ): Promise<RetryResult | RetryError> {
    const retry = shellManager.consumePendingRetry(retryId);
    if (!retry) {
      return {
        success: false,
        response: {
          content: [{ type: "text", text: `Retry not found or expired: ${retryId}` }],
          isError: true,
        },
      };
    }

    // Get blocked commands from retry context (not from allow param)
    const blockedCmds: string[] = [];
    if (retry.blockedCommand) {
      blockedCmds.push(retry.blockedCommand);
    }
    if (retry.blockedCommands) {
      blockedCmds.push(...retry.blockedCommands);
    }

    let execConfig = configHolder.config;
    const retryCwd = retry.context.cwd;

    if (blockedCmds.length > 0 && userChoice) {
      if (userChoice === 3) {
        // Always allow: save to JSON and reload config
        try {
          await saveToLocalJson(retryCwd, blockedCmds);
          execConfig = await loadConfig(retryCwd);
          // Always update configHolder to persist the permission
          configHolder.config = execConfig;
          registry = createRegistry(configHolder.config, configHolder.cwd);
        } catch (error) {
          return {
            success: false,
            response: {
              content: [{
                type: "text",
                text: `Failed to save to .claude/safesh.local.json: ${error instanceof Error ? error.message : String(error)}`,
              }],
              isError: true,
            },
          };
        }
      } else if (userChoice === 2) {
        // Allow for session
        shellManager.addSessionAllowedCommands(blockedCmds);
        execConfig = mergeConfigs(configHolder.config, {
          permissions: { run: blockedCmds },
          external: Object.fromEntries(blockedCmds.map((cmd) => [cmd, { allow: true }])),
        });
      } else {
        // Allow once
        execConfig = mergeConfigs(configHolder.config, {
          permissions: { run: blockedCmds },
          external: Object.fromEntries(blockedCmds.map((cmd) => [cmd, { allow: true }])),
        });
      }
    }

    return {
      success: true,
      code: retry.code,
      shellId: retry.shellId,
      timeout: retry.context.timeout,
      background: retry.context.background,
      config: execConfig,
    };
  }

  /**
   * Execute a file and return the MCP response
   */
  async function handleFileExecution(
    file: string,
    shellId: string | undefined,
    env: Record<string, string> | undefined,
    timeout: number | undefined,
    config: SafeShellConfig,
  ): Promise<McpResponse> {
    const { shell } = shellManager.getOrCreate(
      shellId,
      { cwd: configHolder.cwd, env },
    );

    // Merge session-level allowed commands into config
    const sessionCmds = shellManager.getSessionAllowedCommands();
    let fileConfig = config;
    if (sessionCmds.length > 0) {
      fileConfig = mergeConfigs(fileConfig, {
        permissions: { run: sessionCmds },
        external: Object.fromEntries(sessionCmds.map((c) => [c, { allow: true }])),
      });
    }

    const result = await executeFile(
      file,
      fileConfig,
      { timeout, cwd: shell.cwd },
      shell,
    );

    return mcpTextResponse(formatRunResult(result, shell.id, result.scriptId), !result.success);
  }

  /**
   * Format a blocked command response with retry information (single command)
   */
  function formatBlockedCommandResponse(
    code: string,
    blockedCommand: string,
    shell: Shell,
    env: Record<string, string> | undefined,
    timeout: number | undefined,
    background: boolean | undefined,
    shellId: string | undefined,
  ): McpResponse {
    const retry = shellManager.createPendingRetry(
      code,
      blockedCommand,
      { cwd: shell.cwd, env, timeout, background },
      shellId,
    );

    return mcpJsonResponse({
      error: {
        type: ERROR_COMMAND_NOT_ALLOWED,
        command: blockedCommand,
        message: `Command '${blockedCommand}' is not allowed`,
      },
      retry_id: retry.id,
      hint: `STOP: Present this error to user with options: (1) Allow once, (2) Allow for session, (3) Always allow, (4) Deny. Ask user to reply with their choice (1-4). Then retry with { retry_id: "${retry.id}", userChoice: N } where N=1 (once), 2 (session), or 3 (always).`,
    }, true);
  }

  /**
   * Format a blocked commands response with retry information (multiple commands from init())
   */
  function formatBlockedCommandsResponse(
    code: string,
    blockedCommands: string[],
    notFoundCommands: string[],
    shell: Shell,
    env: Record<string, string> | undefined,
    timeout: number | undefined,
    background: boolean | undefined,
    shellId: string | undefined,
  ): McpResponse {
    const retry = shellManager.createPendingRetryMulti(
      code,
      blockedCommands,
      notFoundCommands,
      { cwd: shell.cwd, env, timeout, background },
      shellId,
    );

    const errors: Array<{ command: string; error: string }> = [];

    for (const cmd of blockedCommands) {
      errors.push({ command: cmd, error: ERROR_COMMAND_NOT_ALLOWED });
    }
    for (const cmd of notFoundCommands) {
      errors.push({ command: cmd, error: ERROR_COMMAND_NOT_FOUND });
    }

    return mcpJsonResponse({
      error: {
        type: ERROR_COMMANDS_BLOCKED,
        commands: errors,
        message: `${blockedCommands.length} command(s) not allowed, ${notFoundCommands.length} command(s) not found`,
      },
      retry_id: retry.id,
      hint: `STOP: Present this error to user with options: (1) Allow once, (2) Allow for session, (3) Always allow, (4) Deny. Ask user to reply with their choice (1-4). Then retry with { retry_id: "${retry.id}", userChoice: N } where N=1 (once), 2 (session), or 3 (always). Note: Commands not found cannot be allowed - they must be fixed in code.`,
    }, true);
  }

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "run",
          description: createRunToolDescription(),
          inputSchema: {
            type: "object",
            properties: {
              code: { type: "string" },
              shcmd: { type: "string", description: "Shell cmd (&&, ||, |, >, >>). No heredocs/subshells" },
              file: { type: "string", description: "File path - reads content and executes as code" },
              module: { type: "string", description: ".ts module path (supports top-level imports/exports)" },
              shellId: { type: "string" },
              background: { type: "boolean" },
              timeout: { type: "number" },
              env: { type: "object", additionalProperties: { type: "string" } },
              retry_id: { type: "string", description: "From COMMANDS_BLOCKED error" },
              userChoice: { type: "number", enum: [1, 2, 3], description: "1=once, 2=session, 3=always" },
            },
          },
        },
        {
          name: "startShell",
          description: START_SHELL_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              cwd: { type: "string" },
              env: { type: "object", additionalProperties: { type: "string" } },
            },
          },
        },
        {
          name: "updateShell",
          description: UPDATE_SHELL_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              shellId: { type: "string" },
              cwd: { type: "string" },
              env: { type: "object", additionalProperties: { type: "string" } },
            },
            required: ["shellId"],
          },
        },
        {
          name: "endShell",
          description: END_SHELL_DESCRIPTION,
          inputSchema: { type: "object", properties: { shellId: { type: "string" } }, required: ["shellId"] },
        },
        {
          name: "listShells",
          description: LIST_SHELLS_DESCRIPTION,
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "listScripts",
          description: LIST_SCRIPTS_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              shellId: { type: "string" },
              filter: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["running", "completed", "failed"] },
                  background: { type: "boolean" },
                  limit: { type: "number" },
                },
              },
            },
            required: ["shellId"],
          },
        },
        {
          name: "getScriptOutput",
          description: GET_SCRIPT_OUTPUT_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              shellId: { type: "string" },
              scriptId: { type: "string" },
              since: { type: "number", description: "Byte offset for incremental reads" },
            },
            required: ["shellId", "scriptId"],
          },
        },
        {
          name: "killScript",
          description: KILL_SCRIPT_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              shellId: { type: "string" },
              scriptId: { type: "string" },
              signal: { type: "string" },
            },
            required: ["shellId", "scriptId"],
          },
        },
        {
          name: "waitScript",
          description: WAIT_SCRIPT_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              shellId: { type: "string" },
              scriptId: { type: "string" },
              timeout: { type: "number" },
            },
            required: ["shellId", "scriptId"],
          },
        },
        {
          name: "listJobs",
          description: LIST_JOBS_DESCRIPTION,
          inputSchema: {
            type: "object",
            properties: {
              shellId: { type: "string" },
              filter: {
                type: "object",
                properties: {
                  scriptId: { type: "string" },
                  status: { type: "string", enum: ["running", "completed", "failed"] },
                  limit: { type: "number" },
                },
              },
            },
            required: ["shellId"],
          },
        },
      ],
    };
  });

  // Build the tool context for handlers
  const toolContext: ToolContext = {
    shellManager,
    getConfig,
    getCwd,
    configHolder,
    registry,
    updateRegistry: (newRegistry: CommandRegistry) => { registry = newRegistry; },
    rootsPromise,
    handleRetryWorkflow,
    handleFileExecution,
    formatBlockedCommandResponse,
    formatBlockedCommandsResponse,
    formatRunResult,
  };

  // Handle tool calls using handler map (SSH-176)
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = toolHandlers[name];
    if (!handler) {
      return mcpTextResponse(`Unknown tool: ${name}`, true);
    }

    try {
      return await handler(args, toolContext);
    } catch (error) {
      // Handle SafeShellError with full formatting
      if (error instanceof SafeShellError) {
        return mcpTextResponse(formatError(error), true);
      }
      // Handle other errors
      return mcpTextResponse(error instanceof Error ? error.message : String(error), true);
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
 * Parse CLI args for MCP initialization
 */
function parseMcpArgs(args: string[]): McpInitArgs {
  const result: McpInitArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === "--project-dir" && nextArg) {
      result.projectDir = nextArg;
      i++;
    } else if (arg === "--cwd" && nextArg) {
      result.cwd = nextArg;
      i++;
    } else if (arg === "--allow-project-commands") {
      result.allowProjectCommands = true;
    } else if (arg?.startsWith("--project-dir=")) {
      result.projectDir = arg.slice("--project-dir=".length);
    } else if (arg?.startsWith("--cwd=")) {
      result.cwd = arg.slice("--cwd=".length);
    }
  }

  return result;
}

/**
 * Main entry point
 */
async function main() {
  // Parse CLI args
  const mcpArgs = parseMcpArgs(Deno.args);

  // Load configuration with MCP args override
  const baseCwd = Deno.cwd();
  const { config, effectiveCwd } = await loadConfigWithArgs(baseCwd, mcpArgs);

  // Create server
  const server = await createServer(config, effectiveCwd);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup (to stderr to not interfere with MCP protocol)
  console.error("SafeShell MCP Server started");
  console.error(`  initial cwd: ${effectiveCwd}`);
  console.error(`  initial projectDir: ${config.projectDir ?? "(none)"}`);
  if (config.allowProjectCommands) {
    console.error("  allowProjectCommands: true");
  }

  // Handle graceful shutdown - flush persistence
  const shutdown = async () => {
    console.error("SafeShell MCP Server shutting down...");
    await closeAllStatePersistence();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
}

// Run if this is the main module
if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to start server:", error);
    Deno.exit(1);
  });
}

export { main };
