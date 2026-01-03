/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

Execution modes (use ONE):
- shcmd: basic shell command → code string (&&, ||, ;, |, >, >>, <, 2>&1, &, globs) **RECOMMENDED** for simple commands
- code: code string
- file: file content as code string
- module: import as .ts module

All APIs under global object '$' (e.g., $.mkdir() - will skip $. below for brevity):
NOTE: Only use APIs listed here. DO NOT guess or make up new methods.

Complete API list:
- Util Objs:
  - fs: await $.fs.read(pathStr), await $.fs.write(pathStr, content)
  - path: join, dirname, basename, extname, resolve, relative, normalize, isAbsolute, parse, format, toFileUrl, fromFileUrl
  - text: trim → S|S[], lines, head, tail, grep, replace, sort, uniq, count, cut, filter, map, diff, joinLines; (e.g.: $.text.trim(' h ') → 'h', .trim(' a \n b ') → ['a','b'])
- Command (.exec() → Promise<CmdResult>; .pipe(CmdFn,args) for chaining; .trans(transform) → FluentStream; .stdout()/stderr() → FluentStream<string>):
  - built-in aliases: git('status'), tmux('list-sessions'), docker('ps'), tmuxSubmit(pane,msg,client?) → Promise
  - data sources: str('data'), bytes(data)
    - e.g.: $.str('input').pipe(_grepCmdFn, ['pattern']).exec(); or .stdout().lines()
  - use .stdout()/.pipe() for streaming or await/thenable (.exec optional)
- CmdFn: (...args) → Command
- initCmds(['cmd1', ...]) → Promise<CmdFn[]> (NOTE: use _ prefix to avoid conflicts)
  - e.g.: const [_curl] = await $.initCmds(['curl']); await _curl('-s', url);
- FluentStream<T> producers:
  - chainables: .filter/.map/.head/.tail/.lines()/.grep(); terminals (all Promise): .collect()/.first()/.count()/.forEach()
  - .pipe(CmdFn, args)
  - .trans(transform) → FluentStream
  - glob('*.txt'), src('*.ts', '*.js'), createStream(asyncIter), fromArray([...]), empty()
  - glob yields {path, base, contents} (PROPS NOT methods)
  - e.g.: $.glob('*.txt').filter(f => f.path.includes('test')).map(f => f.path).collect()
- FluentShell producers (specialized FluentStream<string>):
  - cat: $.cat('app.log').lines().grep(/ERROR/).head(10).collect()
- Direct arrays (no .collect()):
  - globPaths('*.ts') → Promise<string[]>
  - globArray('*.ts') → Promise<GlobEntry[]>
- Stream transforms: 
  - toCmd/toCmdLines(CmdFn, args) - yields single result/lines, stdout, stderr, grep(pattern), lines() → Transform<string, string>
  - tee, filter, take, head, tail → Transform<T, T>
  - map, flatMap → Transform<T, U>
- Shell-like
  - (sync): echo, cd, pwd, pushd, popd, dirs, tempdir
  - (async → Promise): test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls
- Timing: sleep(ms), delay(ms) → Promise<void>
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
