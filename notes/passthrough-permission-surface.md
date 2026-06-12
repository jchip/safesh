# Passthrough Permission Surface (SSH-598)

What the passthrough static analyzer (`src/hooks/passthrough-analyzer.ts`)
validates before handing a command to native bash, and — just as important —
what it deliberately does not.

## What is validated

- **Command words** — every command that can execute, including commands in
  command substitutions, pipelines, env-prefixed forms, case patterns, and
  conditional/loop bodies. Unknown or non-enumerable commands make the script
  ineligible.
- **Redirect targets** — classified per operator as read, write, or both
  (`<>`), resolved against the statically tracked cwd at that point.
- **`cd` targets** — validated as reads, and tracked so later relative
  targets resolve against the right directory. A `cd` the analyzer cannot
  statically resolve makes later path-dependent operations ineligible.

When the analyzer cannot fully account for a script, it marks it ineligible
and the prehook falls back to the transpile path, which enforces the sandbox
at runtime. The analyzer over-approximates; it never guess-approves.

## What is deliberately NOT validated: command-argument paths

`cat /etc/passwd` passes through if `cat` is an allowed command, even though
`/etc/passwd` is outside the read sandbox. The transpile path would block
that read at runtime; passthrough does not.

**This relaxation is intentional** (user decision, 2026-06-12, SSH-598):

- Argument-path validation is heuristic by nature — the analyzer cannot
  reliably distinguish a path argument from a branch name, URL, or pattern,
  so enforcing it would either over-block ordinary commands or provide a
  false sense of soundness.
- Passthrough exists for commands the user's allowlist already trusts;
  what a trusted command reads is governed by the command allowlist plus
  the Bash tool's own permission prompts, not by path extraction.
- Redirects and `cd` stay validated because they are shell-level operations
  with unambiguous path semantics — there the analyzer can be sound.

Do not re-report the missing arg-path validation as a bug; changing this
stance is a product decision, not a fix.

## Related

- `notes/complexity-analyzer.md` — the simple/complex passthrough split.
- `notes/bash-architecture-review-2026-06.md` — the inversion plan that made
  passthrough the default for analyzable commands.
- SSH-590 — soundness fixes for the checks that do exist (cwd tracking,
  case patterns, loop variables, `~user`, redirect classification, globstar).
