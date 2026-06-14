/**
 * Tests for getEffectivePermissions (SSH-586: OS temp dir in defaults,
 * SSH-591: temp dirs snapshotted at startup)
 */

import { assertEquals } from "@std/assert";
import {
  computePathDirDefaults,
  computeTempDirDefaults,
  getEffectivePermissions,
} from "./permissions.ts";
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

Deno.test("SSH-586: TMPDIR is included in temp-dir defaults", () => {
  const dirs = computeTempDirDefaults("/var/folders/0p/abc123/T/");
  assertEquals(dirs.includes("/var/folders/0p/abc123/T"), true);
  // /tmp default is unaffected
  assertEquals(dirs.includes("/tmp"), true);
});

Deno.test("SSH-586: real TMPDIR includes its canonical (symlink-resolved) form", () => {
  // The real TMPDIR exists, so the canonical path is added too (on macOS
  // /var/folders resolves to /private/var/folders, which the validator needs)
  const osTmp = Deno.env.get("TMPDIR")?.replace(/\/+$/, "");
  if (!osTmp || osTmp === "/tmp") return; // environment-dependent; skip if no distinct TMPDIR
  const dirs = computeTempDirDefaults(osTmp);
  assertEquals(dirs.includes(osTmp), true);
  const realTmp = Deno.realPathSync(osTmp);
  assertEquals(dirs.includes(realTmp), true);
});

Deno.test("SSH-586: TMPDIR equal to /tmp is not duplicated", () => {
  const dirs = computeTempDirDefaults("/tmp/");
  assertEquals(dirs.filter((p) => p === "/tmp").length, 1);
});

Deno.test("SSH-586: unset TMPDIR leaves defaults unchanged", () => {
  const dirs = computeTempDirDefaults(undefined);
  assertEquals(dirs.includes("/tmp"), true);
  assertEquals(dirs.some((p) => p.startsWith("/var/folders")), false);
});

Deno.test("SSH-591: startup TMPDIR is in effective read/write paths", () => {
  const osTmp = Deno.env.get("TMPDIR")?.replace(/\/+$/, "");
  if (!osTmp || osTmp === "/tmp") return; // environment-dependent; skip if no distinct TMPDIR
  const perms = getEffectivePermissions(baseConfig, "/test/project");
  assertEquals(perms.read!.includes(osTmp), true);
  assertEquals(perms.write!.includes(osTmp), true);
});

Deno.test("SSH-591: TMPDIR mutation after startup does not widen the sandbox", () => {
  withTmpdir("/var/folders/0p/evil/T", () => {
    const perms = getEffectivePermissions(baseConfig, "/test/project");
    assertEquals(perms.read!.includes("/var/folders/0p/evil/T"), false);
    assertEquals(perms.write!.includes("/var/folders/0p/evil/T"), false);
    // the snapshot defaults are still present
    assertEquals(perms.write!.includes("/tmp"), true);
  });
});

Deno.test("SSH-638: computePathDirDefaults keeps absolute dirs, dedupes, strips trailing sep", () => {
  const dirs = computePathDirDefaults("/usr/bin:/bin:/usr/bin:/opt/x/:.::relative");
  assertEquals(dirs, ["/usr/bin", "/bin", "/opt/x"]);
});

Deno.test("SSH-638: computePathDirDefaults returns [] for empty/undefined PATH", () => {
  assertEquals(computePathDirDefaults(undefined), []);
  assertEquals(computePathDirDefaults(""), []);
});

Deno.test("SSH-638: $PATH bin dirs are in effective read by default", () => {
  // PATH_DIR_DEFAULTS is snapshotted from the real PATH at module load; PATH is
  // not mutated during the test run, so re-deriving gives the same set.
  const pathDirs = computePathDirDefaults(Deno.env.get("PATH"));
  if (pathDirs.length === 0) return; // environment-dependent; skip if PATH empty
  const perms = getEffectivePermissions(baseConfig, "/test/project");
  for (const dir of pathDirs) {
    assertEquals(perms.read!.includes(dir), true);
  }
});

Deno.test("SSH-638: includePathDirsInDefaultRead:false drops $PATH bin dirs", () => {
  const pathDirs = computePathDirDefaults(Deno.env.get("PATH"));
  // pick a system dir outside HOME/cwd so the assertion is meaningful
  const systemDir = pathDirs.find((d) => d.startsWith("/usr") || d.startsWith("/bin") || d.startsWith("/sbin"));
  if (!systemDir) return; // environment-dependent
  const strict = {
    ...baseConfig,
    includePathDirsInDefaultRead: false,
  } as SafeShellConfig;
  const perms = getEffectivePermissions(strict, "/test/project");
  assertEquals(perms.read!.includes(systemDir), false);
});
