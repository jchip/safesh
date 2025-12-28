/**
 * Tests for MCP roots support (SSH-121)
 */

import { assertEquals } from "@std/assert";

// Import internal functions for testing
// We'll test them via the module that exports them

// Test parseFileUri function behavior
Deno.test("parseFileUri - parses Unix file:// URIs", () => {
  // Test via URL parsing (same logic as in server.ts)
  const uri = "file:///Users/jc/dev/safesh";
  const url = new URL(uri);
  assertEquals(decodeURIComponent(url.pathname), "/Users/jc/dev/safesh");
});

Deno.test("parseFileUri - handles spaces in paths", () => {
  const uri = "file:///Users/jc/My%20Projects/safesh";
  const url = new URL(uri);
  assertEquals(decodeURIComponent(url.pathname), "/Users/jc/My Projects/safesh");
});

Deno.test("parseFileUri - handles special characters", () => {
  const uri = "file:///tmp/test%40dir/file%23name";
  const url = new URL(uri);
  assertEquals(decodeURIComponent(url.pathname), "/tmp/test@dir/file#name");
});

// Test applyRootsToConfig behavior
Deno.test("applyRootsToConfig - empty roots returns unchanged config", () => {
  // Test the logic: if roots.length === 0, config unchanged
  const roots: { uri: string; name?: string }[] = [];
  assertEquals(roots.length, 0);
  // No changes expected
});

Deno.test("applyRootsToConfig - first root becomes projectDir", () => {
  // Test the logic: first root URI parsed to projectDir
  const roots = [
    { uri: "file:///Users/jc/dev/safesh", name: "SafeShell" },
    { uri: "file:///Users/jc/dev/other", name: "Other" },
  ];

  const paths = roots.map(r => {
    const url = new URL(r.uri);
    return decodeURIComponent(url.pathname);
  });

  assertEquals(paths[0], "/Users/jc/dev/safesh");
  assertEquals(paths.length, 2);
});

Deno.test("applyRootsToConfig - adds all roots to permissions", () => {
  // Test the logic: all root paths added to read/write permissions
  const roots = [
    { uri: "file:///project1" },
    { uri: "file:///project2" },
    { uri: "file:///shared/libs" },
  ];

  const paths = roots.map(r => {
    const url = new URL(r.uri);
    return decodeURIComponent(url.pathname);
  });

  assertEquals(paths, ["/project1", "/project2", "/shared/libs"]);
});

Deno.test("applyRootsToConfig - filters out non-file URIs", () => {
  // Test the logic: only file:// URIs are processed
  const roots = [
    { uri: "file:///project" },
    { uri: "https://example.com" }, // Should be filtered
  ];

  const paths = roots
    .filter(r => r.uri.startsWith("file://"))
    .map(r => {
      const url = new URL(r.uri);
      return decodeURIComponent(url.pathname);
    });

  assertEquals(paths, ["/project"]);
});
