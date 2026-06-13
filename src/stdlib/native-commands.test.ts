/**
 * Tests for the native-command registry (SSH-629)
 */

import { assertEquals } from "@std/assert";
import { getNativeCommand, NATIVE_CMDS } from "./native-commands.ts";

Deno.test("getNativeCommand - tr is registered", () => {
  const tr = getNativeCommand("tr");
  assertEquals(tr?.name, "tr");
  assertEquals(NATIVE_CMDS.has("tr"), true);
});

Deno.test("getNativeCommand - unknown command is undefined", () => {
  assertEquals(getNativeCommand("definitely-not-a-cmd"), undefined);
});

Deno.test("tr.run - translate a-z to A-Z", async () => {
  const tr = getNativeCommand("tr")!;
  const result = await tr.run(["a-z", "A-Z"], "hello\n");
  assertEquals(result, { stdout: "HELLO\n", code: 0 });
});

Deno.test("tr.run - delete with -d", async () => {
  const tr = getNativeCommand("tr")!;
  const result = await tr.run(["-d", "aeiou"], "hello world\n");
  assertEquals(result.stdout, "hll wrld\n");
  assertEquals(result.code, 0);
});

Deno.test("tr.run - squeeze with -s", async () => {
  const tr = getNativeCommand("tr")!;
  const result = await tr.run(["-s", " "], "a    b   c\n");
  assertEquals(result.stdout, "a b c\n");
  assertEquals(result.code, 0);
});

Deno.test("tr.run - complement delete with -dc", async () => {
  const tr = getNativeCommand("tr")!;
  // Delete everything that is NOT a digit.
  const result = await tr.run(["-dc", "0-9"], "a1b2c3\n");
  assertEquals(result.stdout, "123");
  assertEquals(result.code, 0);
});

Deno.test("tr.supports - true for handled shapes", () => {
  const tr = getNativeCommand("tr")!;
  assertEquals(tr.supports(["a-z", "A-Z"]), true); // translate
  assertEquals(tr.supports(["-d", "abc"]), true); // delete
  assertEquals(tr.supports(["-s", " "]), true); // squeeze
  assertEquals(tr.supports(["-c", "a", "b"]), true); // complement translate
  assertEquals(tr.supports(["-ds", "abc", "xyz"]), true); // delete+squeeze
});

Deno.test("tr.supports - false for unhandled flags/shapes", () => {
  const tr = getNativeCommand("tr")!;
  assertEquals(tr.supports(["--delete", "abc"]), false); // long option
  assertEquals(tr.supports(["-t", "a-z", "A-Z"]), false); // unsupported flag
  assertEquals(tr.supports(["-d"]), false); // delete needs SET1
  assertEquals(tr.supports(["a-z"]), false); // translate needs SET2
  assertEquals(tr.supports(["a", "b", "c"]), false); // too many operands
  assertEquals(tr.supports(["-"]), false); // bare dash unsupported
});
