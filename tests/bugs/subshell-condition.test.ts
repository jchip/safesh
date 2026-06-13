import { assertEquals } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

const EXEC_CONFIG: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
  },
  timeout: 5000,
};

function run(script: string) {
  const code = transpile(parse(script), { imports: false, strict: false });
  return executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });
}

// SSH-620: a subshell `( ... )` or brace group `{ ...; }` used as an
// if/while/until condition no longer throws "Invalid test expression"; its exit
// status drives the branch and flows into $? at branch entry (SSH-619). All
// expected values verified against /bin/bash.
Deno.test("subshell condition drives if branches and $? (SSH-620)", async () => {
  const cases: Array<[string, string]> = [
    // `exit N` inside the subshell is isolated -> condition status N
    [`if (exit 7); then echo y; else echo "x=$?"; fi`, "x=7"],
    [`if (false); then echo y; else echo "x=$?"; fi`, "x=1"],
    [`if (true); then echo "x=$?"; else echo no; fi`, "x=0"],
    // subshell as the leading operand of a && condition
    [`if (false) && [ -n x ]; then echo y; else echo "x=$?"; fi`, "x=1"],
  ];
  for (const [script, expected] of cases) {
    const r = await run(script);
    assertEquals(r.success, true, `stderr: ${r.stderr}\n${script}`);
    assertEquals(r.stdout.trim(), expected, script);
  }
});

Deno.test("brace-group condition drives if branches and $? (SSH-620)", async () => {
  const cases: Array<[string, string]> = [
    [`if { false; }; then echo y; else echo "x=$?"; fi`, "x=1"],
    [`if { true; }; then echo "x=$?"; fi`, "x=0"],
  ];
  for (const [script, expected] of cases) {
    const r = await run(script);
    assertEquals(r.success, true, `stderr: ${r.stderr}\n${script}`);
    assertEquals(r.stdout.trim(), expected, script);
  }
});

Deno.test("subshell condition in while/until loops (SSH-620)", async () => {
  // while with a subshell-wrapped test behaves like the bare test, including
  // the post-loop status (0 from the last body command, not the failed cond).
  const w = await run(`n=0; while ( [ $n -lt 2 ] ); do echo $n; n=$((n+1)); done; echo "end=$?"`);
  assertEquals(w.success, true, w.stderr);
  assertEquals(w.stdout.trim().split("\n"), ["0", "1", "end=0"]);

  // until breaks as soon as the subshell condition succeeds (exit 0).
  const u = await run(`until (exit 0); do echo x; break; done; echo done`);
  assertEquals(u.success, true, u.stderr);
  assertEquals(u.stdout.trim(), "done");
});
