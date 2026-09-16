/**
 * SSH-707: descriptor duplication on a group was parsed but ignored.
 *
 * A redirected group captures its body before applying the group's redirects.
 * That capture used to collect only stdout and write each inner stderr result
 * to the real process stream, leaving nothing for `2>&1` or `2>file` to act on.
 */
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

describe("SSH-707: descriptor duplication on groups", () => {
  it("merges brace-group stderr into stdout in emission order", async () => {
    assertEquals(await run("{ echo err >&2; echo out; } 2>&1"), {
      stdout: "err\nout\n",
      stderr: "",
      code: 0,
    });
  });

  it("merges subshell stderr into stdout", async () => {
    assertEquals(await run("( echo out; echo err >&2 ) 2>&1"), {
      stdout: "out\nerr\n",
      stderr: "",
      code: 0,
    });
  });

  it("feeds merged stderr to the next pipeline stage", async () => {
    assertEquals(await run("{ echo out; echo err >&2; } 2>&1 | grep err"), {
      stdout: "err\n",
      stderr: "",
      code: 0,
    });
  });

  it("duplicates group stdout onto stderr", async () => {
    assertEquals(await run("{ echo out; } 1>&2"), {
      stdout: "",
      stderr: "out\n",
      code: 0,
    });
  });

  it("suppresses group stderr redirected to /dev/null", async () => {
    assertEquals(await run("{ echo err >&2; } 2>/dev/null"), {
      stdout: "",
      stderr: "",
      code: 0,
    });
  });
});
