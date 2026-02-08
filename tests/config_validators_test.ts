/**
 * Tests for individual config validator functions
 *
 * These tests verify that each validator function works independently
 * and can be tested in isolation.
 */

import { assertEquals } from "@std/assert";
import type { SafeShellConfig } from "../src/core/types.ts";

// Import the validator functions - note these are not exported, so we import from the module
// and use the public validateConfig interface to test behavior
import { validateConfig, mergeConfigs } from "../src/core/config.ts";

// ============================================================================
// Helper to create minimal configs for testing
// ============================================================================

function createMinimalConfig(overrides: Partial<SafeShellConfig> = {}): SafeShellConfig {
  return {
    permissions: {},
    external: {},
    env: { allow: [], mask: [] },
    imports: { trusted: [], allowed: [], blocked: [] },
    tasks: {},
    ...overrides,
  };
}

// ============================================================================
// validatePermissions Tests
// ============================================================================

Deno.test("validatePermissions - accepts safe read permissions", () => {
  const config = createMinimalConfig({
    permissions: { read: ["${CWD}", "/tmp"] },
  });
  const result = validateConfig(config);
  assertEquals(result.errors.length, 0);
});

Deno.test("validatePermissions - warns on root read permission", () => {
  const config = createMinimalConfig({
    permissions: { read: ["/"] },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("read") && w.includes("/")),
    true,
  );
});

Deno.test("validatePermissions - errors on root write permission", () => {
  const config = createMinimalConfig({
    permissions: { write: ["/"] },
  });
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("write") && e.includes("/")),
    true,
  );
});

Deno.test("validatePermissions - errors on wildcard run permission", () => {
  const config = createMinimalConfig({
    permissions: { run: ["*"] },
  });
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("run") && e.includes("*")),
    true,
  );
});

Deno.test("validatePermissions - warns on unrestricted network", () => {
  const config = createMinimalConfig({
    permissions: { net: true },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("unrestricted network")),
    true,
  );
});

Deno.test("validatePermissions - accepts specific network hosts", () => {
  const config = createMinimalConfig({
    permissions: { net: ["example.com", "api.github.com"] },
  });
  const result = validateConfig(config);
  assertEquals(result.errors.length, 0);
  // Should not warn about unrestricted network
  assertEquals(
    result.warnings.some((w) => w.includes("unrestricted network")),
    false,
  );
});

// ============================================================================
// validateExternalCommands Tests
// ============================================================================

Deno.test("validateExternalCommands - accepts valid command config", () => {
  const config = createMinimalConfig({
    external: {
      git: {
        allow: ["status", "log"],
        denyFlags: ["--force"],
      },
    },
  });
  const result = validateConfig(config);
  assertEquals(result.errors.length, 0);
});

Deno.test("validateExternalCommands - errors on conflicting flags", () => {
  const config = createMinimalConfig({
    external: {
      git: {
        allow: true,
        denyFlags: ["--force"],
        requireFlags: ["--force"],
      },
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("git") && e.includes("denied and required")),
    true,
  );
});

Deno.test("validateExternalCommands - no warning on unrestricted command", () => {
  const config = createMinimalConfig({
    external: {
      curl: { allow: true },
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("curl") && w.includes("no restrictions")),
    false,
  );
});

Deno.test("validateExternalCommands - accepts command with restrictions", () => {
  const config = createMinimalConfig({
    external: {
      curl: {
        allow: true,
        denyFlags: ["-X", "--request"],
      },
    },
  });
  const result = validateConfig(config);
  // Should not warn about no restrictions
  assertEquals(
    result.warnings.some((w) => w.includes("curl") && w.includes("no restrictions")),
    false,
  );
});

// ============================================================================
// validateImportPolicy Tests
// ============================================================================

Deno.test("validateImportPolicy - accepts safe import policy", () => {
  const config = createMinimalConfig({
    imports: {
      trusted: ["jsr:@std/*"],
      allowed: ["safesh:*"],
      blocked: ["npm:*", "http:*", "https:*"],
    },
  });
  const result = validateConfig(config);
  assertEquals(result.errors.length, 0);
  // Should not have empty blocked warning
  assertEquals(
    result.warnings.some((w) => w.includes("imports.blocked: empty")),
    false,
  );
});

Deno.test("validateImportPolicy - warns on empty blocked list", () => {
  const config = createMinimalConfig({
    imports: {
      trusted: [],
      allowed: [],
      blocked: [],
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("imports.blocked: empty")),
    true,
  );
});

Deno.test("validateImportPolicy - warns on npm:* allowed", () => {
  const config = createMinimalConfig({
    imports: {
      allowed: ["npm:*"],
      blocked: [],
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("npm:*")),
    true,
  );
});

Deno.test("validateImportPolicy - errors on conflicting patterns", () => {
  const config = createMinimalConfig({
    imports: {
      trusted: ["npm:*"],
      blocked: ["npm:*"],
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("trusted and blocked")),
    true,
  );
});

// ============================================================================
// validateShellSettings Tests (cross-concern validation)
// ============================================================================

Deno.test("validateShellSettings - warns on missing projectDir", () => {
  const config = createMinimalConfig({
    projectDir: undefined,
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("projectDir: not set")),
    true,
  );
});

Deno.test("validateShellSettings - accepts valid projectDir", () => {
  const config = createMinimalConfig({
    projectDir: "/home/user/project",
  });
  const result = validateConfig(config);
  // Should not warn about missing projectDir
  assertEquals(
    result.warnings.some((w) => w.includes("projectDir: not set")),
    false,
  );
});

Deno.test("validateShellSettings - warns on dangerous net + npm combo", () => {
  const config = createMinimalConfig({
    permissions: { net: true },
    imports: {
      allowed: ["npm:*"],
      blocked: [],
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("dangerous combination")),
    true,
  );
});

Deno.test("validateShellSettings - warns on CWD write + no import blocks", () => {
  const config = createMinimalConfig({
    permissions: { write: ["${CWD}"] },
    imports: {
      blocked: [],
    },
  });
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("write access to ${CWD}")),
    true,
  );
});

// ============================================================================
// Integration Tests - Multiple validators interact correctly
// ============================================================================

Deno.test("validateConfig - combines results from all validators", () => {
  const config = createMinimalConfig({
    permissions: {
      write: ["/"], // Error from validatePermissions
      run: ["*"], // Error from validatePermissions
    },
    external: {
      git: {
        allow: true,
        denyFlags: ["--force"],
        requireFlags: ["--force"], // Error from validateExternalCommands
      },
    },
    imports: {
      trusted: ["npm:*"],
      blocked: ["npm:*"], // Error from validateImportPolicy
    },
  });
  const result = validateConfig(config);

  // Should have at least 3 errors (one from each validator)
  assertEquals(result.errors.length >= 3, true);

  // Verify specific errors are present
  assertEquals(
    result.errors.some((e) => e.includes("write") && e.includes("/")),
    true,
  );
  assertEquals(
    result.errors.some((e) => e.includes("run") && e.includes("*")),
    true,
  );
  assertEquals(
    result.errors.some((e) => e.includes("denied and required")),
    true,
  );
  assertEquals(
    result.errors.some((e) => e.includes("trusted and blocked")),
    true,
  );
});

Deno.test("validateConfig - empty config returns only default warnings", () => {
  const config = createMinimalConfig();
  const result = validateConfig(config);

  // Empty config should have warnings but no errors
  assertEquals(result.errors.length, 0);

  // Should warn about missing projectDir and empty blocked imports
  assertEquals(
    result.warnings.some((w) => w.includes("projectDir")),
    true,
  );
  assertEquals(
    result.warnings.some((w) => w.includes("imports.blocked: empty")),
    true,
  );
});

// ============================================================================
// SSH-506: mergeEnvConfig preserves allowReadAll
// ============================================================================

Deno.test("SSH-506: mergeConfigs preserves allowReadAll from base when override is undefined", () => {
  const base = createMinimalConfig({
    env: { allow: ["HOME"], mask: [], allowReadAll: false },
  });
  const override = createMinimalConfig({
    env: { allow: ["PATH"], mask: [] },
  });
  const merged = mergeConfigs(base, override);
  assertEquals(merged.env?.allowReadAll, false);
});

Deno.test("SSH-506: mergeConfigs uses override allowReadAll when provided", () => {
  const base = createMinimalConfig({
    env: { allow: ["HOME"], mask: [], allowReadAll: true },
  });
  const override = createMinimalConfig({
    env: { allow: ["PATH"], mask: [], allowReadAll: false },
  });
  const merged = mergeConfigs(base, override);
  assertEquals(merged.env?.allowReadAll, false);
});

Deno.test("SSH-506: mergeConfigs preserves allowReadAll true from base", () => {
  const base = createMinimalConfig({
    env: { allow: [], mask: [], allowReadAll: true },
  });
  const override = createMinimalConfig({
    env: { allow: [], mask: [] },
  });
  const merged = mergeConfigs(base, override);
  assertEquals(merged.env?.allowReadAll, true);
});

Deno.test("SSH-506: mergeConfigs allows override to set allowReadAll to true", () => {
  const base = createMinimalConfig({
    env: { allow: [], mask: [], allowReadAll: false },
  });
  const override = createMinimalConfig({
    env: { allow: [], mask: [], allowReadAll: true },
  });
  const merged = mergeConfigs(base, override);
  assertEquals(merged.env?.allowReadAll, true);
});

Deno.test("SSH-506: mergeConfigs - allowReadAll is undefined when neither sets it", () => {
  const base = createMinimalConfig({
    env: { allow: [], mask: [] },
  });
  const override = createMinimalConfig({
    env: { allow: [], mask: [] },
  });
  const merged = mergeConfigs(base, override);
  assertEquals(merged.env?.allowReadAll, undefined);
});
