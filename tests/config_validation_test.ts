/**
 * Tests for config validation
 */

import { assertEquals } from "@std/assert";
import {
  DEFAULT_CONFIG,
  validateConfig,
} from "../src/core/config.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

// ============================================================================
// Default Config Tests
// ============================================================================

Deno.test("DEFAULT_CONFIG - has safe defaults", () => {
  assertEquals(DEFAULT_CONFIG.permissions?.read, ["${CWD}", "/tmp"]);
  assertEquals(DEFAULT_CONFIG.permissions?.write, ["${CWD}", "/tmp"]);
  assertEquals(DEFAULT_CONFIG.permissions?.net, []);
  assertEquals(DEFAULT_CONFIG.imports?.blocked?.includes("npm:*"), true);
});

Deno.test("DEFAULT_CONFIG - passes validation with no errors", () => {
  const result = validateConfig(DEFAULT_CONFIG);
  assertEquals(result.errors.length, 0);
});

// ============================================================================
// Validation Tests - Permissions
// ============================================================================

Deno.test("validateConfig - allows valid config", () => {
  const result = validateConfig(DEFAULT_CONFIG);
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
