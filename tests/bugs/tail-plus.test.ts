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

describe("Bug: tail -n +N", () => {
  it("outputs from line N for a file operand", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
        run: [],
      },
      timeout: 5000,
    };

    try {
      await Deno.writeTextFile(`${testDir}/lines.txt`, "one\ntwo\nthree\nfour\n");

      const code = transpileBash(`tail -n +3 lines.txt`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "three\nfour\n");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });

  it("outputs from line N in a pipeline", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
        run: [],
      },
      timeout: 5000,
    };

    try {
      await Deno.writeTextFile(`${testDir}/lines.txt`, "one\ntwo\nthree\nfour\n");

      const code = transpileBash(`cat lines.txt | tail -n +2`);
      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "two\nthree\nfour\n");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
