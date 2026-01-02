/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

$ namespace: fs.read/write, git, docker, cmd, cat, glob, globArray, lines, grep, filter, map, head, tail
State (persists): $.ID, $.CWD, $.ENV (plain obj), $.VARS

COMMANDS: $.git('status') returns {code, stdout, stderr}:
  const {stdout} = await $.git('log', '--oneline');

GLOB: $.glob() returns stream - use .collect() or $.globArray() for array:
  const files = await $.globArray('**/*.ts'); // string[] of paths

STREAMING:
  $.cat('f').lines().grep(/pat/).head(10).collect()
  $.glob('**').pipe($.filter(f => ...)).pipe($.head(5)).collect()`;
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
