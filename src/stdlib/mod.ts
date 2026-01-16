/**
 * SafeShell standard library
 *
 * Provides shell-like utilities in a safe, sandboxed environment.
 *
 * `$` is available globally in both code and file execution modes:
 * ```typescript
 * await $.fs.read('file.txt');
 * await $.git('status').exec();
 * await $.content('file.txt').lines().grep(/pat/).collect();
 * ```
 *
 * @module
 */

// Re-export namespaced modules
import * as fs from "./fs.ts";
import * as text from "./text.ts";
import * as path from "jsr:@std/path";
export { fs, text, path };
export * as shelljs from "./shelljs/mod.ts";

// Re-export fluent shell API (as content for $.content())
export { default as _ } from "./shell.ts";
export { FluentShell } from "./shell.ts";

// Re-export command execution
export {
  cmd,
  git,
  docker,
  tmux,
  tmuxSubmit,
  str,
  bytes,
  toCmd,
  toCmdLines,
  init,
  initCmds,
  type Command,
  type CommandResult,
  type CommandOptions,
  type CommandFn,
} from "./command.ts";

// Re-export streaming primitives
export {
  createStream,
  fromArray,
  empty,
  type Stream,
  type Transform,
} from "./stream.ts";

// Re-export stream transforms
export {
  filter,
  map,
  flatMap,
  take,
  head,
  tail,
  lines,
  grep,
} from "./transforms.ts";

// Re-export I/O streams
export { stdout, stderr, tee } from "./io.ts";

// Re-export file streaming (cat, glob, src, dest)
export {
  cat,
  glob,
  src,
  dest,
} from "./fs-streams.ts";

// Re-export commonly used shelljs commands
export {
  chmod,
  which,
  test,
  echo,
  cd,
  pwd,
  pushd,
  popd,
  dirs,
  tempdir,
  env,
  ln,
  ShellString,
} from "./shelljs/mod.ts";

// Re-export commonly used types
export type { SandboxOptions, WalkOptions, WalkEntry, TreeOptions, TreeEntry } from "./fs.ts";

// Re-export tree functions for direct access
export { tree, treeLines, printTree } from "./fs.ts";
export type { GlobOptions } from "./glob.ts";
export type { GrepMatch, GrepOptions, CountResult, DiffLine } from "./text.ts";

// Import remaining exports for _$ namespace
import { default as fluentShell } from "./shell.ts";
import { FluentShell } from "./shell.ts";
import { cmd, git, docker, tmux, tmuxSubmit, str, bytes, toCmd, toCmdLines, initCmds } from "./command.ts";
import { createStream, fromArray, empty } from "./stream.ts";
import { filter, map, flatMap, take, head, tail, lines, grep } from "./transforms.ts";
import { stdout, stderr, tee } from "./io.ts";
import { cat, glob, src, dest } from "./fs-streams.ts";
import { globPaths, globArray } from "./glob.ts";
import { echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString } from "./shelljs/mod.ts";
import { tree, treeLines, printTree } from "./fs.ts";
// Import command transforms (used by transpiler as $.wc(), $.sort(), $.uniq())
import { default as wc } from "../commands/wc.ts";
import { default as sort } from "../commands/sort.ts";
import { default as uniq } from "../commands/uniq.ts";

/**
 * Unified namespace for all SafeShell exports
 * Works in both code and file execution modes
 *
 * Also callable as shorthand: $('git', 'status') or $('whoami')
 */
// Sleep/delay utility
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const _$props = {
  // Fluent file API ($.cat('file').lines().grep(/pattern/).collect())
  cat: fluentShell, FluentShell,
  // Namespaced modules
  fs, text, path,
  // Command execution
  cmd, git, docker, tmux, tmuxSubmit, str, bytes, toCmd, toCmdLines, initCmds,
  // Streaming primitives
  createStream, fromArray, empty,
  // Stream transforms
  filter, map, flatMap, take, head, tail, lines, grep,
  // Command transforms (wc, sort, uniq - used by transpiler)
  wc, sort, uniq,
  // I/O streams
  stdout, stderr, tee,
  // File streaming (glob, src, dest - streaming cat is global only)
  glob, globPaths, globArray, src, dest,
  // ShellJS commands
  echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString,
  // Tree commands
  tree, treeLines, printTree,
  // Timing
  sleep, delay: sleep,
  // Deno file aliases
  writeFile: Deno.writeFile,
  writeFileSync: Deno.writeFileSync,
  writeTextFile: Deno.writeTextFile,
  writeTextFileSync: Deno.writeTextFileSync,
  readFile: Deno.readFile,
  readFileSync: Deno.readFileSync,
  readTextFile: Deno.readTextFile,
  readTextFileSync: Deno.readTextFileSync,
  readDir: Deno.readDir,
  readDirSync: Deno.readDirSync,
  readLink: Deno.readLink,
  readLinkSync: Deno.readLinkSync,
};

// Known built-in commands that have dedicated wrappers
const _$builtins: Record<string, typeof git> = { git, docker, tmux };

// Make $ callable: $('git', 'status') or $('whoami')
function _$fn(command: string, ...args: string[]) {
  const builtin = _$builtins[command];
  if (builtin) {
    return builtin(...args);
  }
  return cmd(command, args);
}

// Merge function with properties
export const $ = Object.assign(_$fn, _$props);

// Also set on globalThis for universal access
(globalThis as Record<string, unknown>).$ = $;
