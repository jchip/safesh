/**
 * Tests for .claude/safesh.local.ts config loading
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { getLocalConfigPath, loadConfig } from "../src/core/config.ts";
import type { SafeshLocalConfig } from "../src/core/types.ts";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a temporary test directory with config files
 */
async function createTestDir(name: string): Promise<string> {
  const testDir = join("/tmp", `safesh-test-${name}-${Date.now()}`);
  await Deno.mkdir(testDir, { recursive: true });
  await Deno.mkdir(join(testDir, ".claude"), { recursive: true });
  return testDir;
}

/**
 * Write a local config file
 */
async function writeLocalConfig(
  testDir: string,
  config: SafeshLocalConfig,
): Promise<void> {
  const configPath = join(testDir, ".claude", "safesh.local.ts");
  const content = `export default ${JSON.stringify(config, null, 2)};`;
  await Deno.writeTextFile(configPath, content);
}

/**
 * Cleanup test directory
 */
async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Path Tests
// ============================================================================

Deno.test("getLocalConfigPath - returns correct path", () => {
  const cwd = "/test/project";
  const expected = "/test/project/.claude/safesh.local.ts";
  assertEquals(getLocalConfigPath(cwd), expected);
});

// ============================================================================
// Loading Tests
// ============================================================================

Deno.test("loadConfig - loads local config with simple string commands", async () => {
  const testDir = await createTestDir("simple-commands");

  try {
    // Write local config with simple string commands
    await writeLocalConfig(testDir, {
      allowedCommands: ["git", "make", "cargo"],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Verify commands were added to external
    assertExists(config.external);
    assertEquals(config.external.git?.allow, true);
    assertEquals(config.external.make?.allow, true);
    assertEquals(config.external.cargo?.allow, true);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - loads local config with command objects", async () => {
  const testDir = await createTestDir("command-objects");

  try {
    // Write local config with command objects
    await writeLocalConfig(testDir, {
      allowedCommands: [
        {
          command: "git",
          subcommands: ["status", "diff", "log"],
        },
        {
          command: "docker",
          subcommands: ["ps", "images"],
        },
      ],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Verify commands were added with subcommands
    assertExists(config.external);
    assertEquals(config.external.git?.allow, ["status", "diff", "log"]);
    assertEquals(config.external.docker?.allow, ["ps", "images"]);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - loads local config with mixed commands", async () => {
  const testDir = await createTestDir("mixed-commands");

  try {
    // Write local config with mixed commands
    await writeLocalConfig(testDir, {
      allowedCommands: [
        "make",
        {
          command: "git",
          subcommands: ["status", "log"],
        },
        "cargo",
      ],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Verify mixed commands
    assertExists(config.external);
    assertEquals(config.external.make?.allow, true);
    assertEquals(config.external.git?.allow, ["status", "log"]);
    assertEquals(config.external.cargo?.allow, true);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - missing local config file does not error", async () => {
  const testDir = await createTestDir("missing-file");

  try {
    // Don't create any local config file
    // Load config should succeed with defaults
    const config = await loadConfig(testDir);

    // Should have default config
    assertExists(config);
    assertExists(config.permissions);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - invalid local config logs warning but does not fail", async () => {
  const testDir = await createTestDir("invalid-config");

  try {
    // Write invalid TypeScript
    const configPath = join(testDir, ".claude", "safesh.local.ts");
    await Deno.writeTextFile(
      configPath,
      "export default { invalid syntax here",
    );

    // Load config should succeed despite invalid file
    const config = await loadConfig(testDir);

    // Should have default config
    assertExists(config);
    assertExists(config.permissions);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - empty allowedCommands returns null", async () => {
  const testDir = await createTestDir("empty-commands");

  try {
    // Write local config with empty allowedCommands
    await writeLocalConfig(testDir, {
      allowedCommands: [],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Should have default config (no additions from local)
    assertExists(config);
    // External should only have defaults, no additions from empty local config
  } finally {
    await cleanupTestDir(testDir);
  }
});

// ============================================================================
// Merging Tests
// ============================================================================

Deno.test("loadConfig - local config merges with project config", async () => {
  const testDir = await createTestDir("merge-test");

  try {
    // Write project config
    const projectConfigPath = join(testDir, "safesh.config.ts");
    await Deno.writeTextFile(
      projectConfigPath,
      `export default {
        external: {
          npm: { allow: true },
        },
      };`,
    );

    // Write local config
    await writeLocalConfig(testDir, {
      allowedCommands: ["git", "docker"],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Verify both configs were merged
    assertExists(config.external);
    assertEquals(config.external.npm?.allow, true); // from project config
    assertEquals(config.external.git?.allow, true); // from local config
    assertEquals(config.external.docker?.allow, true); // from local config
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - local config has highest priority", async () => {
  const testDir = await createTestDir("priority-test");

  try {
    // Write project config with git restricted
    const projectConfigPath = join(testDir, "safesh.config.ts");
    await Deno.writeTextFile(
      projectConfigPath,
      `export default {
        external: {
          git: { allow: ["status", "log"] },
        },
      };`,
    );

    // Write local config with git fully allowed
    await writeLocalConfig(testDir, {
      allowedCommands: ["git"],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Local config should override (merge keeps last value)
    assertExists(config.external);
    assertEquals(config.external.git?.allow, true);
  } finally {
    await cleanupTestDir(testDir);
  }
});

// ============================================================================
// Registry Integration Tests
// ============================================================================

Deno.test("loadConfig - local config adds commands to permissions.run", async () => {
  const testDir = await createTestDir("permissions-run-test");

  try {
    // Write local config with commands
    await writeLocalConfig(testDir, {
      allowedCommands: ["cargo", "rustc", "make"],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Verify commands are in both external and permissions.run
    assertExists(config.external);
    assertEquals(config.external.cargo?.allow, true);
    assertEquals(config.external.rustc?.allow, true);
    assertEquals(config.external.make?.allow, true);

    // Verify permissions.run includes the commands
    assertExists(config.permissions?.run);
    assertEquals(config.permissions.run.includes("cargo"), true);
    assertEquals(config.permissions.run.includes("rustc"), true);
    assertEquals(config.permissions.run.includes("make"), true);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("loadConfig - local config permissions.run merges with existing", async () => {
  const testDir = await createTestDir("permissions-merge-test");

  try {
    // Write project config with existing run permission
    const projectConfigPath = join(testDir, "safesh.config.ts");
    await Deno.writeTextFile(
      projectConfigPath,
      `export default {
        permissions: {
          run: ["git", "docker"],
        },
      };`,
    );

    // Write local config with additional commands
    await writeLocalConfig(testDir, {
      allowedCommands: ["cargo"],
    });

    // Load config
    const config = await loadConfig(testDir);

    // Verify all commands are in permissions.run
    assertExists(config.permissions?.run);
    assertEquals(config.permissions.run.includes("git"), true);
    assertEquals(config.permissions.run.includes("docker"), true);
    assertEquals(config.permissions.run.includes("cargo"), true);
  } finally {
    await cleanupTestDir(testDir);
  }
});
