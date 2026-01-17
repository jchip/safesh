/**
 * Common SafeShell API documentation
 * Used by MCP server tool description and desh --api-doc
 */

/**
 * Get condensed API documentation for token-efficient display
 */
export function getApiDoc(): string {
  return `SafeShell API Reference (condensed)

All APIs under global object '$' (e.g., $.mkdir() - will skip $. below for brevity):
NOTE: Only use APIs listed here. DO NOT guess or make up new methods.

Complete API list:
- Util Objs:
  - fs: read, write, append, readBytes, writeBytes, readJson, writeJson, exists, stat, remove, mkdir, ensureDir, copy, move, touch, symlink, readDir, walk, find (all async → Promise)
  - path: join, dirname, basename, extname, resolve, relative, normalize, isAbsolute, parse, format, toFileUrl, fromFileUrl
  - text: trim → S|S[], lines, head, tail, grep, replace, sort, uniq, count, cut, filter, map, diff, joinLines; file-based: grepFiles, headFile, tailFile, countFile, replaceFile, diffFiles (all async → Promise)
- Command (.exec() → Promise<CmdResult>; .pipe(CmdFn,args) for chaining; .trans(transform) → FluentStream; .stdout()/stderr() → FluentStream<string>):
  - built-in aliases: git('status'), tmux('list-sessions'), docker('ps'), tmuxSubmit(pane,msg,client?) → Promise
  - data sources: str('data'), bytes(data)
    - e.g.: $.str('input').pipe(_grepCmdFn, ['pattern']).exec(); or .stdout().lines()
  - use .stdout()/.pipe() for streaming or await/thenable (.exec optional)
- CmdFn: (...args) → Command
- initCmds(['cmd1', ...]) → Promise<CmdFn[]> (NOTE: use _ prefix to avoid conflicts)
  - e.g.: const [_curl] = await $.initCmds(['curl']); await _curl('-s', url);
- FluentStream<T> producers:
  - chainables: .filter/.map/.flatMap/.head/.tail/.take/.lines()/.grep(); terminals (all Promise): .collect()/.first()/.count()/.forEach()
  - .pipe(CmdFn, args)
  - .trans(transform) → FluentStream
  - glob('*.txt'), src('*.ts', '*.js'), createStream(asyncIter), fromArray([...]), empty()
  - glob yields {path, base, contents} (PROPS NOT methods)
  - e.g.: $.glob('*.txt').filter(f => f.path.includes('test')).map(f => f.path).collect()
- FluentShell producers (specialized FluentStream<string>):
  - cat: $.cat('app.log').lines().grep(/ERROR/).head(10).collect()
- Direct arrays & glob utils (no .collect()):
  - globPaths('*.ts') → Promise<string[]>
  - globArray('*.ts') → Promise<GlobEntry[]>
  - getGlobBase('src/**/*.ts') → 'src'
  - hasMatch('logs/*.error') → Promise<boolean>
  - countMatches('**/*.test.ts') → Promise<number>
  - findFirst('config.*.json') → Promise<string|undefined>
- Stream transforms:
  - toCmd/toCmdLines(CmdFn, args) - yields single result/lines, jq(query, opts?), stdout(), stderr(), grep(pattern), lines() → Transform<string, string>
  - tee, filter, take, head, tail → Transform<T, T>
  - map, flatMap → Transform<T, U>
- Shell-like
  - (sync): echo, cd, pwd, pushd, popd, dirs, tempdir
  - (async → Promise): test, which, chmod, ln, rm, cp, mv, mkdir, touch, ls
- Timing: sleep(ms), delay(ms) → Promise<void>
- State (persists with shellId): ID, ProjectDir, CWD; ENV, VARS (plain objs)
- Deno aliases: writeFile/Sync, writeTextFile/Sync, readFile/Sync, readTextFile/Sync, readDir/Sync, readLink/Sync
- Env helpers: getEnv(name), setEnv(name, val), deleteEnv(name), getAllEnv() (also via $.ENV proxy)

Path expansion:
- shcmd: ~, $VAR, \${VAR}, \${HOME}, \${CWD}
- code: ~ in shell-like utils and $.fs

Full documentation: docs/APIS.md`;
}

/**
 * Get note about bash prehook integration
 */
export function getBashPrehookNote(): string {
  return `
NOTE: With safesh prehook, bash tool can take safesh .ts code directly.
Just prefix with /*#*/ signature:

  /*#*/ console.log(await $.fs.read("file.txt"))

The prehook will detect the signature and execute it as TypeScript.`;
}
