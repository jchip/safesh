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

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp"],
    run: [],
  },
  timeout: 5000,
};

describe("Bug: colon builtin", () => {
  it("runs as a successful no-op in if branches", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });

    try {
      const code = transpileBash(`
cd ${testDir}
for r in present; do
  if [ -d "." ]; then :; fi
done
echo done
`);

      assertEquals(code.includes('$.cmd(":")'), false, code);

      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "done\n");
      assertEquals(result.stderr, "");
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
