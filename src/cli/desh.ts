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
import { loadConfig, mergeConfigs, validateConfig } from "../core/config.ts";
import { executeCode, executeFile, executeCodeStreaming } from "../runtime/executor.ts";
import { SafeShellError } from "../core/errors.ts";
import { getApiDoc, getBashPrehookNote } from "../core/api-doc.ts";
import { getPendingFilePath, getSessionFilePath, findScriptFilePath } from "../core/temp.ts";
// New unified core modules (DRY refactoring)
import { findProjectRoot, PROJECT_MARKERS } from "../core/project-root.ts";
import { readPendingCommand, readPendingPath, deletePending, type PendingCommand, type PendingPathRequest } from "../core/pending.ts";
import { addSessionCommands, addSessionPaths, getSessionAllowedCommandsArray, getSessionPathPermissions } from "../core/session.ts";
import { readStdinFully } from "../core/io-utils.ts";

const VERSION = "0.1.0";

// Project root, session, and pending functions now imported from core modules

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

  // Read pending command file first
  const pending = readPendingCommand(id);
  if (!pending) {
    console.error(`Error: Pending command not found for id: ${id}`);
    Deno.exit(1);
  }

  // Get cwd and projectDir early (needed for session file)
  const cwd = pending.cwd;
  const projectDir = findProjectRoot(cwd);

  // Choice 4 = Deny - cleanup and exit
  if (choice === 4) {
    console.error("[safesh] Command denied by user.");
    deletePending(id, "command");
    Deno.exit(0);
  }

  // Choice 2 = Always allow - update config.local.json
  if (choice === 2) {
    await addToConfigLocal(pending.commands, pending.cwd);
  }

  // Choice 3 = Session allow - update session file
  if (choice === 3) {
    await addSessionCommands(pending.commands, projectDir);
    console.error(`[safesh] Added to session-allow: ${pending.commands.join(", ")}`);
  }

  // Load config and merge approved commands
  const baseConfig = await loadConfig(cwd, { logWarnings: false });
  const config = mergeConfigs(baseConfig, { projectDir });

  // Load session permissions if they exist
  const sessionFile = getSessionFilePath(projectDir);
  try {
    const sessionContent = await Deno.readTextFile(sessionFile);
    const session = JSON.parse(sessionContent) as { permissions?: { read?: string[]; write?: string[] }; allowedCommands?: string[] };
    if (session.permissions) {
      config.permissions = config.permissions ?? {};
      if (session.permissions.read) {
        config.permissions.read = [
          ...(config.permissions.read ?? []),
          ...session.permissions.read,
        ];
      }
      if (session.permissions.write) {
        config.permissions.write = [
          ...(config.permissions.write ?? []),
          ...session.permissions.write,
        ];
      }
    }
    if (session.allowedCommands) {
      config.permissions = config.permissions ?? {};
      config.permissions.run = [
        ...(config.permissions.run ?? []),
        ...session.allowedCommands,
      ];
    }
  } catch (e) {
    // Session file doesn't exist or is invalid - that's fine
  }

  // Add pending commands to permissions
  config.permissions = config.permissions ?? {};
  config.permissions.run = [
    ...(config.permissions.run ?? []),
    ...pending.commands,
  ];

  // Find and read the script file using the scriptHash
  const scriptFilePath = await findScriptFilePath(pending.scriptHash);

  if (!scriptFilePath) {
    console.error(`Error: Script file not found for hash: ${pending.scriptHash}`);
    Deno.exit(1);
  }

  try {
    // Execute the script file directly (it already has the marker)
    // Pass cwd, timeout, and runInBackground from pending metadata
    const result = await executeFile(scriptFilePath, config, {
      cwd,
      timeout: pending.timeout,
    });

    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    // Cleanup pending file on success (keep script file for caching)
    deletePending(id, "command");

    Deno.exit(result.code);
  } catch (error) {
    console.error(`Execution failed: ${error}`);
    // Cleanup pending file on failure too
    deletePending(id, "command");
    Deno.exit(1);
  }
}

/**
 * Add commands to .config/safesh/config.local.json for "always allow"
 */
async function addToConfigLocal(commands: string[], cwd: string): Promise<void> {
  const configDir = `${cwd}/.config/safesh`;
  const configPath = `${configDir}/config.local.json`;

  // Ensure directory exists
  try {
    await Deno.mkdir(configDir, { recursive: true });
  } catch { /* ignore if exists */ }

  // Load existing config or create new
  let config: { allowedCommands?: string[] } = {};
  try {
    const content = await Deno.readTextFile(configPath);
    config = JSON.parse(content);
  } catch { /* file doesn't exist */ }

  // Merge commands
  const existing = new Set(config.allowedCommands ?? []);
  for (const cmd of commands) {
    existing.add(cmd);
  }
  config.allowedCommands = [...existing];

  // Write back
  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
  console.error(`[safesh] Added to always-allow: ${commands.join(", ")}`);
}

// addToSessionFile now replaced by addSessionCommands from core/session.ts

/**
 * Handle retry-path subcommand: desh retry-path --id=X --choice=<option>
 *
 * Choices: r1, w1, rw1 (once), r2, w2, rw2 (session), r3, w3, rw3 (always), deny
 */
async function handleRetryPath(args: string[]): Promise<void> {
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

  const cwd = pending.cwd;
  const projectDir = findProjectRoot(cwd);

  // Handle deny
  if (choice === "deny" || choice === "4") {
    console.error("[safesh] Path access denied by user.");
    deletePending(id, "path");
    Deno.exit(0);
  }

  // Parse choice: r1, w1, rw1, r2, w2, rw2, r3, w3, rw3, or with 'd' for directory (r1d, w2d, etc.)
  const match = choice.match(/^(r|w|rw)([123])(d?)$/);
  if (!match) {
    console.error(`Error: Invalid choice '${choice}'. Must be r1, w1, rw1, r2, w2, rw2, r3, w3, rw3 (or add 'd' for directory), or 4`);
    Deno.exit(1);
  }

  const operation = match[1]!; // r, w, or rw
  const scope = parseInt(match[2]!); // 1, 2, or 3
  const isDirectory = match[3] === "d"; // true if 'd' suffix present

  // Determine the path to grant permission to
  let permissionPath = pending.path;
  if (isDirectory) {
    // Grant permission to the directory instead of the file
    const pathParts = pending.path.split('/');
    permissionPath = pathParts.slice(0, -1).join('/') || '/';
    console.error(`[safesh] Granting permission to directory: ${permissionPath}/`);
  }

  // Determine which permissions to add
  const readPaths: string[] = [];
  const writePaths: string[] = [];

  if (operation === "r" || operation === "rw") {
    readPaths.push(permissionPath);
  }
  if (operation === "w" || operation === "rw") {
    writePaths.push(permissionPath);
  }

  // Apply permissions based on scope
  if (scope === 3) {
    // Always allow - update config.local.json
    await addPathsToConfigLocal(readPaths, writePaths, cwd);
  } else if (scope === 2) {
    // Session allow - update session file
    await addSessionPaths(readPaths, writePaths, projectDir);
    const msg = [];
    if (readPaths.length > 0) msg.push(`read: ${readPaths.join(", ")}`);
    if (writePaths.length > 0) msg.push(`write: ${writePaths.join(", ")}`);
    console.error(`[safesh] Added to session-allow paths: ${msg.join("; ")}`);
  }
  // scope === 1: allow once - just add to runtime config, no persistence

  // Load config and add paths
  const baseConfig = await loadConfig(cwd, { logWarnings: false });
  const config = mergeConfigs(baseConfig, { projectDir });

  // Load session permissions if they exist
  const sessionFile = getSessionFilePath(projectDir);
  try {
    const sessionContent = await Deno.readTextFile(sessionFile);
    const session = JSON.parse(sessionContent) as { permissions?: { read?: string[]; write?: string[] } };
    if (session.permissions) {
      config.permissions = config.permissions ?? {};
      if (session.permissions.read) {
        config.permissions.read = [
          ...(config.permissions.read ?? []),
          ...session.permissions.read,
        ];
      }
      if (session.permissions.write) {
        config.permissions.write = [
          ...(config.permissions.write ?? []),
          ...session.permissions.write,
        ];
      }
    }
  } catch (e) {
    // Session file doesn't exist or is invalid - continue without it
  }

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

  // Re-execute the script file
  // Set SAFESH_SCRIPT_HASH for debug output and SAFESH_SCRIPT_ID for retry flow
  Deno.env.set("SAFESH_SCRIPT_HASH", pending.scriptHash);
  Deno.env.set("SAFESH_SCRIPT_ID", id);

  try {
    const result = await executeFile(scriptFile, config, { cwd });

    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    // Don't cleanup pending file yet - it may be needed for command retries
    // The file will be cleaned up by subsequent retries or manual cleanup

    Deno.exit(result.code);
  } catch (error) {
    console.error(`Execution failed: ${error}`);
    deletePending(id, "path");
    Deno.exit(1);
  }
}

/**
 * Add paths to config.local.json for "always allow"
 */
async function addPathsToConfigLocal(
  readPaths: string[],
  writePaths: string[],
  cwd: string
): Promise<void> {
  const configDir = `${cwd}/.config/safesh`;
  const configPath = `${configDir}/config.local.json`;

  await Deno.mkdir(configDir, { recursive: true }).catch(() => {});

  let config: { permissions?: { read?: string[]; write?: string[] } } = {};
  try {
    const content = await Deno.readTextFile(configPath);
    config = JSON.parse(content);
  } catch { /* file doesn't exist */ }

  config.permissions = config.permissions ?? {};

  if (readPaths.length > 0) {
    const existing = new Set(config.permissions.read ?? []);
    for (const path of readPaths) existing.add(path);
    config.permissions.read = [...existing];
  }

  if (writePaths.length > 0) {
    const existing = new Set(config.permissions.write ?? []);
    for (const path of writePaths) existing.add(path);
    config.permissions.write = [...existing];
  }

  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");

  const msg = [];
  if (readPaths.length > 0) msg.push(`read: ${readPaths.join(", ")}`);
  if (writePaths.length > 0) msg.push(`write: ${writePaths.join(", ")}`);
  console.error(`[safesh] Added to always-allow (${msg.join("; ")})`);
}

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
  // Project dir: explicit flag > findProjectRoot (checks env + markers)
  const projectDir = (args.project as string | undefined)
    ?? findProjectRoot(cwd);
  // Default to streaming if stdout is a TTY, unless explicitly set
  const stream = args.stream !== undefined ? args.stream as boolean : Deno.stdout.isTerminal();

  // Load config with projectDir
  let config;
  try {
    if (configPath) {
      const module = await import(`file://${cwd}/${configPath}`);
      const baseConfig = module.default;
      // Merge projectDir into loaded config
      config = mergeConfigs(baseConfig, { projectDir });
      if (verbose) console.error(`Config loaded from ${configPath}`);
    } else {
      // Load base config without logging warnings (we'll validate after merge)
      const baseConfig = await loadConfig(cwd, { logWarnings: false });
      // Merge projectDir override
      config = mergeConfigs(baseConfig, { projectDir });
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

    // Merge session-allowed commands
    const sessionAllowed = getSessionAllowedCommandsArray(projectDir);
    if (sessionAllowed.length > 0) {
      config.permissions = config.permissions ?? {};
      config.permissions.run = [
        ...(config.permissions.run ?? []),
        ...sessionAllowed,
      ];
    }

    // Merge session-allowed path permissions
    const sessionPaths = getSessionPathPermissions(projectDir);
    if (sessionPaths.read && sessionPaths.read.length > 0) {
      config.permissions = config.permissions ?? {};
      config.permissions.read = [
        ...(config.permissions.read ?? []),
        ...sessionPaths.read,
      ];
    }
    if (sessionPaths.write && sessionPaths.write.length > 0) {
      config.permissions = config.permissions ?? {};
      config.permissions.write = [
        ...(config.permissions.write ?? []),
        ...sessionPaths.write,
      ];
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
    const result = await executeFile(filePath, config);

    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }

    Deno.exit(result.code);
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
