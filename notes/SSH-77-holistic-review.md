# SSH-77 Holistic Review: Bash Transpiler Regression Pattern

## Summary

The recent failures are symptoms of one core design problem: bash execution values do not have one canonical internal representation. The transpiler and runtime currently juggle several shapes:

- external `Command` objects
- buffered command result objects
- `FluentStream` / async iterable output
- shell builtin return values
- assignment-only statements
- async IIFEs that may resolve to any of the above
- string/array convenience values

Because those shapes are not normalized at explicit boundaries, each new shell construct adds another local rule for whether to print, capture, await, stringify, split into lines, preserve raw chunks, or continue after an error.

## Evidence

Recent commits cluster around the same pressure points:

- Command substitution: SSH-55, SSH-60/61, SSH-73, SSH-75
- Pipelines and stream/result shape handling: SSH-31, SSH-34, SSH-52, SSH-53, SSH-56, SSH-57, SSH-65, SSH-75
- Builtins behaving differently by context: SSH-21, SSH-45, SSH-48, SSH-60/61, SSH-66, SSH-67
- Fluent command emulation of external commands: SSH-38, SSH-41, SSH-43, SSH-49, SSH-62, SSH-71, SSH-72, SSH-75
- Redirection/capture/print interaction: SSH-19, SSH-36, SSH-48, SSH-52, SSH-66

The main implementation concentration is `src/bash/transpiler2/handlers/commands.ts`, which is over 3,000 lines and owns command strategy selection, builtin handling, fluent command lowering, redirection, pipeline assembly, logical control, capture, and statement printing. Runtime coercion helpers are embedded twice as generated strings in `src/runtime/preamble.ts`.

## Root Causes

### 1. Missing Shell Value Algebra

The code has flags such as `isPrintable`, `isStream`, `isLineStream`, `isResultObject`, `isTransform`, `requiresRawInput`, `isVariableAssignment`, and `async`. These flags are approximating a type system that does not exist.

The system needs a canonical internal shell value model, for example:

- `ShellStatus`: exit code and pipe status
- `ShellResult`: stdout, stderr, status
- `ShellStream`: raw stdout/stderr chunks plus final status
- `ShellLineStream`: line stream plus final status
- `ShellEffect`: state mutation with status and no stdout

The exact names can change, but the important part is that conversions between them are explicit and shared.

### 2. Context-Sensitive Builtins Are Handled Locally

Builtins can be:

- stateful and silent: `cd`
- output-producing: `pwd`, `ls`, `dirs`
- output-producing but error-prone: `echo` with redirected output
- test/status-like: `test`
- incompatible with pipelines unless represented as command-style output

Today that is handled by scattered flags and special cases. Builtins should lower through a single builtin adapter that returns the canonical shell value shape for the requested context: statement, pipeline input, command substitution, redirection, or capture.

### 3. Fluent Commands Are Not Command Semantics

`grep`, `head`, `sort`, `wc`, etc. are sometimes used as stream transforms and sometimes as replacements for external commands. That distinction matters:

- `grep`, `head`, `sort`, `uniq` usually operate on line records.
- `wc` counts raw bytes/newlines and should not blindly receive `.lines()`.
- unsupported flags should consistently fall back to external `$.cmd`.
- file arguments, globbed file arguments, recursive modes, and `-l/-n/-c` options change output shape.

This needs a command capability registry, not one-off parsing inside the pipeline assembler.

### 4. Preamble Helpers Are Runtime Type Coercion By Duck Typing

`__printCmd`, `__captureCmd`, and `__cmdSubText` currently inspect runtime objects and guess behavior. That made SSH-75 possible: an async IIFE returned a Promise, and command substitution stringified it before awaiting.

Those helpers should call shared runtime coercion functions with well-defined input/output contracts, not duplicate duck-typing logic inside generated preamble strings.

### 5. Tests Are Mostly Incident Regressions, Not Semantic Coverage

The regression tests are valuable, but they are mostly named after symptoms. There is no compact matrix that asserts shell semantics across:

- command source type: external command, builtin, fluent command, assignment, group, subshell
- consumer context: statement print, command substitution, pipeline, redirection, logical operator, background
- data mode: raw stream versus line stream
- status behavior: success, failure, non-zero-with-output, pipe status

That is why adjacent changes keep breaking nearby cases.

## Recommended Consolidation

### Phase 1: Introduce Shared Runtime Coercions

Add a small module that owns conversions:

- `toShellResult(value)`
- `toCommandSubstitutionText(value)`
- `printShellValue(value)`
- `streamStdout(value, mode)`
- `captureShellValue(value)`

Then make the preamble import these helpers instead of embedding duplicated implementations. This is the safest first step because it centralizes behavior without rewriting the transpiler.

### Phase 2: Replace Pipeline Flags With a Shell Value Descriptor

Replace the growing flag set on `PipelinePart` with a single descriptor:

```ts
type ShellValueKind =
  | "effect"
  | "result"
  | "raw-stream"
  | "line-stream"
  | "transform";
```

Pipeline assembly should switch on `kind` and use explicit conversion helpers. This would remove most of the current flag combinations that can be invalid or underspecified.

### Phase 3: Add a Command Capability Registry

Move fluent command knowledge into a registry with structured metadata:

- command name
- supported flags
- unsupported flags that force external fallback
- input mode: `raw` or `line`
- output mode: `raw`, `line`, `result`
- file operand behavior
- recursive/glob behavior

Then `grep`, `wc`, `head`, `sort`, etc. use the same lowering path instead of custom logic scattered through `buildFluentCommand`.

### Phase 4: Normalize Builtin Lowering

Create a builtin adapter that takes:

- builtin metadata
- args
- redirects
- target context

and returns a canonical shell value descriptor. This should absorb the current special cases for output builtins, captured builtins, redirected builtins, and builtins excluded from pipelines.

### Phase 5: Add a Conformance Matrix

Create a small table-driven test harness that transpiles and executes bash snippets, then compares stdout, stderr, exit code, and cwd/env state against expected behavior. Start with the recent failure clusters, not full POSIX:

- command substitution in echo args
- command substitution inside assignments/logical chains
- command output piped to `wc -l`
- builtins in statements, redirections, and command substitution
- grouped logical pipelines
- non-zero intermediate pipeline output
- background command launch behavior

## What Not To Do

Do not keep adding booleans to `PipelinePart` as the primary mechanism. That path is already at the point where each new flag fixes one case and risks another.

Do not rewrite the parser as part of this effort. Most current failures are lowering/runtime semantics, not parse-tree construction.

Do not replace all fluent commands with external commands. Fluent commands are useful, but they need explicit semantic contracts and fallback rules.

## First Implementation Slice

The first slice should be narrow:

1. Extract `__printCmd`, `__captureCmd`, and `__cmdSubText` behavior into a real runtime module.
2. Import that module from both preamble builders.
3. Preserve generated helper names as thin wrappers for compatibility.
4. Add matrix tests for the SSH-73 and SSH-75 cases.

This should reduce duplicated runtime coercion and create a stable place for later pipeline and builtin consolidation.
