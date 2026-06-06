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

describe("Bug: process substitution", () => {
  it("captures input process substitution command output into the temp file", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
        run: ["comm", "sort"],
      },
      timeout: 5000,
    };

    try {
      await Deno.writeTextFile(`${testDir}/before.txt`, "alpha\nbravo\ncharlie\n");
      await Deno.writeTextFile(`${testDir}/after.txt`, "bravo\n");

      const code = transpileBash(
        `comm -23 <(sort before.txt) <(sort after.txt)`,
      );

      assertEquals(code.includes(".text()"), false, code);

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "alpha\ncharlie\n");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });

  it("captures pipeline output inside input process substitution", async () => {
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), "/tmp"],
        write: ["/tmp"],
        run: ["comm", "printf"],
      },
      timeout: 5000,
    };
    const code = transpileBash(
      `comm -23 <(printf "bravo\\nalpha\\ncharlie\\n" | sort) <(printf "bravo\\n" | sort)`,
    );

    assertEquals(code.includes(".text()"), false, code);

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "alpha\ncharlie\n");
  });
});
