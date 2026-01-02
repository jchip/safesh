/**
 * Tool descriptions for MCP server
 *
 * Extracted from server.ts for maintainability.
 * SSH-144: Clean code refactoring
 */

/**
 * Creates the description for the 'run' tool.
 * @param permSummary - Summary of configured permissions
 */
export function createRunToolDescription(permSummary: string): string {
  return `Run JavaScript/TypeScript code in a sandboxed Deno runtime - MCPU usage: infoc

Optional shellId for persistent state. background: true runs async, returns { scriptId, pid, shellId }.
${permSummary ? `Permissions: ${permSummary}` : "No permissions configured."}

IMPORTANT: Do NOT use shell pipes (|, >, etc). Use TypeScript streaming instead.
❌ BAD: $.cmd('sh', ['-c', 'git log | grep ERROR'])
✅ GOOD: $.git('log').stdout().pipe($.lines()).pipe($.grep(/ERROR/)).collect()

All APIs on \`$\` (e.g., \`$.git\`, \`$.fs.read\`):
• fs.read/write/readJson/writeJson/exists/copy/remove - file ops
  await $.fs.write('file.txt', 'content');  // write file
  const text = await $.fs.read('file.txt'); // read file
• cmd, git, docker, deno - auto-exec when awaited
  const { stdout } = await $.git('status'); // { code, stdout, stderr }
  const lines = await $.git('log').stdout().pipe($.lines()).collect(); // streaming
• cat, glob, lines, grep, filter, map, head, tail - streaming
• initCmds(['curl']) - register external commands
• echo, cd, pwd, which, test, ls, rm, cp, mv, mkdir, touch - shell
  ls() returns string[] (names only); ls('-l') returns formatted strings, not objects
NOTE: There is NO $.writeTextFile or $.readTextFile. Use $.fs.write/read or Deno.writeTextFile/readTextFile.

TWO STREAMING STYLES:
• Fluent - file content: $.cat('file.txt').lines().grep(/pat/).head(10).collect()
• Pipe - glob/cat/git: $.glob('**/*.ts').pipe($.head(5)).collect()
  $.git('log').stdout().pipe($.lines()).pipe($.grep(/fix/)).collect()
Note: $.glob() returns File objects {path, base, contents}, not strings. Use f.path for filtering.
Note: $.cat().head(1) returns first CHUNK (buffer), not first line. Use $.cat().lines().head(1) for lines.

SHELL STATE (uppercase, persists across calls): $.ID, $.CWD, $.ENV, $.VARS
$.ENV is a plain object (not Map). Use $.ENV.FOO = 'bar', not .set(). Auto-merged into Deno.env.

ASYNC NOTE: Use parentheses for chaining after await:
(await $.ls('-la')).slice(0, 5)  // correct
await $.ls('-la').slice(0, 5)   // wrong - calls slice on Promise

EXTERNAL COMMANDS:
const [_curl] = await $.initCmds(['curl']);
await _curl('-s', 'https://example.com');  // if blocked, returns COMMANDS_BLOCKED`;
}

export const START_SHELL_DESCRIPTION = `Create a new shell for persistent state between exec calls.
Shells maintain: cwd (working directory), env (environment variables), and VARS (persisted JS variables accessible via $.VARS).`;

export const UPDATE_SHELL_DESCRIPTION =
  "Update shell state: change working directory or set environment variables.";

export const END_SHELL_DESCRIPTION =
  "End a shell and clean up resources. Stops any background jobs.";

export const LIST_SHELLS_DESCRIPTION =
  "List all active shells with their current state.";

export const LIST_SCRIPTS_DESCRIPTION =
  "List scripts (code executions) in a shell with optional filtering. " +
  "Returns scripts sorted by start time (newest first).";

export const GET_SCRIPT_OUTPUT_DESCRIPTION =
  "Get buffered output from a script. " +
  "Supports incremental reads via 'since' offset.";

export const KILL_SCRIPT_DESCRIPTION =
  "Kill a running script by sending a signal. " +
  "Default signal is SIGTERM. Use SIGKILL for force kill.";

export const WAIT_SCRIPT_DESCRIPTION =
  "Wait for a background script to complete. " +
  "Returns the script output and exit status when done.";

export const LIST_JOBS_DESCRIPTION =
  "List jobs (spawned processes) in a shell. " +
  "Jobs are child processes created by scripts via cmd(), git(), docker(), etc. " +
  "Returns jobs sorted by start time (newest first).";
