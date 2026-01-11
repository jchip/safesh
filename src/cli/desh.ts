#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
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

const VERSION = "0.1.0";

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

async function readStdin(): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["code", "file", "import", "config", "project"],
    boolean: ["verbose", "help", "version", "stream", "quiet"],
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

  const cwd = Deno.cwd();
  const verbose = args.verbose as boolean;
  const quiet = args.quiet as boolean;
  const configPath = args.config as string | undefined;
  // Project dir: explicit flag > CLAUDE_PROJECT_DIR env > fallback to cwd
  const projectDir = (args.project as string | undefined)
    ?? Deno.env.get("CLAUDE_PROJECT_DIR")
    ?? cwd;
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
    const code = await readStdin();
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
      code = await readStdin();
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
