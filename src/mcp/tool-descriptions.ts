/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

$ top-level object:
- fs.read/write, git, tmux, docker, cmd, cat, glob, globArray, lines, grep, filter, map, head, tail
- shell-like utils: cat, cd, pwd, ls, mkdir, touch, rm, cp, mv, chmod, ln, which, test, env, tempdir, pushd, popd, dirs, echo
- stream utils (need .collect() which returns array): cat, from, text, glob; chains: .lines, .grep, .filter, .map, .head, .tail
- state (persists with shellId): ID, CWD; ENV, VARS (plain objs)

Path expansion:
- shcmd: expands ~, $VAR, \${VAR}, \${HOME}, \${CWD}
- code: ~ expanded in shell-like utils and $.fs.read/write

Commands:
- built-in: $.git(), $.tmux(), $.docker() - return {code, stdout, stderr}
- external: const [_curl] = await $.initCmds(['curl']); await _curl('-s', url);
- streaming: $.cat('f').lines().grep(/pat/).head(10).collect()`;
}

export const START_SHELL_DESCRIPTION = "Create persistent shell for state between calls (cwd, env, VARS)";

export const UPDATE_SHELL_DESCRIPTION = "Update shell cwd or env vars";

export const END_SHELL_DESCRIPTION = "End shell and stop background jobs";

export const LIST_SHELLS_DESCRIPTION = "List active shells";

export const LIST_SCRIPTS_DESCRIPTION = "List scripts in shell (filter by status/background/limit)";

export const GET_SCRIPT_OUTPUT_DESCRIPTION = "Get script output (incremental via 'since' offset)";

export const KILL_SCRIPT_DESCRIPTION = "Kill script (SIGTERM default, SIGKILL for force)";

export const WAIT_SCRIPT_DESCRIPTION = "Wait for background script completion";

export const LIST_JOBS_DESCRIPTION = "List spawned processes in shell";
