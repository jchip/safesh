import { assertEquals } from "@std/assert";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

const originalCwd = Deno.cwd();
const config: SafeShellConfig = {
  permissions: {
    read: [originalCwd, REAL_TMP],
    write: [REAL_TMP],
  },
  timeout: 5000,
};

async function run(script: string) {
  const code = transpile(parse(script), { imports: false, strict: false });
  return await executeCode(code, config, { cwd: originalCwd });
}

Deno.test("SSH-671: subshell boundaries restore the parent cwd", async (t) => {
  const parent = await Deno.makeTempDir({ dir: REAL_TMP });
  const child = `${parent}/child`;
  await Deno.mkdir(child);

  try {
    const cases: Array<[string, string, string]> = [
      ["statement subshell", `cd "${parent}"; (cd "${child}"; pwd); pwd`, `${child}\n${parent}\n`],
      [
        "subshell condition",
        `cd "${parent}"; if (cd "${child}"; true); then pwd; fi`,
        `${parent}\n`,
      ],
      [
        "command substitution",
        `cd "${parent}"; value=$(cd "${child}" && pwd); pwd; echo "$value"`,
        `${parent}\n${child}\n`,
      ],
      [
        "for-loop body",
        `cd "${parent}"; for dir in "${child}" "${child}"; do (cd "$dir"); pwd; done`,
        `${parent}\n${parent}\n`,
      ],
    ];

    for (const [name, script, expected] of cases) {
      await t.step(name, async () => {
        const result = await run(script);
        assertEquals(result.success, true, `stderr: ${result.stderr}\n${script}`);
        assertEquals(result.stdout, expected, script);
      });
    }
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test("SSH-671: missing saved cwd does not mask subshell completion", async () => {
  const removed = await Deno.makeTempDir({ dir: REAL_TMP });
  const survivor = await Deno.makeTempDir({ dir: REAL_TMP });

  try {
    const result = await run(
      `cd "${removed}"; (cd "${survivor}"; rmdir "${removed}"; true); echo survived`,
    );
    assertEquals(result.success, true, result.stderr);
    assertEquals(result.stdout, "survived\n");
  } finally {
    await Deno.remove(removed, { recursive: true }).catch(() => {});
    await Deno.remove(survivor, { recursive: true }).catch(() => {});
  }
});
