import { assertEquals, assertStringIncludes } from "@std/assert";
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

describe("Bug: External grep escaping", () => {
  it("should preserve BRE alternation when recursive grep falls back to external grep", async () => {
    const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
    const config: SafeShellConfig = {
      permissions: {
        read: [Deno.cwd(), testDir, "/tmp"],
        write: [testDir, "/tmp"],
        run: ["grep"],
      },
      timeout: 5000,
    };

    try {
      await Deno.mkdir(`${testDir}/demo/trust-mock/src`, { recursive: true });
      await Deno.mkdir(`${testDir}/scripts/dev`, { recursive: true });
      await Deno.writeTextFile(
        `${testDir}/demo/trust-mock/package.json`,
        '{"name":"trust-mock"}\n',
      );
      await Deno.writeTextFile(
        `${testDir}/demo/trust-mock/src/index.ts`,
        "const service = 'trustMock';\n",
      );
      await Deno.writeTextFile(
        `${testDir}/scripts/dev/start-local-infra.js`,
        "const svc = 'trust_mock';\n",
      );
      await Deno.writeTextFile(`${testDir}/unrelated.txt`, "nothing here\n");

      const code = transpileBash(`grep -rln "trust-mock\\|trustMock\\|trust_mock" .`);

      assertStringIncludes(code, '$.cmd("grep", "-rln"');
      assertEquals(
        code.includes("trust-mock\\\\\\\\|trustMock\\\\\\\\|trust_mock"),
        false,
        code,
      );

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "./demo/trust-mock/package.json");
      assertStringIncludes(result.stdout, "./demo/trust-mock/src/index.ts");
      assertStringIncludes(result.stdout, "./scripts/dev/start-local-infra.js");
      assertEquals(result.stdout.includes("./unrelated.txt"), false);
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
