/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

$ top-level object:
- fs.read/write, git, tmux, docker, cmd, cat, glob, lines, grep, filter, map, head, tail
- shell-like utils: cat, cd, pwd, ls, mkdir, touch, rm, cp, mv, chmod, ln, which, test, tempdir, pushd, popd, dirs, echo
- fluent streams: $.cat('f'), $.glob('*.txt') - chainable .lines/.grep/.filter/.map/.head/.tail, terminal .collect()
- state (persists with shellId): ID, CWD; ENV, VARS (plain objs)

Path expansion:
- shcmd: expands ~, $VAR, \${VAR}, \${HOME}, \${CWD}
- code: ~ expanded in shell-like utils and $.fs.read/write

Commands:
- built-in: $.git(), $.tmux(), $.docker() - return {code, stdout, stderr}
- external: const [_curl] = await $.initCmds(['curl']); await _curl('-s', url);
- streaming: $.cat('f').lines().grep(/pat/).head(10).collect()
- glob: await $.glob('*.txt').filter(f => f.path.includes('test')).collect()`;
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
