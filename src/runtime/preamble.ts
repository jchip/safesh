/**
 * Preamble builder for SafeShell code execution
 *
 * Generates the auto-import preamble that gets prepended to user code.
 * Used by both foreground (executor.ts) and background (scripts.ts) execution.
 *
 * @module
 */

import type { Shell, SafeShellConfig } from "../core/types.ts";

// Marker used to identify shell state output for syncing vars back
export const SHELL_STATE_MARKER = "__SAFESH_STATE__:";

/**
 * Get the absolute path to the stdlib directory
 */
function getStdlibPath(): string {
  return new URL("../stdlib/", import.meta.url).pathname;
}

/**
 * Config subset needed for permission checking in init()
 */
export interface PreambleConfig {
  projectDir?: string;
  allowProjectCommands?: boolean;
  allowedCommands: string[]; // Merged from permissions.run + external keys
  cwd: string;
}

/**
 * Extract the config subset needed for preamble
 */
export function extractPreambleConfig(config: SafeShellConfig, cwd: string): PreambleConfig {
  const allowedCommands = new Set<string>();

  // Add from permissions.run
  if (config.permissions?.run) {
    for (const cmd of config.permissions.run) {
      allowedCommands.add(cmd);
    }
  }

  // Add from external command configs
  if (config.external) {
    for (const cmd of Object.keys(config.external)) {
      allowedCommands.add(cmd);
    }
  }

  return {
    projectDir: config.projectDir,
    allowProjectCommands: config.allowProjectCommands,
    allowedCommands: Array.from(allowedCommands),
    cwd,
  };
}

/**
 * Build the preamble that gets prepended to user code
 *
 * The preamble injects:
 * - Shell context as $shell
 * - Config for permission checking as $config
 * - Standard library (fs, text)
 * - Streaming shell API (cat, glob, git, lines, grep, map, filter, etc.)
 * - ShellJS-like commands (echo, cd, pwd, chmod, etc.)
 */
export function buildPreamble(shell?: Shell, preambleConfig?: PreambleConfig): { preamble: string; preambleLineCount: number } {
  const stdlibPath = getStdlibPath();

  const lines: string[] = [
    "// SafeShell auto-generated preamble",
    "",
    "// Import standard library",
    `import * as fs from 'file://${stdlibPath}fs.ts';`,
    `import * as text from 'file://${stdlibPath}text.ts';`,
    "",
    "// Import streaming shell API",
    `import { createStream, fromArray, empty } from 'file://${stdlibPath}stream.ts';`,
    `import { filter, map, flatMap, take, head, tail, lines, grep } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout, stderr, tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat, glob, src, dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd, git, docker, deno, str, bytes, toCmd, toCmdLines, initCmds } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands",
    `import { echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
    "",
    "// Import fluent shell API",
    `import $, { FluentShell } from 'file://${stdlibPath}shell.ts';`,
    "",
  ];

  if (shell) {
    // Use 'const' for $shell - vars inside are mutable
    lines.push(
      "// Shell context available as $shell (mutable for var persistence)",
      `const $shell: { id: string; cwd: string; env: Record<string, string>; vars: Record<string, unknown> } = ${JSON.stringify({
        id: shell.id,
        cwd: shell.cwd,
        env: shell.env,
        vars: shell.vars,
      })};`,
      "",
    );
  }

  if (preambleConfig) {
    // Config for permission checking in init()
    lines.push(
      "// Config for permission checking",
      `const $config: { projectDir?: string; allowProjectCommands?: boolean; allowedCommands: string[]; cwd: string } = ${JSON.stringify(preambleConfig)};`,
      "",
    );
  }

  // Count lines so far for line number mapping (before the async function line)
  const preambleLineCount = lines.length + 1; // +1 for the function declaration line

  lines.push(
    "// User code wrapped in async function for error handling",
    "(async () => {",
  );

  return { preamble: lines.join("\n"), preambleLineCount };
}

/**
 * Build the error-handling wrapper that closes the async IIFE
 *
 * @param scriptPath - Path to the script file (for stack trace line mapping)
 * @param preambleLineCount - Number of preamble lines (for line number offset)
 * @param hasShell - Whether to output shell state after execution
 */
export function buildErrorHandler(scriptPath: string, preambleLineCount: number, hasShell: boolean): string {
  const shellOutput = hasShell
    ? `console.log("${SHELL_STATE_MARKER}" + JSON.stringify($shell.vars));`
    : "";

  return `
})().then(() => {
  ${shellOutput}
}).catch((e) => {
  // Known friendly error patterns that don't need stack traces
  const FRIENDLY = [/^Command not found:/, /^Command ".+" is not allowed/, /^Project command/];
  const msg = e instanceof Error ? e.message : String(e);

  // Check if friendly error
  if (FRIENDLY.some(p => p.test(msg))) {
    console.error("Error: " + msg);
    Deno.exit(1);
  }

  // For other errors, try to find user code line in stack
  const stack = e instanceof Error ? (e.stack ?? "") : "";
  const scriptPath = ${JSON.stringify(scriptPath)};
  const preambleLines = ${preambleLineCount};

  for (const line of stack.split("\\n")) {
    if (line.includes(scriptPath)) {
      const m = line.match(/:(\\d+):\\d+\\)?$/);
      if (m) {
        const userLine = parseInt(m[1], 10) - preambleLines;
        if (userLine > 0) {
          console.error("Error: " + msg + "\\n  at line " + userLine + " in your code");
          Deno.exit(1);
        }
      }
      break;
    }
  }

  // Fallback: just show the error message
  console.error("Error: " + msg);
  Deno.exit(1);
});
`;
}

/**
 * Extract shell state from output and return cleaned output
 */
export function extractShellState(output: string): {
  cleanOutput: string;
  vars?: Record<string, unknown>;
} {
  const outputLines = output.split("\n");
  const stateLineIndex = outputLines.findIndex((line) =>
    line.startsWith(SHELL_STATE_MARKER)
  );

  if (stateLineIndex === -1) {
    return { cleanOutput: output };
  }

  const stateLine = outputLines[stateLineIndex]!;
  const jsonStr = stateLine.slice(SHELL_STATE_MARKER.length);

  // Remove the state line from output
  outputLines.splice(stateLineIndex, 1);
  const cleanOutput = outputLines.join("\n");

  try {
    const vars = JSON.parse(jsonStr) as Record<string, unknown>;
    return { cleanOutput, vars };
  } catch {
    return { cleanOutput: output };
  }
}
