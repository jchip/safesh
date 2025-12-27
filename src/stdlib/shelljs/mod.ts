/**
 * ShellJS-like commands for safesh
 *
 * Provides Unix shell command implementations inspired by shelljs.
 * All commands respect sandbox permissions and work in a secure environment.
 *
 * @module
 *
 * @example
 * ```ts
 * import { cat, chmod, which, test, echo, cd, pwd, env, ln } from "./mod.ts";
 *
 * // Read files
 * const content = await cat("file.txt");
 * const numbered = await cat("file.txt", { number: true });
 *
 * // Change permissions
 * await chmod(755, "script.sh");
 * await chmod("u+x", "script.sh");
 *
 * // Find commands
 * const node = await which("node");
 *
 * // Test file types
 * if (await test("-d", "src")) {
 *   console.log("src is a directory");
 * }
 *
 * // Echo text
 * echo("Hello, World!");
 *
 * // Directory navigation
 * cd("/tmp");
 * console.log(pwd().toString());
 *
 * // Environment variables
 * console.log(env.PATH);
 *
 * // Create links
 * await ln("target.txt", "link.txt");
 * ```
 */

// Types
export { ShellString, ShellArray } from "./types.ts";
export type { OptionsMap, ParsedOptions } from "./types.ts";

// Common utilities
export {
  parseOptions,
  expand,
  expandTilde,
  isGlob,
  splitPath,
  isWindows,
  isExecutable,
  checkPath,
  realPath,
  statFollowLinks,
  statNoFollowLinks,
  randomFileName,
  flattenArgs,
  getDefaultConfig,
  PERMS,
} from "./common.ts";

// Commands
export { cat, parseCatOptions } from "./cat.ts";
export type { CatOptions } from "./cat.ts";

export { chmod, parseChmodOptions } from "./chmod.ts";
export type { ChmodOptions } from "./chmod.ts";

export { which } from "./which.ts";
export type { WhichOptions } from "./which.ts";

export { test } from "./test.ts";

export { echo, parseEchoOptions } from "./echo.ts";
export type { EchoOptions } from "./echo.ts";

export { cd, pwd, pushd, popd, dirs, tempdir } from "./dirs.ts";
export type { PushdOptions, PopdOptions, DirsOptions } from "./dirs.ts";

export { env, getEnv, setEnv, deleteEnv, getAllEnv } from "./env.ts";

export { ln, parseLnOptions } from "./ln.ts";
export type { LnOptions } from "./ln.ts";
