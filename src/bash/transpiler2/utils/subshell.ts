/** Emit cwd restoration that ignores a parent directory removed by the subshell. */
export function restoreCwdExpression(savedCwd: string): string {
  return `try { Deno.chdir(${savedCwd}); } catch (__e) { ` +
    `if (!(__e instanceof Deno.errors.NotFound)) throw __e; }`;
}
