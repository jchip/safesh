/**
 * A user-defined function on the right side of a pipe reads the upstream
 * output as its stdin, as in bash. Compared against real `bash -c`.
 */
import { assertEquals } from "@std/assert";
import { parse, transpile } from "../../src/bash/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import { getDefaultConfig } from "../../src/core/utils.ts";

const cwd = Deno.cwd();
const dec = new TextDecoder();
const config = {
  ...getDefaultConfig(cwd),
  allowProjectCommands: true,
  quiet: true,
} as Parameters<typeof executeCode>[1];

const CASES = [
  "f() { cat; }; echo hi | f",
  'f() { tr a-z A-Z; }; printf "x\\n" | f; echo END',
  "f() { echo hi; }; f | tr a-z A-Z",
  'f() { while read l; do echo "<$l>"; done; }; printf "a\\nb\\n" | f',
  'f() { cat; }; g() { tr a-z A-Z; }; echo hi | f | g',
  'f() { echo start; cat; echo end; }; echo mid | f',
  'f() { grep "$1"; }; printf "a\\nb\\n" | f b',
  'f() { cat; false; }; echo x | f; echo "rc=$?"',
  "f() { cat; }; echo hi | f | tr a-z A-Z",
  "g() { cat; }; f() { g; }; echo hi | f",
  'f() { while read a b; do echo "$b-$a"; done; }; printf "1 2\\n3 4\\n" | f',
];

async function runBash(src: string): Promise<{ out: string; code: number }> {
  const o = await new Deno.Command("bash", {
    args: ["-c", src],
    env: { LC_ALL: "C", LANG: "C" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { out: dec.decode(o.stdout), code: o.code };
}

async function runSafesh(src: string): Promise<{ out: string; code: number; ts: string }> {
  const ts = transpile(parse(src), { imports: false, strict: false });
  const r = await executeCode(ts, config, { cwd });
  return { out: r.stdout, code: r.code, ts };
}

Deno.test({
  name: "pipe into a user-defined function matches bash",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    for (const src of CASES) {
      await t.step(src, async () => {
        const b = await runBash(src);
        const s = await runSafesh(src);
        assertEquals({ out: s.out, code: s.code }, b, s.ts);
      });
    }
  },
});
