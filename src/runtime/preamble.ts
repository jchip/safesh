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
 * - Global $ namespace with all APIs
 * - Shell context directly on $ (ID, CWD, ENV, VARS)
 * - Config for permission checking (Symbol-keyed)
 * - Standard library (fs, text)
 * - Streaming shell API (cat, glob, git, lines, grep, map, filter, etc.)
 * - ShellJS-like commands (echo, cd, pwd, chmod, etc.)
 */
export function buildPreamble(shell?: Shell, preambleConfig?: PreambleConfig): { preamble: string; preambleLineCount: number } {
  const stdlibPath = getStdlibPath();

  // Shell context values (or defaults if no shell)
  const shellId = shell?.id ?? "";
  const shellCwd = shell?.cwd ?? "";
  const shellEnv = shell?.env ?? {};
  const shellVars = shell?.vars ?? {};

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
    `import fluentShell, { FluentShell } from 'file://${stdlibPath}shell.ts';`,
    "",
    "// Create $ namespace with all exports",
    `(globalThis as any).$ = {`,
    `  // Fluent file API`,
    `  cat: fluentShell, FluentShell,`,
    `  // Shell context (direct access, uppercase)`,
    `  ID: ${JSON.stringify(shellId)},`,
    `  CWD: ${JSON.stringify(shellCwd)},`,
    `  ENV: ${JSON.stringify(shellEnv)},`,
    `  VARS: ${JSON.stringify(shellVars)},`,
    `  // Internal (Symbol-keyed)`,
    `  [Symbol.for('safesh.config')]: ${preambleConfig ? JSON.stringify(preambleConfig) : "undefined"},`,
    `  // Namespaced modules`,
    `  fs, text,`,
    `  // Command execution`,
    `  cmd, git, docker, deno, str, bytes, toCmd, toCmdLines, initCmds,`,
    `  // Streaming primitives`,
    `  createStream, fromArray, empty,`,
    `  // Stream transforms`,
    `  filter, map, flatMap, take, head, tail, lines, grep,`,
    `  // I/O streams`,
    `  stdout, stderr, tee,`,
    `  // File streaming`,
    `  cat, glob, src, dest,`,
    `  // ShellJS commands`,
    `  echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString,`,
    `};`,
    "",
  ];

  // Count lines so far for line number mapping (before the async function line)
  const preambleLineCount = lines.length + 1; // +1 for the function declaration line

  lines.push(
    "// User code wrapped in async function for error handling",
    "(async () => {",
  );

  return { preamble: lines.join("\n"), preambleLineCount };
}

/**
 * Build preamble for file execution (no async wrapper)
 * Just sets up imports and $ namespace, then file runs as-is
 */
export function buildFilePreamble(shell?: Shell, preambleConfig?: PreambleConfig): string {
  const stdlibPath = getStdlibPath();

  const shellId = shell?.id ?? "";
  const shellCwd = shell?.cwd ?? "";
  const shellEnv = shell?.env ?? {};
  const shellVars = shell?.vars ?? {};

  const lines: string[] = [
    "// SafeShell auto-generated preamble for file execution",
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
    `import fluentShell, { FluentShell } from 'file://${stdlibPath}shell.ts';`,
    "",
    "// Create $ namespace with all exports",
    `(globalThis as any).$ = {`,
    `  cat: fluentShell, FluentShell,`,
    `  ID: ${JSON.stringify(shellId)},`,
    `  CWD: ${JSON.stringify(shellCwd)},`,
    `  ENV: ${JSON.stringify(shellEnv)},`,
    `  VARS: ${JSON.stringify(shellVars)},`,
    `  [Symbol.for('safesh.config')]: ${preambleConfig ? JSON.stringify(preambleConfig) : "undefined"},`,
    `  fs, text,`,
    `  cmd, git, docker, deno, str, bytes, toCmd, toCmdLines, initCmds,`,
    `  createStream, fromArray, empty,`,
    `  filter, map, flatMap, take, head, tail, lines, grep,`,
    `  stdout, stderr, tee,`,
    `  cat, glob, src, dest,`,
    `  echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString,`,
    `};`,
    "",
    "// Original file content below",
    "",
  ];

  return lines.join("\n");
}

/**
 * Build postamble for file execution that outputs shell state
 * @param hasShell - Whether to output shell state
 */
export function buildFilePostamble(hasShell: boolean): string {
  if (!hasShell) return "";
  return `\n\n// SafeShell auto-generated postamble - output shell state\nconsole.log("${SHELL_STATE_MARKER}" + JSON.stringify({ CWD: Deno.cwd(), ENV: $.ENV, VARS: $.VARS }));\n`;
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
    ? `console.log("${SHELL_STATE_MARKER}" + JSON.stringify({ CWD: Deno.cwd(), ENV: $.ENV, VARS: $.VARS }));`
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
  cwd?: string;
  env?: Record<string, string>;
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
    const state = JSON.parse(jsonStr) as { CWD?: string; ENV?: Record<string, string>; VARS?: Record<string, unknown> };
    return { cleanOutput, cwd: state.CWD, env: state.ENV, vars: state.VARS };
  } catch {
    return { cleanOutput: output };
  }
}
