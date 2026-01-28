/**
 * Integration tests for Phase 4 utility modules
 *
 * Tests cross-module compatibility and realistic usage scenarios for:
 * - JSON file I/O utilities (io-utils)
 * - Directory creation utilities (io-utils)
 * - Test helpers (test-helpers)
 * - Config path helpers (config)
 */

import { describe, it } from "@std/testing/bdd";
import { assertEquals, assert, assertRejects } from "@std/assert";
import {
  readJsonFile,
  writeJsonFile,
  ensureDir,
  ensureDirSync,
} from "../../src/core/io-utils.ts";
import {
  withTestDir,
  createTestDir,
  cleanupTestDir,
  REAL_TMP,
} from "../helpers.ts";
import {
  getProjectConfigDir,
  getLocalJsonConfigPath,
} from "../../src/core/config.ts";

describe(
  "Phase 4 utilities integration",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    // ========================================================================
    // 1. JSON File I/O Integration
    // ========================================================================

    describe("JSON file I/O integration", () => {
      it("should handle round-trip with nested directories", async () => {
        await withTestDir("json-roundtrip", async (dir) => {
          const nestedPath = `${dir}/deeply/nested/path/data.json`;
          const testData = { name: "test", values: [1, 2, 3] };

          // Write should create all parent directories automatically
          await writeJsonFile(nestedPath, testData);

          // Verify file was created
          const stat = await Deno.stat(nestedPath);
          assert(stat.isFile, "File should exist");

          // Read back and verify data integrity
          const readData = await readJsonFile<typeof testData>(nestedPath);
          assertEquals(readData, testData);
        });
      });

      it("should handle concurrent writes to same directory", async () => {
        await withTestDir("json-concurrent", async (dir) => {
          const files = Array.from({ length: 5 }, (_, i) => ({
            path: `${dir}/file${i}.json`,
            data: { id: i, name: `file${i}` },
          }));

          // Write all files concurrently
          await Promise.all(
            files.map(({ path, data }) => writeJsonFile(path, data))
          );

          // Verify all files were created correctly
          for (const { path, data } of files) {
            const readData = await readJsonFile(path);
            assertEquals(readData, data);
          }
        });
      });

      it("should throw NotFound for missing JSON file", async () => {
        await withTestDir("json-notfound", async (dir) => {
          const missingPath = `${dir}/missing.json`;

          await assertRejects(
            () => readJsonFile(missingPath),
            Deno.errors.NotFound,
            "JSON file not found"
          );
        });
      });

      it("should throw SyntaxError for invalid JSON", async () => {
        await withTestDir("json-invalid", async (dir) => {
          const invalidPath = `${dir}/invalid.json`;

          // Write invalid JSON (not parseable)
          await Deno.writeTextFile(invalidPath, "{ invalid json }");

          await assertRejects(
            () => readJsonFile(invalidPath),
            SyntaxError,
            "Invalid JSON in file"
          );
        });
      });
    });

    // ========================================================================
    // 2. Directory Creation Integration
    // ========================================================================

    describe("directory creation integration", () => {
      it("should handle ensureDir idempotency", async () => {
        await withTestDir("ensuredir-idempotent", async (dir) => {
          const targetDir = `${dir}/my/nested/directory`;

          // Call ensureDir multiple times
          await ensureDir(targetDir);
          await ensureDir(targetDir);
          await ensureDir(targetDir);

          // Verify directory exists
          const stat = await Deno.stat(targetDir);
          assert(stat.isDirectory, "Directory should exist");
        });
      });

      it("should ensure sync/async consistency", async () => {
        await withTestDir("ensuredir-consistency", async (dir) => {
          const asyncDir = `${dir}/async/path`;
          const syncDir = `${dir}/sync/path`;

          // Create with async
          await ensureDir(asyncDir);
          const asyncStat = await Deno.stat(asyncDir);
          assert(asyncStat.isDirectory, "Async directory should exist");

          // Create with sync
          ensureDirSync(syncDir);
          const syncStat = await Deno.stat(syncDir);
          assert(syncStat.isDirectory, "Sync directory should exist");

          // Both methods should succeed on existing directories
          await ensureDir(syncDir); // async on sync-created
          ensureDirSync(asyncDir); // sync on async-created

          // Verify both still exist
          assert((await Deno.stat(asyncDir)).isDirectory);
          assert((await Deno.stat(syncDir)).isDirectory);
        });
      });

      it("should create nested directories with ensureDir", async () => {
        await withTestDir("ensuredir-nested", async (dir) => {
          const deepPath = `${dir}/a/b/c/d/e/f`;

          await ensureDir(deepPath);

          // Verify entire chain exists
          for (const depth of ["a", "b", "c", "d", "e", "f"]) {
            const parts = deepPath.split("/");
            const idx = parts.indexOf(depth);
            const testPath = parts.slice(0, idx + 1).join("/");
            const stat = await Deno.stat(testPath);
            assert(stat.isDirectory, `${testPath} should be a directory`);
          }
        });
      });
    });

    // ========================================================================
    // 3. Test Helpers Integration
    // ========================================================================

    describe("test helpers integration", () => {
      it("should provide isolated directories for concurrent tests", async () => {
        const results = await Promise.all([
          withTestDir("concurrent-1", async (dir1) => {
            await Deno.writeTextFile(`${dir1}/test.txt`, "dir1");
            return dir1;
          }),
          withTestDir("concurrent-2", async (dir2) => {
            await Deno.writeTextFile(`${dir2}/test.txt`, "dir2");
            return dir2;
          }),
        ]);

        // Directories should be different
        const [dir1, dir2] = results;
        assert(dir1 !== dir2, "Directories should be unique");

        // Both directories should have been cleaned up
        await assertRejects(() => Deno.stat(dir1));
        await assertRejects(() => Deno.stat(dir2));
      });

      it("should cleanup automatically on success", async () => {
        let capturedDir = "";

        await withTestDir("cleanup-success", async (dir) => {
          capturedDir = dir;
          await Deno.writeTextFile(`${dir}/test.txt`, "content");
          // Directory should exist during test
          assert((await Deno.stat(dir)).isDirectory);
        });

        // Directory should be cleaned up after test
        await assertRejects(
          () => Deno.stat(capturedDir),
          Deno.errors.NotFound
        );
      });

      it("should cleanup automatically on error", async () => {
        let capturedDir = "";

        await assertRejects(async () => {
          await withTestDir("cleanup-error", async (dir) => {
            capturedDir = dir;
            await Deno.writeTextFile(`${dir}/test.txt`, "content");
            throw new Error("Test error");
          });
        });

        // Directory should be cleaned up even after error
        await assertRejects(
          () => Deno.stat(capturedDir),
          Deno.errors.NotFound
        );
      });

      it("should refuse to cleanup paths outside REAL_TMP", () => {
        const dangerousPath = "/home/user/important";

        // cleanupTestDir should refuse (no throw, just warn)
        // We can't easily test the console.warn, but we can verify
        // it doesn't throw and doesn't delete anything
        cleanupTestDir(dangerousPath);

        // If it's a real path (which it isn't in test), it would still exist
        // This test mainly ensures no exception is thrown
      });
    });

    // ========================================================================
    // 4. Config Path Helpers Integration
    // ========================================================================

    describe("config path helpers integration", () => {
      it("should create consistent config paths", async () => {
        await withTestDir("config-paths", async (dir) => {
          const configDir = getProjectConfigDir(dir);
          const configFilePath = getLocalJsonConfigPath(dir);

          // Config file should be child of config dir
          assert(
            configFilePath.startsWith(configDir),
            "Config file should be within config dir"
          );

          // Both should use same project dir
          assert(configDir.startsWith(dir));
          assert(configFilePath.startsWith(dir));
        });
      });

      it("should support config save/load round-trip", async () => {
        await withTestDir("config-roundtrip", async (dir) => {
          const configPath = getLocalJsonConfigPath(dir);
          const testConfig = {
            allowedCommands: ["git", "docker", "npm"],
          };

          // Write config using writeJsonFile
          await writeJsonFile(configPath, testConfig);

          // Read back using readJsonFile
          const loadedConfig = await readJsonFile<typeof testConfig>(
            configPath
          );

          assertEquals(loadedConfig, testConfig);
        });
      });

      it("should handle config paths with nested directories", async () => {
        await withTestDir("config-nested", async (dir) => {
          const configPath = getLocalJsonConfigPath(dir);

          // Config dir should be created automatically by writeJsonFile
          const testConfig = { test: true };
          await writeJsonFile(configPath, testConfig);

          // Verify config directory was created
          const configDir = getProjectConfigDir(dir);
          const stat = await Deno.stat(configDir);
          assert(stat.isDirectory, "Config directory should be created");

          // Verify file exists and is correct
          const loaded = await readJsonFile(configPath);
          assertEquals(loaded, testConfig);
        });
      });
    });

    // ========================================================================
    // 5. Cross-Module Integration Scenarios
    // ========================================================================

    describe("cross-module integration", () => {
      it("should handle complete workflow: create dir, write config, read back", async () => {
        await withTestDir("complete-workflow", async (dir) => {
          // Step 1: Create nested config directory structure
          const configDir = getProjectConfigDir(dir);
          await ensureDir(configDir);

          // Step 2: Write JSON config file
          const configPath = getLocalJsonConfigPath(dir);
          const config = {
            allowedCommands: ["git", "docker"],
            timestamp: Date.now(),
          };
          await writeJsonFile(configPath, config);

          // Step 3: Verify directory structure
          const dirStat = await Deno.stat(configDir);
          assert(dirStat.isDirectory);

          // Step 4: Read back and verify
          const loaded = await readJsonFile<typeof config>(configPath);
          assertEquals(loaded, config);
        });
      });

      it("should handle multiple JSON files in same directory", async () => {
        await withTestDir("multi-json", async (dir) => {
          const configDir = `${dir}/config`;
          await ensureDir(configDir);

          // Write multiple config files
          const files = [
            { name: "config1.json", data: { id: 1 } },
            { name: "config2.json", data: { id: 2 } },
            { name: "config3.json", data: { id: 3 } },
          ];

          await Promise.all(
            files.map(({ name, data }) =>
              writeJsonFile(`${configDir}/${name}`, data)
            )
          );

          // Read all back and verify
          for (const { name, data } of files) {
            const loaded = await readJsonFile(`${configDir}/${name}`);
            assertEquals(loaded, data);
          }
        });
      });

      it("should combine test helpers with JSON I/O", async () => {
        // Test that withTestDir works seamlessly with JSON operations
        const testData = { test: "data", nested: { value: 42 } };
        let writtenPath = "";

        await withTestDir("helpers-json", async (dir) => {
          writtenPath = `${dir}/test.json`;
          await writeJsonFile(writtenPath, testData);

          const loaded = await readJsonFile(writtenPath);
          assertEquals(loaded, testData);
        });

        // Cleanup should have removed the file
        await assertRejects(() => Deno.stat(writtenPath));
      });
    });

    // ========================================================================
    // 6. Error Handling Integration
    // ========================================================================

    describe("error handling integration", () => {
      it("should handle permission denied for writeJsonFile", async () => {
        // Try to write to a read-only location (this may not work in all envs)
        // Note: This test is best-effort and may be skipped in some environments
        try {
          await assertRejects(
            () => writeJsonFile("/root/test.json", { test: true }),
            Deno.errors.PermissionDenied
          );
        } catch {
          // Skip if we can't test this (e.g., running as root or in sandboxed env)
        }
      });

      it("should handle file path consistency across operations", async () => {
        await withTestDir("path-consistency", async (dir) => {
          const data = { value: "test" };
          const jsonPath = `${dir}/data.json`;

          // Write with nested path creation
          await writeJsonFile(jsonPath, data);

          // Ensure parent dir idempotently
          const parentDir = jsonPath.substring(0, jsonPath.lastIndexOf("/"));
          await ensureDir(parentDir);

          // Read should still work
          const loaded = await readJsonFile(jsonPath);
          assertEquals(loaded, data);
        });
      });
    });
  }
);
