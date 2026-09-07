import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";

// SSH-683: only stdout flows through a bash pipe — a stage's stderr goes to the
// terminal. `Command.resolveStdin()` ran the upstream with `exec()` and kept
// only `result.stdout`, so `ls /nonexistent | cat` printed nothing at all.
// SSH-682 special-cased the "command not found" line; every other upstream
// stderr was still dropped.

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), "/tmp"],
    write: ["/tmp", "/dev/null"],
    run: ["ls", "cat", "wc"],
  },
  timeout: 5000,
};

function run(bash: string) {
  return executeCode(transpileBash(bash), config, { cwd: Deno.cwd() });
}

const MISSING_DIR = "/nonexistent-safesh-ssh683";
const MISSING_CMD = "safesh-ssh683-no-such-binary";

describe("Bug: pipelines swallow the upstream stage's stderr", () => {
  it("reports the upstream's stderr and still exits with the last stage's status", async () => {
    const result = await run(`ls ${MISSING_DIR} | cat`);

    assertStringIncludes(result.stderr, "No such file or directory");
    assertEquals(result.stdout, "");
    // bash: the pipeline's status is cat's, and cat succeeds on empty stdin
    assertEquals(result.code, 0);
  });

  it("honors the upstream's own 2>file redirect", async () => {
    const result = await run(`ls ${MISSING_DIR} 2>/dev/null | cat`);

    assertEquals(result.stderr.includes("No such file or directory"), false, result.stderr);
    assertEquals(result.stdout, "");
    assertEquals(result.code, 0);
  });

  it("leaves 2>&1 piping the message downstream instead of to stderr", async () => {
    const result = await run(`ls ${MISSING_DIR} 2>&1 | cat`);

    assertStringIncludes(result.stdout, "No such file or directory");
    assertEquals(result.stderr.includes("No such file or directory"), false, result.stderr);
    assertEquals(result.code, 0);
  });

  it("reports each failing stage of a longer pipeline", async () => {
    const result = await run(`ls ${MISSING_DIR} | ls ${MISSING_DIR} | cat`);

    const occurrences = result.stderr.split("No such file or directory").length - 1;
    assertEquals(occurrences, 2, result.stderr);
  });

  it("reports the upstream's command-not-found line exactly once", async () => {
    const result = await run(`${MISSING_CMD} | cat`);

    const occurrences = result.stderr.split("command not found").length - 1;
    assertEquals(occurrences, 1, result.stderr);
    assertStringIncludes(result.stderr, `safesh: ${MISSING_CMD}: command not found`);
    assertEquals(result.code, 0);
  });
});
