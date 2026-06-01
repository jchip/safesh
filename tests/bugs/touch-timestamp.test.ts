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

describe("Bug: touch timestamp option", () => {
  it("supports touch -t before continuing the script", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const artifact = `${testDir}/artifact.jar`;
    const source = `${testDir}/source.java`;
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
      },
      timeout: 5000,
    };

    try {
      const code = transpileBash(
        `touch -t 202001010000 ${artifact}
touch ${source}
echo done`,
      );

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "done");
      assertEquals(result.stderr, "");

      const artifactStat = await Deno.stat(artifact);
      const sourceStat = await Deno.stat(source);
      assertEquals(artifactStat.mtime!.getTime() < sourceStat.mtime!.getTime(), true);
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
