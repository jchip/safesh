/**
 * SSH-647: `command` is a POSIX builtin, not an executable. Before this it fell
 * through to $.cmd("command", ...) and always died with
 * `Command not found: "command"`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { command } from "./command.ts";
import { SHELL_BUILTINS } from "../../bash/transpiler2/builtins.ts";

/** A name that cannot exist on PATH, so the miss path is deterministic. */
const MISSING = `safesh-647-no-such-cmd-${crypto.randomUUID().slice(0, 8)}`;

Deno.test("SSH-647: command -v resolves an executable to its path", async () => {
  const result = await command("-v", "deno");

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "deno");
  // A path, not the bare name echoed back.
  assertStringIncludes(result.stdout, "/");
  assertEquals(result.stdout.endsWith("\n"), true);
});

Deno.test("SSH-647: command -v on a miss is silent and non-zero", async () => {
  const result = await command("-v", MISSING);

  assertEquals(result.code, 1);
  assertEquals(result.stdout, "");
});

Deno.test("SSH-647: command -v reports a shell builtin by name", async () => {
  // cd is lowered by the transpiler, so it has no path to report.
  assertEquals(Object.hasOwn(SHELL_BUILTINS, "cd"), true);

  const result = await command("-v", "cd");

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "cd\n");
});

Deno.test("SSH-647: command -v fails if any name is unresolved", async () => {
  const result = await command("-v", "deno", MISSING);

  assertEquals(result.code, 1);
  // The name that did resolve is still reported.
  assertStringIncludes(result.stdout, "deno");
});

Deno.test("SSH-647: command -V uses the verbose phrasing", async () => {
  const found = await command("-V", "deno");
  assertEquals(found.code, 0);
  assertStringIncludes(found.stdout, "deno is /");

  const builtin = await command("-V", "cd");
  assertEquals(builtin.code, 0);
  assertEquals(builtin.stdout, "cd is a shell builtin\n");

  const missing = await command("-V", MISSING);
  assertEquals(missing.code, 1);
  assertStringIncludes(missing.stdout, `${MISSING}: not found`);
});

Deno.test("SSH-647: -p is accepted and does not change lookup", async () => {
  const withFlag = await command("-p", "-v", "deno");
  const withoutFlag = await command("-v", "deno");

  assertEquals(withFlag.code, 0);
  assertEquals(withFlag.stdout, withoutFlag.stdout);
});

Deno.test("SSH-647: command NAME args runs the command", async () => {
  const result = await command("echo", "safesh-647");

  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "safesh-647");
});

Deno.test("SSH-647: command with no operand is a no-op, -v with none fails", async () => {
  const bare = await command();
  assertEquals(bare.code, 0);
  assertEquals(bare.stdout, "");

  const lookup = await command("-v");
  assertEquals(lookup.code, 1);
  assertEquals(lookup.stdout, "");
});

Deno.test("SSH-647: -- ends option parsing", async () => {
  // After --, -v is an operand (a name to run), not a flag. No such command
  // exists, so this must not be silently treated as a lookup.
  const result = await command("-v", "--", "deno");

  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "/");
});
