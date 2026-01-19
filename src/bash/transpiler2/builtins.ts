/**
 * Shell builtins configuration for the transpiler.
 */

export type BuiltinType = "silent" | "prints" | "output" | "async";

export interface BuiltinConfig {
  fn: string;
  type: BuiltinType;
}

/**
 * Shell builtins that should use preamble imports instead of $.cmd()
 *
 * Categories:
 * - silent: Side-effect only, no output (cd, pushd, popd)
 * - prints: Already prints output, don't wrap (echo)
 * - output: Returns value that should be printed (pwd, dirs, ls)
 * - async: Async operations that return results (which, test, chmod, etc.)
 */
export const SHELL_BUILTINS: Record<string, BuiltinConfig> = {
  cd: { fn: "__cd", type: "silent" },
  pushd: { fn: "__pushd", type: "silent" },
  popd: { fn: "__popd", type: "silent" },
  echo: { fn: "__echo", type: "prints" },
  pwd: { fn: "__pwd", type: "output" },
  dirs: { fn: "__dirs", type: "output" },
  ls: { fn: "__ls", type: "output" },
  test: { fn: "__test", type: "async" },
  which: { fn: "__which", type: "async" },
  chmod: { fn: "__chmod", type: "async" },
  ln: { fn: "__ln", type: "async" },
  rm: { fn: "__rm", type: "async" },
  rmdir: { fn: "__rmdir", type: "async" },
  cp: { fn: "__cp", type: "async" },
  mv: { fn: "__mv", type: "async" },
  mkdir: { fn: "__mkdir", type: "async" },
  touch: { fn: "__touch", type: "async" },
};
