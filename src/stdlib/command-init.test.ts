/**
 * Tests for runtime command permission checking (command-init.ts).
 *
 * SSH-648: relative-path commands must resolve against the live process cwd
 * (updated by $.cd → Deno.chdir), not just the static cwd captured at start.
 */

import { assertEquals } from "@std/assert";
import { checkPermission, type PreambleConfig } from "./command-init.ts";

function makeConfig(overrides: Partial<PreambleConfig> = {}): PreambleConfig {
  return {
    allowedCommands: [],
    cwd: "/start",
    ...overrides,
  };
}

/**
 * Like Deno.makeTempDir() but returns the canonical path. macOS resolves
 * /var -> /private/var, and Deno.cwd() (used by the fix) returns the canonical
 * form, so temp paths must match it for workspace-root containment checks.
 */
async function makeTempDirReal(): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir());
}

/** Run `fn` with the process cwd temporarily changed, restoring it after. */
async function withCwd(dir: string, fn: () => Promise<void>): Promise<void> {
  const original = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn();
  } finally {
    Deno.chdir(original);
  }
}

Deno.test("SSH-648: relative command auto-allowed when run from a cd'd workspace dir", async () => {
  const tmpDir = await makeTempDirReal();
  const startDir = `${tmpDir}/start`;
  const workspaceRoot = `${tmpDir}/dev`;
  const pkgDir = `${workspaceRoot}/pkg`;

  await Deno.mkdir(startDir, { recursive: true });
  await Deno.mkdir(pkgDir, { recursive: true });
  await Deno.writeTextFile(`${pkgDir}/tool`, "#!/bin/sh\n");

  try {
    const config = makeConfig({
      cwd: startDir, // static start cwd — ./tool does NOT exist here
      projectDir: startDir,
      workspaceRoots: [workspaceRoot],
      allowProjectCommands: true,
    });

    // Static-cwd-only check fails (the old behavior / the gap).
    await withCwd(startDir, async () => {
      const atStart = await checkPermission("./tool", config);
      assertEquals(atStart.allowed, false);
    });

    // After cd into the workspace pkg dir, the live cwd resolves it.
    await withCwd(pkgDir, async () => {
      const result = await checkPermission("./tool", config);
      assertEquals(result.allowed, true, JSON.stringify(result));
      if (result.allowed) {
        assertEquals(result.resolvedPath, `${pkgDir}/tool`);
      }
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-648: live cwd outside all workspace roots is still blocked", async () => {
  const tmpDir = await makeTempDirReal();
  const startDir = `${tmpDir}/start`;
  const workspaceRoot = `${tmpDir}/dev`;
  const outsideDir = `${tmpDir}/elsewhere`;

  await Deno.mkdir(startDir, { recursive: true });
  await Deno.mkdir(workspaceRoot, { recursive: true });
  await Deno.mkdir(outsideDir, { recursive: true });
  await Deno.writeTextFile(`${outsideDir}/tool`, "#!/bin/sh\n");

  try {
    const config = makeConfig({
      cwd: startDir,
      projectDir: startDir,
      workspaceRoots: [workspaceRoot],
      allowProjectCommands: true,
    });

    // Exists at the live cwd, but that dir is outside every workspace root.
    await withCwd(outsideDir, async () => {
      const result = await checkPermission("./tool", config);
      assertEquals(result.allowed, false);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-648: behavior unchanged when live cwd equals start cwd", async () => {
  const tmpDir = await makeTempDirReal();
  const startDir = `${tmpDir}/start`;

  await Deno.mkdir(`${startDir}/scripts`, { recursive: true });
  await Deno.writeTextFile(`${startDir}/scripts/build.sh`, "#!/bin/sh\n");

  try {
    const config = makeConfig({
      cwd: startDir,
      projectDir: startDir,
      allowProjectCommands: true,
    });

    await withCwd(startDir, async () => {
      const result = await checkPermission("scripts/build.sh", config);
      assertEquals(result.allowed, true, JSON.stringify(result));
      if (result.allowed) {
        assertEquals(result.resolvedPath, `${startDir}/scripts/build.sh`);
      }
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("SSH-648: bare PATH names unaffected by live cwd", async () => {
  const config = makeConfig({ allowedCommands: ["git"], cwd: "/start" });

  const allowed = await checkPermission("git", config);
  assertEquals(allowed.allowed, true);

  const blocked = await checkPermission("curl", config);
  assertEquals(blocked.allowed, false);
});

Deno.test("SSH-648: relative command allowlisted by exact path under the live cwd", async () => {
  const tmpDir = await makeTempDirReal();
  const startDir = `${tmpDir}/start`;
  const pkgDir = `${tmpDir}/pkg`;

  await Deno.mkdir(startDir, { recursive: true });
  await Deno.mkdir(`${pkgDir}/bin`, { recursive: true });
  await Deno.writeTextFile(`${pkgDir}/bin/tool`, "#!/bin/sh\n");

  try {
    // allowProjectCommands off: only the explicit absolute-path allowlist entry
    // (resolved against the live cwd) should permit it.
    const config = makeConfig({
      cwd: startDir,
      projectDir: startDir,
      allowProjectCommands: false,
      allowedCommands: [`${pkgDir}/bin/tool`],
    });

    await withCwd(pkgDir, async () => {
      const result = await checkPermission("./bin/tool", config);
      assertEquals(result.allowed, true, JSON.stringify(result));
      if (result.allowed) {
        assertEquals(result.resolvedPath, `${pkgDir}/bin/tool`);
      }
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
