/**
 * SafeShell standard library
 *
 * Provides shell-like utilities in a safe, sandboxed environment.
 *
 * @module
 */

// Re-export namespaced modules
export * as fs from "./fs.ts";
export * as text from "./text.ts";
export * as glob from "./glob.ts";
export * as shelljs from "./shelljs/mod.ts";

// Re-export fluent shell API
export { default as $ } from "./shell.ts";

// Re-export commonly used shelljs commands
export {
  cat,
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
export type { GlobOptions, GlobEntry } from "./glob.ts";
export type { GrepMatch, GrepOptions, CountResult, DiffLine } from "./text.ts";
