/**
 * Tests for I/O Utilities
 *
 * Note: These tests verify the logic structure but cannot fully test
 * readStdinFully() in a unit test environment as it requires actual stdin.
 * Integration tests should be used to verify stdin reading behavior.
 */

import { assertEquals } from "jsr:@std/assert@1";

// Basic smoke test to ensure the module loads
Deno.test("io-utils module exports readStdinFully", async () => {
  const { readStdinFully } = await import("./io-utils.ts");
  assertEquals(typeof readStdinFully, "function");
});
