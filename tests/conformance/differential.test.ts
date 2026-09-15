/**
 * SSH-628 — Differential conformance harness (bash vs transpile+execute).
 *
 * For each bash snippet we run the PRODUCTION pipeline —
 * `transpile(parse(src), { imports: false, strict: false })` -> `executeCode` —
 * and compare its stdout + exit code against real `bash -c src` under LC_ALL=C.
 *
 * This is the gate for every transpiler/executor fix and for flipping the
 * `nativeCommands` per-util adapters: a fix is "done" when its case stops being
 * an xfail here.
 *
 * Cases tagged `xfail` document a KNOWN divergence against an open ticket. The
 * harness asserts they STILL diverge, and fails loudly the moment one starts
 * matching bash — that is the signal to drop the `xfail` and close the ticket.
 *
 * Promoted from .temp/review/diff.ts (the ad-hoc review harness, 33 pass / 2
 * fail on first run after the SSH-623/624/625/626/627/629 fixes).
 */
import { parse, transpile } from "../../src/bash/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import { getDefaultConfig } from "../../src/core/utils.ts";

const cwd = Deno.cwd();
const dec = new TextDecoder();

// Mirror the production transpile options + real runtime preamble, and allow
// spawning real coreutils so we compare against actual tool output (not stubs).
const config = {
  ...getDefaultConfig(cwd),
  allowProjectCommands: true,
  quiet: true,
} as Parameters<typeof executeCode>[1];

interface Case {
  src: string;
  /** Open ticket id when this case is a KNOWN divergence (expected-fail). */
  xfail?: string;
  /**
   * SSH-695: case needs bash 4+ syntax and is skipped on an older host. Tag
   * only the cases that genuinely need it — the gate used to be all-or-nothing,
   * which silently disabled the whole corpus (and every `xfail` assertion in
   * it) on macOS, where /bin/bash is 3.2.
   */
  bash4?: true;
}

/**
 * Bash snippets grouped by surface. `@TMP@` is replaced with a per-run temp dir
 * (rooted under the sandbox-writable /tmp) before execution. `\n` sequences are
 * left for `printf`/the shell to interpret, matching real usage.
 */
const CORPUS: Record<string, Case[]> = {
  expansion: [
    { src: 'f=a.tar.gz; echo "${f#*.}"' },
    { src: 'f=a.tar.gz; echo "${f##*.}"' },
    { src: 'f=a.tar.gz; echo "${f%.*}"' },
    { src: 'echo "${UNSET:+SET}"' },
    { src: 'echo "${UNSET:-default}"' },
    { src: 's=hello; echo "${s/l/L}"; echo "${s//l/L}"' },
    { src: 's=hello; echo "${#s}"; echo "${s:1:3}"' },
    { src: 's=hello; echo "${s^^}"; echo "${s,,}"', bash4: true },
    { src: 'r=PATH; echo "${!r}" | head -c0; echo indirect-ok' },
  ],
  arithmetic: [
    { src: "echo $((1+2*3)); echo $((2**10)); echo $((7/2)); echo $((7%3))" },
    { src: "i=5; echo $((i++)); echo $i; echo $((++i))" },
    { src: "echo $(( (1<2) ? 10 : 20 ))" },
  ],
  quoting: [
    { src: 'echo "a   b"' },
    { src: "echo 'a$b\\n'" },
    { src: 'printf "%s-%s\\n" x y z' },
  ],
  coreutils: [
    { src: 'printf "b\\na\\nc\\n" | sort' },
    { src: 'printf "B\\na\\nA\\nb\\n" | LC_ALL=C sort' },
    { src: 'printf "a\\na\\nb\\n" | uniq -c' },
    { src: "echo hello | tr a-z A-Z" },
    { src: 'echo hello-world | sed "s/-/_/g"' },
    { src: 'echo "1 2 3" | awk "{print \\$2}"' },
    { src: 'printf "apple\\nbob\\ncat\\n" | grep b' },
    // SSH-631: native $.wc omits coreutils right-justified field-width padding.
    { src: 'printf "one two three\\n" | wc -w', xfail: "SSH-631" },
    { src: 'printf "x\\ny\\nz\\n" | head -2; echo --; printf "x\\ny\\nz\\n" | tail -1' },
    // SSH-632: this was never about || precedence — the `2>/dev/null` failed
    // because /dev/null was missing from the getDefaultConfig write list.
    {
      src:
        'seq 1 3 2>/dev/null | paste -sd+ - 2>/dev/null || printf "1\\n2\\n3\\n" | tr "\\n" "+"; echo',
    },
    { src: "seq 1 3 2>/dev/null | paste -sd+ - 2>/dev/null" },
    { src: "false | cat || echo fallback" },
    { src: 'false || printf "a\\nb\\n" | tr "\\n" "+"; echo' },
  ],
  control: [
    { src: "false; echo $?" },
    { src: "if true; then echo yes; else echo no; fi" },
    { src: 'for i in 1 2 3; do echo "n$i"; done' },
    // NB: this *passes* — a complete &&/|| chain keeps its guards. Contrast with
    // the SSH-634 assignment case below (chain feeding a ;-sequence).
    { src: 'x=$(false) && echo Y || echo N; echo "rc=$?"' },
    { src: "n=0; while [ $n -lt 3 ]; do echo $n; n=$((n+1)); done" },
    { src: "case abc in a*) echo matched-a;; *) echo other;; esac" },
  ],
  subshell: [
    { src: "echo $(echo nested)" },
    { src: '(exit 3); echo "rc=$?"' },
    { src: "echo $(( $(echo 2) + 3 ))" },
    { src: 'v=$(printf "x\\ny\\n" | sort -r); echo "$v"' },
  ],
  redirection: [
    // Read back via `cat < f` (proven correct) so these isolate write/append/
    // truncate redirection from the SSH-635 `cat FILE` print bug pinned below.
    { src: "echo hi > @TMP@/r.txt; cat < @TMP@/r.txt" },
    { src: 'printf "a\\n" > @TMP@/r.txt; printf "b\\n" >> @TMP@/r.txt; cat < @TMP@/r.txt' },
    { src: "echo first > @TMP@/r.txt; echo second > @TMP@/r.txt; cat < @TMP@/r.txt" },
    { src: "echo out 2>/dev/null" },
    { src: "echo discard > /dev/null; echo kept" },
    // SSH-635 (fixed): `cat FILE` (path arg) no longer doubles the trailing newline.
    { src: 'printf "hi\\n" > @TMP@/c.txt; cat @TMP@/c.txt' },
  ],
  assignment: [
    { src: 'a=1; b=2; echo "$a$b"' },
    { src: 'a=hello; echo "${a}world"' },
    { src: "x=5; x=$((x+1)); echo $x" },
    // SSH-633: multiple prefix assignments used to emit a declaration keyword
    // per assignment into one comma expression (`var a=.., var b=..`), which is
    // invalid JS; the names are hoisted instead.
    { src: "a=1 b=2 && echo Y" },
    { src: "a=$(false) b=$(true) && echo Y" },
    { src: 'a=1 b=2 c=3; echo "$a$b$c"' },
    // SSH-634: an `x=$(cmd)` left operand carries the substitution's status, so
    // hoisting it out of the && chain (which then ran the rest
    // unconditionally) dropped the guard. Not specific to the ;-sequence the
    // ticket described — the bare chain was broken too.
    { src: 'x=$(false) && echo Y; echo "rc=$?"' },
    { src: "x=$(false) && echo Y" },
    { src: "x=$(true) && echo Y" },
    { src: 'x=$(echo hi) && echo "got=$x"' },
    // Assignments that CANNOT fail must still hoist (they always succeed).
    { src: "a=1 && echo Y" },
    { src: 'a=1 && b=2 && echo "$a$b"' },
    // SSH-694: a subscript is an arithmetic context, so all of these spellings
    // are equivalent. `$i` used to emit a bare `$i` identifier (ReferenceError).
    { src: 'a=(1 2 3); i=1; echo "${a[$i]}"' },
    { src: 'a=(1 2 3); i=1; echo "${a[i]}"' },
    { src: 'a=(1 2 3); echo "${a[1]}"' },
    { src: 'a=(1 2 3); i=1; echo "${a[i+1]}"' },
    { src: 'a=(x y); n=0; echo "${a[$n]}${a[$((n+1))]}"' },
    // SSH-697: whole-array expansion is handled for PIPESTATUS but not for an
    // ordinary array, so these still lower to unparseable output.
    { src: 'a=(1 2 3); echo "${a[@]}"', xfail: "SSH-697" },
    { src: 'a=(1 2 3); echo "${a[*]}"', xfail: "SSH-697" },
    { src: 'a=(1 2 3); echo "${#a[@]}"', xfail: "SSH-697" },
  ],
  functions: [
    // SSH-674: call-site arguments used to be dropped, and $N in the body read
    // an undeclared __POSITIONAL_PARAMS__ (ReferenceError). Arguments are now
    // forwarded as a rest parameter of that name.
    { src: 'norm() { echo "got=[$1]"; }; norm hello' },
    { src: "greet() { echo hi; }; greet" },
    { src: 'f() { echo "$1-$2"; }; f a b' },
    { src: 'f() { echo "count=$#"; }; f a b c' },
    { src: 'f() { echo "all=$@"; }; f x y' },
    { src: 'f() { echo "[$1]"; }; f' },
    { src: 'g() { echo "hello $1"; }; g world; g again' },
    { src: 'f() { echo "$1"; }; x=val; f "$x"' },
    { src: 'f() { i() { echo "inner=$1"; }; i deep; echo "outer=$1"; }; f out' },
    { src: 'echo "top=[$1]"' },
    // SSH-698: a function CALL is a Promise, not a Command, so redirecting,
    // piping or capturing one still fails.
    { src: "f() { echo hi; }; f | cat", xfail: "SSH-698" },
    { src: 'f() { echo "a$1"; }; v=$(f X); echo "[$v]"', xfail: "SSH-698" },
  ],
  // SSH-676: background jobs + `wait`. Every case here is ordering-sensitive on
  // purpose — the pre-fix failure mode was `wait` falling straight through, so
  // only the interleaving proves it actually waits. Sleeps are spread far
  // enough apart (50ms vs 200ms) that the ordering is not a race.
  jobs: [
    { src: "( sleep 0.2; echo SLOW ) & echo FG; wait; echo AFTER" },
    { src: "sleep 0.2 & wait; echo AFTER" },
    { src: "( sleep 0.2; echo A ) & ( sleep 0.05; echo B ) & wait; echo C" },
    { src: "{ sleep 0.2; echo BRACE; } & wait; echo AFTER" },
    { src: "echo pre; ( sleep 0.1; echo mid ) & wait; echo post" },
    // $! must be non-empty for an in-process job too (bash gives a real pid;
    // we only pin that something referable comes back), and `wait $!` waits.
    { src: '( sleep 0.1 ) & p=$!; [ -n "$p" ] && echo haspid; wait' },
    { src: "( sleep 0.2; echo X ) & wait $!; echo Y" },
    // $! is the MOST RECENT job, not the first.
    { src: '( exit 3 ) & ( exit 4 ) & wait $!; echo "rc=$?"' },
    // Bare `wait` always reports 0, even when a job failed; `wait PID` reports
    // that job's status; an unknown pid is 127.
    { src: '( exit 3 ) & wait; echo "rc=$?"' },
    { src: '( exit 3 ) & wait $!; echo "rc=$?"' },
    { src: '{ sleep 0.1; false; } & wait $!; echo "rc=$?"' },
    { src: 'wait; echo "rc=$?"' },
    { src: 'wait 999999; echo "rc=$?"' },
    // Reaping: a bare `wait` clears the table (a later `wait $!` is 127), but
    // `wait PID` leaves the record, so the same pid reports the same status.
    { src: '( exit 3 ) & p=$!; wait; wait $p; echo "rc=$?"' },
    { src: '( exit 3 ) & p=$!; wait $p; wait $p; echo "rc=$?"' },
  ],
};

// SSH-676 collateral: giving a `( ... )`/`{ ...; }` group in expression
// position its real exit status (it was hardcoded to 0) also fixes negation
// and PIPESTATUS for those forms. Kept alongside the jobs corpus because the
// same change drives both.
CORPUS.subshell!.push(
  { src: '! ( false ); echo "rc=$?"' },
  { src: '! ( true ); echo "rc=$?"' },
  // SSH-677: the captured-upstream build (buildStatementAsCapturedExpression)
  // still hardcodes code 0, so a group feeding a pipe loses its status.
  { src: '( false ) | cat; echo "${PIPESTATUS[0]}"', xfail: "SSH-677" },
  // SSH-693: a subshell restores the process environment as well as the JS
  // bindings, so an `export` inside `( )` cannot reach a later child process.
  { src: "export X=outer; ( export X=inner ); printenv X" },
  { src: 'export X=outer; ( export X=inner ); echo "$X"' },
  { src: "export X=outer; ( export X=inner; printenv X )" },
  { src: '( export NEW=1 ); printenv NEW; echo "rc=$?"' },
  { src: "export X=outer; ( unset X ); printenv X" },
);

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runBash(src: string): Promise<{ out: string; code: number; err: string }> {
  const o = await new Deno.Command("bash", {
    args: ["-c", src],
    env: { LC_ALL: "C", LANG: "C" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { out: dec.decode(o.stdout), code: o.code, err: dec.decode(o.stderr) };
}

async function runSafesh(src: string): Promise<{ out: string; code: number; ts: string }> {
  let ts = "";
  try {
    ts = transpile(parse(src), { imports: false, strict: false });
  } catch (e) {
    return { out: "", code: -1, ts: `__PARSE/TRANSPILE THREW__: ${msg(e)}` };
  }
  try {
    const r = await executeCode(ts, config, { cwd });
    return { out: r.stdout, code: r.code, ts };
  } catch (e) {
    return { out: "", code: -1, ts: `${ts}\n__EXECUTE THREW__: ${msg(e)}` };
  }
}

function divergenceReport(
  cat: string,
  src: string,
  b: { out: string; code: number; err: string },
  s: { out: string; code: number; ts: string },
): string {
  return [
    `DIVERGENCE [${cat}]  ${src}`,
    `  bash   (rc=${b.code}): ${JSON.stringify(b.out)}`,
    `  safesh (rc=${s.code}): ${JSON.stringify(s.out)}`,
    b.err.trim() ? `  bash stderr: ${JSON.stringify(b.err)}` : "",
    "  transpiled:",
    s.ts.split("\n").map((l) => `    ${l}`).join("\n"),
  ].filter(Boolean).join("\n");
}

// SSH-695: only a handful of cases need bash 4+ syntax, so probe the version and
// skip just those (`bash4: true`) rather than the whole corpus. The gate was
// previously all-or-nothing, which meant that on macOS — where /bin/bash is 3.2 —
// every case AND every `xfail` assertion was silently inactive, so a fixed bug
// never tripped the "XFAIL now MATCHES" alarm this harness exists to raise.
// `bash` being absent or unrunnable is still a whole-corpus skip.
async function bashVersion(): Promise<{ ok: boolean; major: number; reason: string }> {
  try {
    const o = await new Deno.Command("bash", {
      args: ["-c", "echo ${BASH_VERSINFO[0]}"],
      env: { LC_ALL: "C" },
      stdout: "piped",
      stderr: "null",
    }).output();
    if (o.code !== 0) return { ok: false, major: 0, reason: "`bash` exited non-zero" };
    const major = Number.parseInt(dec.decode(o.stdout).trim(), 10);
    if (!Number.isFinite(major)) {
      return { ok: false, major: 0, reason: "could not read BASH_VERSINFO" };
    }
    return { ok: true, major, reason: `bash ${major}` };
  } catch (e) {
    return { ok: false, major: 0, reason: `\`bash\` not runnable: ${msg(e)}` };
  }
}

const bash = await bashVersion();
if (!bash.ok) {
  console.warn(`[SSH-628] differential conformance SKIPPED — ${bash.reason}`);
} else if (bash.major < 4) {
  console.warn(
    `[SSH-628] ${bash.reason}: running the corpus, skipping only the bash4-tagged cases`,
  );
}

Deno.test({
  name: "SSH-628: differential conformance (bash vs transpile+execute, LC_ALL=C)",
  ignore: !bash.ok,
  // Spawns external processes (bash + real coreutils); their fd lifecycle is not
  // what this differential test polices, so the op/resource sanitizers are off.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmp = await Deno.realPath(
      await Deno.makeTempDir({ dir: "/tmp", prefix: "safesh-conf-" }),
    );
    try {
      for (const [cat, cases] of Object.entries(CORPUS)) {
        for (const c of cases) {
          const label = c.xfail ? `${c.src}  (xfail ${c.xfail})` : c.src;
          await t.step({
            name: `[${cat}] ${label}`,
            ignore: Boolean(c.bash4) && bash.major < 4,
            fn: async () => {
              const src = c.src.replaceAll("@TMP@", tmp);
              const b = await runBash(src);
              const s = await runSafesh(src);
              const diverged = b.out !== s.out || b.code !== s.code;

              if (c.xfail) {
                if (!diverged) {
                  throw new Error(
                    `XFAIL ${c.xfail} now MATCHES bash — the bug appears fixed. ` +
                      `Remove the \`xfail\` from this case and close ${c.xfail}.\n  src: ${c.src}`,
                  );
                }
                return; // still diverges as documented; gate stays green
              }
              if (diverged) throw new Error(divergenceReport(cat, c.src, b, s));
            },
          });
        }
      }
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
    }
  },
});
