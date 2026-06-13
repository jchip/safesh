/**
 * Tests for wc command — SSH-572 regression coverage
 *
 * SSH-572: `wc -l` with multiple glob operands returned `0 total` — the
 * multi-operand form was lowered to a single-file pipe (`$.cat(files[0])`),
 * dropping every operand after the first, never expanding globs, and never
 * producing per-file lines or the `total` line.
 *
 * These tests pin the coreutils-parity contract at the wc-command layer:
 * `wcMultiple()` must reproduce real wc's per-file + total output exactly.
 *
 * Real coreutils reference (macOS, captured 2026-06-12), for a.txt
 * "one\ntwo\nthree\n" and b.txt "x\ny\n":
 *   $ wc -l a.txt b.txt
 *          3 a.txt
 *          2 b.txt
 *          5 total
 *   $ wc a.txt b.txt
 *          3       3      14 a.txt
 *          2       2       4 b.txt
 *          5       5      18 total
 *   $ wc -l a.txt            (single operand: no total line)
 *          3 a.txt
 */

import { assertEquals } from "@std/assert";
import { expandGlob } from "@std/fs";
import { basename, join } from "@std/path";
import { formatWcLine, wcCount, wcMultiple, type WcStats } from "./wc.ts";

async function* toAsync(items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

const A_CONTENT = "one\ntwo\nthree\n"; // 3 lines, 3 words, 14 bytes
const B_CONTENT = "x\ny\n"; // 2 lines, 2 words, 4 bytes

Deno.test("SSH-572: wc -l with two operands emits per-file counts and total", async () => {
  const sources: Array<[string, AsyncIterable<string>]> = [
    ["a.txt", toAsync([A_CONTENT])],
    ["b.txt", toAsync([B_CONTENT])],
  ];

  const output = await collect(wcMultiple(sources, { lines: true }));

  // Exact real `wc -l a.txt b.txt` output, line by line
  assertEquals(output, [
    "       3 a.txt",
    "       2 b.txt",
    "       5 total",
  ]);
});

Deno.test("SSH-572: wc with no flags emits 3-column per-file lines and total", async () => {
  const sources: Array<[string, AsyncIterable<string>]> = [
    ["a.txt", toAsync([A_CONTENT])],
    ["b.txt", toAsync([B_CONTENT])],
  ];

  const output = await collect(wcMultiple(sources));

  // Exact real `wc a.txt b.txt` output
  assertEquals(output, [
    "       3       3      14 a.txt",
    "       2       2       4 b.txt",
    "       5       5      18 total",
  ]);
});

Deno.test("SSH-572: single operand has no total line", async () => {
  const sources: Array<[string, AsyncIterable<string>]> = [
    ["a.txt", toAsync([A_CONTENT])],
  ];

  const output = await collect(wcMultiple(sources, { lines: true }));

  assertEquals(output, ["       3 a.txt"]);
});

Deno.test("SSH-572: two real files via glob expansion match real wc -l", async () => {
  // The ticket scenario: two real files plus a glob matching both.
  const dir = await Deno.makeTempDir({ prefix: "ssh572-wc-" });
  try {
    await Deno.writeTextFile(join(dir, "a.txt"), A_CONTENT);
    await Deno.writeTextFile(join(dir, "b.txt"), B_CONTENT);

    // Expand the glob the way a shell would (sorted operand order)
    const paths: string[] = [];
    for await (const entry of expandGlob(join(dir, "*.txt"))) {
      if (entry.isFile) paths.push(entry.path);
    }
    paths.sort();
    assertEquals(paths.length, 2, "glob must match both files");

    const sources: Array<[string, AsyncIterable<string>]> = paths.map(
      (path) => [basename(path), toAsync([Deno.readTextFileSync(path)])],
    );

    const output = await collect(wcMultiple(sources, { lines: true }));

    // Exact real `wc -l *.txt` output for these files
    assertEquals(output, [
      "       3 a.txt",
      "       2 b.txt",
      "       5 total",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SSH-572: total accumulates every field across operands", async () => {
  const sources: Array<[string, AsyncIterable<string>]> = [
    ["a.txt", toAsync([A_CONTENT])],
    ["b.txt", toAsync([B_CONTENT])],
    ["c.txt", toAsync(["hé\n"])], // 1 line, 1 word, 4 bytes, 3 chars
  ];

  const output = await collect(wcMultiple(sources, { words: true }));

  assertEquals(output, [
    "       3 a.txt",
    "       2 b.txt",
    "       1 c.txt",
    "       6 total",
  ]);
});

Deno.test("SSH-572: formatWcLine matches real wc field layout", async () => {
  const stats: WcStats = await wcCount(toAsync([A_CONTENT]));

  assertEquals(formatWcLine(stats, { lines: true }, "a.txt"), "       3 a.txt");
  assertEquals(formatWcLine(stats, {}, "a.txt"), "       3       3      14 a.txt");
  // No name (stdin form): counts only
  assertEquals(formatWcLine(stats, { lines: true }), "       3");
  // Wide counts shift the field naturally, like printf "%8d"
  assertEquals(
    formatWcLine({ lines: 123456789, words: 0, bytes: 0, chars: 0 }, { lines: true }, "big"),
    "123456789 big",
  );
});
