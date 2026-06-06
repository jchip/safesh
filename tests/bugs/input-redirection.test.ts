import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast, { imports: false, strict: false });
}

describe("Bug: input redirection", () => {
  it("feeds file contents to stdin instead of the file path text", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
        run: ["wc"],
      },
      timeout: 5000,
    };

    try {
      await Deno.writeTextFile(`${testDir}/README.md`, "one\ntwo\nthree\n");

      const code = transpileBash(`wc -l < README.md`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "3");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
