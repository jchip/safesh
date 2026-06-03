import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
    run: ["printf"],
  },
  timeout: 5000,
};

describe("Bug: assignment command substitution in logical chains", () => {
  it("uses assignment-only commands as successful command results", async () => {
    const code = transpileBash(
      `out=$(printf "ok" 2>&1) && echo "$out" || echo fail`,
    );

    assertEquals(code.includes("__captureCmd(let out"), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim(), "ok");
  });

  it("keeps assignment-only commands out of capture expression position", async () => {
    const code = transpileBash(
      `for i in 1 2 3; do
  out=$(printf "ok" 2>&1) && { echo "$out"; break; } || { echo "attempt $i failed"; }
done
echo done`,
    );

    assertEquals(code.includes("__captureCmd(let out"), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim(), "ok\ndone");
  });
});
