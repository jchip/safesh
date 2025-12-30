/**
 * Tests for File System Streams
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { glob, src, cat, dest, type File } from "./fs-streams.ts";
import { map, filter } from "./transforms.ts";
import type { SafeShellConfig } from "../core/types.ts";

// Test fixtures directory
const FIXTURES_DIR = join(Deno.cwd(), ".temp", "fs-streams-test");

/**
 * Setup test fixtures
 */
async function setupFixtures() {
  // Clean and create fixtures directory
  try {
    await Deno.remove(FIXTURES_DIR, { recursive: true });
  } catch {
    // Directory might not exist
  }
  await ensureDir(FIXTURES_DIR);

  // Create test files
  await Deno.writeTextFile(join(FIXTURES_DIR, "file1.txt"), "Hello World");
  await Deno.writeTextFile(join(FIXTURES_DIR, "file2.txt"), "Goodbye World");
  await Deno.writeTextFile(
    join(FIXTURES_DIR, "data.json"),
    JSON.stringify({ name: "test", value: 42 }),
  );

  // Create subdirectory with files
  const subDir = join(FIXTURES_DIR, "src", "app");
  await ensureDir(subDir);
  await Deno.writeTextFile(join(subDir, "index.ts"), 'console.log("Hello")');
  await Deno.writeTextFile(
    join(subDir, "utils.ts"),
    'export const add = (a, b) => a + b',
  );
  await Deno.writeTextFile(
    join(subDir, "utils.test.ts"),
    'import { add } from "./utils.ts"',
  );

  // Create another subdirectory
  const componentsDir = join(FIXTURES_DIR, "src", "components");
  await ensureDir(componentsDir);
  await Deno.writeTextFile(
    join(componentsDir, "Button.tsx"),
    'export const Button = () => <button />',
  );

  // Create log file for cat() tests
  await Deno.writeTextFile(
    join(FIXTURES_DIR, "app.log"),
    "INFO: Starting\nERROR: Failed\nWARN: Slow\nERROR: Crashed\nINFO: Done\n",
  );

  // Create binary file
  const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
  await Deno.writeFile(join(FIXTURES_DIR, "image.png"), binaryData);
}

/**
 * Cleanup test fixtures
 */
async function cleanupFixtures() {
  try {
    await Deno.remove(FIXTURES_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create test config with fixtures directory
 */
function createTestConfig(): SafeShellConfig {
  // Use realpath to handle symlinks properly
  const realFixturesDir = (() => {
    try {
      return Deno.realPathSync(FIXTURES_DIR);
    } catch {
      return FIXTURES_DIR;
    }
  })();

  return {
    permissions: {
      read: [realFixturesDir],
      write: [realFixturesDir],
    },
  };
}

Deno.test("glob() - finds files matching pattern", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const files = await glob(join(FIXTURES_DIR, "*.txt"), {
      config,
    }).collect();

    assertEquals(files.length, 2);
    assertEquals(
      files.every((f) => f.path.endsWith(".txt")),
      true,
    );
    assertEquals(
      files.every((f) => typeof f.contents === "string"),
      true,
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("glob() - recursive pattern with **", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const files = await glob(join(FIXTURES_DIR, "**/*.ts"), {
      config,
    }).collect();

    // Should find index.ts, utils.ts, utils.test.ts
    assertEquals(files.length, 3);
    assertEquals(
      files.every((f) => f.path.endsWith(".ts")),
      true,
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("glob() - with exclude patterns", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const files = await glob(join(FIXTURES_DIR, "**/*.ts"), {
      config,
      exclude: ["**/*.test.ts"],
    }).collect();

    // Should exclude utils.test.ts
    assertEquals(files.length, 2);
    assertEquals(
      files.every((f) => !f.path.includes(".test.")),
      true,
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("glob() - sets base directory correctly", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const pattern = join(FIXTURES_DIR, "src/**/*.ts");
    const files = await glob(pattern, { config }).collect();

    // Base should be FIXTURES_DIR/src
    const expectedBase = join(FIXTURES_DIR, "src");
    assertEquals(
      files.every((f) => f.base === expectedBase),
      true,
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("glob() - handles binary files", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const files = await glob(join(FIXTURES_DIR, "*.png"), {
      config,
    }).collect();

    assertEquals(files.length, 1);
    assertEquals(files[0]!.contents instanceof Uint8Array, true);
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("glob() - respects sandbox boundaries", async () => {
  await setupFixtures();
  try {
    // Config that only allows read from a subdirectory
    const restrictedConfig: SafeShellConfig = {
      permissions: {
        read: [join(FIXTURES_DIR, "src")],
        write: [],
      },
    };

    const files = await glob(join(FIXTURES_DIR, "**/*.txt"), {
      config: restrictedConfig,
      cwd: join(FIXTURES_DIR, "src"),
    }).collect();

    // Should find no files since .txt files are outside allowed directory
    assertEquals(files.length, 0);
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("src() - single pattern", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const files = await src(
      { config },
      join(FIXTURES_DIR, "*.txt"),
    ).collect();

    assertEquals(files.length, 2);
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("src() - multiple patterns", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const files = await src(
      { config },
      join(FIXTURES_DIR, "*.txt"),
      join(FIXTURES_DIR, "*.json"),
    ).collect();

    assertEquals(files.length, 3); // 2 txt + 1 json
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("src() - throws on no patterns", () => {
  assertRejects(
    async () => {
      await src({ config: createTestConfig() }).collect();
    },
    Error,
    "requires at least one pattern",
  );
});

Deno.test("cat() - reads file contents", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const contents = await cat(join(FIXTURES_DIR, "file1.txt"), {
      config,
    }).collect();

    assertEquals(contents.length, 1);
    assertEquals(contents[0], "Hello World");
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("cat() - integrates with transforms", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();

    // Import lines transform for this test
    const lines = () =>
      async function* (stream: AsyncIterable<string>) {
        for await (const text of stream) {
          for (const line of text.split("\n")) {
            if (line) yield line;
          }
        }
      };

    const logLines = await cat(join(FIXTURES_DIR, "app.log"), { config })
      .pipe(lines())
      .collect();

    assertEquals(logLines.length, 5);
    assertEquals(logLines[0], "INFO: Starting");
    assertEquals(logLines[1], "ERROR: Failed");
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("cat() - throws on sandbox violation", async () => {
  await setupFixtures();
  try {
    const restrictedConfig: SafeShellConfig = {
      permissions: {
        read: [join(FIXTURES_DIR, "src")],
        write: [],
      },
    };

    await assertRejects(
      async () => {
        await cat(join(FIXTURES_DIR, "file1.txt"), {
          config: restrictedConfig,
          cwd: join(FIXTURES_DIR, "src"),
        }).collect();
      },
      Error,
      "outside allowed directories",
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("cat() - throws on non-existent file", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();

    await assertRejects(
      async () => {
        await cat(join(FIXTURES_DIR, "nonexistent.txt"), { config }).collect();
      },
      Error,
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - writes files to directory", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "output");

    await glob(join(FIXTURES_DIR, "*.txt"), { config })
      .pipe(dest(outDir, { config }))
      .collect();

    // Verify files were written
    const written1 = await Deno.readTextFile(join(outDir, "file1.txt"));
    const written2 = await Deno.readTextFile(join(outDir, "file2.txt"));

    assertEquals(written1, "Hello World");
    assertEquals(written2, "Goodbye World");
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - preserves directory structure", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "dist");

    await glob(join(FIXTURES_DIR, "src/**/*.ts"), {
      config,
      exclude: ["**/*.test.ts"],
    })
      .pipe(dest(outDir, { config }))
      .collect();

    // Verify directory structure is preserved
    const indexPath = join(outDir, "app", "index.ts");
    const utilsPath = join(outDir, "app", "utils.ts");

    const indexContent = await Deno.readTextFile(indexPath);
    const utilsContent = await Deno.readTextFile(utilsPath);

    assertEquals(indexContent, 'console.log("Hello")');
    assertEquals(utilsContent, "export const add = (a, b) => a + b");
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - works with custom base", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "dist");
    const customBase = join(FIXTURES_DIR, "src", "app");

    await glob(join(FIXTURES_DIR, "src/app/**/*.ts"), {
      config,
      base: customBase,
      exclude: ["**/*.test.ts"],
    })
      .pipe(dest(outDir, { config }))
      .collect();

    // With custom base src/app, files should be written directly to dist
    const indexPath = join(outDir, "index.ts");
    const utilsPath = join(outDir, "utils.ts");

    const indexContent = await Deno.readTextFile(indexPath);
    const utilsContent = await Deno.readTextFile(utilsPath);

    assertEquals(indexContent, 'console.log("Hello")');
    assertEquals(utilsContent, "export const add = (a, b) => a + b");
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - transforms files before writing", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "output");

    await glob(join(FIXTURES_DIR, "*.txt"), { config })
      .pipe(
        map(async (file: File) => {
          // Transform contents to uppercase
          if (typeof file.contents === "string") {
            file.contents = file.contents.toUpperCase();
          }
          return file;
        }),
      )
      .pipe(dest(outDir, { config }))
      .collect();

    // Verify transformed content was written
    const written = await Deno.readTextFile(join(outDir, "file1.txt"));
    assertEquals(written, "HELLO WORLD");
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - handles binary files", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "output");

    await glob(join(FIXTURES_DIR, "*.png"), { config })
      .pipe(dest(outDir, { config }))
      .collect();

    // Verify binary file was copied correctly
    const original = await Deno.readFile(join(FIXTURES_DIR, "image.png"));
    const copied = await Deno.readFile(join(outDir, "image.png"));

    assertEquals(copied, original);
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - throws on sandbox violation", async () => {
  await setupFixtures();
  try {
    const restrictedConfig: SafeShellConfig = {
      permissions: {
        read: [FIXTURES_DIR],
        write: [join(FIXTURES_DIR, "src")], // Only allow writing to src
      },
    };

    await assertRejects(
      async () => {
        await glob(join(FIXTURES_DIR, "*.txt"), {
          config: restrictedConfig,
        })
          .pipe(dest(join(FIXTURES_DIR, "output"), {
            config: restrictedConfig,
          }))
          .collect();
      },
      Error,
      "outside allowed directories",
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("dest() - passes files through for chaining", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "output");

    const files = await glob(join(FIXTURES_DIR, "*.txt"), { config })
      .pipe(dest(outDir, { config }))
      .collect();

    // Files should be passed through
    assertEquals(files.length, 2);
    // Path should be updated to output location
    assertEquals(
      files.every((f) => f.path.includes("output")),
      true,
    );
  } finally {
    await cleanupFixtures();
  }
});

Deno.test("integration - full pipeline with glob, map, filter, and dest", async () => {
  await setupFixtures();
  try {
    const config = createTestConfig();
    const outDir = join(FIXTURES_DIR, "dist");

    // Complex pipeline: find TS files, exclude tests, add header, write
    await glob(join(FIXTURES_DIR, "**/*.ts"), { config })
      .pipe(
        filter((f: File) => !f.path.includes(".test.")),
      )
      .pipe(
        map(async (file: File) => {
          if (typeof file.contents === "string") {
            file.contents = "// Auto-generated\n" + file.contents;
          }
          return file;
        }),
      )
      .pipe(dest(outDir, { config }))
      .collect();

    // Verify output
    const indexContent = await Deno.readTextFile(
      join(outDir, "src", "app", "index.ts"),
    );
    assertEquals(indexContent.startsWith("// Auto-generated\n"), true);
    assertEquals(indexContent.includes('console.log("Hello")'), true);

    // Verify test file was excluded
    const testFileExists = await Deno.stat(
      join(outDir, "src", "app", "utils.test.ts"),
    ).then(() => true).catch(() => false);
    assertEquals(testFileExists, false);
  } finally {
    await cleanupFixtures();
  }
});
