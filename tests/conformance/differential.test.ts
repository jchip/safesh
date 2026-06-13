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
    { src: 's=hello; echo "${s^^}"; echo "${s,,}"' },
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
    // SSH-632: || across a pipeline returns rc1/empty instead of the fallback.
    {
      src:
        'seq 1 3 2>/dev/null | paste -sd+ - 2>/dev/null || printf "1\\n2\\n3\\n" | tr "\\n" "+"; echo',
      xfail: "SSH-632",
    },
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
    // SSH-635: `cat FILE` (path arg) doubles the trailing newline (`cat < FILE` does not).
    { src: 'printf "hi\\n" > @TMP@/c.txt; cat @TMP@/c.txt', xfail: "SSH-635" },
  ],
  assignment: [
    { src: 'a=1; b=2; echo "$a$b"' },
    { src: 'a=hello; echo "${a}world"' },
    { src: "x=5; x=$((x+1)); echo $x" },
    // SSH-633: multiple prefix assignments transpile to invalid `let a=.., let b=..`.
    { src: "a=1 b=2 && echo Y", xfail: "SSH-633" },
    // SSH-634: assignment-left &&-chain before a ;-sequence drops the && guard.
    { src: 'x=$(false) && echo Y; echo "rc=$?"', xfail: "SSH-634" },
  ],
};

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

// The corpus uses bash 4+ features (e.g. ${s^^}); skip rather than red-fail on a
// host whose `bash` is older or absent (macOS /bin/bash is 3.2).
async function bashSupportsCorpus(): Promise<{ ok: boolean; reason: string }> {
  try {
    const o = await new Deno.Command("bash", {
      args: ["-c", "echo ${BASH_VERSINFO[0]}"],
      env: { LC_ALL: "C" },
      stdout: "piped",
      stderr: "null",
    }).output();
    if (o.code !== 0) return { ok: false, reason: "`bash` exited non-zero" };
    const major = Number.parseInt(dec.decode(o.stdout).trim(), 10);
    if (!(major >= 4)) {
      return { ok: false, reason: `bash ${major} < 4 (corpus uses bash 4+ features)` };
    }
    return { ok: true, reason: `bash ${major}` };
  } catch (e) {
    return { ok: false, reason: `\`bash\` not runnable: ${msg(e)}` };
  }
}

const bash = await bashSupportsCorpus();
if (!bash.ok) {
  console.warn(`[SSH-628] differential conformance SKIPPED — ${bash.reason}`);
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
          await t.step(`[${cat}] ${label}`, async () => {
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
          });
        }
      }
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
    }
  },
});
