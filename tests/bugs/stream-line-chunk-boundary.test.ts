/**
 * A block-writing producer (a subprocess pipe) hands the stream chunks that end
 * mid-line. lines() must carry the partial line across the boundary, otherwise
 * every line straddling a chunk edge is silently split into two fragments:
 * downstream grep misses it, and the line count is inflated.
 */

import { assertEquals } from "@std/assert";
import { cmd } from "../../src/stdlib/command.ts";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

const LINE_COUNT = 40000;
const PADDING = "padding-padding-padding-padding";

async function writeBigFile(): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".txt" });
  const body = Array.from(
    { length: LINE_COUNT },
    (_, i) => `line ${i} MARKER ${PADDING}`,
  ).join("\n");
  await Deno.writeTextFile(path, body + "\n");
  return path;
}

Deno.test("lines() over a subprocess stream keeps every line whole", async () => {
  const path = await writeBigFile();
  try {
    const collected = await cmd("cat", [path]).stdout().lines().collect();

    assertEquals(collected.length, LINE_COUNT);
    assertEquals(collected[0], `line 0 MARKER ${PADDING}`);
    assertEquals(collected[LINE_COUNT - 1], `line ${LINE_COUNT - 1} MARKER ${PADDING}`);
    assertEquals(collected.filter((line) => !line.includes("MARKER")).length, 0);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("grep over a subprocess stream matches every line", async () => {
  const path = await writeBigFile();
  try {
    const matched = await cmd("cat", [path]).stdout().lines().grep(/MARKER/).count();
    assertEquals(matched, LINE_COUNT);
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("while read over an already-line stream still reads one line at a time", async () => {
  // The transpiler lowers `cmd | grep | while read` with the upstream already a
  // line stream; re-splitting it must not concatenate the lines together.
  const script =
    `printf "a one\nb two\nc three\n" | grep -v "b " | while read letter word; do echo "$letter|$word"; done`;
  const code = transpile(parse(script), { imports: false, strict: false });

  const config: SafeShellConfig = {
    permissions: { read: [Deno.cwd(), "/tmp"], write: ["/tmp"] },
    timeout: 5000,
  };
  const result = await executeCode(code, config, { cwd: Deno.cwd() });

  assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
  assertEquals(result.stdout.trim().split("\n"), ["a|one", "c|three"]);
});
