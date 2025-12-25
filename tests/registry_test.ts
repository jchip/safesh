/**
 * Tests for external command whitelist registry
 */

import { assertEquals } from "@std/assert";
import {
  CommandRegistry,
  createRegistry,
  DEFAULT_COMMAND_CONFIGS,
  normalizeCommand,
} from "../src/external/registry.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

// ============================================================================
// CommandRegistry Tests
// ============================================================================

Deno.test("CommandRegistry - registers and retrieves commands", () => {
  const registry = new CommandRegistry();

  registry.register("git", { allow: true });

  assertEquals(registry.isWhitelisted("git"), true);
  assertEquals(registry.get("git")?.allow, true);
});

Deno.test("CommandRegistry - returns undefined for unregistered commands", () => {
  const registry = new CommandRegistry();

  assertEquals(registry.get("unknown"), undefined);
  assertEquals(registry.isWhitelisted("unknown"), false);
});

Deno.test("CommandRegistry - unregisters commands", () => {
  const registry = new CommandRegistry();

  registry.register("git", { allow: true });
  assertEquals(registry.isWhitelisted("git"), true);

  const removed = registry.unregister("git");
  assertEquals(removed, true);
  assertEquals(registry.isWhitelisted("git"), false);
});

Deno.test("CommandRegistry - lists all registered commands", () => {
  const registry = new CommandRegistry();

  registry.register("git", { allow: true });
  registry.register("docker", { allow: ["ps", "logs"] });
  registry.register("fyn", { allow: true });

  const commands = registry.list();
  assertEquals(commands.length, 3);
  assertEquals(commands.includes("git"), true);
  assertEquals(commands.includes("docker"), true);
  assertEquals(commands.includes("fyn"), true);
});

Deno.test("CommandRegistry - clears all commands", () => {
  const registry = new CommandRegistry();

  registry.register("git", { allow: true });
  registry.register("docker", { allow: true });

  registry.clear();

  assertEquals(registry.list().length, 0);
});

Deno.test("CommandRegistry - loads from config on construction", () => {
  const config: SafeShellConfig = {
    external: {
      git: { allow: true },
      docker: { allow: ["ps"] },
    },
  };

  const registry = new CommandRegistry(config);

  assertEquals(registry.isWhitelisted("git"), true);
  assertEquals(registry.isWhitelisted("docker"), true);
  assertEquals(registry.get("docker")?.allow, ["ps"]);
});

// ============================================================================
// Default Configs Tests
// ============================================================================

Deno.test("DEFAULT_COMMAND_CONFIGS - has git with safety defaults", () => {
  const gitConfig = DEFAULT_COMMAND_CONFIGS["git"];

  assertEquals(gitConfig?.allow, true);
  assertEquals(gitConfig?.denyFlags?.includes("--force"), true);
  assertEquals(gitConfig?.denyFlags?.includes("-f"), true);
  assertEquals(gitConfig?.pathArgs?.validateSandbox, true);
});

Deno.test("DEFAULT_COMMAND_CONFIGS - has docker with restricted subcommands", () => {
  const dockerConfig = DEFAULT_COMMAND_CONFIGS["docker"];

  assertEquals(Array.isArray(dockerConfig?.allow), true);
  assertEquals((dockerConfig?.allow as string[]).includes("ps"), true);
  assertEquals((dockerConfig?.allow as string[]).includes("logs"), true);
  assertEquals(dockerConfig?.denyFlags?.includes("--privileged"), true);
});

Deno.test("DEFAULT_COMMAND_CONFIGS - has deno with restricted subcommands", () => {
  const denoConfig = DEFAULT_COMMAND_CONFIGS["deno"];

  assertEquals(Array.isArray(denoConfig?.allow), true);
  assertEquals((denoConfig?.allow as string[]).includes("run"), true);
  assertEquals((denoConfig?.allow as string[]).includes("test"), true);
  assertEquals(denoConfig?.denyFlags?.includes("--allow-all"), true);
  assertEquals(denoConfig?.denyFlags?.includes("-A"), true);
});

// ============================================================================
// loadDefaults Tests
// ============================================================================

Deno.test("CommandRegistry - loadDefaults only loads allowed commands", () => {
  const registry = new CommandRegistry();

  // Only allow git, not docker
  registry.loadDefaults(["git"]);

  assertEquals(registry.isWhitelisted("git"), true);
  assertEquals(registry.isWhitelisted("docker"), false);
});

Deno.test("CommandRegistry - loadDefaults preserves existing configs", () => {
  const registry = new CommandRegistry();

  // Register custom git config
  registry.register("git", { allow: ["status", "log"] });

  // Load defaults (should not override)
  registry.loadDefaults(["git"]);

  assertEquals(registry.get("git")?.allow, ["status", "log"]);
});

// ============================================================================
// mergeWithDefaults Tests
// ============================================================================

Deno.test("CommandRegistry - mergeWithDefaults combines configs", () => {
  const registry = new CommandRegistry();

  const userConfig = {
    git: { allow: true, denyFlags: ["--force"] }, // Override
    fyn: { allow: true }, // Keep as is
  };

  registry.mergeWithDefaults(userConfig, ["git", "fyn", "docker"]);

  // User config should override default
  assertEquals(registry.get("git")?.denyFlags, ["--force"]);
  // User config should be used
  assertEquals(registry.isWhitelisted("fyn"), true);
  // Default should be used for docker (not in user config but in allowed)
  assertEquals(registry.isWhitelisted("docker"), true);
});

Deno.test("CommandRegistry - mergeWithDefaults ignores non-allowed commands", () => {
  const registry = new CommandRegistry();

  const userConfig = {
    rm: { allow: true }, // Not in allowed list
  };

  registry.mergeWithDefaults(userConfig, ["git"]);

  assertEquals(registry.isWhitelisted("rm"), false);
});

// ============================================================================
// createRegistry Tests
// ============================================================================

Deno.test("createRegistry - creates registry from config", () => {
  const config: SafeShellConfig = {
    permissions: {
      run: ["git", "docker"],
    },
    external: {
      git: { allow: true },
    },
  };

  const registry = createRegistry(config);

  assertEquals(registry.isWhitelisted("git"), true);
  assertEquals(registry.isWhitelisted("docker"), true);
});

Deno.test("createRegistry - handles empty config", () => {
  const registry = createRegistry({});

  assertEquals(registry.list().length, 0);
});

// ============================================================================
// normalizeCommand Tests
// ============================================================================

Deno.test("normalizeCommand - extracts basename from path", () => {
  assertEquals(normalizeCommand("/usr/bin/git"), "git");
  assertEquals(normalizeCommand("/usr/local/bin/docker"), "docker");
});

Deno.test("normalizeCommand - handles simple command names", () => {
  assertEquals(normalizeCommand("git"), "git");
  assertEquals(normalizeCommand("docker"), "docker");
});
