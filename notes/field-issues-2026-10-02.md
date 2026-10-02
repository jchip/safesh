# Field issues: fyn benchmarking session (2026-10-02)

Issues hit while an agent used safesh as its Bash tool shell on macOS (zsh login shell). Each entry
gives the command shape, the observed output, and the generated TypeScript where safesh cached it.

The full generated scripts are in `/tmp/safesh/scripts/` under the names listed per issue. `/tmp` is
cleared on reboot, so the key lines are copied below.

## Fix status

- **1 and 2: fixed.** The lexer records a per-char quote mask, and the parser puts it on literal
  parts. A word with an unquoted expansion or an unquoted glob char now lowers to
  `$.__wordFields(segments)`. That runtime helper does IFS splitting, then globs each field. Command
  args and for-lists share it. Plain `$a` on an array reads its first element. The `splitting` and
  `globbing` groups in `tests/conformance/differential.test.ts` pin this against real bash.
- **3: fixed.** A script in this session's scratchpad (`/tmp/claude-<uid>/<seg>/<session_id>/scratchpad/`)
  is auto-allowed and recorded in the session allow file (`src/core/scratchpad.ts`). Symlinks out of
  it and other sessions' scratchpads are still blocked.
- **4: no change.** Working as intended.
- **5: fixed.** The trailer step is emitted only when the script may change cwd (`cd`, `pushd`,
  `popd`, `source`, `.`, `eval`, or a dynamic command name). Export and var lines no longer
  persist for scripts without a cwd change.

Remaining gaps, all pre-existing and not covered by these fixes:
- An unquoted command name isn't split (`CMD="git status"; $CMD`).
- `'a b'$p` is parsed as one single-quoted literal, so `$p` is never expanded.
- Only the default IFS is supported.
- Globs outside the sandbox's readable paths fall back to the literal word, as `$.__expandGlob`
  already does.

## 1. Unquoted `$VAR` always becomes exactly one arg (bug)

Both shapes below come from the same codegen. An unquoted variable used as a command arg becomes one
template literal, with no word splitting and no array spread.

**Decision: follow bash semantics.** An unquoted expansion goes through IFS word splitting, then
pathname expansion on each field. For an array, unquoted `$ARGS` means `${ARGS[0]}` (first element
only), and that element is then split and globbed. Only `${ARGS[@]}` / `${ARGS[*]}` expand to every
element, and that path already works. So the 1a command still won't run correctly under bash
semantics. It passes `install` alone, which is what real bash does.

The codegen lives in `src/bash/transpiler2/handlers/commands.ts`. `wordIsUnquotedGlobLiteral` (line
104) rejects any word with an expansion, so an arg like `$S/*` is never globbed either.

### 1a. Array variable is comma-joined

```sh
ARGS=(install --script-policy=off --progress=none --no-audit --registry=https://registry.npmjs.org/)
node $FYN $ARGS
```

Output from fyn, which got a single arg:

```
> Error: missing script: "install,--script-policy=off,--progress=none,--no-audit,--registry=https://registry.npmjs.org/" - not found in package.json scripts
```

Generated code (`tx-script-QhmirVPLiuuWo9AN.ts`). The array is kept as an array:

```ts
var ARGS = ["install", "--script-policy=off", "--progress=none", "--no-audit", "--registry=https://registry.npmjs.org/"];
```

The call site then interpolates it into one string, so `Array.prototype.toString` joins with commas:

```ts
$.cmd({ env: { ... } }, "node",
  `${typeof FYN !== "undefined" ? FYN : ($.ENV.FYN ?? $.VARS?.FYN ?? "")}`,
  `${typeof ARGS !== "undefined" ? ARGS : ($.ENV.ARGS ?? $.VARS?.ARGS ?? "")}`).stdout("/dev/null")
```

Bash expands `$ARGS` to the first element only. Neither bash nor zsh joins with commas.
`"${B[@]}"` is handled correctly: `B=(x y z); printf '[%s]\n' "${B[@]}"` printed `[x]`, `[y]`,
`[z]`.

### 1b. Scalar variable isn't word-split

```sh
ARGS="install --script-policy=off --progress=none --no-audit --registry=https://registry.npmjs.org/"
node $FYN $ARGS
```

Output:

```
> Error: missing script: "install --script-policy=off --progress=none --no-audit --registry=https://registry.npmjs.org/" - not found in package.json scripts
```

Generated code (`tx-script-DH19t2Fc5kQo4S1k.ts`) has the same call site as 1a:

```ts
var ARGS = "install --script-policy=off --progress=none --no-audit --registry=https://registry.npmjs.org/";
...
"node", `${... FYN ...}`, `${typeof ARGS !== "undefined" ? ARGS : ($.ENV.ARGS ?? $.VARS?.ARGS ?? "")}`
```

This matches zsh's default (no `SH_WORD_SPLIT`). Bash splits it into five args, and that is the
target behavior. An earlier variant ran the same way (`tx-script-XnHOgQeneGgL6GpA.ts`, two
backgrounded subshells).

## 2. For-loop word list with a glob isn't glob-expanded (bug)

```sh
for m in direct central; do echo "== $m"
  for d in $S/$m/cache/*; do echo "$d $(find $d | wc -l)"; done
done
```

Output, though each `cache/` dir held `fyn` and `fyn-central`:

```
== direct
/private/tmp/claude-502/.../scratchpad/repeat/direct/cache/* 0
== central
/private/tmp/claude-502/.../scratchpad/repeat/central/cache/* 0
```

Generated code (`tx-script-06UkgNyK4pw-hx9Q.ts`). The word is split on whitespace, and no glob step
runs:

```ts
_tmp$0.push(...(`${typeof S !== "undefined" ? S : ($.ENV.S ?? $.VARS?.S ?? "")}/${typeof m !== "undefined" ? m : ($.ENV.m ?? $.VARS?.m ?? "")}/cache/*`).split(/\s+/).filter(s => s.length > 0));
```

It isn't tied to variables at all. `visitForStatement` in `handlers/control.ts` never calls
`$.__expandGlob`, so a plain literal loop isn't globbed either. `for f in notes/R*` iterates once,
over the string `"notes/R*"`. A tilde loop is also left literal (`tx-script--4vbb_iutXkVPACP.ts`;
another guard blocked it, so it never ran):

```ts
for (const f of [`${Deno.env.get("HOME") || "~"}/dev/safesh/notes/R*`]) {
```

The dynamic branch splits on `/\s+/` and skips IFS, so a path with a space also breaks into pieces.
Under bash semantics, each for-list word goes through the same steps as a command arg. Unquoted
expansions are split, and every field is globbed. A field with no match stays literal.

`S=...; for f in $S/R*; do ...; done` and `echo $S/R*` did expand correctly in this session, but they
left no `tx-script`. The transpiler doesn't glob `echo $S/R*`, so these must have gone through
passthrough to a real shell.

## 3. Scripts the agent just wrote need a permission prompt

Running scripts the agent had written in its own scratchpad seconds earlier was blocked:

```
PreToolUse:Bash hook error: [SAFESH] BLOCKED: /private/tmp/claude-502/.../scratchpad/repeat/run.sh, /private/tmp/claude-502/.../scratchpad/repeat/time.sh
...
HINT: Use safesh TypeScript code with /*#*/ prefix - many shell utils are pre-approved.
```

That's by design. Still, it stalls a long task until the user answers, and the user then passes the
choice back through `desh retry --id=1790979029243-90448 --choice=3`. Option: let a session
pre-approve its scratchpad dir, or allow-for-session by directory, not by file.

Session allows are an exact-string `Set` (`getSessionAllowedCommands` in `src/core/session.ts`).
Nothing matches by directory prefix, and nothing special-cases the scratchpad.

## 4. Output header path is the project root (not a bug)

Every output starts with `# /*#*/ /Users/joel.chen/dev/fynjs`. The header is intended. It is a clear
signal that safesh ran the script. The path is `findProjectRoot(cwd)`, not the cwd, and
`findProjectRoot` returns `CLAUDE_PROJECT_DIR` first. So it stays fixed for the session even when the
working dir moves to `/Users/joel.chen/dev/pnpm-benchmarks` or `.../fynjs/packages/fyn`.

## 5. The rewritten command trips Claude Code's worktree guard (bug)

After the session entered a git worktree (Claude Code's EnterWorktree), every command safesh
transpiled was refused before it ran:

```
This session is isolated in the worktree /Users/joel.chen/dev/fynjs-rlink, but this command runs . inside a construct too complex to verify; what it reads or is handed as shell text cannot be shown not to run git. Refusing to run it — a worktree-isolated session's git operations must target its own worktree. Split it into plain, separate commands and run them from /Users/joel.chen/dev/fynjs-rlink.
```

None of the refused commands ran `.`. The `.` comes from the command safesh substitutes. The guard
checks the rewritten `updatedInput.command`, which `outputRewriteToDeshFile` in
`hooks/bash-prehook.ts` (line 1256) builds like this:

```sh
desh -q -f <tx-script>.ts --state-trailer '<trailer>'; __safesh_rc=$?; [ -f '<trailer>' ] && [ -O '<trailer>' ] && . '<trailer>'; rm -f '<trailer>' 2>/dev/null; (exit $__safesh_rc)
```

Sourcing the SSH-580 state trailer runs a file the guard can't read ahead of time, so it refuses
the whole line. Even trivial commands hit it. `ln -f a b` was transpiled to `$.ln("-f", a, b)`
(`tx-script-5AUsXSB7_b5aEOEf.ts`) and refused. So were `mkdir -p` (`tx-script-j4ULxDGu5FSbPVlY.ts`),
`cp`, `rm -rf`, `printf ... $VAR`, `node -e '...' $VAR`, a heredoc `git commit`, and nested `for`
loops.

`/*#*/` TypeScript is refused too. In the default file mode it gets the same trailer. Only heredoc
mode (`desh -q <<'SAFESH_EOF'`) has no trailer. `/*#*/ Deno.kill(...)` and a plain `kill <pid>` were
both refused inside the worktree.

What still ran:
- Commands that passed through to native bash, like `ls`, `grep`, `git add`, `cargo check` and
  `node script.mjs`. They left no `tx-script`. A `.temp/kill-pids.mjs` run with `node` was the
  working way to stop processes.
- Background runs. `SAFESH_RUN_IN_BACKGROUND=1 desh -q -f <file>` also skips the trailer.

Impact: inside a Claude Code worktree, an agent loses most shell commands and falls back to asking
the user. The guard is Claude Code's and not configurable, so the fix belongs here.

Code check: `outputRewriteToDeshFile` adds the `.` step to every foreground file-mode run, whether or
not the script touches shell state. The trailer itself is written by `buildStateTrailerHook` in
`src/runtime/preamble.ts`. It emits three kinds of lines: `cd` for a cwd change, `export` for env
changes, and plain `k=v` for `$.VARS` changes. Claude Code's Bash tool keeps only the cwd between
calls. Env vars and shell vars don't persist there even for passthrough commands. So in Claude Code
only the `cd` line has a lasting effect.

Options:
- Emit the trailer only when the script can change shell state (`cd`, `export`, assignments,
  `source`). Most commands have none, so most rewrites would carry no `.`.
- Or apply the deltas some way the guard can read, such as literal `cd`/`export` text in the
  command line, instead of sourcing a file.

## Not safesh

These came up in the same session and look like safesh at first, but aren't:
- `tmux new-window -d ... "bash script.sh"` was refused with a different message: "runs tmux with
  the text bash ... in a plain command". It passed through untransformed (no `tx-script`). The guard
  refuses tmux running shell text on its own. Outside a worktree, a `/*#*/` script calling
  `$.tmux(...)` works. Inside one, it's refused like every other transpiled command.
- `pgrep -f "bash .*x.sh"` matching its own waiting shell is plain pgrep self-match. Use `[b]ash`.
- No safesh error logs exist for these. `/tmp/safesh/errors/` has only entries from Sep 28 to Oct 1.
