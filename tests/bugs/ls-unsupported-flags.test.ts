import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import { REAL_TMP } from "../helpers.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast, { imports: false, strict: false });
}

describe("Bug: ls Unsupported Flags", () => {
  it("should fall back to external ls for -lt before continuing the script", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const file = `${testDir}/inspections-all.jar`;
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
      },
      timeout: 5000,
    };

    try {
      await Deno.writeTextFile(file, "jar bytes");

      const code = transpileBash(
        `ls -lt ${file}; echo "---"; printf "mergePiiFromState\\nLEGAL_ID_VERIFICATION\\nignored\\n" | grep -E "mergePiiFromState|LEGAL_ID_VERIFICATION" | head -5`,
      );

      assertStringIncludes(code, '$.cmd("ls", "-lt"');
      assertEquals(code.includes('$.ls("-lt"'), false);

      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "inspections-all.jar");
      assertStringIncludes(result.stdout, "---");
      assertStringIncludes(result.stdout, "mergePiiFromState");
      assertStringIncludes(result.stdout, "LEGAL_ID_VERIFICATION");
      assertEquals(result.stderr.includes("Option not recognized"), false);
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
