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

const VERSION = "0.1.0";

const HELP = `
SafeShell - Secure shell for AI assistants

USAGE:
  safesh <command> [options]

COMMANDS:
  exec <code>       Execute JS/TS code in sandbox
  run <cmd> [args]  Run whitelisted external command
  task <name>       Run defined task
  repl              Start interactive REPL
  serve             Start MCP server

OPTIONS:
  -c, --config <file>  Config file (default: ./safesh.config.ts)
  -v, --verbose        Verbose output
  -h, --help           Show this help
  --version            Show version

EXAMPLES:
  safesh exec "console.log('hello')"
  safesh run git status
  safesh task build
  safesh repl
  safesh serve
`;

/**
 * Execute a task from the config
 */
async function runTask(
  taskName: string,
  config: SafeShellConfig,
  verbose: boolean,
): Promise<void> {
  const taskDef = config.tasks?.[taskName];

  if (!taskDef) {
    console.error(`Task '${taskName}' not found in config`);
    console.error(`Available tasks: ${Object.keys(config.tasks ?? {}).join(", ")}`);
    Deno.exit(1);
  }

  // Handle task reference (string)
  if (typeof taskDef === "string") {
    await runTask(taskDef, config, verbose);
    return;
  }

  const task = taskDef;

  if (verbose) {
    console.log(`Running task: ${taskName}`);
  }

  // Handle simple command task
  if (task.cmd) {
    const result = await executeCode(task.cmd, config, {
      cwd: task.cwd,
    });

    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }

    if (!result.success) {
      Deno.exit(result.code);
    }
    return;
  }

  // Handle parallel tasks
  if (task.parallel) {
    if (verbose) {
      console.log(`Running tasks in parallel: ${task.parallel.join(", ")}`);
    }

    const results = await Promise.allSettled(
      task.parallel.map((t: string) => runTask(t, config, verbose)),
    );

    const failed = results.filter(
      (r: PromiseSettledResult<void>) => r.status === "rejected",
    );
    if (failed.length > 0) {
      console.error(`${failed.length} parallel task(s) failed`);
      Deno.exit(1);
    }
    return;
  }

  // Handle serial tasks
  if (task.serial) {
    if (verbose) {
      console.log(`Running tasks in series: ${task.serial.join(", ")}`);
    }

    for (const t of task.serial) {
      await runTask(t, config, verbose);
    }
    return;
  }

  console.error(`Task '${taskName}' has no executable configuration`);
  Deno.exit(1);
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
    string: ["config"],
    boolean: ["verbose", "help", "version"],
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
