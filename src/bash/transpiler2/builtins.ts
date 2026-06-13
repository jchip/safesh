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
  // Lowered specially because ":" is a shell no-op, not a callable SafeShell API.
  ":": { fn: "", type: "silent" },
  // Lowered specially (SSH-612): unset clears bindings, it is not an executable.
  unset: { fn: "", type: "silent" },
  cd: { fn: "$.cd", type: "silent" },
  pushd: { fn: "$.pushd", type: "silent" },
  popd: { fn: "$.popd", type: "silent" },
  echo: { fn: "$.echo", type: "prints" },
  pwd: { fn: "$.pwd", type: "output" },
  dirs: { fn: "$.dirs", type: "output" },
  ls: { fn: "$.ls", type: "output" },
  // SSH-621: `test` (and `[`) are NOT mapped here — shelljs $.test only does
  // file tests and returns a boolean, so `test 0 -lt 2` was wrong. Falling
  // through to $.cmd("test", ...) uses the full native test/`[` evaluator,
  // which returns a proper { code } result for all operators.
  which: { fn: "$.which", type: "async" },
  chmod: { fn: "$.chmod", type: "async" },
  ln: { fn: "$.ln", type: "async" },
  rm: { fn: "$.rm", type: "async" },
  rmdir: { fn: "$.rmdir", type: "async" },
  cp: { fn: "$.cp", type: "async" },
  mv: { fn: "$.mv", type: "async" },
  mkdir: { fn: "$.mkdir", type: "async" },
  touch: { fn: "$.touch", type: "async" },
  exit: { fn: "Deno.exit", type: "silent" },
};
