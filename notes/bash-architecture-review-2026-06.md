# Bash Architecture Review — Why One-Off Bugs Keep Appearing (2026-06-11)

Four parallel deep-reviews (git-history taxonomy, parser, transpiler2, runtime/execution
model) plus live observation. Conclusion up front: **the bug stream is structural, not
incidental, and refactoring within the current architecture has empirically failed to
stop it. The fix is to invert the execution default: run real bash by default, and treat
transpilation as an opt-in fast path restricted to a proven-conformant subset.**

## 1. Evidence

### Bug taxonomy (full git history, ~135 distinct bash fixes in ~6 months)

| Root-cause layer | Count | Notes |
|---|--:|---|
| CMD-EMULATION (fluent grep/wc/ls/cat/sort...) | ~38 | grep alone: 15 fixes |
| LOWERING (pipelines, &&/\|\|, redirects, subshells) | ~30 | |
| LEX/PARSE (heredocs, [[ ]], (( )), keywords) | ~22 | |
| EXPANSION (tilde, ${...}, quoting, escapes) | ~18 | |
| VALUE-COERCION (stream/result/promise shape) | ~14 | SSH-77's focus |
| BUILTIN (cd, set, :, echo, read) | ~9 | |
| PERMISSION/ENV | ~8 | |

Recidivist files: `transpiler2/handlers/commands.ts` **96 changes**, `hooks/bash-prehook.ts` 69,
`runtime/executor.ts` 61, `runtime/preamble.ts` 49, `bash/parser.ts` 29.

### Consolidation did not bend the curve

Monthly bash-fix counts: Jan 91, Feb 33, Mar 8, Apr 6, **May 23, Jun 23 (through 06-11)**.
Both the transpiler2 rewrite (Jan) and the SSH-77/78–82 consolidation (capability registry,
builtin adapter, conformance matrix — landed 06-04) were followed by fix *spikes*, not lulls.
The week after the consolidation was the highest bash-fix-velocity week in project history.

### Live confirmation (this review session, ~30 min of ordinary commands)

Six new bugs tripped while merely *reviewing* the repo:
- `sort -rn` in a pipeline produced ascending order (SSH-571)
- `wc -l` with multiple glob operands returned `0 total` (SSH-572)
- `desh retry-path` always failed — pending file written to `/tmp/safesh/`, read from
  `/tmp/safesh/pending/` (SSH-569, fixed; the writer existed twice, once as code and once
  as an emitted string — the duplication SSH-77 warned about caused a P1)
- env-prefixed `TMPDIR=/tmp desh ...` blocked as unknown command, recursive prompt (SSH-570)
- `grep -n` numbers lines skipping blanks — drift grows with file position (SSH-573)
- `mv` glob operands unexpanded + macOS `/tmp` symlink rejected safesh's own state dir (SSH-574)

The defect supply is effectively unbounded because ordinary usage keeps finding fresh surface.

## 2. Root cause

safesh simultaneously re-implements **three open-ended conformance surfaces**:

1. **Bash grammar.** The hand-rolled lexer is context-free where bash is context-sensitive.
   Worst offender: words are flattened to a single string (`lexer.ts` slow path) and then
   **re-parsed** into parts (`parser.ts` `parseWordParts`) after quote context is already
   destroyed — the canonical generator of escaping/expansion bugs. Heredoc bodies keep the
   `quoted` flag but never use it; C-style `for` re-concatenates tokens and re-parses.
   ~85–90% of the ~7,700-line parser layer is generic POSIX reimplementation, including an
   entire **dead parser-combinator subsystem** (only error-hints uses it).

2. **Shell execution semantics, via TS string codegen.** The SSH-77 phases landed as
   scaffolding bolted onto the old machinery: `ShellValueKind` exists but is *derived from*
   the old flags (`commands.ts` ~16 booleans still threaded through); the capability registry
   is real but `buildFluentCommand` still has a 160-line bespoke switch; consumer-context
   decisions (print vs capture vs pipe vs cmdsub) are made in ≥5 scattered places. Emitting
   TypeScript *source strings* multiplies everything: hand-assembled async IIFEs, manual
   await/`isPromise` bookkeeping, per-call-site quote escaping, and runtime duck-typing in
   preamble strings.

3. **Coreutils behavior.** Fluent grep/sort/wc/head/ls must match real tools flag-for-flag.
   This is the single largest bug category (38) and is unbounded by definition — every flag
   combination an agent ever types is a potential divergence. grep alone: 15 fixes.

Each surface alone is enormous; chasing all three at once guarantees the observed bug rate.
The SSH-77 internal-quality work was correct but aimed at surface 2 only — and the data shows
even done well it cannot fix surfaces 1 and 3.

## 3. What the sandbox actually enforces (and doesn't)

- Deno `--allow-run` is **unrestricted**; command allowlisting is an in-process check —
  enforcement theater (acknowledged in `os-sandbox-design.md`).
- Real enforcement comes from Deno `--allow-read/--allow-write/--allow-net` scoped to
  workspace roots.
- A **passthrough path to real bash already exists and is the default for simple commands**
  (`bash-prehook.ts` `outputPassthrough`): `desh`/`deno` and simple non-dangerous commands run
  natively today. Transpilation is reserved for *complex* commands — i.e., exactly the cases
  where emulation diverges most. The current default is backwards.

## 4. Recommendation

### A. Invert the execution default (the fundamental fix)

> Parse bash to **extract the permission surface** (command words incl. after env-prefix
> assignments, file/path operands, redirect targets, network use). If everything is allowed,
> **execute the original bash string in a real bash subprocess** — `bash -c`, with injected
> cwd/env and a state trailer (`pwd`/`env` marker on exit) replacing the current
> `SHELL_STATE_MARKER` round-trip. Transpile **only** constructs on a proven-conformant
> allowlist; when the analyzer cannot fully account for a script, prompt/deny — never
> guess-transpile.

Effect: LOWERING, VALUE-COERCION, CMD-EMULATION, and most EXPANSION bugs (~100 of 135)
become *unreachable* for everyday commands, because real bash and real coreutils execute
them. The parser's only correctness obligation shrinks to "soundly identify commands and
paths," which is drastically easier than "reproduce execution semantics" — and can
over-approximate (be conservative) without breaking anyone.

What is kept: the permission UX, session/workspace roots, state persistence, the `/*#*/`
TS mode, and the `$` stdlib for TS users. What is lost: per-construct interception inside
complex scripts — which today buys little real security given unrestricted `--allow-run`.

### B. Replace the parser front-end (pays off in any architecture)

Even design A needs a *sound* parser for permission extraction. Swap the hand-rolled
lexer/parser for **mvdan/sh (Go→WASM)** or tree-sitter-bash behind a thin adapter to the
existing AST (`transpiler2/visitor.ts` consumes a clean discriminated-union surface, so the
adapter is the only work). Deletes ~7k LOC of POSIX reimplementation including the dead
combinator stack; kills the LEX/PARSE + most EXPANSION classes at the source.

### C. Stop emulating coreutils in transpiled bash

Fluent `$.text.*` stays for TS-mode users, but transpiled bash should run real
grep/sort/wc/mv as subprocesses (path-checked operands). With A in place this mostly falls
out automatically; until then, shrink the fluent allowlist to cases the conformance matrix
proves.

### D. Real enforcement via OS sandbox (per `os-sandbox-design.md`)

Run the bash subprocess under seatbelt/sandbox-exec (macOS) with workspace-root file rules.
This gives *stronger* guarantees than today's emulation (which any un-transpiled escape
bypasses) and is what makes design A strictly safer, not just more compatible.

### E. If a transpiler remains: finish SSH-77 properly

Single lowering boundary `lower(node, ConsumerContext)`; `ShellValueDescriptor` as the
**only** currency (delete the ~16 flags, don't derive the descriptor from them); no logic
duplicated as emitted strings (SSH-569 was exactly that failure, in the error handler).

### Sequencing (each step independently shippable)

1. **Inversion pilot:** extend passthrough to any fully-analyzable command whose commands +
   paths are allowed (keep transpile as fallback instead of default). Measure: bug-report rate.
2. State trailer for passthrough (cwd/env persistence parity), then make passthrough the default.
3. mvdan/sh front-end adapter for the permission extractor.
4. OS sandbox wrapper for the bash subprocess.
5. Demote the transpiler to the `/*#*/` TS mode + a small proven allowlist; freeze
   `handlers/commands.ts` (bug-fix only).

Per the migration rule: this changes existing behavior — **requires explicit user sign-off
on direction and on each step's migration before implementation.**

## Appendix: source review pointers

- Word flattening / re-parse: `src/bash/lexer.ts` (~:649, :697+), `src/bash/parser.ts`
  (`parseWordParts` ~:1472, :1720); heredoc quoted-flag unused (`lexer.ts:1284`, `parser.ts` ~:1325)
- Flag-soup vs descriptor: `transpiler2/handlers/commands.ts` ~:369–379, :1274–1318, :1950–1958
- Bespoke command switch despite registry: `commands.ts` ~:988–1151
- Context decisions scattered: `commands.ts` :1226, :2361, :2849; `handlers/words.ts` :57
- Passthrough infra: `hooks/bash-prehook.ts` ~:1244, :1409
- Unrestricted allow-run: `src/runtime/permissions.ts` (`buildRunPermission`), `executor.ts:48`
