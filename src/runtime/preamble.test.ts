/**
 * Unit tests for preamble.ts
 *
 * Tests the generated preamble code that gets prepended to executed scripts.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { buildPreamble, type PreambleConfig } from "./preamble.ts";

describe("preamble", () => {
  describe("buildPreamble", () => {
    it("generates valid TypeScript code", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(typeof preamble, "string");
      assertEquals(preamble.length > 0, true);
    });

    it("includes __printCmd helper function", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("async function __printCmd"), true);
    });

    it("includes __cmdSubText helper function", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("async function __cmdSubText"), true);
    });

    it("sets up $ global namespace", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("(globalThis as any).$ ="), true);
    });

    it("exposes project directory via $.ProjectDir", () => {
      const projectDir = "/test/my-project";
      const config: PreambleConfig = {
        projectDir,
        allowedCommands: [],
        cwd: projectDir,
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes(`ProjectDir: "${projectDir}"`), true);
    });
  });

  describe("__printCmd null handling (bug fix commit 4833c4c)", () => {
    it("includes null check before accessing result properties", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      // Should have null check: if (!result) return 1;
      assertEquals(preamble.includes("if (!result) return 1"), true, "Should check for null result");
    });

    it("includes fallback for result.code", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      // Should use nullish coalescing: result.code ?? 1
      assertEquals(preamble.includes("result.code ?? 1"), true, "Should have fallback for undefined code");
    });

    it("contains correct null handling logic", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      // The preamble should contain both the null check and the fallback
      // This ensures __printCmd handles null/undefined results gracefully
      assertEquals(preamble.includes("if (!result) return 1"), true, "Should check for null/undefined");
      assertEquals(preamble.includes("result.code ?? 1"), true, "Should have fallback for missing code");

      // Should have logic to handle stdout and stderr without crashing
      assertEquals(preamble.includes("if (result.stdout)"), true, "Should check stdout before using");
      assertEquals(preamble.includes("if (result.stderr)"), true, "Should check stderr before using");
    });

    it("contains output writing logic", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      // Should write stdout and stderr when present
      assertEquals(preamble.includes("Deno.stdout.write"), true, "Should write to stdout");
      assertEquals(preamble.includes("Deno.stderr.write"), true, "Should write to stderr");
    });

    it("returns appropriate exit codes", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      // Should return 1 for null and use actual code when present
      assertEquals(preamble.includes("return 1"), true, "Should return 1 for null");
      assertEquals(preamble.includes("return result.code ?? 1"), true, "Should return actual code or 1");
    });
  });

  describe("edge cases", () => {
    it("handles empty project directory", () => {
      const config: PreambleConfig = {
        projectDir: "",
        allowedCommands: [],
        cwd: "/test",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(typeof preamble, "string");
      assertEquals(preamble.includes('ProjectDir: ""'), true);
    });

    it("handles minimal config", () => {
      const config: PreambleConfig = {
        allowedCommands: [],
        cwd: "/test",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(typeof preamble, "string");
      assertEquals(preamble.length > 0, true);
    });
  });
});
