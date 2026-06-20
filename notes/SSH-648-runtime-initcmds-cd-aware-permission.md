# SSH-648: Runtime `$.initCmds` permission check ignores `$.cd` (static cwd gap)

> NOTE: The `tasks` MCP server was not connected in the session where this was
> implemented, so this ticket could not be created in the tracker. Mirror this
> into `tasks` (project prefix `SSH`, type `bug`). Discovered-from [[SSH-647]].

## Type
bug

## Summary
The runtime permission gate in `src/stdlib/command-init.ts` (`checkPermission`,
reached via the public `$.initCmds([...])` API) resolves relative-path commands
against a **static `config.cwd`** captured at script start. It does not honor a
prior `$.cd()`, so:

```ts
$.cd("/ws/pkg");
const [tool] = await $.initCmds(["./tool"]);  // checked against the START dir
```

is permission-checked against the start directory, not `/ws/pkg`. This is the
runtime twin of the prehook bug fixed in SSH-647.

## Audit context (what is and isn't affected)
The runtime runs under unrestricted `--allow-run` (src/runtime/executor.ts:428);
the code comment names the two application-layer gates: "bash-prehook, initCmds".

- **Transpiled bash (`$.cmd`)** — NOT affected. The transpiler emits
  `await $.cd("/ws/pkg")` then `$.cmd("./tool")`; `Command` does no SafeShell
  allowlist re-check (command.ts), and spawns `Deno.Command("./tool",
  {cwd: undefined})` which inherits the live `Deno.cwd()` that `$.cd` updated via
  `Deno.chdir()` (shelljs/dirs.ts:73). Its allowlist gate is the prehook
  (SSH-647), which is now cd-aware. Execution is cd-correct.
- **`$.initCmds([...])`** — affected. Uses static `config.cwd`, so it both
  (a) can wrongly block a relative command that exists in the cd'd dir, and
  (b) is inconsistent with execution (which uses the live cwd).

## Fix
At runtime the live process cwd is authoritative (`$.cd` → `Deno.chdir`), so
`checkPermission` now resolves relative commands against the **live `Deno.cwd()`
plus the static start cwd** (deduped), allowing if either permits. The live cwd
is tried first so the returned `resolvedPath` matches where the command actually
executes.

Strictly additive: the static start cwd remains a candidate, so when no `$.cd`
happened (live === start) behavior is identical — no migration concern. Auto-
allow stays gated by the existing workspace-root + `allowProjectCommands` checks.

## Files
- src/stdlib/command-init.ts — live-cwd candidate resolution in `checkPermission`
- src/stdlib/command-init.test.ts — new tests
