/**
 * Tests for sort command — SSH-571 regression coverage
 *
 * SSH-571: `printf '10\n2\n33\n' | sort -rn` produced ASCENDING order.
 *
 * Where the bug lives: the sort emulation itself composes -r and -n
 * correctly (verified here). The end-to-end failure happens before sort
 * runs: the bash lowering's flag collector only exact-matches "-n"/"-r"/"-u",
 * so the combined forms "-rn"/"-nr" are silently dropped and the pipeline is
 * lowered to `$.sort()` with no options (see
 * src/bash/transpiler2/utils/command-args.ts collectFlagOptionsAndFiles).
 *
 * These tests pin the coreutils-parity contract at the sort-command layer so
 * the transpiler fix (combined short-flag expansion) has a verified target:
 * `$.sort({ numeric: true, reverse: true })` MUST equal real `sort -rn`.
 *
 * Real coreutils reference (captured 2026-06-12):
 *   printf '10\n2\n33\n' | sort -rn  -> 33 10 2
 *   printf '10\n2\n33\n' | sort -nr  -> 33 10 2   (flag order irrelevant)
 *   printf '10\n2\n33\n' | sort -n   -> 2 10 33
 *   printf '10\n2\n33\n' | sort -r   -> 33 2 10
 */

import { assertEquals } from "@std/assert";
import { sort, sortTransform, type SortOptions } from "./sort.ts";

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

const INPUT = ["10", "2", "33"];

Deno.test("SSH-571: sort -rn (numeric+reverse) yields descending numeric order", async () => {
  const r = await collect(sort(toAsync(INPUT), { numeric: true, reverse: true }));
  assertEquals(r, ["33", "10", "2"]);
});

Deno.test("SSH-571: sort -nr flag-order variant is identical to -rn", async () => {
  // -nr and -rn must parse to the same options; both orders map to
  // { numeric: true, reverse: true } and must produce the same output.
  const rn: SortOptions = { numeric: true, reverse: true };
  const nr: SortOptions = { reverse: true, numeric: true };
  const a = await collect(sort(toAsync(INPUT), rn));
  const b = await collect(sort(toAsync(INPUT), nr));
  assertEquals(a, b);
  assertEquals(a, ["33", "10", "2"]);
});

Deno.test("SSH-571: plain sort -n yields ascending numeric order", async () => {
  const r = await collect(sort(toAsync(INPUT), { numeric: true }));
  assertEquals(r, ["2", "10", "33"]);
});

Deno.test("SSH-571: plain sort -r yields reverse lexicographic order", async () => {
  // Real `sort -r` on 10/2/33 is lexicographic descending: 33, 2, 10
  const r = await collect(sort(toAsync(INPUT), { reverse: true }));
  assertEquals(r, ["33", "2", "10"]);
});

Deno.test("SSH-571: default sort (no flags) yields lexicographic order", async () => {
  // The buggy lowering ran this for `sort -rn`: 10, 2, 33
  const r = await collect(sort(toAsync(INPUT)));
  assertEquals(r, ["10", "2", "33"]);
});

Deno.test("SSH-571: sortTransform composes numeric+reverse in pipelines", async () => {
  // $.sort(...) in transpiled pipelines is sortTransform
  const transform = sortTransform({ numeric: true, reverse: true });
  const r = await collect(transform(toAsync(INPUT)));
  assertEquals(r, ["33", "10", "2"]);
});

Deno.test("SSH-571: numeric+reverse with duplicates and negatives", async () => {
  const r = await collect(
    sort(toAsync(["5", "-3", "10", "5", "0"]), { numeric: true, reverse: true }),
  );
  assertEquals(r, ["10", "5", "5", "0", "-3"]);
});
