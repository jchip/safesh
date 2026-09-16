import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { transpileSource } from "../../src/bash/transpiler2/mod.ts";
import { getDefaultConfig } from "../../src/core/utils.ts";
import { executeCode } from "../../src/runtime/executor.ts";

const cwd = Deno.cwd();
const config = {
  ...getDefaultConfig(cwd),
  allowProjectCommands: true,
  quiet: true,
} as Parameters<typeof executeCode>[1];

async function run(bash: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const ts = transpileSource(bash, { imports: false, strict: false });
  const result = await executeCode(ts, config, { cwd });
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}

describe("SSH-711: group pipelines preserve the downstream command's final byte", () => {
  it("does not append a newline to unterminated output", async () => {
    assertEquals(await run("{ echo -n x; } | cat; echo END"), {
      stdout: "xEND\n",
      stderr: "",
      code: 0,
    });
  });

  it("preserves the expanded echo flag form", async () => {
    assertEquals(await run("f=-n; { echo $f x; } | cat; echo END"), {
      stdout: "xEND\n",
      stderr: "",
      code: 0,
    });
  });

  it("keeps newline-terminated group pipelines terminated", async () => {
    assertEquals(await run("{ echo x; } | cat; echo END"), {
      stdout: "x\nEND\n",
      stderr: "",
      code: 0,
    });
  });
});
