#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * SafeShell CLI entry point
 */

import { parseArgs } from "@std/cli/parse-args";
import { loadConfig } from "../core/config.ts";
import { executeCode } from "../runtime/executor.ts";
import { runExternal } from "../external/runner.ts";
import { SafeShellError } from "../core/errors.ts";
import type { SafeShellConfig } from "../core/types.ts";
import { runTask as executeTask } from "../runner/tasks.ts";
import { shellsCommand } from "./commands/shells.ts";
import { tasksCommand } from "./commands/tasks.ts";
import { logsCommand } from "./commands/logs.ts";
import { killCommand } from "./commands/kill.ts";
import { cleanCommand } from "./commands/clean.ts";

const VERSION = "0.1.0";

const HELP = `
SafeShell - Secure shell for AI assistants

USAGE:
  safesh <command> [options]

COMMANDS:
  exec <code>          Execute JS/TS code in sandbox
  run <cmd> [args]     Run whitelisted external command
  task <name>          Run defined task
  repl                 Start interactive REPL
  serve                Start MCP server

  State Management (MCP server):
  shells               List all shells
  tasks [options]      List scripts/jobs
  logs <scriptId>      View script output
  kill <scriptId>      Send SIGTERM to script
  clean                Remove stale state

OPTIONS:
  -c, --config <file>  Config file (default: ./safesh.config.ts)
  -v, --verbose        Verbose output
  -h, --help           Show this help
  --version            Show version

  Task options:
  --running            Only show running tasks
  --shell <shellId>    Filter by shell ID
  --status <status>    Filter by status (running|completed|failed)

EXAMPLES:
  safesh exec "console.log('hello')"
  safesh run git status
  safesh task build
  safesh repl
  safesh serve

  safesh shells
  safesh tasks --running
  safesh tasks --shell sh_abc123
  safesh logs script_xyz789
  safesh kill script_xyz789
  safesh clean
`;

/**
 * Execute a task from the config (CLI wrapper)
 */
async function runTask(
  taskName: string,
  config: SafeShellConfig,
  verbose: boolean,
): Promise<void> {
  const result = await executeTask(taskName, config, { verbose });

  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    console.error(result.stderr);
  }

  if (!result.success) {
    Deno.exit(result.code);
  }
}

/**
 * Start an interactive REPL
 */
async function startRepl(config: SafeShellConfig): Promise<void> {
  console.log(`SafeShell REPL v${VERSION}`);
  console.log("Type .help for commands, .exit to quit");
  console.log("");

  const decoder = new TextDecoder();
  const buffer = new Uint8Array(1024);

  while (true) {
    // Print prompt
    await Deno.stdout.write(new TextEncoder().encode("> "));

    // Read input
    const n = await Deno.stdin.read(buffer);
    if (n === null) {
      break; // EOF
    }

    const input = decoder.decode(buffer.subarray(0, n)).trim();

    // Handle REPL commands
    if (input === ".exit" || input === ".quit") {
      console.log("Goodbye!");
      break;
    }

    if (input === ".help") {
      console.log("REPL commands:");
      console.log("  .help    Show this help");
      console.log("  .exit    Exit REPL");
      console.log("  .quit    Exit REPL");
      console.log("");
      continue;
    }

    if (!input) {
      continue;
    }

    // Execute code
    try {
      const result = await executeCode(input, config);

      if (result.stdout) {
        console.log(result.stdout);
      }
      if (result.stderr) {
        console.error(result.stderr);
      }
      if (!result.success) {
        console.error(`Exit code: ${result.code}`);
      }
    } catch (error) {
      if (error instanceof SafeShellError) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error(`Error: ${error}`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["config", "shell", "status"],
    boolean: ["verbose", "help", "version", "running"],
    alias: {
      c: "config",
      v: "verbose",
      h: "help",
    },
    default: {
      config: "./safesh.config.ts",
      verbose: false,
    },
  });

  if (args.help) {
    console.log(HELP);
    Deno.exit(0);
  }

  if (args.version) {
    console.log(`safesh ${VERSION}`);
    Deno.exit(0);
  }

  const [command, ...rest] = args._;
  const cwd = Deno.cwd();
  const verbose = args.verbose as boolean;
  const configPath = args.config as string;

  // State management commands don't need config
  const stateCommands = ["shells", "tasks", "logs", "kill", "clean"];
  if (stateCommands.includes(String(command))) {
    switch (command) {
      case "shells":
        await shellsCommand();
        break;

      case "tasks":
        await tasksCommand({
          running: args.running,
          shellId: args.shell,
          status: args.status as "running" | "completed" | "failed" | undefined,
        });
        break;

      case "logs":
        if (rest.length === 0) {
          console.error("Usage: safesh logs <scriptId>");
          Deno.exit(1);
        }
        await logsCommand(String(rest[0]));
        break;

      case "kill":
        if (rest.length === 0) {
          console.error("Usage: safesh kill <scriptId>");
          Deno.exit(1);
        }
        await killCommand(String(rest[0]));
        break;

      case "clean":
        await cleanCommand();
        break;
    }
    return;
  }

  // Load config for all commands except serve (which has its own startup)
  let config: SafeShellConfig | undefined;
  if (command !== "serve") {
    try {
      // If custom config path specified, load it directly
      if (configPath !== "./safesh.config.ts") {
        const module = await import(`file://${Deno.cwd()}/${configPath}`);
        config = module.default;
        if (verbose) {
          console.log(`Config loaded from ${configPath}`);
        }
      } else {
        // Use default config loading
        config = await loadConfig(cwd);
        if (verbose) {
          console.log("Config loaded successfully");
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
  }

  switch (command) {
    case "exec": {
      if (rest.length === 0) {
        console.error("Usage: safesh exec <code>");
        Deno.exit(1);
      }

      const code = rest.join(" ");

      try {
        const result = await executeCode(code, config!);

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
      break;
    }

    case "run": {
      if (rest.length === 0) {
        console.error("Usage: safesh run <cmd> [args...]");
        Deno.exit(1);
      }

      const cmd = String(rest[0]);
      const cmdArgs = rest.slice(1).map(String);

      try {
        const result = await runExternal(cmd, cmdArgs, config!);

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
      break;
    }

    case "task": {
      if (rest.length === 0) {
        console.error("Usage: safesh task <name>");
        Deno.exit(1);
      }

      const taskName = String(rest[0]);

      try {
        await runTask(taskName, config!, verbose);
      } catch (error) {
        if (error instanceof SafeShellError) {
          console.error(`Error: ${error.message}`);
        } else {
          console.error(`Task failed: ${error}`);
        }
        Deno.exit(1);
      }
      break;
    }

    case "repl": {
      try {
        await startRepl(config!);
      } catch (error) {
        if (error instanceof SafeShellError) {
          console.error(`Error: ${error.message}`);
        } else {
          console.error(`REPL failed: ${error}`);
        }
        Deno.exit(1);
      }
      break;
    }

    case "serve":
      // TODO: Implement after SSH-16
      console.log("Starting MCP server...");
      console.error("Not implemented yet");
      Deno.exit(1);
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
      }
      console.log(HELP);
      Deno.exit(command ? 1 : 0);
  }
}

if (import.meta.main) {
  main();
}
