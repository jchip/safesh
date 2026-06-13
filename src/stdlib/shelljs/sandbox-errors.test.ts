/**
 * SSH-607: sandbox rejections (SafeShellError) must propagate out of the
 * shelljs builtins instead of being flattened into a generic stderr string —
 * the inline error handler needs the error to drive the PATH BLOCKED prompt
 * and `desh retry-path` flow, exactly like fs.* and redirects.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { SafeShellError } from "../../core/errors.ts";
import { mkdir } from "./mkdir.ts";
import { rm } from "./rm.ts";
import { cp } from "./cp.ts";
import { mv } from "./mv.ts";
import { REAL_TMP } from "../../../tests/helpers.ts";

const CONFIG_SYMBOL = Symbol.for("safesh.config");

/** Inject a sandbox config the way the preamble does, run fn, restore. */
async function withInjectedConfig<T>(
  config: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const g = globalThis as { $?: Record<symbol, unknown> };
  const prev = g.$;
  g.$ = { [CONFIG_SYMBOL]: config };
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete g.$;
    else g.$ = prev;
  }
}

function deniedConfig(denied: string) {
  return {
    projectDir: REAL_TMP,
    permissions: { denyWrite: [denied] },
  };
}

Deno.test("SSH-607: mkdir rethrows SafeShellError for deny-listed paths", async () => {
  const denied = `${REAL_TMP}/safesh-607-denied`;
  await withInjectedConfig(deniedConfig(denied), async () => {
    await assertRejects(
      () => Promise.resolve(mkdir(`${denied}/sub`)).then((r) => r),
      SafeShellError,
      "deny-write",
    );
  });
});

Deno.test("SSH-607: rm rethrows SafeShellError for deny-listed paths", async () => {
  const denied = `${REAL_TMP}/safesh-607-denied`;
  await withInjectedConfig(deniedConfig(denied), async () => {
    await assertRejects(
      () => Promise.resolve(rm(`${denied}/file`)).then((r) => r),
      SafeShellError,
      "deny-write",
    );
  });
});

Deno.test("SSH-607: cp rethrows SafeShellError for deny-listed targets", async () => {
  const denied = `${REAL_TMP}/safesh-607-denied`;
  const srcDir = `${REAL_TMP}/safesh-607-src`;
  await Deno.mkdir(srcDir, { recursive: true });
  await Deno.writeTextFile(`${srcDir}/a.txt`, "x");
  try {
    await withInjectedConfig(deniedConfig(denied), async () => {
      await assertRejects(
        () => Promise.resolve(cp(`${srcDir}/a.txt`, `${denied}/a.txt`)).then((r) => r),
        SafeShellError,
        "deny-write",
      );
    });
  } finally {
    await Deno.remove(srcDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("SSH-607: mv rethrows SafeShellError for deny-listed targets", async () => {
  const denied = `${REAL_TMP}/safesh-607-denied`;
  const srcDir = `${REAL_TMP}/safesh-607-mvsrc`;
  await Deno.mkdir(srcDir, { recursive: true });
  await Deno.writeTextFile(`${srcDir}/a.txt`, "x");
  try {
    await withInjectedConfig(deniedConfig(denied), async () => {
      await assertRejects(
        () => Promise.resolve(mv(`${srcDir}/a.txt`, `${denied}/a.txt`)).then((r) => r),
        SafeShellError,
        "deny-write",
      );
    });
  } finally {
    await Deno.remove(srcDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("SSH-607: ordinary filesystem errors still map to stderr strings", async () => {
  // No deny config: a missing file is a normal rm error, not a throw
  const result = await rm(`${REAL_TMP}/safesh-607-nonexistent-file`);
  assertEquals(result.code, 1);
  assertEquals(result.stderr.includes("No such file or directory"), true);
});
