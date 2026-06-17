import { assertEquals } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

const EXEC_CONFIG: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    // /dev/null mirrors the real default config (src/core/config.ts): a piped
    // `cmd 2>/dev/null | grep -q ...` writes the upstream stderr to /dev/null.
    write: ["/tmp", "/dev/null"],
  },
  timeout: 5000,
};

function run(script: string) {
  const code = transpile(parse(script), { imports: false, strict: false });
  return executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });
}

// SSH-645: a fluent pipeline/command used as an if/while/until condition
// (`until cmd | grep -q x`, `while grep -q x file`) lowered to a FluentStream.
// Awaiting it yielded the stream object itself, whose `.code` is `undefined`, so
// every break test silently compared `undefined` against 0 — `until` never
// terminated (infinite loop), and `while`/`if` never entered the body. The
// condition now routes through __captureCmd, which consumes the stream and turns
// grep's empty-exit-code (empty -> 1, non-empty -> 0) into a real `.code`.
// All expected values verified against /bin/bash.
Deno.test("until terminates when a piped grep -q condition matches (SSH-645)", async () => {
  // grep matches on the first poll -> until breaks before running the body.
  const r = await run(
    `n=0; until echo READY | grep -q READY; do n=$((n+1)); [ $n -gt 5 ] && break; done; echo "tries=$n"`,
  );
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "tries=0");
});

Deno.test("until polls a changing condition and stops when met (SSH-645)", async () => {
  // The real-world box-reboot shape: poll a state source until it reports UP.
  // Without the fix this loop never observed the UP transition and spun forever.
  const state = "/tmp/ssh645-state.txt";
  const r = await run(
    `echo DOWN > ${state}
     tries=0
     until cat ${state} 2>/dev/null | grep -q UP; do
       tries=$((tries+1))
       if [ $tries -gt 40 ]; then echo TIMEOUT; break; fi
       if [ $tries -ge 3 ]; then echo UP > ${state}; fi
     done
     echo "reachable after $tries"`,
  );
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "reachable after 3");
});

Deno.test("while runs its body while a piped grep -q matches (SSH-645)", async () => {
  const r = await run(
    `n=0; while echo hi | grep -q hi; do n=$((n+1)); break; done; echo "ran=$n"`,
  );
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "ran=1");
});

Deno.test("while skips its body when a piped grep -q does not match (SSH-645)", async () => {
  const r = await run(`while echo hi | grep -q ZZZ; do echo X; break; done; echo done`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "done");
});

Deno.test("if/else branches on a piped grep -q condition (SSH-645)", async () => {
  const yes = await run(`if echo hi | grep -q hi; then echo Y; else echo N; fi`);
  assertEquals(yes.success, true, yes.stderr);
  assertEquals(yes.stdout.trim(), "Y");

  const no = await run(`if echo hi | grep -q ZZZ; then echo Y; else echo N; fi`);
  assertEquals(no.success, true, no.stderr);
  assertEquals(no.stdout.trim(), "N");
});

Deno.test("single grep -q command as a condition reads its file (SSH-645)", async () => {
  const file = "/tmp/ssh645-grep.txt";
  const found = await run(`printf 'foo\\nbar\\n' > ${file}; if grep -q foo ${file}; then echo Y; else echo N; fi`);
  assertEquals(found.success, true, found.stderr);
  assertEquals(found.stdout.trim(), "Y");

  const missing = await run(`printf 'foo\\nbar\\n' > ${file}; if grep -q zzz ${file}; then echo Y; else echo N; fi`);
  assertEquals(missing.success, true, missing.stderr);
  assertEquals(missing.stdout.trim(), "N");
});

Deno.test("grep -q condition does not leak the matched line to stdout (SSH-645)", async () => {
  // -q means quiet: the condition decides the branch but prints nothing itself.
  const r = await run(`if echo SECRET | grep -q SECRET; then echo OK; fi`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim(), "OK");
});

Deno.test("non-stream command conditions still print side-effect stdout (SSH-645)", async () => {
  // Guard the fix's boundary: only stream conditions get captured; a plain
  // command condition (`if echo hi`) must keep printing its output, as in bash.
  const r = await run(`if echo hi; then echo IN; fi`);
  assertEquals(r.success, true, r.stderr);
  assertEquals(r.stdout.trim().split("\n"), ["hi", "IN"]);
});
