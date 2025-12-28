/**
 * Preamble builder for SafeShell code execution
 *
 * Generates the auto-import preamble that gets prepended to user code.
 * Used by both foreground (executor.ts) and background (scripts.ts) execution.
 *
 * @module
 */

import type { Shell } from "../core/types.ts";

// Marker used to identify shell state output for syncing vars back
export const SHELL_STATE_MARKER = "__SAFESH_STATE__:";

/**
 * Get the absolute path to the stdlib directory
 */
function getStdlibPath(): string {
  return new URL("../stdlib/", import.meta.url).pathname;
}

/**
 * Build the preamble that gets prepended to user code
 *
 * The preamble injects:
 * - Shell context as $shell
 * - Standard library (fs, text)
 * - Streaming shell API (cat, glob, git, lines, grep, map, filter, etc.)
 * - ShellJS-like commands (echo, cd, pwd, chmod, etc.)
 */
export function buildPreamble(shell?: Shell): string {
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
    `import { cmd, git, docker, deno, str, bytes, toCmd, toCmdLines, init } from 'file://${stdlibPath}command.ts';`,
    "",
    "// Import shelljs-like commands",
    `import { echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, ShellString } from 'file://${stdlibPath}shelljs/mod.ts';`,
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

  lines.push(
    "// User code starts here",
    "",
  );

  return lines.join("\n");
}

/**
 * Build epilogue that outputs shell state for syncing back
 */
export function buildEpilogue(hasShell: boolean): string {
  if (!hasShell) return "";

  return `
// SafeShell epilogue - output shell state for syncing
console.log("${SHELL_STATE_MARKER}" + JSON.stringify($shell.vars));
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
