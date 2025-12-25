/**
 * Tests for command and flag validation
 */

import { assertEquals } from "@std/assert";
import {
  getSubcommand,
  hasRequiredFlags,
  isFlagDenied,
  parseFlags,
  validateCommand,
  validateExternal,
} from "../src/external/validator.ts";
import { CommandRegistry } from "../src/external/registry.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

// ============================================================================
// parseFlags Tests
// ============================================================================

Deno.test("parseFlags - parses long flags", () => {
  const flags = parseFlags(["--verbose", "--force"]);
  assertEquals(flags, ["--verbose", "--force"]);
});

Deno.test("parseFlags - parses short flags", () => {
  const flags = parseFlags(["-v", "-f"]);
  assertEquals(flags, ["-v", "-f"]);
});

Deno.test("parseFlags - handles flag=value format", () => {
  const flags = parseFlags(["--output=/path", "--file=test.txt"]);
  assertEquals(flags, ["--output", "--file"]);
});

Deno.test("parseFlags - handles combined short flags", () => {
  const flags = parseFlags(["-abc"]);
  assertEquals(flags, ["-a", "-b", "-c"]);
});

Deno.test("parseFlags - ignores non-flag arguments", () => {
  const flags = parseFlags(["commit", "-m", "message", "file.txt"]);
  assertEquals(flags, ["-m"]);
});

// ============================================================================
// getSubcommand Tests
// ============================================================================

Deno.test("getSubcommand - returns first non-flag argument", () => {
  assertEquals(getSubcommand(["status"]), "status");
  assertEquals(getSubcommand(["--verbose", "status"]), "status");
  assertEquals(getSubcommand(["-v", "commit", "-m", "msg"]), "commit");
});

Deno.test("getSubcommand - returns undefined if no subcommand", () => {
  assertEquals(getSubcommand(["--help"]), undefined);
  assertEquals(getSubcommand(["-v", "--verbose"]), undefined);
});

// ============================================================================
// isFlagDenied Tests
// ============================================================================

Deno.test("isFlagDenied - detects denied flags", () => {
  const denyFlags = ["--force", "-f", "--hard"];

  assertEquals(isFlagDenied("--force", denyFlags), true);
  assertEquals(isFlagDenied("-f", denyFlags), true);
  assertEquals(isFlagDenied("--hard", denyFlags), true);
});

Deno.test("isFlagDenied - allows non-denied flags", () => {
  const denyFlags = ["--force", "-f"];

  assertEquals(isFlagDenied("--verbose", denyFlags), false);
  assertEquals(isFlagDenied("-v", denyFlags), false);
});

Deno.test("isFlagDenied - case insensitive", () => {
  const denyFlags = ["--Force", "-F"];

  assertEquals(isFlagDenied("--force", denyFlags), true);
  assertEquals(isFlagDenied("-f", denyFlags), true);
});

// ============================================================================
// hasRequiredFlags Tests
// ============================================================================

Deno.test("hasRequiredFlags - returns valid when all present", () => {
  const result = hasRequiredFlags(["--dry-run", "-v"], ["--dry-run"]);

  assertEquals(result.valid, true);
  assertEquals(result.missing.length, 0);
});

Deno.test("hasRequiredFlags - returns missing flags", () => {
  const result = hasRequiredFlags(["-v"], ["--dry-run", "--verbose"]);

  assertEquals(result.valid, false);
  assertEquals(result.missing, ["--dry-run", "--verbose"]);
});

// ============================================================================
// validateCommand Tests
// ============================================================================

Deno.test("validateCommand - rejects unwhitelisted commands", () => {
  const registry = new CommandRegistry();
  registry.register("git", { allow: true });

  const result = validateCommand("rm", ["-rf", "/"], registry);

  assertEquals(result.valid, false);
  assertEquals(result.error?.code, "COMMAND_NOT_WHITELISTED");
});

Deno.test("validateCommand - allows whitelisted commands", () => {
  const registry = new CommandRegistry();
  registry.register("git", { allow: true });

  const result = validateCommand("git", ["status"], registry);

  assertEquals(result.valid, true);
  assertEquals(result.command, "git");
  assertEquals(result.subcommand, "status");
});

Deno.test("validateCommand - validates subcommands when allow is array", () => {
  const registry = new CommandRegistry();
  registry.register("docker", { allow: ["ps", "logs"] });

  // Allowed subcommand
  let result = validateCommand("docker", ["ps"], registry);
  assertEquals(result.valid, true);

  // Disallowed subcommand
  result = validateCommand("docker", ["rm", "container"], registry);
  assertEquals(result.valid, false);
  assertEquals(result.error?.code, "SUBCOMMAND_NOT_ALLOWED");
});

Deno.test("validateCommand - rejects denied flags", () => {
  const registry = new CommandRegistry();
  registry.register("git", { allow: true, denyFlags: ["--force", "-f"] });

  const result = validateCommand("git", ["push", "--force"], registry);

  assertEquals(result.valid, false);
  assertEquals(result.error?.code, "FLAG_NOT_ALLOWED");
});

Deno.test("validateCommand - allows non-denied flags", () => {
  const registry = new CommandRegistry();
  registry.register("git", { allow: true, denyFlags: ["--force"] });

  const result = validateCommand("git", ["push", "--verbose"], registry);

  assertEquals(result.valid, true);
});

Deno.test("validateCommand - checks required flags", () => {
  const registry = new CommandRegistry();
  registry.register("deploy", { allow: true, requireFlags: ["--dry-run"] });

  // Missing required flag
  let result = validateCommand("deploy", ["production"], registry);
  assertEquals(result.valid, false);

  // Has required flag
  result = validateCommand("deploy", ["--dry-run", "production"], registry);
  assertEquals(result.valid, true);
});

Deno.test("validateCommand - handles path-based command names", () => {
  const registry = new CommandRegistry();
  registry.register("git", { allow: true });

  const result = validateCommand("/usr/bin/git", ["status"], registry);

  assertEquals(result.valid, true);
  assertEquals(result.command, "git");
});

// ============================================================================
// validateExternal Tests (integration)
// ============================================================================

Deno.test({
  name: "validateExternal - combines command and path validation",
  async fn() {
    const registry = new CommandRegistry();
    registry.register("git", {
      allow: true,
      pathArgs: { autoDetect: true, validateSandbox: true },
    });

    const realTmp = await Deno.realPath("/tmp");
    const config: SafeShellConfig = {
      permissions: {
        read: [realTmp],
        write: [realTmp],
      },
    };

    // Valid command and path
    let result = await validateExternal(
      "git",
      ["add", `${realTmp}/file.txt`],
      registry,
      config,
      "/",
    );
    assertEquals(result.valid, true);

    // Invalid path
    result = await validateExternal(
      "git",
      ["add", "/etc/passwd"],
      registry,
      config,
      "/",
    );
    assertEquals(result.valid, false);
    // Could be PATH_VIOLATION or SYMLINK_VIOLATION depending on path resolution
    assertEquals(
      result.error?.code === "PATH_VIOLATION" ||
        result.error?.code === "SYMLINK_VIOLATION",
      true,
    );
  },
});

Deno.test({
  name: "validateExternal - rejects command before checking path",
  async fn() {
    const registry = new CommandRegistry();
    registry.register("git", { allow: true });

    const config: SafeShellConfig = {
      permissions: {
        read: ["/tmp"],
        write: ["/tmp"],
      },
    };

    const result = await validateExternal(
      "rm",
      ["-rf", "/"],
      registry,
      config,
      "/",
    );

    assertEquals(result.valid, false);
    assertEquals(result.error?.code, "COMMAND_NOT_WHITELISTED");
  },
});
