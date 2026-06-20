# SSH-647: Permission resolver ignores leading `cd <dir> &&` for relative commands

> NOTE: The `tasks` MCP server was not connected in the session where this was
> implemented, so this ticket could not be created in the tracker. Mirror this
> into `tasks` (project prefix `SSH`, type `bug`) when the MCP is available.

## Type
bug

## Summary
A complex bash command of the form `cd /abs/workspace/dir && ./tool ...` is
blocked by the prehook even when `/abs/workspace/dir` is inside a configured
`workspaceRoots` entry with `allowProjectCommands: true`.

## Root cause
`getDisallowedCommands()` (hooks/bash-prehook.ts) → `checkCommandPermission()`
(src/core/command_permission.ts) resolves a relative command path against the
prehook's **base cwd** (`Deno.cwd()` at hook time), never against the directory
the script `cd`s into first. The prehook runs *before* the command executes, so
the leading `cd` has not taken effect, and the resolver does not parse it.

Concrete repro that triggered this:
- base cwd: `/Users/jc/dev/safesh`
- command: `cd /Users/jc/dev/fyntime/services/android && ./gradlew ...`
- config: `workspaceRoots: ["/Users/jc/dev"]`, `allowProjectCommands: true`
- `./gradlew` resolves to `/Users/jc/dev/safesh/gradlew` (missing) instead of
  `/Users/jc/dev/fyntime/services/android/gradlew` (present, inside the root)
  → `COMMAND_NOT_FOUND` → blocked with the 1-4 prompt.

## Fix
Reuse the passthrough analyzer's existing static cwd tracking (SSH-590). The
analyzer now also records, per relative-path command, the set of effective
working directories it runs in (`commandCwds`). The permission gate evaluates a
relative command against the base cwd **plus** every statically-known effective
cwd, allowing it if it passes in **any** candidate dir.

Strictly additive: the base cwd is always a candidate, so nothing previously
allowed becomes blocked (no migration concern). Auto-allow remains gated by the
existing workspace-root + `allowProjectCommands` checks, so a `cd` to a dir
outside all roots still does not grant permission.

## Workaround (pre-fix)
Use an absolute command path: `/Users/jc/dev/fyntime/services/android/gradlew ...`.

## Files
- src/hooks/passthrough-analyzer.ts — record `commandCwds`
- src/core/command_permission.ts — `candidateCwds`, `checkCommandAllowedInAnyCwd`
- hooks/bash-prehook.ts — run analyzer first, thread `commandCwds` into the gate
- src/core/command_permission.test.ts, src/hooks/passthrough-analyzer.test.ts — tests
