/**
 * Unit tests for bash-prehook command detection.
 *
 * The prehook module is import-safe: its entrypoint is guarded by
 * import.meta.main, so importing it here only loads the functions.
 */

import { assertEquals } from "@std/assert";
import { shouldPassthrough, stripLeadingAssignments } from "./bash-prehook.ts";

Deno.test("SSH-570: env-prefixed desh is recognized as passthrough", () => {
  assertEquals(
    shouldPassthrough("TMPDIR=/tmp desh retry-path --id=abc --choice=w2d"),
    true,
  );
  assertEquals(shouldPassthrough("FOO=bar BAZ=qux desh retry --id=x"), true);
  assertEquals(shouldPassthrough("DENO_DIR=/tmp/d deno test --allow-all"), true);
});

Deno.test("SSH-570: plain passthrough commands still match", () => {
  assertEquals(shouldPassthrough("desh retry --id=x"), true);
  assertEquals(shouldPassthrough("deno test"), true);
  assertEquals(shouldPassthrough("./src/cli/desh.ts retry"), true);
});

Deno.test("SSH-570: non-passthrough commands are unaffected", () => {
  assertEquals(shouldPassthrough("ls -la"), false);
  assertEquals(shouldPassthrough("TMPDIR=/tmp ls"), false);
  // a pure assignment has no command word to match
  assertEquals(shouldPassthrough("FOO=desh"), false);
  // desh as an argument, not the command word
  assertEquals(shouldPassthrough("echo desh retry"), false);
});

Deno.test("SSH-570: stripLeadingAssignments handles quoted values", () => {
  assertEquals(
    stripLeadingAssignments(`FOO='a b' BAR="c d" desh run`),
    "desh run",
  );
  assertEquals(stripLeadingAssignments(`FOO= desh run`), "desh run");
  assertEquals(stripLeadingAssignments(`PATH+=:/x desh run`), "desh run");
  // not assignments: leave untouched
  assertEquals(stripLeadingAssignments("echo FOO=bar"), "echo FOO=bar");
  assertEquals(stripLeadingAssignments("desh run"), "desh run");
});
