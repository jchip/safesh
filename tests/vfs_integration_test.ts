/**
 * VFS Integration Tests
 *
 * Tests the Virtual File System integration with SafeShell executor.
 */

import { assertEquals, assertStringIncludes, assertRejects } from "@std/assert";
import { executeCode } from "../src/runtime/executor.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

Deno.test("VFS - Basic read/write operations", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Write to VFS
    await Deno.writeTextFile("/@vfs/test.txt", "Hello VFS!");

    // Read from VFS
    const content = await Deno.readTextFile("/@vfs/test.txt");
    console.log("Content:", content);

    // Verify content
    if (content !== "Hello VFS!") {
      throw new Error("Content mismatch");
    }
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Content: Hello VFS!");
});

Deno.test("VFS - Directory operations", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Create nested directories
    await Deno.mkdir("/@vfs/data/logs", { recursive: true });

    // Write files in directory
    await Deno.writeTextFile("/@vfs/data/logs/app.log", "Log entry 1");
    await Deno.writeTextFile("/@vfs/data/logs/error.log", "Error entry 1");

    // List directory
    const entries = [];
    for await (const entry of Deno.readDir("/@vfs/data/logs")) {
      entries.push(entry.name);
    }

    console.log("Files:", entries.sort().join(", "));
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Files: app.log, error.log");
});

Deno.test("VFS - File stats", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    await Deno.writeTextFile("/@vfs/stats.txt", "Test content");

    const stat = await Deno.stat("/@vfs/stats.txt");
    console.log("Is file:", stat.isFile);
    console.log("Size:", stat.size);
    console.log("Has mtime:", !!stat.mtime);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Is file: true");
  assertStringIncludes(result.stdout, "Size: 12");
  assertStringIncludes(result.stdout, "Has mtime: true");
});

Deno.test("VFS - Preload files", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
      preload: {
        "/@vfs/config.json": JSON.stringify({ version: "1.0.0", debug: true }),
        "/@vfs/data/users.json": JSON.stringify([
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ]),
      },
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Read preloaded files
    const config = JSON.parse(await Deno.readTextFile("/@vfs/config.json"));
    const users = JSON.parse(await Deno.readTextFile("/@vfs/data/users.json"));

    console.log("Config version:", config.version);
    console.log("User count:", users.length);
    console.log("First user:", users[0].name);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Config version: 1.0.0");
  assertStringIncludes(result.stdout, "User count: 2");
  assertStringIncludes(result.stdout, "First user: Alice");
});

Deno.test("VFS - Preload directories", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
      preload: {
        "/@vfs/output": null, // Create empty directory
        "/@vfs/logs": null,
      },
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Write to preloaded directories
    await Deno.writeTextFile("/@vfs/output/result.txt", "Done!");
    await Deno.writeTextFile("/@vfs/logs/app.log", "Started");

    // Verify they exist
    const output = await Deno.stat("/@vfs/output");
    const logs = await Deno.stat("/@vfs/logs");

    console.log("Output is dir:", output.isDirectory);
    console.log("Logs is dir:", logs.isDirectory);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Output is dir: true");
  assertStringIncludes(result.stdout, "Logs is dir: true");
});

Deno.test("VFS - Custom prefix", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
      prefix: "/virtual/",
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Use custom prefix
    await Deno.writeTextFile("/virtual/test.txt", "Custom prefix!");
    const content = await Deno.readTextFile("/virtual/test.txt");

    console.log("Content:", content);
    console.log("Prefix:", $.vfs.prefix);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Content: Custom prefix!");
  assertStringIncludes(result.stdout, "Prefix: /virtual/");
});

Deno.test("VFS - Access via $.vfs API", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Write using Deno API
    await Deno.writeTextFile("/@vfs/direct.txt", "Direct write");

    // Read using VFS API
    const data = $.vfs.read("/@vfs/direct.txt");
    const content = new TextDecoder().decode(data);

    console.log("Content:", content);

    // Get VFS stats
    const stats = $.vfs.stats();
    console.log("File count:", stats.fileCount);
    console.log("Total size:", stats.totalSize);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Content: Direct write");
  assertStringIncludes(result.stdout, "File count:");
  assertStringIncludes(result.stdout, "Total size:");
});

Deno.test("VFS - Size limit enforcement", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
      maxSize: 1024, // 1KB limit
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    try {
      // Try to write 2KB of data
      const data = "x".repeat(2048);
      await Deno.writeTextFile("/@vfs/large.txt", data);
      console.log("ERROR: Should have failed");
    } catch (error) {
      console.log("Caught error:", error.message.includes("size limit"));
    }
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Caught error: true");
});

Deno.test("VFS - File limit enforcement", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
      maxFiles: 5, // Very low limit for testing
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    try {
      // Try to create more files than the limit
      // Note: root directory counts as 1 file
      for (let i = 0; i < 10; i++) {
        await Deno.writeTextFile(\`/@vfs/file\${i}.txt\`, "data");
      }
      console.log("ERROR: Should have failed");
    } catch (error) {
      console.log("Caught error:", error.message.includes("file limit"));
    }
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Caught error: true");
});

Deno.test("VFS - VFS + Real FS simultaneously", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
      preload: {
        "/@vfs/memo.txt": "This is in VFS",
      },
    },
    permissions: {
      read: ["/tmp"],
      write: ["/tmp"],
    },
  };

  const script = `
    // Write to VFS
    await Deno.writeTextFile("/@vfs/vfs-file.txt", "VFS file");

    // Write to real FS
    const tmpFile = "/tmp/safesh-test-" + Date.now() + ".txt";
    await Deno.writeTextFile(tmpFile, "Real FS file");

    // Read from both
    const vfsContent = await Deno.readTextFile("/@vfs/vfs-file.txt");
    const realContent = await Deno.readTextFile(tmpFile);

    console.log("VFS:", vfsContent);
    console.log("Real FS:", realContent);

    // Clean up real FS
    await Deno.remove(tmpFile);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "VFS: VFS file");
  assertStringIncludes(result.stdout, "Real FS: Real FS file");
});

Deno.test("VFS - Remove files", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Create and remove file
    await Deno.writeTextFile("/@vfs/temp.txt", "Temporary");
    await Deno.remove("/@vfs/temp.txt");

    // Verify file is gone
    try {
      await Deno.readTextFile("/@vfs/temp.txt");
      console.log("ERROR: File should be deleted");
    } catch (error) {
      console.log("File deleted:", error.name === "NotFound");
    }
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "File deleted: true");
});

Deno.test("VFS - Remove directories recursively", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Create directory with files
    await Deno.mkdir("/@vfs/data/logs", { recursive: true });
    await Deno.writeTextFile("/@vfs/data/logs/app.log", "Log 1");
    await Deno.writeTextFile("/@vfs/data/logs/error.log", "Log 2");

    // Remove recursively
    await Deno.remove("/@vfs/data", { recursive: true });

    // Verify directory is gone
    try {
      await Deno.stat("/@vfs/data");
      console.log("ERROR: Directory should be deleted");
    } catch (error) {
      console.log("Directory deleted:", error.name === "NotFound");
    }
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Directory deleted: true");
});

Deno.test("VFS - Sync operations", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Test sync operations
    Deno.writeTextFileSync("/@vfs/sync.txt", "Sync write");
    const content = Deno.readTextFileSync("/@vfs/sync.txt");
    const stat = Deno.statSync("/@vfs/sync.txt");

    console.log("Content:", content);
    console.log("Is file:", stat.isFile);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Content: Sync write");
  assertStringIncludes(result.stdout, "Is file: true");
});

Deno.test("VFS - Binary data", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // Write binary data
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    await Deno.writeFile("/@vfs/binary.dat", data);

    // Read binary data
    const read = await Deno.readFile("/@vfs/binary.dat");
    const text = new TextDecoder().decode(read);

    console.log("Text:", text);
    console.log("Length:", read.length);
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Text: Hello");
  assertStringIncludes(result.stdout, "Length: 5");
});

Deno.test("VFS - VFS not accessible without enabling", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: false, // Explicitly disabled
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    // $.vfs should not be available
    console.log("Has vfs:", typeof $.vfs !== "undefined");

    // /@vfs/ paths should fail (no real permission and no VFS)
    try {
      await Deno.writeTextFile("/@vfs/test.txt", "test");
      console.log("ERROR: Should have failed");
    } catch (error) {
      console.log("Failed as expected:", error.message.includes("write access"));
    }
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, true);
  assertStringIncludes(result.stdout, "Has vfs: false");
  assertStringIncludes(result.stdout, "Failed as expected: true");
});

Deno.test("VFS - Cleanup after execution", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  // First execution
  const script1 = `
    await Deno.writeTextFile("/@vfs/persist.txt", "Data 1");
    const content = await Deno.readTextFile("/@vfs/persist.txt");
    console.log("First:", content);
  `;

  const result1 = await executeCode(script1, config);
  assertEquals(result1.success, true);
  assertStringIncludes(result1.stdout, "First: Data 1");

  // Second execution - VFS should be cleared
  const script2 = `
    try {
      await Deno.readTextFile("/@vfs/persist.txt");
      console.log("ERROR: File should not persist");
    } catch (error) {
      console.log("File not found:", error.name === "NotFound");
    }
  `;

  const result2 = await executeCode(script2, config);
  assertEquals(result2.success, true);
  assertStringIncludes(result2.stdout, "File not found: true");
});

Deno.test("VFS - Error handling preserves VFS cleanup", async () => {
  const config: SafeShellConfig = {
    vfs: {
      enabled: true,
    },
    permissions: {
      read: [],
      write: [],
    },
  };

  const script = `
    await Deno.writeTextFile("/@vfs/before-error.txt", "Created");
    throw new Error("Intentional error");
  `;

  const result = await executeCode(script, config);
  assertEquals(result.success, false);
  assertStringIncludes(result.stderr, "Intentional error");

  // Verify VFS cleanup happened by running another script
  const script2 = `
    try {
      await Deno.readTextFile("/@vfs/before-error.txt");
      console.log("ERROR: VFS not cleaned up");
    } catch (error) {
      console.log("VFS cleaned up:", error.name === "NotFound");
    }
  `;

  const result2 = await executeCode(script2, config);
  assertEquals(result2.success, true);
  assertStringIncludes(result2.stdout, "VFS cleaned up: true");
});
