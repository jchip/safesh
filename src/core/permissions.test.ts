/**
 * Tests for getEffectivePermissions (SSH-586: OS temp dir in defaults)
 */

import { assertEquals } from "@std/assert";
import { getEffectivePermissions } from "./permissions.ts";
import type { SafeShellConfig } from "./types.ts";

const baseConfig = { projectDir: "/test/project" } as SafeShellConfig;

function withTmpdir<T>(value: string | undefined, fn: () => T): T {
  const prev = Deno.env.get("TMPDIR");
  if (value === undefined) {
    Deno.env.delete("TMPDIR");
  } else {
    Deno.env.set("TMPDIR", value);
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      Deno.env.delete("TMPDIR");
    } else {
      Deno.env.set("TMPDIR", prev);
    }
  }
}

Deno.test("SSH-586: TMPDIR is included in default read/write paths", () => {
  withTmpdir("/var/folders/0p/abc123/T/", () => {
    const perms = getEffectivePermissions(baseConfig, "/test/project");
    assertEquals(perms.read!.includes("/var/folders/0p/abc123/T"), true);
    assertEquals(perms.write!.includes("/var/folders/0p/abc123/T"), true);
    // /tmp default is unaffected
    assertEquals(perms.write!.includes("/tmp"), true);
  });
});

Deno.test("SSH-586: real TMPDIR includes its canonical (symlink-resolved) form", () => {
  // The real TMPDIR exists, so the canonical path is added too (on macOS
  // /var/folders resolves to /private/var/folders, which the validator needs)
  const osTmp = Deno.env.get("TMPDIR")?.replace(/\/+$/, "");
  if (!osTmp || osTmp === "/tmp") return; // environment-dependent; skip if no distinct TMPDIR
  const perms = getEffectivePermissions(baseConfig, "/test/project");
  assertEquals(perms.write!.includes(osTmp), true);
  const realTmp = Deno.realPathSync(osTmp);
  assertEquals(perms.write!.includes(realTmp), true);
});

Deno.test("SSH-586: TMPDIR equal to /tmp is not duplicated", () => {
  withTmpdir("/tmp/", () => {
    const perms = getEffectivePermissions(baseConfig, "/test/project");
    assertEquals(perms.write!.filter((p) => p === "/tmp").length, 1);
  });
});

Deno.test("SSH-586: unset TMPDIR leaves defaults unchanged", () => {
  withTmpdir(undefined, () => {
    const perms = getEffectivePermissions(baseConfig, "/test/project");
    assertEquals(perms.write!.includes("/tmp"), true);
    assertEquals(perms.write!.some((p) => p.startsWith("/var/folders")), false);
  });
});
