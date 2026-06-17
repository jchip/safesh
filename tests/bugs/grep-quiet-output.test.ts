import { assertEquals } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

const EXEC_CONFIG: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp", "/dev/null"],
  },
  timeout: 5000,
};

function run(script: string) {
  const code = transpile(parse(script), { imports: false, strict: false });
  return executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });
}

// SSH-646: `grep -q` (and --quiet/--silent) lowered to the fluent passthrough
// filter `$.grep(/re/)`, which drops `-q`. The exit code was right, but in print
// positions (statement, or the printed operand of &&/||) the matched lines
// leaked to stdout — bash's `-q` writes nothing. Fluent grep can't model "match
// but emit nothing", so `-q` now delegates to real grep (the same fallback `-c`,
// `-m`, `-A/B/C` already use). All expected values verified against /bin/bash.
Deno.test("grep -q emits nothing in statement position (SSH-646)", async () => {
  const r = await run(`echo hi | grep -q hi`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout, "");
  assertEquals(r.code, 0);
});

Deno.test("grep -q no-match in statement position is silent and nonzero (SSH-646)", async () => {
  const r = await run(`echo hi | grep -q ZZZ`);
  assertEquals(r.stdout, "");
  assertEquals(r.code, 1);
});

Deno.test("grep -q && only runs the rhs, no matched-line leak (SSH-646)", async () => {
  const r = await run(`echo hi | grep -q hi && echo YES`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "YES");
});

Deno.test("grep -q || runs the rhs on no match (SSH-646)", async () => {
  const r = await run(`echo hi | grep -q ZZZ || echo NO`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "NO");
});

Deno.test("grep --quiet / --silent long forms suppress output (SSH-646)", async () => {
  const q = await run(`echo hi | grep --quiet hi && echo YES`);
  assertEquals(q.success, true, q.stderr);
  assertEquals(q.stdout.trim(), "YES");

  const s = await run(`echo hi | grep --silent hi && echo YES`);
  assertEquals(s.success, true, s.stderr);
  assertEquals(s.stdout.trim(), "YES");
});

Deno.test("grep -q combined with other flags suppresses output (SSH-646)", async () => {
  // -qi: quiet + ignore-case. The whole run delegates to real grep.
  const r = await run(`echo HELLO | grep -qi hello && echo YES`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "YES");

  // -qv: quiet + invert. "hi" does not match "ZZZ", so -v makes it a match.
  const inv = await run(`echo hi | grep -qv ZZZ && echo YES`);
  assertEquals(inv.success, true, inv.stderr);
  assertEquals(inv.stdout.trim(), "YES");
});

Deno.test("grep -q downstream of a fluent stage stays quiet (SSH-646)", async () => {
  // Upstream `sort` is the fluent transform; the real grep -q consumes it.
  const r = await run(`printf 'b\\na\\n' | sort | grep -q a && echo YES`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "YES");
});
