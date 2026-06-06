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
    run: ["printf", "sh"],
  },
  timeout: 5000,
};

describe("Bug: command substitution output", () => {
  it("awaits async logical command substitutions before rendering text", async () => {
    const code = transpileBash(
      `echo "pom=$(test -f /tmp/safesh-missing-pom.xml && echo yes || echo no)"`,
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim(), "pom=no");
    assertEquals(result.stdout.includes("[object Promise]"), false);
  });

  it("preserves line counts through wc in command substitution pipelines", async () => {
    const code = transpileBash(
      `echo "tracked-files=$(printf "a\\nb\\n" | wc -l)"`,
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout.trim(), "tracked-files=2");
  });

  it("captures stdout from nested sh -c pipelines", async () => {
    const code = transpileBash(
      `jar=$(sh -c 'printf "validations-3.0.19-model.jar\\nignored.jar\\n" | grep -i "validations.*model"'); echo "jar=$jar"`,
    );

    const result = await executeCode(code, config, { cwd: Deno.cwd() });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stdout, "jar=validations-3.0.19-model.jar\n");
  });
});
