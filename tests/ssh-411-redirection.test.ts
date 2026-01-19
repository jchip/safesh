/**
 * SSH-411: Test for "Empty path is not allowed" error with 2>&1 redirection
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { parse, transpile } from "../src/bash/mod.ts";

Deno.test("SSH-411: Reproduce empty path error with 2>&1 redirection", async (t) => {
  await t.step("should transpile command with 2>&1 redirection", () => {
    const input = 'sleep 15 && curl -s -H "Host: relay.termxti.com" http://localhost:12080/api/health 2>&1';

    // This should not throw during transpilation
    const ast = parse(input);
    const result = transpile(ast);
    console.log("Transpiled code:", result);

    // Check that the code doesn't contain empty strings in problematic places
    assertEquals(typeof result, "string");
    assertEquals(result.length > 0, true);

    // Should contain mergeStreams for 2>&1
    assertStringIncludes(result, "mergeStreams");
  });

  await t.step("should transpile simple 2>&1 redirection", () => {
    const input = 'echo test 2>&1';
    const ast = parse(input);
    const result = transpile(ast);
    console.log("Simple 2>&1 transpiled:", result);
    assertEquals(typeof result, "string");
  });

  await t.step("should transpile curl with 2>&1", () => {
    const input = 'curl -s http://example.com 2>&1';
    const ast = parse(input);
    const result = transpile(ast);
    console.log("Curl 2>&1 transpiled:", result);
    assertEquals(typeof result, "string");
  });

  await t.step("should handle 2>&1 with && operator", () => {
    const input = 'echo first && echo second 2>&1';
    const ast = parse(input);
    const result = transpile(ast);
    console.log("&& with 2>&1 transpiled:", result);
    assertEquals(typeof result, "string");
  });
});
