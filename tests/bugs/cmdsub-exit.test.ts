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

function transpileForExecution(script: string): string {
  return transpile(parse(script), { imports: false, strict: false });
}

// SSH-613: `exit N` inside $( ) runs in a subshell, so it must end only the
// substitution (leaving $? = N), not Deno.exit the whole script.
Deno.test("exit in $() assignment leaves $?=N and continues the script (SSH-613)", async () => {
  const code = transpileForExecution(`x=$(exit 3); echo "after=$? x=[$x]"`);
  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim(), "after=3 x=[]");
});

Deno.test("exit in an embedded $() does not terminate the surrounding command (SSH-613)", async () => {
  const code = transpileForExecution(`echo "a$(exit 5)b"; echo "next=$?"`);
  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  // bash: prints "ab"; $? after the echo is echo's own status (0), since the
  // command word — not the embedded substitution — sets $? here.
  assertEquals(result.stdout.trim().split("\n"), ["ab", "next=0"]);
});

Deno.test("normal $() without exit is byte-for-byte unaffected (SSH-613)", async () => {
  const code = transpileForExecution(`x=$(echo hi); echo "[$x] $?"`);
  const result = await executeCode(code, EXEC_CONFIG, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim(), "[hi] 0");
  // The no-exit path must keep the original lowering (no try/catch wrapper).
  assertEquals(code.includes("__sshSubshellExit"), false, code);
});
