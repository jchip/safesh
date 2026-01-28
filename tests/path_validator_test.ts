/**
 * Tests for external command path argument validation
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  extractPathFromFlag,
  extractPaths,
  isPathFlag,
  isPathLike,
  sanitizePathArgs,
  validatePathArgs,
} from "../src/external/path_validator.ts";
import type { SafeShellConfig } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";
import { REAL_TMP } from "./helpers.ts";

// ============================================================================
// isPathLike Tests
// ============================================================================

Deno.test("isPathLike - detects absolute paths", () => {
  assertEquals(isPathLike("/etc/passwd"), true);
  assertEquals(isPathLike("/home/user/file.txt"), true);
});

Deno.test("isPathLike - detects relative paths with ./", () => {
  assertEquals(isPathLike("./file.txt"), true);
  assertEquals(isPathLike("./subdir/file.txt"), true);
});

Deno.test("isPathLike - detects parent paths with ../", () => {
  assertEquals(isPathLike("../file.txt"), true);
  assertEquals(isPathLike("../../file.txt"), true);
});

Deno.test("isPathLike - detects home directory paths", () => {
  assertEquals(isPathLike("~/file.txt"), true);
  assertEquals(isPathLike("~/.config"), true);
});

Deno.test("isPathLike - rejects plain arguments", () => {
  assertEquals(isPathLike("file.txt"), false);
  assertEquals(isPathLike("--flag"), false);
  assertEquals(isPathLike("-o"), false);
  assertEquals(isPathLike("commit"), false);
});

// ============================================================================
// isPathFlag Tests
// ============================================================================

Deno.test("isPathFlag - detects common path flags", () => {
  assertEquals(isPathFlag("-o"), true);
  assertEquals(isPathFlag("--output"), true);
  assertEquals(isPathFlag("--file"), true);
  assertEquals(isPathFlag("-f"), true);
  assertEquals(isPathFlag("-C"), true);
});

Deno.test("isPathFlag - detects flag=value patterns", () => {
  assertEquals(isPathFlag("--output=/path"), true);
  assertEquals(isPathFlag("--file=config.txt"), true);
});

Deno.test("isPathFlag - rejects non-path flags", () => {
  assertEquals(isPathFlag("--verbose"), false);
  assertEquals(isPathFlag("-v"), false);
  assertEquals(isPathFlag("--force"), false);
});

// ============================================================================
// extractPathFromFlag Tests
// ============================================================================

Deno.test("extractPathFromFlag - extracts path from flag=value", () => {
  assertEquals(extractPathFromFlag("--output=/path/to/file"), "/path/to/file");
  assertEquals(extractPathFromFlag("-o=file.txt"), "file.txt");
});

Deno.test("extractPathFromFlag - returns null for flags without value", () => {
  assertEquals(extractPathFromFlag("--output"), null);
  assertEquals(extractPathFromFlag("-o"), null);
});

// ============================================================================
// extractPaths Tests
// ============================================================================

Deno.test("extractPaths - extracts absolute paths", () => {
  const args = ["clone", "/path/to/repo", "dest"];
  const paths = extractPaths(args);

  assertEquals(paths.length, 1);
  assertEquals(paths[0]?.path, "/path/to/repo");
  assertEquals(paths[0]?.argIndex, 1);
});

Deno.test("extractPaths - extracts relative paths", () => {
  const args = ["add", "./file.txt"];
  const paths = extractPaths(args);

  assertEquals(paths.length, 1);
  assertEquals(paths[0]?.path, "./file.txt");
});

Deno.test("extractPaths - extracts paths from flags with embedded value", () => {
  const args = ["build", "--output=/dist"];
  const paths = extractPaths(args);

  assertEquals(paths.length, 1);
  assertEquals(paths[0]?.path, "/dist");
  assertEquals(paths[0]?.fromFlag, true);
});

Deno.test("extractPaths - extracts paths from flag + value pairs", () => {
  const args = ["build", "-o", "/dist"];
  const paths = extractPaths(args);

  assertEquals(paths.length, 1);
  assertEquals(paths[0]?.path, "/dist");
  assertEquals(paths[0]?.fromFlag, true);
});

Deno.test("extractPaths - respects explicit positions", () => {
  const args = ["clone", "url", "dest"];
  const paths = extractPaths(args, { positions: [2] });

  assertEquals(paths.length, 1);
  assertEquals(paths[0]?.path, "dest");
  assertEquals(paths[0]?.argIndex, 2);
});

Deno.test("extractPaths - skips non-path arguments", () => {
  const args = ["commit", "-m", "message", "--verbose"];
  const paths = extractPaths(args);

  assertEquals(paths.length, 0);
});

Deno.test("extractPaths - handles multiple paths", () => {
  const args = ["cp", "/src/file.txt", "./dest.txt"];
  const paths = extractPaths(args);

  assertEquals(paths.length, 2);
  assertEquals(paths[0]?.path, "/src/file.txt");
  assertEquals(paths[1]?.path, "./dest.txt");
});

// ============================================================================
// validatePathArgs Tests
// ============================================================================

Deno.test({
  name: "validatePathArgs - allows paths within sandbox",
  async fn() {
    const config: SafeShellConfig = {
      permissions: {
        read: [REAL_TMP],
        write: [REAL_TMP],
      },
    };

    // Should not throw
    await validatePathArgs(
      ["add", `${REAL_TMP}/file.txt`],
      "git",
      config,
      "/",
    );
  },
});

Deno.test({
  name: "validatePathArgs - rejects paths outside sandbox",
  async fn() {
    const config: SafeShellConfig = {
      permissions: {
        read: ["/allowed"],
        write: ["/allowed"],
      },
    };

    await assertRejects(
      () => validatePathArgs(["clone", "/etc/passwd"], "git", config, "/"),
      SafeShellError,
      "outside allowed directories",
    );
  },
});

Deno.test({
  name: "validatePathArgs - validates flag paths",
  async fn() {
    const config: SafeShellConfig = {
      permissions: {
        read: ["/allowed"],
        write: ["/allowed"],
      },
    };

    await assertRejects(
      () =>
        validatePathArgs(["build", "--output=/etc/malicious"], "cmd", config, "/"),
      SafeShellError,
      "outside allowed directories",
    );
  },
});

Deno.test({
  name: "validatePathArgs - skips validation when disabled",
  async fn() {
    const config: SafeShellConfig = {
      permissions: {
        read: ["/allowed"],
        write: ["/allowed"],
      },
    };

    // Should not throw even though path is outside sandbox
    await validatePathArgs(
      ["clone", "/etc/passwd"],
      "git",
      config,
      "/",
      { allow: true, pathArgs: { validateSandbox: false } },
    );
  },
});

Deno.test({
  name: "validatePathArgs - expands ~ to HOME",
  async fn() {
    const home = Deno.env.get("HOME");
    if (!home) return; // Skip if HOME not set

    const config: SafeShellConfig = {
      permissions: {
        read: [home],
        write: [home],
      },
    };

    // Should not throw
    await validatePathArgs(
      ["add", "~/.config/file"],
      "git",
      config,
      "/",
    );
  },
});

// ============================================================================
// sanitizePathArgs Tests
// ============================================================================

Deno.test("sanitizePathArgs - converts relative to absolute paths", async () => {
  const result = await sanitizePathArgs(["add", "./file.txt"], "/project");

  assertEquals(result[1], "/project/file.txt");
});

Deno.test("sanitizePathArgs - preserves non-path arguments", async () => {
  const result = await sanitizePathArgs(
    ["commit", "-m", "message"],
    "/project",
  );

  assertEquals(result, ["commit", "-m", "message"]);
});

Deno.test("sanitizePathArgs - handles embedded flag paths", async () => {
  const result = await sanitizePathArgs(
    ["build", "--output=./dist"],
    "/project",
  );

  assertEquals(result[1], "--output=/project/dist");
});
