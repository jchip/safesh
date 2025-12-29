/**
 * SafeShell standard library
 *
 * Provides shell-like utilities in a safe, sandboxed environment.
 *
 * Usage in standalone scripts:
 * ```typescript
 * import { fs, cmd, git, $, glob } from "safesh:stdlib";
 * ```
 *
 * @module
 */

// Re-export namespaced modules
export * as fs from "./fs.ts";
export * as text from "./text.ts";
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
  ShellArray,
} from "./shelljs/mod.ts";

// Re-export commonly used types
export type { SandboxOptions, WalkOptions, WalkEntry } from "./fs.ts";
export type { GlobOptions } from "./glob.ts";
export type { GrepMatch, GrepOptions, CountResult, DiffLine } from "./text.ts";
