/**
 * Tests for command permission validation
 */

import { assertEquals } from "@std/assert";
import {
  checkCommandPermission,
  checkMultipleCommands,
  getAllowedCommands,
  isCommandAllowed,
} from "./command_permission.ts";
import type { SafeShellConfig } from "./types.ts";

// Test helper to create minimal config
function makeConfig(overrides: Partial<SafeShellConfig> = {}): SafeShellConfig {
  return {
    permissions: { run: [] },
    external: {},
    ...overrides,
  };
}

Deno.test("getAllowedCommands - merges permissions.run and external keys", () => {
  const config = makeConfig({
    permissions: { run: ["git", "deno"] },
    external: { curl: { allow: true }, docker: { allow: ["ps", "build"] } },
  });

  const allowed = getAllowedCommands(config);

  assertEquals(allowed.size, 4);
  assertEquals(allowed.has("git"), true);
  assertEquals(allowed.has("deno"), true);
  assertEquals(allowed.has("curl"), true);
  assertEquals(allowed.has("docker"), true);
});

Deno.test("isCommandAllowed - returns true for allowed commands", () => {
  const allowed = new Set(["git", "deno"]);

  assertEquals(isCommandAllowed("git", allowed), true);
  assertEquals(isCommandAllowed("deno", allowed), true);
  assertEquals(isCommandAllowed("curl", allowed), false);
});

Deno.test("checkCommandPermission - basic name command allowed", async () => {
  const config = makeConfig({ permissions: { run: ["git"] } });
  const result = await checkCommandPermission("git", config, "/home/user");

  assertEquals(result.allowed, true);
  if (result.allowed) {
    assertEquals(result.resolvedPath, "git");
  }
});

Deno.test("checkCommandPermission - basic name command not allowed", async () => {
  const config = makeConfig({ permissions: { run: ["git"] } });
  const result = await checkCommandPermission("curl", config, "/home/user");

  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.error, "COMMAND_NOT_ALLOWED");
    assertEquals(result.command, "curl");
  }
});

Deno.test("checkCommandPermission - full path with basename allowed", async () => {
  const config = makeConfig({ permissions: { run: ["git"] } });
  const result = await checkCommandPermission("/usr/bin/git", config, "/home/user");

  assertEquals(result.allowed, true);
  if (result.allowed) {
    assertEquals(result.resolvedPath, "/usr/bin/git");
  }
});

Deno.test("checkCommandPermission - full path with verbatim allowed", async () => {
  const config = makeConfig({ permissions: { run: ["/usr/local/bin/custom-tool"] } });
  const result = await checkCommandPermission("/usr/local/bin/custom-tool", config, "/home/user");

  assertEquals(result.allowed, true);
  if (result.allowed) {
    assertEquals(result.resolvedPath, "/usr/local/bin/custom-tool");
  }
});

Deno.test("checkCommandPermission - full path not allowed", async () => {
  const config = makeConfig({ permissions: { run: ["git"] } });
  const result = await checkCommandPermission("/usr/bin/curl", config, "/home/user");

  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.error, "COMMAND_NOT_ALLOWED");
    assertEquals(result.command, "/usr/bin/curl");
  }
});

Deno.test("checkCommandPermission - relative path not found", async () => {
  const config = makeConfig({
    projectDir: "/home/user/project",
    permissions: { run: [] },
  });
  const result = await checkCommandPermission("./nonexistent.sh", config, "/home/user");

  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.error, "COMMAND_NOT_FOUND");
    assertEquals(result.command, "./nonexistent.sh");
  }
});

Deno.test("checkCommandPermission - project command auto-allow when enabled", async () => {
  // Create a temp directory structure
  const tmpDir = await Deno.makeTempDir();
  const projectDir = `${tmpDir}/project`;
  const scriptPath = `${projectDir}/scripts/build.sh`;

  await Deno.mkdir(`${projectDir}/scripts`, { recursive: true });
  await Deno.writeTextFile(scriptPath, "#!/bin/bash\necho hello");

  try {
    const config = makeConfig({
      projectDir,
      allowProjectCommands: true,
    });

    const result = await checkCommandPermission("scripts/build.sh", config, projectDir);

    assertEquals(result.allowed, true);
    if (result.allowed) {
      assertEquals(result.resolvedPath, scriptPath);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("checkCommandPermission - project command not allowed when disabled", async () => {
  // Create a temp directory structure
  const tmpDir = await Deno.makeTempDir();
  const projectDir = `${tmpDir}/project`;
  const scriptPath = `${projectDir}/scripts/build.sh`;

  await Deno.mkdir(`${projectDir}/scripts`, { recursive: true });
  await Deno.writeTextFile(scriptPath, "#!/bin/bash\necho hello");

  try {
    const config = makeConfig({
      projectDir,
      allowProjectCommands: false, // Disabled
    });

    const result = await checkCommandPermission("scripts/build.sh", config, projectDir);

    assertEquals(result.allowed, false);
    if (!result.allowed) {
      assertEquals(result.error, "COMMAND_NOT_ALLOWED");
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("checkMultipleCommands - all allowed", async () => {
  const config = makeConfig({
    permissions: { run: ["git", "deno", "docker"] },
  });

  const result = await checkMultipleCommands(
    { git: "git", deno: "deno", docker: "docker" },
    config,
    "/home/user",
  );

  assertEquals(result.allAllowed, true);
  assertEquals(result.notAllowed.length, 0);
  assertEquals(result.notFound.length, 0);
});

Deno.test("checkMultipleCommands - some not allowed", async () => {
  const config = makeConfig({
    permissions: { run: ["git"] },
  });

  const result = await checkMultipleCommands(
    { git: "git", curl: "curl", cargo: "cargo" },
    config,
    "/home/user",
  );

  assertEquals(result.allAllowed, false);
  assertEquals(result.notAllowed.includes("curl"), true);
  assertEquals(result.notAllowed.includes("cargo"), true);
  assertEquals(result.results["git"]?.allowed, true);
});

Deno.test("checkMultipleCommands - some not found", async () => {
  const config = makeConfig({
    permissions: { run: ["git"] },
    projectDir: "/nonexistent/project",
  });

  const result = await checkMultipleCommands(
    { git: "git", missing: "./missing.sh" },
    config,
    "/home/user",
  );

  assertEquals(result.allAllowed, false);
  assertEquals(result.notFound.includes("./missing.sh"), true);
  assertEquals(result.results["git"]?.allowed, true);
});
