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
  cd: { fn: "$.cd", type: "silent" },
  pushd: { fn: "$.pushd", type: "silent" },
  popd: { fn: "$.popd", type: "silent" },
  echo: { fn: "$.echo", type: "prints" },
  pwd: { fn: "$.pwd", type: "output" },
  dirs: { fn: "$.dirs", type: "output" },
  ls: { fn: "$.ls", type: "output" },
  test: { fn: "$.test", type: "async" },
  which: { fn: "$.which", type: "async" },
  chmod: { fn: "$.chmod", type: "async" },
  ln: { fn: "$.ln", type: "async" },
  rm: { fn: "$.rm", type: "async" },
  rmdir: { fn: "$.rmdir", type: "async" },
  cp: { fn: "$.cp", type: "async" },
  mv: { fn: "$.mv", type: "async" },
  mkdir: { fn: "$.mkdir", type: "async" },
  touch: { fn: "$.touch", type: "async" },
};
