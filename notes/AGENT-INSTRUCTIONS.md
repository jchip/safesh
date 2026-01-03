# SafeShell MCP

**CRITICAL: ALWAYS run `usage safesh` via mcpu BEFORE calling any safesh tool. DO NOT guess tool names.**

The main tool is `run` - never guess names like `execute`, `eval`, etc.

## When to Use SafeShell vs Native Tools

**USE safesh for:** Stream processing, pipelines, git automation, background jobs, complex transformations

**USE native Write/Edit for:** Creating docs, writing code, simple file ops - safesh is NOT a writing tool

**Global namespace:** `$` - all APIs (e.g., `$.git`, `$.fs`, `$.cat`). Shell state: `$.ID`, `$.CWD`, `$.ENV`, `$.VARS`.

## ⚠️ APIs That DO NOT EXIST - Never Guess

- ❌ `$('ls -la')` or `$\`cmd\`` → `$` is NOT a function. Use `shcmd` param or `$.cmd()`
- ❌ `$.fs.writeTextFile` → ✅ `$.fs.write()` or `Deno.writeTextFile()`
- ❌ `$.fs.readTextFile` → ✅ `$.fs.read()` or `Deno.readTextFile()`
- ❌ `$.writeTextFile` → ✅ `$.fs.write()`
- ❌ `$.readTextFile` → ✅ `$.fs.read()`

## Common Gotchas

- **`$.ENV`** is a plain object (not Map). Use `$.ENV.FOO = 'bar'` not `.set()`.
- **`ls()`** returns `string[]`; `ls('-l')` returns formatted strings, NOT objects.
- **`$.glob()`** returns `{path, base, contents}`, not strings. Use `f.path` for filtering.
- **Streaming**: `$.cat().head(1)` returns first **chunk**, not line. Use `$.cat().lines().head(1)`.
- **Async chaining**: `(await $.ls('-la')).slice(0, 5)` not `await $.ls('-la').slice(0, 5)`.

## Commands

```typescript
// Built-in: git, tmux
const { stdout } = await $.git('status');

// External commands: MUST register first with initCmds
const [_curl] = await $.initCmds(['curl']);
await _curl('-s', 'https://example.com');

// Streaming
$.cat('f.txt').lines().grep(/ERR/).head(10).collect()
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
