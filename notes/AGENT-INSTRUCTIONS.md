# SafeShell Agent Instructions

For API reference, use `usage safesh` via mcpu. This doc covers policies not in the MCP schema.

**Global namespace:** `$` - all APIs (e.g., `$.git`, `$.fs`, `$.content`). Shell state: `$.ID`, `$.CWD`, `$.ENV`, `$.VARS`.

## Common Gotchas

- **`$.ENV`** persists across calls and auto-merges into Deno.env on next run. Set once, use everywhere.
- **`ls()`** returns `string[]` (names only); `ls('-l')` returns formatted strings, NOT objects.
- **`$.glob()`** returns `File` objects `{path, base, contents}`, not strings. Use `f.path` for filtering.

## CRITICAL: SafeShell vs Bash

- **USE** `safesh` MCP for file operations, text processing, command execution
- Bash OK for: simple commands, pipes (`|`), output redirect (`>`)
- **NO** heredocs (`<<EOF`), shell programming, command substitution

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
| Built-in | `STANDARD_PRESET` (in code)              |
| Global   | `~/.config/safesh/config.[ts\|json]`     |
| Project  | `.config/safesh/config.[ts\|json]`       |
| Local    | `.config/safesh/config.local.[ts\|json]` |
