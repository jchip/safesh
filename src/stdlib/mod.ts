/**
 * SafeShell standard library
 *
 * Provides shell-like utilities in a safe, sandboxed environment.
 *
 * `_S` is available globally in both code and file execution modes:
 * ```typescript
 * await _S.fs.read('file.txt');
 * await _S.git('status').exec();
 * ```
 *
 * @module
 */

// Re-export namespaced modules
import * as fs from "./fs.ts";
import * as text from "./text.ts";
export { fs, text };
export * as shelljs from "./shelljs/mod.ts";

// Re-export fluent shell API
export { default as $ } from "./shell.ts";
export { FluentShell } from "./shell.ts";

// Re-export command execution
export {
  cmd,
  git,
  docker,
  deno,
  str,
  bytes,
  toCmd,
  toCmdLines,
  init,
  type Command,
  type CommandResult,
  type CommandOptions,
  type RegisteredCommand,
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
export type { SandboxOptions, WalkOptions, WalkEntry } from "./fs.ts";
export type { GlobOptions } from "./glob.ts";
export type { GrepMatch, GrepOptions, CountResult, DiffLine } from "./text.ts";

// Import remaining exports for _S namespace
import { default as $ } from "./shell.ts";
import { FluentShell } from "./shell.ts";
import { cmd, git, docker, deno, str, bytes, toCmd, toCmdLines, initCmds } from "./command.ts";
import { createStream, fromArray, empty } from "./stream.ts";
import { filter, map, flatMap, take, head, tail, lines, grep } from "./transforms.ts";
import { stdout, stderr, tee } from "./io.ts";
import { cat, glob, src, dest } from "./fs-streams.ts";
import { echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString } from "./shelljs/mod.ts";

/**
 * Unified namespace for all SafeShell exports
 * Works in both code and file execution modes
 */
export const _S = {
  // Namespaced modules
  fs, text,
  // Fluent shell API
  $, FluentShell,
  // Command execution
  cmd, git, docker, deno, str, bytes, toCmd, toCmdLines, initCmds,
  // Streaming primitives
  createStream, fromArray, empty,
  // Stream transforms
  filter, map, flatMap, take, head, tail, lines, grep,
  // I/O streams
  stdout, stderr, tee,
  // File streaming
  cat, glob, src, dest,
  // ShellJS commands
  echo, cd, pwd, pushd, popd, dirs, tempdir, env, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls, ShellString,
};

// Also set on globalThis for universal access
(globalThis as Record<string, unknown>)._S = _S;
