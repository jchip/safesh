/**
 * Tests for import security policy enforcement
 */

import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  generateImportMap,
  isImportAllowed,
  validateImports,
} from "../src/core/import_map.ts";
import type { ImportPolicy } from "../src/core/types.ts";
import { SafeShellError } from "../src/core/errors.ts";

describe("Import Security", () => {
  const defaultPolicy: ImportPolicy = {
    trusted: ["jsr:@std/*", "safesh:*"],
    allowed: [],
    blocked: ["npm:*", "http:*", "https:*"],
  };

  describe("isImportAllowed", () => {
    it("should allow trusted imports", () => {
      assertEquals(isImportAllowed("jsr:@std/path", defaultPolicy), true);
      assertEquals(isImportAllowed("jsr:@std/fs", defaultPolicy), true);
      assertEquals(isImportAllowed("safesh:fs", defaultPolicy), true);
      assertEquals(isImportAllowed("safesh:text", defaultPolicy), true);
    });

    it("should block npm imports", () => {
      assertEquals(isImportAllowed("npm:lodash", defaultPolicy), false);
      assertEquals(isImportAllowed("npm:express", defaultPolicy), false);
    });

    it("should block http/https imports", () => {
      assertEquals(
        isImportAllowed("http://example.com/script.js", defaultPolicy),
        false,
      );
      assertEquals(
        isImportAllowed("https://cdn.example.com/lib.js", defaultPolicy),
        false,
      );
    });

    it("should allow user-whitelisted imports", () => {
      const policy: ImportPolicy = {
        ...defaultPolicy,
        allowed: ["npm:lodash", "https://deno.land/x/oak/mod.ts"],
      };

      assertEquals(isImportAllowed("npm:lodash", policy), true);
      assertEquals(
        isImportAllowed("https://deno.land/x/oak/mod.ts", policy),
        true,
      );
    });

    it("should allow imports not in blocked list", () => {
      assertEquals(isImportAllowed("./local.ts", defaultPolicy), true);
      assertEquals(isImportAllowed("../utils/helper.ts", defaultPolicy), true);
      assertEquals(isImportAllowed("/absolute/path.ts", defaultPolicy), true);
    });
  });

  describe("validateImports", () => {
    it("should pass for code with allowed imports", () => {
      const code = `
        import { join } from "jsr:@std/path";
        import * as fs from "safesh:fs";
        import { helper } from "./helper.ts";
      `;
      // Should not throw
      validateImports(code, defaultPolicy);
    });

    it("should reject code with npm imports", () => {
      const code = `
        import lodash from "npm:lodash";
        console.log(lodash);
      `;
      assertRejects(
        async () => {
          validateImports(code, defaultPolicy);
        },
        SafeShellError,
        "npm:lodash",
      );
    });

    it("should reject code with http imports", () => {
      const code = `
        import { serve } from "http://example.com/serve.ts";
      `;
      assertRejects(
        async () => {
          validateImports(code, defaultPolicy);
        },
        SafeShellError,
        "http://example.com/serve.ts",
      );
    });

    it("should reject code with https imports", () => {
      const code = `
        import oak from "https://deno.land/x/oak/mod.ts";
      `;
      assertRejects(
        async () => {
          validateImports(code, defaultPolicy);
        },
        SafeShellError,
        "https://deno.land/x/oak/mod.ts",
      );
    });

    it("should reject dynamic imports", () => {
      const code = `
        const mod = await import("npm:express");
      `;
      assertRejects(
        async () => {
          validateImports(code, defaultPolicy);
        },
        SafeShellError,
        "npm:express",
      );
    });

    it("should allow blocked imports if in allowed list", () => {
      const policy: ImportPolicy = {
        ...defaultPolicy,
        allowed: ["npm:lodash"],
      };

      const code = `
        import _ from "npm:lodash";
      `;
      // Should not throw
      validateImports(code, policy);
    });

    it("should handle multiple imports correctly", () => {
      const code = `
        import { join } from "jsr:@std/path";
        import * as fs from "safesh:fs";
        import lodash from "npm:lodash";
        import oak from "https://deno.land/x/oak/mod.ts";
      `;

      assertRejects(
        async () => {
          validateImports(code, defaultPolicy);
        },
        SafeShellError,
        // Should catch first violation (npm:lodash)
      );
    });
  });

  describe("generateImportMap", () => {
    it("should generate import map file", async () => {
      const importMapPath = await generateImportMap(defaultPolicy);

      // Should return a path
      assertEquals(typeof importMapPath, "string");
      assertEquals(importMapPath.endsWith("import-map.json"), true);

      // Should be a valid file
      const stat = await Deno.stat(importMapPath);
      assertEquals(stat.isFile, true);

      // Should contain valid JSON
      const content = await Deno.readTextFile(importMapPath);
      const importMap = JSON.parse(content);
      assertEquals(typeof importMap, "object");
      assertEquals(typeof importMap.imports, "object");
    });

    it("should generate valid import map structure", async () => {
      const importMapPath = await generateImportMap(defaultPolicy);
      const content = await Deno.readTextFile(importMapPath);
      const importMap = JSON.parse(content);

      // Should have imports field
      assertEquals(typeof importMap.imports, "object");

      // Import map should be valid JSON
      assertEquals(importMap.imports !== null, true);
    });
  });

  describe("Integration with executor", () => {
    // These tests require the full executor setup
    // They verify end-to-end import blocking

    it("should block npm imports at execution time", async () => {
      const { executeCode } = await import("../src/runtime/executor.ts");
      const { DEFAULT_CONFIG } = await import("../src/core/config.ts");

      const code = `
        import lodash from "npm:lodash";
        console.log("Should not reach here");
      `;

      await assertRejects(
        async () => {
          await executeCode(code, DEFAULT_CONFIG);
        },
        SafeShellError,
        "npm:lodash",
      );
    });

    it("should allow jsr:@std/* imports", async () => {
      const { executeCode } = await import("../src/runtime/executor.ts");
      const { DEFAULT_CONFIG } = await import("../src/core/config.ts");

      const code = `
        const { join } = await import("jsr:@std/path");
        console.log(join("a", "b"));
      `;

      const result = await executeCode(code, DEFAULT_CONFIG);
      if (!result.success) {
        console.error("STDOUT:", result.stdout);
        console.error("STDERR:", result.stderr);
        console.error("CODE:", result.code);
      }
      assertEquals(result.success, true);
      assertEquals(result.stdout.trim(), "a/b");
    });

    it("should allow local imports", async () => {
      const { executeCode } = await import("../src/runtime/executor.ts");
      const { DEFAULT_CONFIG } = await import("../src/core/config.ts");

      const code = `
        const message = "Hello from local code";
        console.log(message);
      `;

      const result = await executeCode(code, DEFAULT_CONFIG);
      assertEquals(result.success, true);
      assertEquals(result.stdout.trim(), "Hello from local code");
    });

    it("should respect custom allowed list", async () => {
      const { executeCode } = await import("../src/runtime/executor.ts");
      const { DEFAULT_CONFIG, mergeConfigs } = await import(
        "../src/core/config.ts"
      );

      const customConfig = mergeConfigs(DEFAULT_CONFIG, {
        imports: {
          trusted: ["jsr:@std/*"],
          allowed: ["npm:lodash"],
          blocked: ["npm:*", "http:*", "https:*"],
        },
      });

      const code = `
        const lodash = await import("npm:lodash");
        console.log("lodash allowed");
      `;

      const result = await executeCode(code, customConfig);
      assertEquals(result.success, true);
    });
  });
});
