/**
 * Tests for Command Transform Functions
 *
 * Tests for toCmdLines/toCmd pipeline exit code handling.
 * SSH-4: Pipeline stages should not throw on non-zero exit.
 */

import { assertEquals } from "@std/assert";
import { toCmdLines, toCmd } from "./command-transforms.ts";
import { cmd } from "./command.ts";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) result.push(item);
  return result;
}

async function* fromArray(items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

// SSH-4: toCmdLines should pass through output even when command exits non-zero

Deno.test("toCmdLines - does not throw when command exits non-zero with no output", async () => {
  // grep exits 1 when no lines match - bash pipeline just gets empty output
  const grepCmd = cmd("grep", ["this_pattern_will_not_match_xyz123"]);
  const input = fromArray(["hello world", "foo bar", "baz qux"]);

  // Must NOT throw - bash pipelines continue on non-zero exit
  const result = await collect(toCmdLines(grepCmd)(input));
  assertEquals(result, []);
});

Deno.test("toCmdLines - yields stdout lines even when command exits non-zero", async () => {
  // sh -c outputs one line then exits 1 - downstream should still receive the line
  const shCmd = cmd("sh", ["-c", "echo matched_line; exit 1"]);
  const input = fromArray(["irrelevant stdin"]);

  const result = await collect(toCmdLines(shCmd)(input));
  assertEquals(result, ["matched_line"]);
});

Deno.test("toCmd - does not throw when command exits non-zero", async () => {
  // grep exits 1 on no match - toCmd should yield empty stdout, not throw
  const grepCmd = cmd("grep", ["this_pattern_will_not_match_xyz123"]);
  const input = fromArray(["hello world", "foo bar"]);

  const result = await collect(toCmd(grepCmd)(input));
  assertEquals(result, [""]); // toCmd yields stdout (empty string for no output)
});

Deno.test("toCmdLines - intermediate non-zero exit flows output to next stage", async () => {
  // Simulates: echo lines | grep partial | wc -l
  // grep finds 2 of 3 lines (exits 0), but even if it exited 1 the pipeline must continue
  // Here we test the pattern: output from non-zero command flows to collect
  const shCmd = cmd("sh", ["-c", "printf 'line1\nline2\nline3'; exit 1"]);
  const input = fromArray([]);

  const result = await collect(toCmdLines(shCmd)(input));
  assertEquals(result, ["line1", "line2", "line3"]);
});
