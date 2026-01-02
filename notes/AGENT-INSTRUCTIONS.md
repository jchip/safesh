# SafeShell MCP

For API reference, use `usage safesh` via mcpu. This section covers policies only.

**Global namespace:** `$` - all APIs (e.g., `$.git`, `$.fs`, `$.cat`). Shell state: `$.ID`, `$.CWD`, `$.ENV`, `$.VARS`.

## Common Gotchas

- **`$.ENV`** is a plain object (not Map like Deno.env). Use `$.ENV.FOO = 'bar'` not `.set()`. Persists across calls.
- **`ls()`** returns `string[]` (names only); `ls('-l')` returns formatted strings, NOT objects.
- **`$.glob()`** returns `File` objects `{path, base, contents}`, not strings. Use `f.path` for filtering.
  - `base` = glob root directory (for relative path calculation with `dest()`)
  - `contents` = file contents (eagerly loaded)
- **Streaming**: `$.cat().head(1)` returns the first **chunk** (buffer), not the first line. Use `$.cat().lines().head(1)` for line-based operations.
- **No `$.writeTextFile`/`$.readTextFile`** - use `$.fs.write()`/`$.fs.read()` or `Deno.writeTextFile()`/`Deno.readTextFile()`.
- **Async chaining**: Use parentheses: `(await $.ls('-la')).slice(0, 5)` not `await $.ls('-la').slice(0, 5)`.

## Tools

```
Types: S=string, I=int, N=num, B=bool, O=object

run: Execute JS/TS code in sandboxed Deno
  code?: S         # JS/TS code
  shcmd?: S        # Shell cmd (supports &&, ||, |, >, >>)
  file?: S         # Path to .ts file
  shellId?: S      # For persistent state
  background?: B   # Async exec, returns {scriptId, pid}
  timeout?: I      # ms (default 30000)
  env?: O{S:S}     # Extra env vars
  retry_id?: S     # From COMMANDS_BLOCKED error
  userChoice?: 1|2|3  # 1=once, 2=session, 3=always

startShell: Create persistent shell (cwd?, env?)
endShell: Destroy shell (shellId)
listShells: List active shells
listScripts: List scripts in shell (shellId, filter?)
getScriptOutput: Get output (shellId, scriptId, since?)
killScript: Kill script (shellId, scriptId, signal?)
waitScript: Wait for completion (shellId, scriptId, timeout?)
listJobs: List spawned processes (shellId, filter?)
```

## File Operations

```typescript
await $.fs.write('file.txt', 'content');  // write file
const text = await $.fs.read('file.txt'); // read file
await $.fs.writeJson('data.json', obj);   // write JSON
const obj = await $.fs.readJson('f.json'); // read JSON
```

## Commands & Streaming

```typescript
// Built-in: git, docker, deno
const { stdout } = await $.git('status');

// External: must register first
const [_curl] = await $.initCmds(['curl']);
await _curl('-s', 'https://example.com');

// Streaming styles
$.cat('f.txt').lines().grep(/ERR/).head(10).collect()  // fluent
$.glob('**/*.ts').pipe($.filter(f => f.path.includes('test'))).collect()  // pipe
$.git('log').stdout().pipe($.lines()).pipe($.grep(/fix/)).collect()
```

## CRITICAL: SafeShell vs Bash

- **USE** safesh for: file ops, text processing, command execution
- **Bash OK** for: simple commands, pipes (`|`), redirects (`>`)
- **NO** heredocs (`<<EOF`), shell programming, command substitution

## Permission Workflow

When `COMMANDS_BLOCKED` returned:
1. Present options: (1) Allow once, (2) Allow session, (3) Always, (4) Deny
2. Retry with: `{ retry_id: "...", userChoice: N }`
3. If Deny (4), stop and report error

**NEVER use Bash as fallback for blocked commands** - defeats security model.

## Config Hierarchy

| Level    | Path                                     |
|----------|------------------------------------------|
| Built-in | `DEFAULT_CONFIG` (in code)               |
| Global   | `~/.config/safesh/config.[ts\|json]`     |
| Project  | `.config/safesh/config.[ts\|json]`       |
| Local    | `.config/safesh/config.local.[ts\|json]` |

## Default Permissions

- **Read:** `${CWD}`, `${HOME}`, `/tmp` (denied: `~/.ssh`, `~/.gnupg`, `~/.aws/credentials`, etc.)
- **Write:** `${CWD}`, `/tmp` (denied: `~/.ssh`, `~/.bashrc`, `~/.zshrc`, etc.)
