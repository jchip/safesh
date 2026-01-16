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
  /** Project temp directory config: true=.temp (default), false=/tmp, string=custom path */
  projectTemp?: boolean | string;
  /** VFS configuration */
  vfs?: {
    enabled: boolean;
    prefix?: string;
    maxSize?: number;
    maxFiles?: number;
    preload?: Record<string, string | null>;
  };
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
    projectTemp: config.projectTemp,
    vfs: config.vfs,
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
    `import { filter as __filter, map as __map, flatMap as __flatMap, take as __take, head as __head, tail as __tail, lines as __lines, grep as __grep, jq as __jq } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout as __stdout, stderr as __stderr, tee as __tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat as __cat, glob as __glob, src as __src, dest as __dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd as __cmd, git as __git, docker as __docker, tmux as __tmux, tmuxSubmit as __tmuxSubmit, str as __str, bytes as __bytes, toCmd as __toCmd, toCmdLines as __toCmdLines, initCmds as __initCmds } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands (aliased to avoid TDZ conflicts)",
    `import { echo as __echo, cd as __cd, pwd as __pwd, pushd as __pushd, popd as __popd, dirs as __dirs, tempdir as __tempdir, test as __test, which as __which, chmod as __chmod, ln as __ln, rm as __rm, cp as __cp, mv as __mv, mkdir as __mkdir, touch as __touch, ls as __ls, ShellString as __ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
    "",
    "// Import fluent shell API",
    `import __fluentShell, { FluentShell as __FluentShell } from 'file://${stdlibPath}shell.ts';`,
    `import { FluentStream as __FluentStream } from 'file://${stdlibPath}fluent-stream.ts';`,
    "",
  ];

  // Add VFS imports and setup if enabled
  if (preambleConfig?.vfs?.enabled) {
    const vfsPath = new URL("../vfs/", import.meta.url).pathname;
    preambleLines.push(
      "// Import Virtual File System",
      `import { VirtualFileSystem as __VirtualFileSystem, setupVFS as __setupVFS } from 'file://${vfsPath}mod.ts';`,
      "",
      "// Initialize VFS",
      `const __vfs = new __VirtualFileSystem(${JSON.stringify({
        prefix: preambleConfig.vfs.prefix,
        maxSize: preambleConfig.vfs.maxSize,
        maxFiles: preambleConfig.vfs.maxFiles,
      })});`,
      "",
    );

    // Add preload functionality if specified
    if (preambleConfig.vfs.preload && Object.keys(preambleConfig.vfs.preload).length > 0) {
      preambleLines.push(
        "// Preload VFS files",
        `const __vfsPreload = ${JSON.stringify(preambleConfig.vfs.preload)};`,
        `for (const [path, content] of Object.entries(__vfsPreload)) {`,
        `  if (content === null) {`,
        `    __vfs.mkdir(path, { recursive: true });`,
        `  } else {`,
        `    __vfs.write(path, new TextEncoder().encode(content));`,
        `  }`,
        `}`,
        "",
      );
    }

    preambleLines.push(
      "// Setup VFS interception",
      `const __restoreVFS = __setupVFS(__vfs);`,
      "",
    );
  }

  preambleLines.push(
    "// Sync shell ENV to Deno.env so child processes inherit them",
    `for (const [k, v] of Object.entries(${JSON.stringify(shellEnv)})) { Deno.env.set(k, v); }`,
    "",
    "// Helper function to execute commands and print their output",
    `async function __printCmd(cmd: any): Promise<number> {`,
    `  const result = await cmd;`,
    `  if (result.stdout) {`,
    `    await Deno.stdout.write(new TextEncoder().encode(result.stdout));`,
    `  }`,
    `  if (result.stderr) {`,
    `    await Deno.stderr.write(new TextEncoder().encode(result.stderr));`,
    `  }`,
    `  return result.code;`,
    `}`,
    "",
    "// Custom tempdir function that uses project config and shellId",
    `function __tempdir(): string {`,
    `  const projectTemp = ${JSON.stringify(preambleConfig?.projectTemp ?? true)};`,
    `  const projectDir = ${JSON.stringify(preambleConfig?.projectDir ?? "")};`,
    `  const rawShellId = ${JSON.stringify(shellId)};`,
    `  const shellId = rawShellId.replace(/[^a-zA-Z0-9_-]/g, '_');`,
    `  let baseDir: string;`,
    `  if (projectTemp === false) {`,
    `    baseDir = '/tmp';`,
    `  } else if (typeof projectTemp === 'string') {`,
    `    baseDir = projectTemp.startsWith('/') ? projectTemp : (projectDir ? projectDir + '/' + projectTemp : '/tmp');`,
    `  } else {`,
    `    baseDir = projectDir ? projectDir + '/.temp' : '/tmp';`,
    `  }`,
    `  const tempPath = shellId ? baseDir + '/' + shellId : baseDir;`,
    `  try { Deno.mkdirSync(tempPath, { recursive: true }); } catch {}`,
    `  return tempPath;`,
    `}`,
    "",
    "// Create $ namespace with all exports",
    `(globalThis as any).$ = {`,
    `  // Fluent file API`,
    `  cat: __fluentShell, FluentShell: __FluentShell,`,
    `  // Shell context (direct access, uppercase)`,
    `  ID: ${JSON.stringify(shellId)},`,
    `  get CWD() { return Deno.cwd(); },`,
    `  ProjectDir: ${JSON.stringify(preambleConfig?.projectDir ?? "")},`,
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
    `  cmd: async (name: string) => { const [fn] = await __initCmds([name]); return fn; },`,
    `  git: __git, docker: __docker, tmux: __tmux, tmuxSubmit: __tmuxSubmit, str: __str, bytes: __bytes, toCmd: __toCmd, toCmdLines: __toCmdLines, initCmds: __initCmds,`,
    `  // Streaming primitives (wrapped in FluentStream for chainable .filter/.map)`,
    `  createStream: (it: AsyncIterable<any>) => new __FluentStream(__createStream(it)),`,
    `  fromArray: (items: any[]) => new __FluentStream(__fromArray(items)),`,
    `  empty: () => new __FluentStream(__empty()),`,
    `  // Stream transforms`,
    `  filter: __filter, map: __map, flatMap: __flatMap, take: __take, head: __head, tail: __tail, lines: __lines, grep: __grep, jq: __jq,`,
    `  // I/O streams`,
    `  stdout: __stdout, stderr: __stderr, tee: __tee,`,
    `  // File streaming (cat is fluent API above, not streaming)`,
    `  glob: __glob, src: __src, dest: __dest,`,
    `  // Glob utilities from fs module (needed by shell parser)`,
    `  globPaths: __fs.globPaths, globArray: __fs.globArray,`,
    `  // ShellJS commands`,
    `  echo: __echo, cd: __cd, pwd: __pwd, pushd: __pushd, popd: __popd, dirs: __dirs, tempdir: __tempdir, test: __test, which: __which, chmod: __chmod, ln: __ln, rm: __rm, cp: __cp, mv: __mv, mkdir: __mkdir, touch: __touch, ls: __ls, ShellString: __ShellString,`,
    `  // Path utilities from @std/path`,
    `  path: __fs.path,`,
    `  // Timing utilities`,
    `  sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms)),`,
    `  delay: (ms: number) => new Promise<void>(r => setTimeout(r, ms)),`,
  );

  // Add VFS to $ if enabled
  if (preambleConfig?.vfs?.enabled) {
    preambleLines.push(
      `  // Virtual File System`,
      `  vfs: __vfs,`,
    );
  } else {
    // Close the $ object without VFS
    const lastLine = preambleLines[preambleLines.length - 1];
    if (lastLine) {
      preambleLines[preambleLines.length - 1] = lastLine.replace(/,$/, '');
    }
  }

  preambleLines.push(
    `};`,
    "",
  );

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
    `import { filter as __filter, map as __map, flatMap as __flatMap, take as __take, head as __head, tail as __tail, lines as __lines, grep as __grep, jq as __jq } from 'file://${stdlibPath}transforms.ts';`,
    `import { stdout as __stdout, stderr as __stderr, tee as __tee } from 'file://${stdlibPath}io.ts';`,
    `import { cat as __cat, glob as __glob, src as __src, dest as __dest } from 'file://${stdlibPath}fs-streams.ts';`,
    `import { cmd as __cmd, git as __git, docker as __docker, tmux as __tmux, tmuxSubmit as __tmuxSubmit, str as __str, bytes as __bytes, toCmd as __toCmd, toCmdLines as __toCmdLines, initCmds as __initCmds } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands (aliased to avoid TDZ conflicts)",
    `import { echo as __echo, cd as __cd, pwd as __pwd, pushd as __pushd, popd as __popd, dirs as __dirs, tempdir as __tempdir, test as __test, which as __which, chmod as __chmod, ln as __ln, rm as __rm, cp as __cp, mv as __mv, mkdir as __mkdir, touch as __touch, ls as __ls, ShellString as __ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
    "",
    "// Import fluent shell API",
    `import __fluentShell, { FluentShell as __FluentShell } from 'file://${stdlibPath}shell.ts';`,
    `import { FluentStream as __FluentStream } from 'file://${stdlibPath}fluent-stream.ts';`,
    "",
    "// Custom tempdir function that uses project config and shellId",
    `function __tempdir(): string {`,
    `  const projectTemp = ${JSON.stringify(preambleConfig?.projectTemp ?? true)};`,
    `  const projectDir = ${JSON.stringify(preambleConfig?.projectDir ?? "")};`,
    `  const rawShellId = ${JSON.stringify(shellId)};`,
    `  const shellId = rawShellId.replace(/[^a-zA-Z0-9_-]/g, '_');`,
    `  let baseDir: string;`,
    `  if (projectTemp === false) {`,
    `    baseDir = '/tmp';`,
    `  } else if (typeof projectTemp === 'string') {`,
    `    baseDir = projectTemp.startsWith('/') ? projectTemp : (projectDir ? projectDir + '/' + projectTemp : '/tmp');`,
    `  } else {`,
    `    baseDir = projectDir ? projectDir + '/.temp' : '/tmp';`,
    `  }`,
    `  const tempPath = shellId ? baseDir + '/' + shellId : baseDir;`,
    `  try { Deno.mkdirSync(tempPath, { recursive: true }); } catch {}`,
    `  return tempPath;`,
    `}`,
    "",
    "// Sync shell ENV to Deno.env so child processes inherit them",
    `for (const [k, v] of Object.entries(${JSON.stringify(shellEnv)})) { Deno.env.set(k, v); }`,
    "",
    "// Helper function to execute commands and print their output",
    `async function __printCmd(cmd: any): Promise<number> {`,
    `  const result = await cmd;`,
    `  if (result.stdout) {`,
    `    await Deno.stdout.write(new TextEncoder().encode(result.stdout));`,
    `  }`,
    `  if (result.stderr) {`,
    `    await Deno.stderr.write(new TextEncoder().encode(result.stderr));`,
    `  }`,
    `  return result.code;`,
    `}`,
    "",
    "// Create $ namespace with all exports",
    `(globalThis as any).$ = {`,
    `  cat: __fluentShell, FluentShell: __FluentShell,`,
    `  ID: ${JSON.stringify(shellId)},`,
    `  get CWD() { return Deno.cwd(); },`,
    `  ProjectDir: ${JSON.stringify(preambleConfig?.projectDir ?? "")},`,
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
    `  cmd: async (name: string) => { const [fn] = await __initCmds([name]); return fn; },`,
    `  git: __git, docker: __docker, tmux: __tmux, tmuxSubmit: __tmuxSubmit, str: __str, bytes: __bytes, toCmd: __toCmd, toCmdLines: __toCmdLines, initCmds: __initCmds,`,
    `  // Streaming primitives (wrapped in FluentStream for chainable .filter/.map)`,
    `  createStream: (it: AsyncIterable<any>) => new __FluentStream(__createStream(it)),`,
    `  fromArray: (items: any[]) => new __FluentStream(__fromArray(items)),`,
    `  empty: () => new __FluentStream(__empty()),`,
    `  filter: __filter, map: __map, flatMap: __flatMap, take: __take, head: __head, tail: __tail, lines: __lines, grep: __grep,`,
    `  stdout: __stdout, stderr: __stderr, tee: __tee,`,
    `  glob: __glob, src: __src, dest: __dest,`,
    `  globPaths: __fs.globPaths, globArray: __fs.globArray,`,
    `  echo: __echo, cd: __cd, pwd: __pwd, pushd: __pushd, popd: __popd, dirs: __dirs, tempdir: __tempdir, test: __test, which: __which, chmod: __chmod, ln: __ln, rm: __rm, cp: __cp, mv: __mv, mkdir: __mkdir, touch: __touch, ls: __ls, ShellString: __ShellString,`,
    `  path: __fs.path,`,
    `  // Timing utilities`,
    `  sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms)),`,
    `  delay: (ms: number) => new Promise<void>(r => setTimeout(r, ms)),`,
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
export function buildErrorHandler(scriptPath: string, preambleLineCount: number, hasShell: boolean, vfsEnabled = false): string {
  const shellOutput = hasShell
    ? `console.log("${SHELL_STATE_MARKER}" + JSON.stringify({ CWD: Deno.cwd(), ENV: $.ENV, VARS: $.VARS }));`
    : "";

  const vfsCleanup = vfsEnabled
    ? `  // Cleanup VFS
  if (typeof __restoreVFS === 'function') {
    try { __restoreVFS(); } catch {}
  }
  if (typeof __vfs !== 'undefined' && typeof __vfs.clear === 'function') {
    try { __vfs.clear(); } catch {}
  }`
    : "";

  return `
})().then(() => {
  ${shellOutput}
  ${vfsCleanup}
}).catch((e) => {
  ${vfsCleanup}
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
