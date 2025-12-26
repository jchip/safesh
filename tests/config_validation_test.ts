/**
 * Tests for config validation and security presets
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  getPreset,
  PERMISSIVE_PRESET,
  STANDARD_PRESET,
  STRICT_PRESET,
  validateConfig,
} from "../src/core/config.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

// ============================================================================
// Preset Tests
// ============================================================================

Deno.test("getPreset - returns strict preset", () => {
  const preset = getPreset("strict");
  assertEquals(preset, STRICT_PRESET);
});

Deno.test("getPreset - returns standard preset", () => {
  const preset = getPreset("standard");
  assertEquals(preset, STANDARD_PRESET);
});

Deno.test("getPreset - returns permissive preset", () => {
  const preset = getPreset("permissive");
  assertEquals(preset, PERMISSIVE_PRESET);
});

Deno.test("strict preset - has minimal permissions", () => {
  assertEquals(STRICT_PRESET.permissions?.write, ["/tmp"]);
  assertEquals(STRICT_PRESET.permissions?.net, []);
  assertEquals(STRICT_PRESET.permissions?.run, []);
  assertEquals(STRICT_PRESET.imports?.blocked?.includes("npm:*"), true);
  assertEquals(STRICT_PRESET.imports?.blocked?.includes("http:*"), true);
  assertEquals(STRICT_PRESET.imports?.blocked?.includes("file:*"), true);
});

Deno.test("standard preset - has balanced permissions", () => {
  assertEquals(STANDARD_PRESET.permissions?.read, ["${CWD}", "/tmp"]);
  assertEquals(STANDARD_PRESET.permissions?.write, ["${CWD}", "/tmp"]);
  assertEquals(STANDARD_PRESET.permissions?.net, []);
  assertEquals(STANDARD_PRESET.imports?.blocked?.includes("npm:*"), true);
});

Deno.test("permissive preset - has broader permissions", () => {
  assertEquals(PERMISSIVE_PRESET.permissions?.net, true);
  assertExists(PERMISSIVE_PRESET.permissions?.run);
  assertEquals(
    PERMISSIVE_PRESET.permissions?.run?.includes("git"),
    true,
  );
  assertEquals(PERMISSIVE_PRESET.external?.git?.allow, true);
});

// ============================================================================
// Validation Tests - Permissions
// ============================================================================

Deno.test("validateConfig - allows valid standard config", () => {
  const result = validateConfig(STANDARD_PRESET);
  assertEquals(result.errors.length, 0);
});

Deno.test("validateConfig - errors on write: ['/']", () => {
  const config: SafeShellConfig = {
    permissions: { write: ["/"] },
  };
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("write") && e.includes("/")),
    true,
  );
});

Deno.test("validateConfig - errors on run: ['*']", () => {
  const config: SafeShellConfig = {
    permissions: { run: ["*"] },
  };
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("run") && e.includes("*")),
    true,
  );
});

Deno.test("validateConfig - warns on read: ['/']", () => {
  const config: SafeShellConfig = {
    permissions: { read: ["/"] },
  };
  const result = validateConfig(config);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.some((w) => w.includes("read") && w.includes("/")),
    true,
  );
});

Deno.test("validateConfig - warns on sensitive read directories", () => {
  const config: SafeShellConfig = {
    permissions: { read: ["/etc", "/var"] },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("/etc")),
    true,
  );
  assertEquals(
    result.warnings.some((w) => w.includes("/var")),
    true,
  );
});

Deno.test("validateConfig - errors on dangerous write directories", () => {
  const config: SafeShellConfig = {
    permissions: { write: ["/etc", "/bin"] },
  };
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("/etc")),
    true,
  );
  assertEquals(
    result.errors.some((e) => e.includes("/bin")),
    true,
  );
});

Deno.test("validateConfig - warns on unrestricted network access", () => {
  const config: SafeShellConfig = {
    permissions: { net: true },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("unrestricted network")),
    true,
  );
});

Deno.test("validateConfig - warns on too many allowed commands", () => {
  const config: SafeShellConfig = {
    permissions: {
      run: Array.from({ length: 25 }, (_, i) => `cmd${i}`),
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("25 commands")),
    true,
  );
});

// ============================================================================
// Validation Tests - External Commands
// ============================================================================

Deno.test("validateConfig - errors on conflicting flags", () => {
  const config: SafeShellConfig = {
    external: {
      git: {
        allow: true,
        denyFlags: ["--force"],
        requireFlags: ["--force"],
      },
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) =>
      e.includes("git") && e.includes("denied and required")
    ),
    true,
  );
});

Deno.test("validateConfig - warns on unrestricted external commands", () => {
  const config: SafeShellConfig = {
    external: {
      git: {
        allow: true,
      },
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("git") && w.includes("no restrictions")),
    true,
  );
});

// ============================================================================
// Validation Tests - Import Policy
// ============================================================================

Deno.test("validateConfig - warns on empty blocked imports", () => {
  const config: SafeShellConfig = {
    imports: {
      trusted: [],
      allowed: [],
      blocked: [],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("imports.blocked: empty")),
    true,
  );
});

Deno.test("validateConfig - warns on npm:* allowed", () => {
  const config: SafeShellConfig = {
    imports: {
      allowed: ["npm:*"],
      blocked: [],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("npm:*")),
    true,
  );
});

Deno.test("validateConfig - warns on http:* allowed", () => {
  const config: SafeShellConfig = {
    imports: {
      allowed: ["http:*", "https:*"],
      blocked: [],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("http:*") || w.includes("https:*")),
    true,
  );
});

Deno.test("validateConfig - errors on conflicting trusted/blocked imports", () => {
  const config: SafeShellConfig = {
    imports: {
      trusted: ["npm:*"],
      blocked: ["npm:*"],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("trusted and blocked")),
    true,
  );
});

Deno.test("validateConfig - errors on conflicting allowed/blocked imports", () => {
  const config: SafeShellConfig = {
    imports: {
      allowed: ["http:*"],
      blocked: ["http:*"],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.errors.some((e) => e.includes("allowed and blocked")),
    true,
  );
});

// ============================================================================
// Validation Tests - Cross-Concern
// ============================================================================

Deno.test("validateConfig - warns on dangerous combination: net + npm", () => {
  const config: SafeShellConfig = {
    permissions: { net: true },
    imports: {
      allowed: ["npm:*"],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) =>
      w.includes("dangerous combination") && w.includes("npm")
    ),
    true,
  );
});

Deno.test("validateConfig - warns on write CWD + no import blocks", () => {
  const config: SafeShellConfig = {
    permissions: { write: ["${CWD}"] },
    imports: {
      blocked: [],
    },
  };
  const result = validateConfig(config);
  assertEquals(
    result.warnings.some((w) => w.includes("write access to ${CWD}")),
    true,
  );
});

// ============================================================================
// Integration Tests - Presets Pass Validation
// ============================================================================

Deno.test("strict preset passes validation with no errors", () => {
  const result = validateConfig(STRICT_PRESET);
  assertEquals(result.errors.length, 0);
});

Deno.test("standard preset passes validation with no errors", () => {
  const result = validateConfig(STANDARD_PRESET);
  assertEquals(result.errors.length, 0);
});

Deno.test("permissive preset may have warnings but no errors", () => {
  const result = validateConfig(PERMISSIVE_PRESET);
  assertEquals(result.errors.length, 0);
  // Permissive preset should have some warnings (net: true, etc.)
  assertEquals(result.warnings.length > 0, true);
});
