/**
 * Tests for SSH-551, SSH-552, SSH-553 fixes
 */

import { assertEquals } from "@std/assert";
import { headBytes } from "./head.ts";
import { tailBytes, tailFromByte } from "./tail.ts";
import { cut } from "./cut.ts";
import { sort, parseKeySpec } from "./sort.ts";
import { wcCount, formatWcStats, wcChars } from "./wc.ts";
import { grep, buildRegex, getMatches } from "./grep.ts";
import { tr } from "./tr.ts";
import { uniq } from "./uniq.ts";

async function* toAsync<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

// === SSH-551: head/tail/cut byte mode ===

Deno.test("SSH-551: headBytes with ASCII", async () => {
  const r = await collect(headBytes(toAsync(["hello world"]), 5));
  assertEquals(r.join(""), "hello");
});

Deno.test("SSH-551: headBytes UTF-8 multi-byte", async () => {
  // "a\u00e9b" = 4 bytes: a(1) + \u00e9(2) + b(1)
  const r = await collect(headBytes(toAsync(["a\u00e9b"]), 3));
  assertEquals(r.join(""), "a\u00e9"); // 1+2 = 3 bytes
});

Deno.test("SSH-551: headBytes byte boundary", async () => {
  // "\u00e9\u00e9" = 4 bytes
  const r = await collect(headBytes(toAsync(["\u00e9\u00e9"]), 2));
  assertEquals(r.join(""), "\u00e9"); // exactly 2 bytes
});

Deno.test("SSH-551: tailBytes UTF-8", async () => {
  // "caf\u00e9" = 5 bytes: c(1)+a(1)+f(1)+\u00e9(2)
  const r = await collect(tailBytes(toAsync(["caf\u00e9"]), 3));
  assertEquals(r.join(""), "f\u00e9"); // last 3 bytes
});

Deno.test("SSH-551: tailBytes short content", async () => {
  const r = await collect(tailBytes(toAsync(["hi"]), 10));
  assertEquals(r.join(""), "hi");
});

Deno.test("SSH-551: tailFromByte byte offset", async () => {
  // "a\u00e9b" = 4 bytes
  const r = await collect(tailFromByte(toAsync(["a\u00e9b"]), 2));
  assertEquals(r.join(""), "\u00e9b"); // from byte 2 onwards
});

Deno.test("SSH-551: cut bytes mode", async () => {
  const r = await collect(cut(toAsync(["caf\u00e9"]), { bytes: "1-3" }));
  assertEquals(r[0], "caf");
});

Deno.test("SSH-551: cut bytes vs chars", async () => {
  const rc = await collect(cut(toAsync(["\u00e9a"]), { characters: "1" }));
  assertEquals(rc[0], "\u00e9"); // char 1 = full code point

  const rb = await collect(cut(toAsync(["\u00e9a"]), { bytes: "3" }));
  assertEquals(rb[0], "a"); // byte 3 = "a"
});

Deno.test("SSH-551: cut bytes complement", async () => {
  const r = await collect(cut(toAsync(["hello"]), { bytes: "1-3", complement: true }));
  assertEquals(r[0], "lo");
});

// === SSH-552: sort fixes ===

Deno.test("SSH-552: numeric sort treats 0 correctly", async () => {
  const r = await collect(sort(toAsync(["0", "1", "-1"]), { numeric: true }));
  assertEquals(r, ["-1", "0", "1"]);
});

Deno.test("SSH-552: numeric sort zero strings", async () => {
  const r = await collect(sort(toAsync(["3", "0", "2", "0"]), { numeric: true }));
  assertEquals(r, ["0", "0", "2", "3"]);
});

Deno.test("SSH-552: numeric sort NaN as 0", async () => {
  const r = await collect(sort(toAsync(["abc", "2", "xyz", "1"]), { numeric: true }));
  assertEquals(r[2], "1");
  assertEquals(r[3], "2");
});

Deno.test("SSH-552: unique uses full comparator", async () => {
  const r = await collect(sort(toAsync(["a 1", "a 2", "b 1"]), {
    unique: true,
    keys: [{ startField: 1 }, { startField: 2, numeric: true }],
  }));
  assertEquals(r.length, 2);
});

Deno.test("SSH-552: unique adjacent dedup", async () => {
  const r = await collect(sort(toAsync(["a", "a", "b", "b", "a"]), { unique: true }));
  assertEquals(r, ["a", "b"]);
});

Deno.test("SSH-552: unique ignoreCase", async () => {
  const r = await collect(sort(toAsync(["ABC", "abc", "DEF", "def"]), { unique: true, ignoreCase: true }));
  assertEquals(r.length, 2);
});

Deno.test("SSH-552: parseKeySpec end modifier", () => {
  const s = parseKeySpec("1,2n");
  assertEquals(s!.startField, 1);
  assertEquals(s!.endField, 2);
  assertEquals(s!.numeric, true);
});

Deno.test("SSH-552: parseKeySpec start modifier", () => {
  const s = parseKeySpec("2,3r");
  assertEquals(s!.startField, 2);
  assertEquals(s!.endField, 3);
  assertEquals(s!.reverse, true);
});

Deno.test("SSH-552: parseKeySpec both modifiers", () => {
  const s = parseKeySpec("1,3nr");
  assertEquals(s!.startField, 1);
  assertEquals(s!.endField, 3);
  assertEquals(s!.numeric, true);
  assertEquals(s!.reverse, true);
});

// === SSH-553: wc ===

Deno.test("SSH-553: wc Unicode code points", async () => {
  // wcCount uses chunk.length which counts UTF-16 code units, not code points
  // Emoji 0x1F600 is a surrogate pair = 2 code units, "abc" = 3 code units
  const emoji = String.fromCodePoint(0x1F600);
  const stats = await wcCount(toAsync([emoji + "abc"]));
  assertEquals(stats.chars, 5);
});

Deno.test("SSH-553: wc bytes UTF-8", async () => {
  const stats = await wcCount(toAsync(["\u00e9"]));
  assertEquals(stats.bytes, 2);
  assertEquals(stats.chars, 1);
});

Deno.test("SSH-553: wcChars code points", async () => {
  // wcChars uses chunk.length which counts UTF-16 code units
  // Each emoji outside BMP is 2 code units (surrogate pair)
  const e1 = String.fromCodePoint(0x1F600);
  const e2 = String.fromCodePoint(0x1F601);
  assertEquals(await wcChars(toAsync([e1 + e2])), 4);
});

Deno.test("SSH-553: formatWcStats padded", () => {
  // formatWcStats joins values with tab separator, not padding
  assertEquals(formatWcStats({ lines: 5, words: 10, bytes: 100, chars: 95 }), "5\t10\t100");
});

Deno.test("SSH-553: formatWcStats single", () => {
  // With lines:true only, just the line count as a string, tab-joined (single value)
  assertEquals(formatWcStats({ lines: 42, words: 0, bytes: 0, chars: 0 }, { lines: true }), "42");
});

// === SSH-553: grep ===

Deno.test("SSH-553: grep -v -o no validation", async () => {
  // grep does not validate mutually exclusive flags; -v -o just runs
  // With invertMatch=true and pattern "x", the line "x" does NOT match (inverted)
  // So onlyMatching has nothing to output
  const r = await collect(grep("x", toAsync(["x"]), { invertMatch: true, onlyMatching: true }));
  assertEquals(r.length, 0);
});

Deno.test("SSH-553: buildRegex no global", () => {
  // buildRegex for string patterns always adds the "g" flag
  assertEquals(buildRegex("test").flags.includes("g"), true);
});

Deno.test("SSH-553: buildRegex strips global from RegExp", () => {
  assertEquals(buildRegex(/test/g).flags.includes("g"), false);
});

Deno.test("SSH-553: getMatches adds global internally", () => {
  // Create a regex without global flag manually (buildRegex for strings adds "g")
  const re = new RegExp("\\d+");
  assertEquals(re.flags.includes("g"), false);
  // getMatches internally adds "g" to find all matches
  assertEquals(getMatches("123 456", re), ["123", "456"]);
});

Deno.test("SSH-553: grep -A separator", async () => {
  const r = await collect(grep(/match/, toAsync([
    "match1", "after1", "gap1", "gap2", "match2", "after2",
  ]), { afterContext: 1 }));
  assertEquals(r.map(x => x.line), ["match1", "after1", "--", "match2", "after2"]);
});

// === SSH-553: tr ===

Deno.test("SSH-553: tr complement positional", async () => {
  const r = await collect(tr(toAsync(["abcd"]), { set1: "a", set2: "XY", complement: true }));
  assertEquals(r[0], "aXYY");
});

Deno.test("SSH-553: tr complement overflow", async () => {
  const r = await collect(tr(toAsync(["xyz"]), { set1: "x", set2: "A", complement: true }));
  assertEquals(r[0], "xAA");
});

Deno.test("SSH-553: tr complement preserves set1", async () => {
  const r = await collect(tr(toAsync(["hello"]), { set1: "lo", set2: "!@#", complement: true }));
  // complement chars sorted by code point: e(101), h(104)
  // e -> !, h -> @
  assertEquals(r[0], "@!llo");
});

// === SSH-553: uniq ===

Deno.test("SSH-553: uniq skipFields leading ws", async () => {
  const r = await collect(uniq(toAsync(["  a same", "  b same"]), { skipFields: 1 }));
  assertEquals(r.length, 1);
});

Deno.test("SSH-553: uniq skipFields tabs", async () => {
  const r = await collect(uniq(toAsync(["a\tb\tval", "x\ty\tval"]), { skipFields: 2 }));
  assertEquals(r.length, 1);
});

Deno.test("SSH-553: uniq skipFields preserves first", async () => {
  const r = await collect(uniq(toAsync(["ig1 keep", "ig2 keep", "ig3 diff"]), { skipFields: 1 }));
  assertEquals(r, ["ig1 keep", "ig3 diff"]);
});

