# SafeShell Agent Instructions

For API reference, use `usage safesh` via mcpu. This doc covers policies and usage patterns.

## Global Namespace

**`$`** - all APIs accessible (e.g., `$.git`, `$.fs`, `$.cat`).

**Shell state (uppercase, persists across calls):**
- `$.ID` - current shell ID
- `$.CWD` - current working directory
- `$.ENV` - environment variables (plain object, not Map)
- `$.VARS` - persisted JS variables across calls

## Common Gotchas

- **`$.ENV`** is a plain object. Use `$.ENV.FOO = 'bar'` not `.set()`. Auto-merged into Deno.env.
- **`ls()`** returns `string[]` (names only); `ls('-l')` returns formatted strings, NOT objects.
- **`$.glob()`** returns `File` objects `{path, base, contents, stat}`:
  - `path` = absolute file path
  - `base` = glob root directory (for relative path calculation with `dest()`)
  - `contents` = file contents (eagerly loaded)
- **Streaming**: `$.cat().head(1)` returns first **chunk**, not first line. Use `$.cat().lines().head(1)`.
- **No `$.writeTextFile`/`$.readTextFile`** - use `$.fs.write()`/`$.fs.read()` or `Deno.writeTextFile()`/`Deno.readTextFile()`.
- **Async chaining**: Use parentheses: `(await $.ls('-la')).slice(0, 5)` not `await $.ls('-la').slice(0, 5)`.

## MCP Tools

### `run` - Execute Code
```typescript
// Parameters:
code?: string      // JS/TS code to execute
shcmd?: string     // Shell command (transpiled to TS), supports: &&, ||, |, 2>&1, >, >>
file?: string      // Path to .ts file to execute
shellId?: string   // Shell ID for persistent state (optional, auto-creates if not provided)
background?: bool  // Run async, returns { scriptId, pid, shellId }
timeout?: number   // Timeout in ms (default: 30000)
env?: object       // Additional environment variables
retry_id?: string  // Retry ID from COMMANDS_BLOCKED error
userChoice?: 1|2|3 // Permission choice: 1=once, 2=session, 3=always
```

### `startShell` / `endShell` / `listShells`
```typescript
// startShell - create persistent shell
startShell({ cwd?: string, env?: object })

// endShell - cleanup shell and stop background jobs
endShell({ shellId: string })

// listShells - show all active shells
listShells()
```

### `listScripts` / `getScriptOutput` / `killScript` / `waitScript`
Manage background script execution.

## File Operations

```typescript
// Read/Write
await $.fs.write('file.txt', 'content');
const text = await $.fs.read('file.txt');
await $.fs.writeJson('data.json', { key: 'value' });
const obj = await $.fs.readJson('data.json');

// Other fs operations
await $.fs.exists('file.txt');      // boolean
await $.fs.copy('src', 'dest');
await $.fs.remove('file.txt');
await $.mkdir('-p', 'path/to/dir');
await $.rm('-rf', 'dir');
await $.touch('file.txt');
await $.cp('src', 'dest');
await $.mv('old', 'new');
```

## Command Execution

```typescript
// Built-in commands (git, docker, deno)
const { code, stdout, stderr } = await $.git('status');
const { stdout } = await $.docker('ps');

// External commands (must be registered)
const [_curl, _wget] = await $.initCmds(['curl', 'wget']);
await _curl('-s', 'https://example.com');

// Generic command
await $.cmd('mycommand', ['arg1', 'arg2']);
```

## Streaming

**Two styles:**

```typescript
// Fluent style - file content
await $.cat('file.txt')
  .lines()
  .grep(/ERROR/)
  .head(10)
  .collect();

// Pipe style - glob/commands
await $.glob('**/*.ts')
  .pipe($.filter(f => f.path.includes('test')))
  .pipe($.head(5))
  .collect();

await $.git('log', '--oneline')
  .stdout()
  .pipe($.lines())
  .pipe($.grep(/fix/i))
  .collect();
```

**Stream methods:**
- `lines()` - split into lines
- `grep(pattern)` - filter by regex
- `filter(fn)` - filter by predicate
- `map(fn)` - transform
- `head(n)` / `tail(n)` - take first/last n
- `collect()` - gather results into array
- `count()` - count items

## CRITICAL: SafeShell vs Bash

- ✅ **USE** `safesh` MCP for file operations, text processing, command execution
- ✅ Bash OK for: simple external commands, pipes (`|`), output redirect (`>`)
- ❌ **NO** heredocs (`<<EOF`), shell programming, command substitution in bash

**Rule:** Only invoke external commands in bash. Any logic → use safesh TypeScript.

## ⛔ NEVER USE BASH AS FALLBACK FOR BLOCKED COMMANDS

When safesh blocks a command with `COMMAND_NOT_ALLOWED` or `COMMANDS_BLOCKED`:

1. **DO NOT** switch to Bash as a workaround - this defeats the security model
2. **DO** present the permission options to user
3. **DO** wait for user's choice and retry with `{ retry_id, userChoice }`

```
❌ WRONG: "safesh blocked X, let me use bash instead"
✅ CORRECT: "Command X is blocked. Options: (1) Allow once (2) Allow session (3) Always (4) Deny"
```

**This is a strict rule with no exceptions.**

## Permission Retry Workflow

When `initCmds()` or command execution returns COMMANDS_BLOCKED:

1. **STOP** - present ALL blocked commands to user with options:
   - **1 = Allow once** - temporary, this execution only
   - **2 = Allow for session** - remembered in memory for shell session
   - **3 = Always allow** - saved to `.config/safesh/config.local.json`
   - **4 = Deny** - stop and report error

2. **Retry** with only: `run({ retry_id: "...", userChoice: N })`
   - Server remembers code and blocked commands from retry_id
   - Do NOT resend code on retry

3. If user chooses **Deny** (4), stop and report error - do not proceed.

## Config Hierarchy

Configs loaded and merged (later overrides earlier, JSON overrides TS):

| Level    | Path                                     |
| -------- | ---------------------------------------- |
| Built-in | `DEFAULT_CONFIG` (in code)               |
| Global   | `~/.config/safesh/config.[ts\|json]`     |
| Project  | `.config/safesh/config.[ts\|json]`       |
| Local    | `.config/safesh/config.local.[ts\|json]` |

## Default Permissions

**Read allowed:** `${CWD}`, `${HOME}`, `/tmp`
**Read denied:** `~/.ssh`, `~/.gnupg`, `~/.aws/credentials`, `~/.config/gh`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`, `~/.docker/config.json`, `~/.kube/config`

**Write allowed:** `${CWD}`, `/tmp`
**Write denied:** `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.bashrc`, `~/.zshrc`, `~/.profile`, etc.

## Background Execution

```typescript
// Start background task
const result = await run({
  code: 'await $.cmd("long-running-task")',
  background: true
});
// Returns: { scriptId: "sc1", pid: 12345, shellId: "sh1" }

// Check status
await listScripts({ shellId: "sh1" });

// Get output
await getScriptOutput({ shellId: "sh1", scriptId: "sc1" });

// Wait for completion
await waitScript({ shellId: "sh1", scriptId: "sc1" });

// Kill if needed
await killScript({ shellId: "sh1", scriptId: "sc1", signal: "SIGTERM" });
```
