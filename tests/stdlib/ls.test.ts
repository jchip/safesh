/**
 * Tests for ls command
 *
 * @module
 */

import { assertEquals, assertRejects } from "@std/assert";
import { ls, parseLsOptions } from "../../src/stdlib/shelljs/ls.ts";
import { join } from "@std/path";

Deno.test("parseLsOptions - single option -l", () => {
  const opts = parseLsOptions("-l");
  assertEquals(opts.long, true);
  assertEquals(opts.all, false);
  assertEquals(opts.humanReadable, false);
});

Deno.test("parseLsOptions - single option -h", () => {
  const opts = parseLsOptions("-h");
  assertEquals(opts.humanReadable, true);
  assertEquals(opts.long, false);
  assertEquals(opts.all, false);
});

Deno.test("parseLsOptions - combined options -lh", () => {
  const opts = parseLsOptions("-lh");
  assertEquals(opts.long, true);
  assertEquals(opts.humanReadable, true);
  assertEquals(opts.all, false);
});

Deno.test("parseLsOptions - combined options -hl", () => {
  const opts = parseLsOptions("-hl");
  assertEquals(opts.humanReadable, true);
  assertEquals(opts.long, true);
  assertEquals(opts.all, false);
});

Deno.test("parseLsOptions - combined options -alh", () => {
  const opts = parseLsOptions("-alh");
  assertEquals(opts.all, true);
  assertEquals(opts.long, true);
  assertEquals(opts.humanReadable, true);
});

Deno.test("ls - basic listing", async () => {
  const files = await ls(".");
  assertEquals(Array.isArray(files), true);
});

Deno.test("ls - with -l option", async () => {
  const files = await ls("-l", ".");
  assertEquals(Array.isArray(files), true);
  // Long format should have mode/size/date info
  if (files.length > 0 && files[0]) {
    assertEquals(files[0].includes(" "), true);
  }
});

Deno.test("ls - with -lh option (human readable)", async () => {
  const files = await ls("-lh", ".");
  assertEquals(Array.isArray(files), true);
  // Should not throw "Option not recognized: h"
});
