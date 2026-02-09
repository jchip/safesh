/**
 * Tests for SSH-550 JQ fixes
 */

import { assertEquals } from "@std/assert";
import { jqExec } from "./jq.ts";
import { executeQuery, isIterationResult } from "./query-engine.ts";

// === SSH-550: slurp mode ===

Deno.test("SSH-550: slurp wraps single object in array", async () => {
  const result = await jqExec(".", '{"a":1}', { slurp: true });
  assertEquals(result.exitCode, 0);
  // slurp always wraps: {"a":1} -> [{"a":1}]
  assertEquals(JSON.parse(result.output), [{ a: 1 }]);
});

Deno.test("SSH-550: slurp wraps array in array", async () => {
  const result = await jqExec(".", "[1,2,3]", { slurp: true });
  assertEquals(result.exitCode, 0);
  // slurp wraps array: [1,2,3] -> [[1,2,3]]
  assertEquals(JSON.parse(result.output), [[1, 2, 3]]);
});

Deno.test("SSH-550: slurp JSONL multi-line", async () => {
  const result = await jqExec(".", '1\n2\n3', { slurp: true });
  assertEquals(result.exitCode, 0);
  // multi-line JSONL slurped into array: [1, 2, 3]
  assertEquals(JSON.parse(result.output), [1, 2, 3]);
});

Deno.test("SSH-550: slurp length on array input", async () => {
  const result = await jqExec("length", "[1,2,3]", { slurp: true });
  assertEquals(result.exitCode, 0);
  // slurp wraps [1,2,3] -> [[1,2,3]], length of outer = 1
  assertEquals(JSON.parse(result.output), 1);
});

Deno.test("SSH-550: slurp length on JSONL", async () => {
  const result = await jqExec("length", '1\n2\n3', { slurp: true });
  assertEquals(result.exitCode, 0);
  // JSONL slurped: [1,2,3], length = 3
  assertEquals(JSON.parse(result.output), 3);
});

// === SSH-550: .[] on objects ===

Deno.test("SSH-550: .[] yields object values", async () => {
  const result = await jqExec(".[]", '{"a":1,"b":2}');
  assertEquals(result.exitCode, 0);
  const lines = result.output.split("\n");
  const values = lines.map((l) => JSON.parse(l));
  assertEquals(values.sort(), [1, 2]);
});

// === SSH-550: map handles IterationResult ===

Deno.test("SSH-550: map with piped query returns correct results", async () => {
  const result = await jqExec("map(.name)", '[{"name":"Alice"},{"name":"Bob"}]');
  assertEquals(result.exitCode, 0);
  assertEquals(JSON.parse(result.output), ["Alice", "Bob"]);
});

// === SSH-550: unique sorts output ===

Deno.test("SSH-550: unique returns sorted output", async () => {
  const result = await jqExec("unique", "[3,1,2,1,3]");
  assertEquals(result.exitCode, 0);
  assertEquals(JSON.parse(result.output), [1, 2, 3]);
});

Deno.test("SSH-550: unique sorts strings", async () => {
  const result = await jqExec("unique", '["charlie","alice","bob","alice"]');
  assertEquals(result.exitCode, 0);
  assertEquals(JSON.parse(result.output), ["alice", "bob", "charlie"]);
});

// === SSH-550: comparison regex greedy left ===

Deno.test("SSH-550: comparison with dotted field access", async () => {
  const result = await jqExec(
    '.[] | select(.user.age >= 18) | .user.name',
    '[{"user":{"name":"Alice","age":25}},{"user":{"name":"Bob","age":15}}]',
  );
  assertEquals(result.exitCode, 0);
  assertEquals(result.output.trim(), '"Alice"');
});

// === SSH-550: TokenResult removal (type cleanup) ===

Deno.test("SSH-550: executeToken returns JsonValue type", () => {
  const result = executeQuery({ a: 1 }, ".a");
  assertEquals(result, 1);
});
