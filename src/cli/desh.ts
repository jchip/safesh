#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --config=/Users/jc/dev/safesh/deno.json
/**
 * desh - Deno Shell CLI for SafeShell
 *
 * A simplified CLI for executing SafeShell TypeScript code.
 *
 * Usage:
 *   desh --code 'console.log($.pwd())'
 *   desh --code <<'EOF'
 *   const files = await $.globPaths("*.ts");
 *   console.log(files);
 *   EOF
 *   desh --file script.ts
 *   desh --import ./module.ts
 */

import { parseArgs } from "@std/cli/parse-args";
import { loadConfig, loadSessionConfig, mergeConfigs, validateConfig } from "../core/config.ts";
import { executeCode, executeCodeStreaming, executeFilePassthrough } from "../runtime/executor.ts";
import { SafeShellError } from "../core/errors.ts";
import { getApiDoc, getBashPrehookNote } from "../core/api-doc.ts";
import { getPendingFilePath, getSessionFilePath, findScriptFilePath, getTempRoot } from "../core/temp.ts";
// New unified core modules (DRY refactoring)
import { findProjectRoot, PROJECT_MARKERS } from "../core/project-root.ts";
import { readPendingCommand, readPendingPath, deletePending, type PendingCommand, type PendingPathRequest } from "../core/pending.ts";
import { addSessionCommands, addSessionPaths, getSessionAllowedCommandsArray, getSessionPathPermissions, mergeSessionPermissions } from "../core/session.ts";
import { readStdinFully } from "../core/io-utils.ts";
import { addCommandsToConfig, addPathsToConfig } from "../core/config-persistence.ts";

const VERSION = "0.1.0";

// Project root, session, and pending functions now imported from core modules

/**
 * Parse and validate retry command arguments.
 *
 * @param args - Command line arguments
 * @returns Parsed retry command arguments
 * @throws Exits with code 1 if validation fails
 */
export function parseRetryArgs(args: string[]): { id: string; choice: number } {
  const parsed = parseArgs(args, {
    string: ["id", "choice"],
  });

  const id = parsed.id as string;
  const choice = parseInt(parsed.choice as string, 10);

  if (!id) {
    console.error("Error: --id is required for retry");
    Deno.exit(1);
  }

  if (isNaN(choice) || choice < 1 || choice > 4) {
    console.error("Error: --choice must be 1-4");
    Deno.exit(1);
  }

  return { id, choice };
}

/**
 * Load pending command from file.
 *
 * @param id - Pending command ID
 * @returns Pending command data
 * @throws Exits with code 1 if command not found
 */
export function loadPendingCommand(id: string): PendingCommand {
  const pending = readPendingCommand(id);
  if (!pending) {
    console.error(`Error: Pending command not found for id: ${id}`);
    Deno.exit(1);
  }
  return pending;
}

/**
 * Apply permission choice (update configs as needed).
 * Security-critical: Handles persistent permission grants.
 *
 * @param choice - User's permission choice (1-4)
 * @param pending - Pending command data
 * @param id - Pending command ID
 * @returns Project directory for session-scoped permissions
 * @throws Exits with code 0 if choice is deny (4)
 */
export async function applyPermissionChoice(
  choice: number,
  pending: PendingCommand,
  id: string,
): Promise<string> {
  // Choice 4 = Deny - cleanup and exit
  if (choice === 4) {
    console.error("[safesh] Command denied by user.");
    deletePending(id, "command");
    Deno.exit(0);
  }

  // Choice 2 = Always allow - update config.local.json
  if (choice === 2) {
    await addCommandsToConfig(pending.commands, pending.cwd);
  }

  // Load config to get projectDir
  const { projectDir } = await loadSessionConfig(pending.cwd);

  // Choice 3 = Session allow - update session file
  if (choice === 3) {
    await addSessionCommands(pending.commands, projectDir);
    console.error(`[safesh] Added to session-allow: ${pending.commands.join(", ")}`);
  }

  return projectDir;
}

/**
 * Build retry execution config with merged permissions.
 *
 * @param pending - Pending command data
 * @returns Config with pending commands added to permissions
 */
export async function buildRetryConfig(pending: PendingCommand) {
  const { config } = await loadSessionConfig(pending.cwd);

  // Add pending commands to permissions
  config.permissions = config.permissions ?? {};
  config.permissions.run = [
    ...(config.permissions.run ?? []),
    ...pending.commands,
  ];

  return config;
}

/**
 * Execute retry script and handle output/cleanup.
 *
 * @param scriptPath - Path to script file
 * @param config - Execution config with permissions
 * @param pending - Pending command data
 * @param id - Pending command ID
 * @throws Exits with appropriate code after execution
 */
export async function executeRetryScript(
  scriptPath: string,
  config: Awaited<ReturnType<typeof loadSessionConfig>>["config"],
  pending: PendingCommand,
  id: string,
): Promise<void> {
  try {
    // Execute with inherited stdio for real-time output passthrough
    const exitCode = await executeFilePassthrough(scriptPath, config, {
      cwd: pending.cwd,
      timeout: pending.timeout,
    });

    // Cleanup pending file on success (keep script file for caching)
    deletePending(id, "command");

    Deno.exit(exitCode);
  } catch (error) {
    console.error(`Execution failed: ${error}`);
    // Cleanup pending file on failure too
    deletePending(id, "command");
    Deno.exit(1);
  }
}

/**
 * Handle retry subcommand: desh retry --id=X --choice=N
 *
 * Choices:
 * 1 = Allow once (just execute)
 * 2 = Always allow (update config.local.json, then execute)
 * 3 = Allow for session (update session file, then execute)
 * 4 = Deny (do nothing)
 */
async function handleRetry(args: string[]): Promise<void> {
  // Phase 1: Parse and validate arguments
  const { id, choice } = parseRetryArgs(args);

  // Phase 2: Load pending command
  const pending = loadPendingCommand(id);

  // Phase 3: Apply permission choice (exits if deny)
  await applyPermissionChoice(choice, pending, id);

  // Phase 4: Build execution config
  const config = await buildRetryConfig(pending);

  // Phase 5: Find script file and execute
  const scriptFilePath = await findScriptFilePath(pending.scriptHash);
  if (!scriptFilePath) {
    console.error(`Error: Script file not found for hash: ${pending.scriptHash}`);
    Deno.exit(1);
  }

  await executeRetryScript(scriptFilePath, config, pending, id);
}

/**
 * Add commands to .config/safesh/config.local.json for "always allow"
 */
// addToConfigLocal now replaced by addCommandsToConfig from core/config-persistence.ts

// addToSessionFile now replaced by addSessionCommands from core/session.ts

// ============================================================================
// handleRetryPath Phase Functions
// ============================================================================

/**
 * Parsed path permission choice
 */
export interface PathPermissionChoice {
  operation: "r" | "w" | "rw";
  scope: 1 | 2 | 3; // 1 = once, 2 = session, 3 = always
  isDirectory: boolean;
}

/**
 * Parsed retry-path arguments
 */
export interface RetryPathArgs {
  id: string;
  choice: string;
}

/**
 * Phase 1: Parse and validate retry-path arguments.
 * Security-critical: Validates all user inputs before processing.
 *
 * @param args - Command line arguments
 * @returns Parsed arguments with id and choice
 * @throws Exits process with code 1 if validation fails
 */
export function parseRetryPathArgs(args: string[]): RetryPathArgs {
  const parsed = parseArgs(args, {
    string: ["id", "choice"],
  });

  const id = parsed.id as string;
  const choice = parsed.choice as string;

  if (!id) {
    console.error("Error: --id is required for retry-path");
    Deno.exit(1);
  }

  if (!choice) {
    console.error("Error: --choice is required for retry-path");
    Deno.exit(1);
  }

  return { id, choice };
}

/**
 * Phase 2: Parse path choice into structured data.
 * Security-critical: Validates choice format to prevent injection.
 *
 * Format: (r|w|rw)(1|2|3)(d?)
 * - Operations: r (read), w (write), rw (read-write)
 * - Scopes: 1 (once), 2 (session), 3 (always)
 * - Modifier: d (directory instead of file)
 *
 * @param choice - Choice string (r1, w2, rw3, r1d, etc. or "deny"/"4")
 * @returns Structured permission choice
 * @throws Error with "DENY" message if user denies
 * @throws Exits process with code 1 if choice format is invalid
 */
export function parsePathChoice(choice: string): PathPermissionChoice {
  // Handle deny
  if (choice === "deny" || choice === "4") {
    throw new Error("DENY"); // Special sentinel for denial
  }

  // Parse choice: r1, w1, rw1, r2, w2, rw2, r3, w3, rw3, or with 'd' for directory (r1d, w2d, etc.)
  const match = choice.match(/^(r|w|rw)([123])(d?)$/);
  if (!match) {
    console.error(`Error: Invalid choice '${choice}'. Must be r1, w1, rw1, r2, w2, rw2, r3, w3, rw3 (or add 'd' for directory), or 4`);
    Deno.exit(1);
  }

  const operation = match[1]! as "r" | "w" | "rw";
  const scope = parseInt(match[2]!) as 1 | 2 | 3;
  const isDirectory = match[3] === "d";

  return { operation, scope, isDirectory };
}

/**
 * Phase 3: Load pending path request and script file.
 * Security-critical: Validates file existence before granting permissions.
 *
 * @param id - Pending request ID
 * @returns Pending path request and script file path
 * @throws Exits process with code 1 if not found
 */
export async function loadPendingPathData(id: string): Promise<{ pending: PendingPathRequest; scriptFile: string }> {
  // Read pending path request
  const pending = readPendingPath(id);
  if (!pending) {
    console.error(`Error: Pending path request not found for id: ${id}`);
    Deno.exit(1);
  }

  // Find the script file
  const scriptFile = await findScriptFilePath(pending.scriptHash);
  if (!scriptFile) {
    console.error(`Error: Script file not found for hash: ${pending.scriptHash}`);
    Deno.exit(1);
  }

  return { pending, scriptFile };
}

/**
 * Phase 4: Build read and write permission lists based on choice.
 * Security-critical: Determines exact paths to grant permissions.
 *
 * @param pending - Pending path request
 * @param choice - Parsed permission choice
 * @returns Read and write permission paths
 */
export function buildPathPermissions(
  pending: PendingPathRequest,
  choice: PathPermissionChoice,
): { readPaths: string[]; writePaths: string[] } {
  // Determine the path to grant permission to
  let permissionPath = pending.path;
  if (choice.isDirectory) {
    // Grant permission to the directory instead of the file
    // Security note: Prevents directory traversal by using path parts
    const pathParts = pending.path.split('/');
    permissionPath = pathParts.slice(0, -1).join('/') || '/';
    console.error(`[safesh] Granting permission to directory: ${permissionPath}/`);
  }

  // Determine which permissions to add
  const readPaths: string[] = [];
  const writePaths: string[] = [];

  if (choice.operation === "r" || choice.operation === "rw") {
    readPaths.push(permissionPath);
  }
  if (choice.operation === "w" || choice.operation === "rw") {
    writePaths.push(permissionPath);
  }

  return { readPaths, writePaths };
}

/**
 * Phase 5: Persist path permissions based on scope.
 * Security-critical: Writes persistent permissions to config files.
 *
 * Audit trail: Logs all permission grants to stderr.
 *
 * @param readPaths - Paths to grant read permission
 * @param writePaths - Paths to grant write permission
 * @param scope - Permission scope (1=once, 2=session, 3=always)
 * @param cwd - Current working directory
 * @param projectDir - Project directory
 */
export async function persistPathPermissions(
  readPaths: string[],
  writePaths: string[],
  scope: 1 | 2 | 3,
  cwd: string,
  projectDir: string,
): Promise<void> {
  if (scope === 3) {
    // Always allow - update config.local.json
    // Security audit: Permanent permission grant logged
    await addPathsToConfig(readPaths, writePaths, cwd);
  } else if (scope === 2) {
    // Session allow - update session file
    // Security audit: Session permission grant logged
    await addSessionPaths(readPaths, writePaths, projectDir);
    const msg = [];
    if (readPaths.length > 0) msg.push(`read: ${readPaths.join(", ")}`);
    if (writePaths.length > 0) msg.push(`write: ${writePaths.join(", ")}`);
    console.error(`[safesh] Added to session-allow paths: ${msg.join("; ")}`);
  }
  // scope === 1: allow once - no persistence needed, only runtime grant
}

/**
 * Phase 6: Build retry path configuration with permissions.
 *
 * @param pending - Pending path request
 * @param readPaths - Paths to grant read permission
 * @param writePaths - Paths to grant write permission
 * @returns SafeShell configuration with merged permissions and projectDir
 */
export async function buildRetryPathConfig(
  pending: PendingPathRequest,
  readPaths: string[],
  writePaths: string[],
): Promise<{ config: Awaited<ReturnType<typeof loadSessionConfig>>["config"]; projectDir: string }> {
  // Load config and merge session permissions
  const { config, projectDir } = await loadSessionConfig(pending.cwd);

  // Add paths to runtime config
  config.permissions = config.permissions ?? {};
  if (readPaths.length > 0) {
    config.permissions.read = [
      ...(config.permissions.read ?? []),
      ...readPaths,
    ];
  }
  if (writePaths.length > 0) {
    config.permissions.write = [
      ...(config.permissions.write ?? []),
      ...writePaths,
    ];
  }

  return { config, projectDir };
}

/**
 * Phase 7: Execute retry path script with updated permissions.
 * Security-critical: Executes user script with granted permissions.
 *
 * @param scriptFile - Script file path
 * @param config - SafeShell configuration
 * @param pending - Pending path request
 * @param id - Pending request ID
 * @throws Exits process with result code or 1 on error
 */
export async function executeRetryPathScript(
  scriptFile: string,
  config: Awaited<ReturnType<typeof loadSessionConfig>>["config"],
  pending: PendingPathRequest,
  id: string,
): Promise<void> {
  // Set SAFESH_SCRIPT_HASH for debug output and SAFESH_SCRIPT_ID for retry flow
  Deno.env.set("SAFESH_SCRIPT_HASH", pending.scriptHash);
  Deno.env.set("SAFESH_SCRIPT_ID", id);

  try {
    // Execute with inherited stdio for real-time output passthrough
    const exitCode = await executeFilePassthrough(scriptFile, config, { cwd: pending.cwd });

    // Don't cleanup pending file yet - it may be needed for command retries
    // The file will be cleaned up by subsequent retries or manual cleanup

    Deno.exit(exitCode);
  } catch (error) {
    console.error(`Execution failed: ${error}`);
    deletePending(id, "path");
    Deno.exit(1);
  }
}

/**
 * Handle retry-path subcommand: desh retry-path --id=X --choice=<option>
 *
 * Orchestrates the 7-phase retry-path flow:
 * 1. Parse and validate arguments
 * 2. Parse choice into structured data
 * 3. Load pending request and script
 * 4. Build permission lists
 * 5. Persist permissions based on scope
 * 6. Build configuration with permissions
 * 7. Execute script with updated permissions
 *
 * Security-critical: Handles path permission grants with audit trail.
 *
 * Choices: r1, w1, rw1 (once), r2, w2, rw2 (session), r3, w3, rw3 (always), deny
 * Add 'd' suffix for directory permissions (e.g., r1d, rw2d)
 */
async function handleRetryPath(args: string[]): Promise<void> {
  // Phase 1: Parse arguments
  const { id, choice } = parseRetryPathArgs(args);

  // Phase 2: Parse choice (handles denial)
  let parsedChoice: PathPermissionChoice;
  try {
    parsedChoice = parsePathChoice(choice);
  } catch (error) {
    if (error instanceof Error && error.message === "DENY") {
      console.error("[safesh] Path access denied by user.");
      deletePending(id, "path");
      Deno.exit(0);
    }
    throw error;
  }

  // Phase 3: Load pending data
  const { pending, scriptFile } = await loadPendingPathData(id);

  // Phase 4: Build permissions
  const { readPaths, writePaths } = buildPathPermissions(pending, parsedChoice);

  // Phase 5 & 6: Build config and persist permissions
  const { config, projectDir } = await buildRetryPathConfig(pending, readPaths, writePaths);
  await persistPathPermissions(readPaths, writePaths, parsedChoice.scope, pending.cwd, projectDir);

  // Phase 7: Execute script
  await executeRetryPathScript(scriptFile, config, pending, id);
}

/**
 * Add paths to config.local.json for "always allow"
 */
// addPathsToConfigLocal now replaced by addPathsToConfig from core/config-persistence.ts

// addPathsToSessionFile now replaced by addSessionPaths from core/session.ts

const HELP = `
desh - Deno Shell CLI for SafeShell

USAGE:
  desh [options]

OPTIONS:
  -c, --code <code>      Execute inline TypeScript code
                         If no argument, reads from stdin (for heredoc)
  -f, --file <path>      Execute TypeScript file
  -i, --import <path>    Import and execute module
  -p, --project <dir>    Project directory (default: $CLAUDE_PROJECT_DIR or cwd)
  -s, --stream           Stream output in real-time (default for TTY)
  --no-stream            Disable streaming, buffer output
  -q, --quiet            Suppress config warnings
  --config <file>        Config file (default: ./safesh.config.ts)
  -v, --verbose          Verbose output
  -h, --help             Show this help
  --version              Show version
  --api-doc              Show SafeShell API documentation

EXAMPLES:
  # Inline code as argument
  desh -c 'console.log($.pwd())'

  # Inline code via heredoc
  desh --code <<'EOF'
  const files = await $.globPaths("**/*.ts");
  for (const f of files) console.log(f);
  EOF

  # Execute file
  desh --file script.ts

  # Import module (runs top-level code)
  desh --import ./tasks.ts

ENVIRONMENT:
  $ namespace is available globally with:
    $.cmd(), $.git(), $.cat(), $.glob(), $.fs, $.text, etc.
`;

async function main() {
  // Check for retry subcommand first
  if (Deno.args[0] === "retry") {
    await handleRetry(Deno.args.slice(1));
    return;
  }

  // Check for retry-path subcommand
  if (Deno.args[0] === "retry-path") {
    await handleRetryPath(Deno.args.slice(1));
    return;
  }

  const args = parseArgs(Deno.args, {
    string: ["code", "file", "import", "config", "project"],
    boolean: ["verbose", "help", "version", "api-doc", "stream", "quiet"],
    alias: {
      c: "code",
      f: "file",
      i: "import",
      p: "project",
      s: "stream",
      q: "quiet",
      v: "verbose",
      h: "help",
    },
    default: {
      verbose: false,
      quiet: false,
    },
    negatable: ["stream"],
  });

  if (args.help) {
    console.log(HELP);
    Deno.exit(0);
  }

  if (args.version) {
    console.log(`desh ${VERSION}`);
    Deno.exit(0);
  }

  if (args["api-doc"]) {
    console.log(getApiDoc());
    console.log(getBashPrehookNote());
    Deno.exit(0);
  }

  const cwd = Deno.cwd();
  const verbose = args.verbose as boolean;
  const quiet = args.quiet as boolean;
  const configPath = args.config as string | undefined;
  // Default to streaming if stdout is a TTY, unless explicitly set
  const stream = args.stream !== undefined ? args.stream as boolean : Deno.stdout.isTerminal();

  // Load config with projectDir
  let config;
  let projectDir: string;
  try {
    if (configPath) {
      // Custom config path - load manually and merge with project root
      const module = await import(`file://${cwd}/${configPath}`);
      const baseConfig = module.default;
      // Project dir: explicit flag > findProjectRoot (checks env + markers)
      projectDir = (args.project as string | undefined) ?? findProjectRoot(cwd);
      // Merge projectDir into loaded config
      config = mergeConfigs(baseConfig, { projectDir });
      mergeSessionPermissions(config, projectDir);
      if (verbose) console.error(`Config loaded from ${configPath}`);
    } else {
      // Standard config loading - use helper
      // Project dir: explicit flag > findProjectRoot (checks env + markers)
      const explicitProjectDir = args.project as string | undefined;
      const result = await loadSessionConfig(cwd, {
        projectDir: explicitProjectDir,
      });
      config = result.config;
      projectDir = result.projectDir;
      if (verbose) console.error("Config loaded successfully");
    }

    // Check if allowProjectCommands should be enabled via env var (set by bash-prehook)
    const envAllowProjectCommands = Deno.env.get("SAFESH_ALLOW_PROJECT_COMMANDS");
    if (envAllowProjectCommands === "true") {
      config = mergeConfigs(config, { allowProjectCommands: true });
      if (verbose) console.error("Enabled allowProjectCommands from environment");
    }

    // Validate and log warnings after projectDir merge (unless quiet)
    if (!quiet) {
      const validation = validateConfig(config);
      if (validation.warnings.length > 0) {
        console.error("⚠️  Config warnings:");
        validation.warnings.forEach((w) => console.error(`   ${w}`));
      }
    }
  } catch (error) {
    if (error instanceof SafeShellError) {
      console.error(`Config error: ${error.message}`);
    } else {
      console.error(`Failed to load config: ${error}`);
    }
    Deno.exit(1);
  }

  // Determine execution mode
  const hasCode = args.code !== undefined;
  const hasFile = args.file !== undefined;
  const hasImport = args.import !== undefined;

  const modeCount = [hasCode, hasFile, hasImport].filter(Boolean).length;

  if (modeCount === 0) {
    // No mode specified - check if stdin has data (piped)
    if (Deno.stdin.isTerminal()) {
      console.error("Error: No code provided. Use --code, --file, or --import");
      console.error("Run 'desh --help' for usage");
      Deno.exit(1);
    }
    // Read from stdin
    const code = await readStdinFully();
    if (!code.trim()) {
      console.error("Error: Empty input from stdin");
      Deno.exit(1);
    }
    await executeInlineCode(code, config, verbose, stream);
    return;
  }

  if (modeCount > 1) {
    console.error("Error: Use only one of --code, --file, or --import");
    Deno.exit(1);
  }

  if (hasCode) {
    let code = args.code as string;

    // If --code is specified but empty/true, read from stdin
    if (code === "" || code === "true") {
      code = await readStdinFully();
    }

    if (!code.trim()) {
      console.error("Error: Empty code provided");
      Deno.exit(1);
    }

    await executeInlineCode(code, config, verbose, stream);
  } else if (hasFile) {
    const filePath = args.file as string;
    await executeFileCode(filePath, config, verbose);
  } else if (hasImport) {
    const importPath = args.import as string;
    await executeImportCode(importPath, config, verbose, stream);
  }
}

async function executeInlineCode(
  code: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  verbose: boolean,
  stream: boolean,
): Promise<void> {
  if (verbose) console.error(`Executing inline code (${code.length} chars), stream=${stream}`);

  try {
    if (stream) {
      // Streaming mode - output in real-time
      const encoder = new TextEncoder();
      let exitCode = 0;

      for await (const chunk of executeCodeStreaming(code, config)) {
        if (chunk.type === "stdout" && chunk.data) {
          await Deno.stdout.write(encoder.encode(chunk.data));
        } else if (chunk.type === "stderr" && chunk.data) {
          await Deno.stderr.write(encoder.encode(chunk.data));
        } else if (chunk.type === "exit") {
          exitCode = chunk.code ?? 0;
        }
      }

      Deno.exit(exitCode);
    } else {
      // Buffered mode - output after completion
      const result = await executeCode(code, config);

      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.error(result.stderr);
      }

      Deno.exit(result.code);
    }
  } catch (error) {
    // SSH-477: Save error to log file with context
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Build error log with available context
    const errorLogParts = [
      "=== Execution Error ===",
      `Code:\n${code}`,
      `\nError: ${errorMessage}`,
      errorStack ? `\nStack trace:\n${errorStack}` : "",
      "=========================\n",
    ].join("\n");

    // Save to error log file
    try {
      const errorDir = `${getTempRoot()}/errors`;
      Deno.mkdirSync(errorDir, { recursive: true });
      const errorFile = `${errorDir}/${Date.now()}-${Deno.pid}.log`;
      Deno.writeTextFileSync(errorFile, errorLogParts);
      console.error(`\nFull details saved to: ${errorFile}`);
    } catch {
      // Ignore logging errors
    }

    if (error instanceof SafeShellError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Execution failed: ${error}`);
    }
    Deno.exit(1);
  }
}

async function executeFileCode(
  filePath: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  verbose: boolean,
): Promise<void> {
  if (verbose) console.error(`Executing file: ${filePath}`);

  try {
    const result = await executeFilePassthrough(filePath, config);
    Deno.exit(result);
  } catch (error) {
    if (error instanceof SafeShellError) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Execution failed: ${error}`);
    }
    Deno.exit(1);
  }
}

async function executeImportCode(
  importPath: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  verbose: boolean,
  stream: boolean,
): Promise<void> {
  if (verbose) console.error(`Importing module: ${importPath}`);

  // For --import, wrap the import in code that executes it
  // This allows the module's top-level code to run with $ available
  const code = `await import("${importPath}");`;

  // Reuse executeInlineCode which handles streaming
  await executeInlineCode(code, config, verbose, stream);
}

if (import.meta.main) {
  main();
}
