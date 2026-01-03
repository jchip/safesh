/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

Execution modes (use ONE):
- code: code string
- file: file content as code string
- module: import as .ts module
- shcmd: basic shell command → code string (&&, ||, ;, |, >, >>, <, 2>&1, &, globs)

All APIs under global object '$' (e.g., $.mkdir() - will skip $. below for brevity):
NOTE: Only use APIs listed here. DO NOT guess or make up new methods.

Complete API list:
- Util Objs:
  - fs: await $.fs.read(pathStr), await $.fs.write(pathStr, content) - async file I/O
  - path: join, dirname, basename, resolve, etc.
  - text: trim → S|S[], lines, head, tail; (e.g.: $.text.trim(' h ') → 'h', .trim(' a \n b ') → ['a','b'])
- Commands (methods: .exec() → {code, stdout: S, stderr: S}; .stdout/stderr() → FluentStream<string> ):
  - built-in aliases: git('status'), tmux('list-sessions'), docker('ps'), tmuxSubmit(pane,msg,client)
  - external: const [curl] = await $.initCmds(['curl']); await curl('-s', url);
  - general: $.cmd('echo', ['hello']) - cmd name, then args array
  - data sources: str('data'), bytes(data) - data for piping TO other commands
    - e.g.: $.str('input').pipe(CMD, ['pattern']).exec()
    - transforms: $.str('data').stdout().pipe($.lines()).collect()
- glob, src, createStream, fromArray, empty → FluentStream<T> (chainables: .filter/.map/.head/.tail/lines/.grep; terminal: .collect()/.first()/.count()/.forEach())
  - $.glob('*.txt') → File as T (object with PROPS (NOT methods) {path, base, contents})
  - $.src('*.ts', '*.js') → multiple patterns
  - e.g.: $.glob('*.txt').filter(f => f.path.includes('test')).map(f => f.path).collect()
- cat → FluentShell (specialized FluentStream<string>)
  - e.g.: $.cat('app.log').lines().grep(/ERROR/).head(10).collect()
- globPaths → string[]; globArray → GlobEntry[]; (Direct arrays (await, no .collect())):
- Direct $. transform functions (e.g.: $.filter(...))
  - filter, map, flatMap, take, head, tail, lines, grep
  - toCmd(CMD, ['args']) - pipe stream content through external command
  - toCmdLines(CMD, ['args']) - same but yields output lines 
- I/O: stdout, stderr, tee
- Shell-like: echo, cd, pwd, pushd, popd, dirs, tempdir, test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls
- Timing: sleep, delay
- State (persists with shellId): ID, ProjectDir, CWD; ENV, VARS (plain objs)

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
