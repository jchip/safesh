#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * SafeShell CLI entry point
 */

import { parseArgs } from "@std/cli/parse-args";

const VERSION = "0.1.0";

const HELP = `
SafeShell - Secure shell for AI assistants

USAGE:
  safesh <command> [options]

COMMANDS:
  exec <code>       Execute JS/TS code in sandbox
  run <cmd> [args]  Run whitelisted external command
  task <name>       Run defined task
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
  safesh serve
`;

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

  switch (command) {
    case "exec":
      // TODO: Implement after SSH-17
      console.log("exec:", rest.join(" "));
      console.error("Not implemented yet");
      Deno.exit(1);
      break;

    case "run":
      // TODO: Implement after SSH-18
      console.log("run:", rest.join(" "));
      console.error("Not implemented yet");
      Deno.exit(1);
      break;

    case "task":
      // TODO: Implement after SSH-19
      console.log("task:", rest[0]);
      console.error("Not implemented yet");
      Deno.exit(1);
      break;

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
