# Bug: a variable first assigned inside a `case` branch is emitted as a block-scoped `let`

Found 2026-09-10 while running ordinary CI-style bash (an env→URL lookup table)
through the MCP `Bash` tool. Filed from observed behaviour + source reading.

**Status: fixed 2026-09-15 as SSH-689**, but *not* by the hoisting pre-pass
proposed below — see "Resolution" at the end of this document for what was
actually built and why. Everything between here and there is the original
report, kept as the analysis of record.

## Summary

When a shell variable's **first** assignment occurs inside a `case` branch, the
transpiler emits `let X = …` *inside the generated JS `if (…) { }` block*. The
binding dies at the closing brace, but `ctx.declareVariable()` has already
recorded it in the enclosing transpiler scope, so every later branch and every
later read compiles against a binding that does not exist at runtime.

This is a correctness bug in a fully-supported construct, not an unsupported
one: `case`, `for`, `if`, `while` and functions all have first-class AST nodes,
dedicated handlers and extensive passing tests.

## Impact

Three distinct failure modes, in descending order of nastiness:

1. **Silent wrong value.** If the variable name collides with a JS global — and
   `URL` is an extremely common shell variable name — the read falls through to
   the ambient global. A script that builds `URL` in a `case` and curls it does
   not crash; it silently uses the source text of Deno's `URL` class. This is
   the dangerous one: no error, wrong behaviour.
2. **Silent empty value.** Otherwise the read compiles to
   `typeof X !== "undefined" ? X : ($.ENV.X ?? $.VARS?.X ?? "")` and yields `""`.
3. **Hard crash.** A later branch emits a bare `X = …`, which in the strict-mode
   ESM wrapper throws `ReferenceError: X is not defined`.

Mode 1 and 2 are the reason this is worth prioritising — an agent running shell
in this sandbox gets a plausible-looking wrong answer rather than a failure.

## Reproduction

```bash
for E in dev staging; do
  case "$E" in
    dev)     L1="a" ;;
    staging) L1="b" ;;
  esac
  echo "L=[$L1]"
done
```

Expected (bash): `L=[a]` / `L=[b]`.
Actual: prints `L=[]`, then aborts with `ReferenceError: L1 is not defined`.

The JS-global variant, same shape with the variable named `URL`, prints the
source text of `class URL { … }` for the first iteration and then `[b]`.

Retained artifacts from these runs:
`/tmp/safesh/errors/1789083646186-2957.log` (+ `scripts/file_fre9vponaJDnPj3c.ts:384`),
`/tmp/safesh/errors/1789083601318-2209.log` (+ `scripts/file_lX25Aw3zwSyJ5gQc.ts:377`),
`/tmp/safesh/errors/1789083077850-87707.log` (+ `scripts/file_nMrKBNvirBZVyHm3.ts:385`).

### Generated code

Obtained directly via `transpile(parse(src))`, and byte-identical to the
retained `/tmp/safesh/scripts/file_*.ts` for the failing runs:

```js
for (const E of ["dev", "staging"]) {
  const _tmp0 = `${typeof E !== "undefined" ? E : ($.ENV.E ?? $.VARS?.E ?? "")}`;
  if (/^dev\/*$/.test(_tmp0)) {
    let Q = "a";        // <-- block-scoped, dies at the closing brace
  } else if (/^staging\/*$/.test(_tmp0)) {
    Q = "b";            // <-- no binding in scope -> ReferenceError (strict mode)
  }
  $.echo(`[${typeof Q !== "undefined" ? Q : ($.ENV.Q ?? $.VARS?.Q ?? "")}]`);
}
```

## Root cause

The transpiler has no declaration-hoisting pass. Declarations are emitted lazily
at the first assignment site:

`src/bash/transpiler2/handlers/commands.ts:3323-3334`

```ts
  // Check if variable is already declared
  if (ctx.isDeclared(stmt.name)) {
    return `${jsName} = ${value}`;          // reassignment
  } else {
    ctx.declareVariable(stmt.name, "let");  // records in the ENCLOSING scope
    ...
    return `let ${jsName} = ${value}`;      // but emits HERE, inside the block
  }
```

Meanwhile `visitCaseStatement` opens real JS blocks but never pushes a matching
transpiler scope — only `ctx.indent()`:

`src/bash/transpiler2/handlers/control.ts:331-343`

```ts
    if (first) {
      lines.push(`${indent}if (${patterns}) {`);
      first = false;
    } else {
      lines.push(`${indent}} else if (${patterns}) {`);
    }

    ctx.indent();
    for (const s of caseClause.body) {
      const result = ctx.visitStatement(s);
      lines.push(...result.lines);
    }
    ctx.dedent();
```

So the transpiler's scope model and the emitted JS block structure disagree:
the `let` lands in a block the scope model does not know exists.

`pushScope`/`popScope` are called in exactly two places in the whole tree —
`visitForStatement` (`control.ts:198`/`205`) and `visitFunctionDeclaration`.
`visitIfStatement`, `visitCaseStatement`, `visitLoop` (while/until),
`visitCStyleForStatement`, `visitSubshell` and `visitBraceGroup` all emit blocks
with no scope push, so the same defect should reproduce for a first assignment
inside `if`/`elif`, `while`, a C-style `for`, or a brace group.

The `for` loop's static-vs-dynamic list handling (`control.ts:122-191`) is **not**
implicated — it only chooses `[...]` vs `_tmp0.push(...)` for `itemsExpr`; the
loop body emission at `control.ts:195-207` is identical either way. I verified
this by dumping both forms through `transpile()`.

## Suggested fix

Add a declaration-hoisting pre-pass. This is semantically right for bash, which
has no block-scoped variables — every assignment in a script or function body
belongs to that body's scope.

1. Add a recursive walker collecting assigned names from a statement list,
   descending into `If.consequent/alternate`, `Case.cases[].body`,
   `For`/`CStyleFor`/`While`/`Until`.body, `Subshell.body`, `BraceGroup.body`
   and pipeline operands, but **stopping at `FunctionDeclaration`** (functions
   get their own pass). Include assignment-prefixed command env vars.
2. In `mod.ts`, right after the async IIFE is opened, emit `let A, B, C;` for the
   collected names and `ctx.declareVariable(n, "let")` each. Same inside
   `visitFunctionDeclaration` after its `pushScope()`.
3. `buildVariableAssignment` then always takes the `isDeclared` branch and emits
   a plain `X = …` everywhere.

This fixes all three failure modes at once, including the JS-global collision —
a hoisted top-level `let URL;` shadows `globalThis.URL`. The
`typeof X !== "undefined"` env-fallback still works: a hoisted-but-unassigned
`let` is `undefined` past its TDZ, so never-assigned names still fall through to
`$.ENV`.

Two things to watch:

- Keep `visitForStatement`'s `pushScope()` so the `const` loop variable stays
  scoped, but hoist *body* assignments to the enclosing script/function scope —
  otherwise a variable first assigned in a loop and read after it regresses
  (bash keeps it).
- The `selfReferences` TDZ workaround at `commands.ts:3330` becomes dead code.

Adding `pushScope`/`popScope` to the block handlers is worth doing regardless so
the scope model stops lying, but **it is not a fix on its own** — it would turn
the crash into silently-empty output, i.e. trade mode 3 for mode 2.

## Test coverage

`case`-inside-a-loop appears to be untested: no test in
`src/bash/transpiler2/` combines `esac` with `for`/`while`. Worth adding
assertions that no `let` is emitted inside an `if`/`else if` block, for `case`,
`if`/`elif`, `while`, and a name colliding with a JS global (`URL`, `Response`,
`Event`).

## Unresolved anomaly

Some invocations with a **literal** for-list printed correct values
(`[a]` / `[b]`) even though `transpile()` emits the broken form for them, while
the identical loop failed when combined with a second statement. Successful
scripts are deleted from `/tmp/safesh/scripts/`, so I could not capture the
generated code for a passing run to compare. That suggests a second execution
path that sometimes produces different (correct) output. Worth identifying
before fixing, in case it is a partial workaround that the hoisting pass should
supersede rather than duplicate.

## Note on scoping the report

The MCP `run` tool's `shcmd` parameter is described as
`"Shell cmd (&&, ||, |, >, >>). No heredocs/subshells"` (`src/mcp/server.ts`).
That reads as a hint on one parameter rather than a statement about transpiler
support, and it is contradicted by `visitSubshell`'s recent ticketed work — but
if complex `for`/`case` really is meant to be out of scope, the fix is to reject
it loudly rather than emit code that silently computes the wrong value.

## Resolution (SSH-689)

The hoisting pre-pass above was **not** built. `buildVariableAssignment` now
declares with `var` instead of `let`, which gets the same result far more
cheaply: `var` is function-scoped, so the binding hoists to the enclosing async
IIFE (or function body) no matter which block first assigns it. That is exactly
bash's model — no block-scoped variables — so no walker, no name collection and
no second declaration site were needed.

All three failure modes close at once, for `case`, `if`/`elif`, `while` and
brace groups alike:

- Mode 1 (JS-global collision) — a hoisted top-level `var URL` shadows
  `globalThis.URL`, so the read can no longer reach the ambient class.
- Mode 2 (silent empty) — the binding outlives the block, so later reads see it.
- Mode 3 (ReferenceError) — a later branch's bare `X = …` now has a binding.

The `typeof X !== "undefined"` env-fallback still behaves as the report
predicted: a hoisted-but-unassigned `var` is `undefined`, so never-assigned
names still fall through to `$.ENV`.

Three consequences worth recording, none of them anticipated above:

1. **The SSH-566 TDZ workaround is gone, not just dead.** The report expected
   `selfReferences` to become dead code. It is stronger than that: `var` has no
   TDZ at all, so `PATH="$PATH:…"` reads `undefined` in its own initializer and
   falls through to `$.ENV.PATH`. The split `let X; X = …` emission was removed
   outright, and the SSH-566 tests now assert the inline `var` form while
   keeping their execution checks.
2. **Subshells needed matching work.** They lower to an async IIFE, which is a
   function boundary — so a *first* assignment inside one now stays
   subshell-local, which is correct bash parity and came for free. But an
   assignment to an *already-declared* parent variable still mutated the parent.
   `visitSubshell` and `buildSubshellTestExpression` now push a transpiler scope
   and save/restore the inherited bindings around the body.
3. **Generated temporaries were renamed `_tmpN` → `_tmp$N`.** `$` is not legal
   in a bash variable name, so a user script can no longer collide with a
   generated temporary — previously `_tmp0=user` next to a `case` would clash.

The report's "Unresolved anomaly" — a literal for-list sometimes printing the
right values — was not chased down separately; it is consistent with mode 1/2
depending on whether the name happened to collide with a global, and the
conformance tests now pin the behaviour either way.

### Coverage added

`conformance.test.ts` compares against real bash for a first assignment inside
a `case` branch in a loop, `if`/`elif`, a `while` body, a brace group, and a
name colliding with a JS global (`URL`, `Response`). `tests/bugs/bash-lowering-
conformance.test.ts` covers the subshell isolation cases.

### Discovered while fixing: SSH-690 (since fixed)

The C-style `for` case from the report's list turned out to be broken for an
unrelated reason. `visitCStyleForStatement` emits the init expression verbatim,
so `for ((i = 0; i < 2; i++))` lowers to `for ((i = 0); …)` — a bare assignment
to an undeclared binding, i.e. `ReferenceError` in the strict-mode wrapper
before the body runs. Verified pre-existing: the baseline emits the identical
init. Filed as SSH-690 and fixed immediately after; see the section below.

## SSH-690: arithmetic references to shell variables

The C-style `for` was the visible symptom of a wider defect. Every arithmetic
operand was lowered to a **bare JS identifier** — `visitVariableReference`
emitted `Number(i ?? 0)` — so any arithmetic touching a variable that had not
already been assigned in-script threw `ReferenceError`. The C-style `for` hits
it every time because its loop variable is normally fresh, but so did
`echo $((z + 1))`, `((w++))` and `((s += 5))`.

Two halves to the fix:

**Reads** now use the same `typeof`-guarded form that word expansion uses, with
an environment fallback: `Number((typeof i !== "undefined" ? i : ($.ENV.i ??
$.VARS?.i)) ?? 0)`. `typeof` is the one operator that is safe on an undeclared
name, so this never throws, and it also fixes reads of variables that exist
only in the environment — bash does see those in arithmetic, e.g.
`LIM=2 bash -c 'for ((i=0;i<LIM;i++))'`. Unset still evaluates to 0.

**Writes** need a real assignable binding, so `ctx.hoistVariable()` records the
name and `mod.ts` emits one `var a, b;` at the top of the IIFE. Hoisting rather
than declaring at the use site is what makes this work everywhere: arithmetic
can appear in expression position (`echo $((v = 7))`) where there is no
statement to prepend a declaration to. Declaring at the root also matches bash,
where an assignment inside a function body is global unless `local` — verified
that `f() { for ((m=0;m<2;m++)); do :; done; }; f; echo $m` prints 2.

Note this is the declaration-hoisting pass the original report proposed, but
demand-driven: only names that actually need an assignable binding are
collected, and only from arithmetic, rather than walking the whole AST.

Two subtleties worth recording:

1. **`++`/`--` and compound assignment read before they write**, so they cannot
   use the raw binding either. `undefined++` is NaN where bash counts 0. `++`
   normalizes first — `((i = <guarded read>), i++)` — which also coerces a
   string, so `i="5"; ((i++))` gives 6 and not `"51"`. Compound assignment
   expands `i op= n` to `i = <guarded read> op n`, so `((s += 5))` on an unset
   `s` yields 5. This changed the five compound-assignment structural tests,
   which now assert the expanded form.
2. **Hoisting re-opened the subshell leak SSH-689 had just closed.** A name
   hoisted from inside a subshell body lands in the root scope, so
   `( ((y++)) )` would have leaked to the parent. `visitSubshell` and
   `buildSubshellTestExpression` now compute their save/restore list *after*
   visiting the body rather than before, since visiting is what discovers the
   hoisted names. Brace groups deliberately do not isolate — bash `{ ((bg++)); }`
   does leak — so they were left alone.

### Coverage added

`conformance.test.ts` compares against real bash for a C-style `for` with an
otherwise-unset loop variable, the loop variable surviving the loop, unset
variables counting as 0 across `$(())`/`((i++))`/`((s += 5))`, numeric stepping
of a string-valued variable, and subshell isolation of an arithmetic write.

### Still open

A nested `$(())` fails to **parse** when the outer expansion is inside double
quotes: `echo "$(( $((2 + 3)) * 2 ))"` gives "Parse error at 1:2: Expected
command name", while the unquoted `echo $(( $((2+3)) * 2 ))` parses fine. So it
is the quoting interaction, not nesting as such. Pre-existing and in the parser,
not the transpiler, so out of scope here — filed as SSH-691.
