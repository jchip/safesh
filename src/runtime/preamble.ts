/**
 * Preamble builder for SafeShell code execution
 *
 * Generates the auto-import preamble that gets prepended to user code.
 * Used by both foreground (executor.ts) and background (scripts.ts) execution.
 *
 * @module
 */

import type { Shell, SafeShellConfig } from "../core/types.ts";
import { SHELL_STATE_MARKER } from "../core/constants.ts";

// Re-export for backward compatibility
export { SHELL_STATE_MARKER };

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

  // Use aliased imports to avoid TDZ conflicts when user code declares same-named variables
  const preambleLines: string[] = [
    "// SafeShell auto-generated preamble",
    "",
    "// Import standard library",
    `import * as __fs from 'file://${stdlibPath}fs.ts';`,
    `import * as __text from 'file://${stdlibPath}text.ts';`,
    "",
    "// Import streaming shell API (aliased to avoid TDZ conflicts with user code)",
    `import { createStream as __createStream, fromArray as __fromArray, empty as __empty } from 'file://${stdlibPath}stream.ts';`,
    `import { filter as __filter, map as __map, flatMap as __flatMap, take as __take, head as __head, tail as __tail, lines as __lines, grep as __grep } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout as __stdout, stderr as __stderr, tee as __tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat as __cat, glob as __glob, src as __src, dest as __dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd as __cmd, git as __git, docker as __docker, tmux as __tmux, tmuxSubmit as __tmuxSubmit, str as __str, bytes as __bytes, toCmd as __toCmd, toCmdLines as __toCmdLines, initCmds as __initCmds } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands (aliased to avoid TDZ conflicts)",
    `import { echo as __echo, cd as __cd, pwd as __pwd, pushd as __pushd, popd as __popd, dirs as __dirs, tempdir as __tempdir, env as __env, test as __test, which as __which, chmod as __chmod, ln as __ln, rm as __rm, cp as __cp, mv as __mv, mkdir as __mkdir, touch as __touch, ls as __ls, ShellString as __ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
    "",
    "// Import fluent shell API",
    `import __fluentShell, { FluentShell as __FluentShell } from 'file://${stdlibPath}shell.ts';`,
    "",
    "// Sync shell ENV to Deno.env so child processes inherit them",
    `for (const [k, v] of Object.entries(${JSON.stringify(shellEnv)})) { Deno.env.set(k, v); }`,
    "",
    "// Create $ namespace with all exports",
    `(globalThis as any).$ = {`,
    `  // Fluent file API`,
    `  cat: __fluentShell, FluentShell: __FluentShell,`,
    `  // Shell context (direct access, uppercase)`,
    `  ID: ${JSON.stringify(shellId)},`,
    `  CWD: ${JSON.stringify(shellCwd)},`,
    `  ENV: new Proxy(${JSON.stringify(shellEnv)}, {`,
    `    set(target, prop, value) {`,
    `      target[prop] = value;`,
    `      if (typeof prop === 'string') Deno.env.set(prop, String(value));`,
    `      return true;`,
    `    },`,
    `    deleteProperty(target, prop) {`,
    `      delete target[prop];`,
    `      if (typeof prop === 'string') Deno.env.delete(prop);`,
    `      return true;`,
    `    }`,
    `  }),`,
    `  VARS: ${JSON.stringify(shellVars)},`,
    `  // Internal (Symbol-keyed)`,
    `  [Symbol.for('safesh.config')]: ${preambleConfig ? JSON.stringify(preambleConfig) : "undefined"},`,
    `  // Namespaced modules`,
    `  fs: __fs, text: __text,`,
    `  // Command execution`,
    `  cmd: __cmd, git: __git, docker: __docker, tmux: __tmux, tmuxSubmit: __tmuxSubmit, str: __str, bytes: __bytes, toCmd: __toCmd, toCmdLines: __toCmdLines, initCmds: __initCmds,`,
    `  // Streaming primitives`,
    `  createStream: __createStream, fromArray: __fromArray, empty: __empty,`,
    `  // Stream transforms`,
    `  filter: __filter, map: __map, flatMap: __flatMap, take: __take, head: __head, tail: __tail, lines: __lines, grep: __grep,`,
    `  // I/O streams`,
    `  stdout: __stdout, stderr: __stderr, tee: __tee,`,
    `  // File streaming (cat is fluent API above, not streaming)`,
    `  glob: __glob, src: __src, dest: __dest,`,
    `  // Glob utilities from fs module (needed by shell parser)`,
    `  globPaths: __fs.globPaths, globArray: __fs.globArray,`,
    `  // ShellJS commands`,
    `  echo: __echo, cd: __cd, pwd: __pwd, pushd: __pushd, popd: __popd, dirs: __dirs, tempdir: __tempdir, env: __env, test: __test, which: __which, chmod: __chmod, ln: __ln, rm: __rm, cp: __cp, mv: __mv, mkdir: __mkdir, touch: __touch, ls: __ls, ShellString: __ShellString,`,
    `  // Path utilities from @std/path`,
    `  path: __fs.path,`,
    `};`,
    "",
  ];

  // Count lines so far for line number mapping (before the async function line)
  const preambleLineCount = preambleLines.length + 1; // +1 for the function declaration line

  preambleLines.push(
    "// User code wrapped in async function for error handling",
    "(async () => {",
  );

  return { preamble: preambleLines.join("\n"), preambleLineCount };
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

  // Use aliased imports to avoid TDZ conflicts when user code declares same-named variables
  const preambleLines: string[] = [
    "// SafeShell auto-generated preamble for file execution",
    "",
    "// Import standard library",
    `import * as __fs from 'file://${stdlibPath}fs.ts';`,
    `import * as __text from 'file://${stdlibPath}text.ts';`,
    "",
    "// Import streaming shell API (aliased to avoid TDZ conflicts with user code)",
    `import { createStream as __createStream, fromArray as __fromArray, empty as __empty } from 'file://${stdlibPath}stream.ts';`,
    `import { filter as __filter, map as __map, flatMap as __flatMap, take as __take, head as __head, tail as __tail, lines as __lines, grep as __grep } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout as __stdout, stderr as __stderr, tee as __tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat as __cat, glob as __glob, src as __src, dest as __dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd as __cmd, git as __git, docker as __docker, tmux as __tmux, tmuxSubmit as __tmuxSubmit, str as __str, bytes as __bytes, toCmd as __toCmd, toCmdLines as __toCmdLines, initCmds as __initCmds } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands (aliased to avoid TDZ conflicts)",
    `import { echo as __echo, cd as __cd, pwd as __pwd, pushd as __pushd, popd as __popd, dirs as __dirs, tempdir as __tempdir, env as __env, test as __test, which as __which, chmod as __chmod, ln as __ln, rm as __rm, cp as __cp, mv as __mv, mkdir as __mkdir, touch as __touch, ls as __ls, ShellString as __ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
    "",
    "// Import fluent shell API",
    `import __fluentShell, { FluentShell as __FluentShell } from 'file://${stdlibPath}shell.ts';`,
    "",
    "// Sync shell ENV to Deno.env so child processes inherit them",
    `for (const [k, v] of Object.entries(${JSON.stringify(shellEnv)})) { Deno.env.set(k, v); }`,
    "",
    "// Create $ namespace with all exports",
    `(globalThis as any).$ = {`,
    `  cat: __fluentShell, FluentShell: __FluentShell,`,
    `  ID: ${JSON.stringify(shellId)},`,
    `  CWD: ${JSON.stringify(shellCwd)},`,
    `  ENV: new Proxy(${JSON.stringify(shellEnv)}, {`,
    `    set(target, prop, value) {`,
    `      target[prop] = value;`,
    `      if (typeof prop === 'string') Deno.env.set(prop, String(value));`,
    `      return true;`,
    `    },`,
    `    deleteProperty(target, prop) {`,
    `      delete target[prop];`,
    `      if (typeof prop === 'string') Deno.env.delete(prop);`,
    `      return true;`,
    `    }`,
    `  }),`,
    `  VARS: ${JSON.stringify(shellVars)},`,
    `  [Symbol.for('safesh.config')]: ${preambleConfig ? JSON.stringify(preambleConfig) : "undefined"},`,
    `  fs: __fs, text: __text,`,
    `  cmd: __cmd, git: __git, docker: __docker, tmux: __tmux, tmuxSubmit: __tmuxSubmit, str: __str, bytes: __bytes, toCmd: __toCmd, toCmdLines: __toCmdLines, initCmds: __initCmds,`,
    `  createStream: __createStream, fromArray: __fromArray, empty: __empty,`,
    `  filter: __filter, map: __map, flatMap: __flatMap, take: __take, head: __head, tail: __tail, lines: __lines, grep: __grep,`,
    `  stdout: __stdout, stderr: __stderr, tee: __tee,`,
    `  glob: __glob, src: __src, dest: __dest,`,
    `  globPaths: __fs.globPaths, globArray: __fs.globArray,`,
    `  echo: __echo, cd: __cd, pwd: __pwd, pushd: __pushd, popd: __popd, dirs: __dirs, tempdir: __tempdir, env: __env, test: __test, which: __which, chmod: __chmod, ln: __ln, rm: __rm, cp: __cp, mv: __mv, mkdir: __mkdir, touch: __touch, ls: __ls, ShellString: __ShellString,`,
    `  path: __fs.path,`,
    `};`,
    "",
    "// Original file content below",
    "",
  ];

  return preambleLines.join("\n");
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
