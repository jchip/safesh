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

async function withFixture(
  fn: (testDir: string, config: SafeShellConfig) => Promise<void>,
): Promise<void> {
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
    await Deno.writeTextFile(
      `${testDir}/start-local-infra.js`,
      [
        "#!/usr/bin/env node",
        "const unrelated = true;",
        "const service = 'trust-mock';",
        "const other = 'value';",
        "const backend = 'remote';",
        "const host = 'ts.idme.test';",
      ].join("\n") + "\n",
    );

    await fn(testDir, config);
  } finally {
    await Deno.remove(testDir, { recursive: true });
  }
}

describe("Bug: grep file output", () => {
  it("should filter by line and honor -n in combined -nE flags", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(
        `cd ${testDir} && grep -nE "trust-mock|trustMock|Trust-Mock|ts\\.idme|IPL_BACKEND|backend|BACKEND" start-local-infra.js`,
      );

      assertStringIncludes(code, ".lines().map");

      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "3:const service = 'trust-mock';");
      assertStringIncludes(result.stdout, "5:const backend = 'remote';");
      assertStringIncludes(result.stdout, "6:const host = 'ts.idme.test';");
      assertEquals(result.stdout.includes("#!/usr/bin/env node"), false);
      assertEquals(result.stdout.includes("const unrelated = true;"), false);
    });
  });

  it("should apply newline-separated cd before grep with a relative file path", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(
        `cd ${testDir}
grep -nE "trust-mock|backend" start-local-infra.js`,
      );

      assertStringIncludes(code, `$.cd("${testDir}")`);
      assertStringIncludes(code, ".lines().map");

      const result = await executeCode(code, config, { cwd: Deno.cwd() });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "3:const service = 'trust-mock';");
      assertStringIncludes(result.stdout, "5:const backend = 'remote';");
      assertEquals(result.stdout.includes("#!/usr/bin/env node"), false);
      assertEquals(result.stdout.includes("const unrelated = true;"), false);
    });
  });

  it("should print matching lines for standalone grep with a file argument", async () => {
    await withFixture(async (testDir, config) => {
      const code = transpileBash(
        `grep -E "trust-mock|backend" start-local-infra.js`,
      );

      assertStringIncludes(code, "for await");
      assertStringIncludes(code, ".lines().grep");

      const result = await executeCode(code, config, { cwd: testDir });

      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "const service = 'trust-mock';");
      assertStringIncludes(result.stdout, "const backend = 'remote';");
      assertEquals(result.stdout.includes("#!/usr/bin/env node"), false);
      assertEquals(result.stdout.includes("const unrelated = true;"), false);
    });
  });
});
