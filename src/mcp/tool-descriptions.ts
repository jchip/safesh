/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

$ top-level object categories:

Shell-like utils: cd, pwd, ls, mkdir, touch, rm, cp, mv, chmod, ln, which, test, tempdir, pushd, popd, dirs, echo
File system: await $.fs.read(path), await $.fs.write(path, content) - async file I/O
Commands (return {code, stdout, stderr}): $.git(), $.tmux(), $.docker(), $.cmd()
  - external: const [curl] = await $.initCmds(['curl']); await curl('-s', url);

Fluent streams (chainable .filter/.map/.head/.tail, terminal .collect()/.first()/.count()/.forEach()):
  - $.cat('f') → FluentShell (string stream) - has .lines()/.grep()
  - $.glob('*.txt') → FluentStream<File> - files with path/base/contents
  - $.src('*.ts', '*.js') → FluentStream<File> - multiple patterns

Transform functions: filter, map, head, tail, lines, grep - use with .pipe() or as fluent methods
State (persists with shellId): ID, CWD; ENV, VARS (plain objs)

Examples:
- $.cat('app.log').lines().grep(/ERROR/).head(10).collect()
- $.glob('*.txt').filter(f => f.path.includes('test')).map(f => f.path).collect()

Path expansion:
- shcmd: ~, $VAR, \${VAR}, \${HOME}, \${CWD}
- code: ~ in shell-like utils and $.fs`;
}

export const START_SHELL_DESCRIPTION = "";

export const UPDATE_SHELL_DESCRIPTION = "";

export const END_SHELL_DESCRIPTION = "Also stops background jobs";

export const LIST_SHELLS_DESCRIPTION = "";

export const LIST_SCRIPTS_DESCRIPTION = "";

export const GET_SCRIPT_OUTPUT_DESCRIPTION = "Incremental via 'since' offset";

export const KILL_SCRIPT_DESCRIPTION = "SIGTERM default, SIGKILL with force";

export const WAIT_SCRIPT_DESCRIPTION = "";

export const LIST_JOBS_DESCRIPTION = "";
