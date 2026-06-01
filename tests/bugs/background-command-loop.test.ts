import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

describe("Bug: background command in loop", () => {
  it("spawns a background command without awaiting the Command object first", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
        run: ["sh"],
      },
      timeout: 5000,
    };

    try {
      const code = transpileBash(
        `for i in 1 2; do sh -c "exit 0" & done
echo after`,
      );

      assertEquals(code.includes("const __bgCmd = await"), false, code);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "after");
      assertEquals(result.stderr, "");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });

  it("does not print synchronous background builtins twice", async () => {
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), "/tmp"],
        write: ["/tmp"],
      },
      timeout: 5000,
    };
    const code = transpileBash(
      `echo hi &
echo after`,
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim().split(/\r?\n/).sort(), ["after", "hi"]);
    assertEquals(result.stderr, "");
  });
});
