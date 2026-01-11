/**
 * Virtual File System Integration Example
 *
 * Demonstrates how to use VFS with SafeShell executor.
 *
 * Run with: deno run --allow-all examples/vfs-integration.ts
 */

import { executeCode } from "../src/runtime/executor.ts";
import type { SafeShellConfig } from "../src/core/types.ts";

console.log("🚀 VFS Integration Example\n");

// Example 1: Basic VFS usage
console.log("Example 1: Basic VFS");
console.log("=".repeat(50));

const config1: SafeShellConfig = {
  vfs: {
    enabled: true,
    // Use defaults for prefix (/@vfs/), maxSize, maxFiles
  },
  permissions: {
    read: [],
    write: [],
  },
};

const script1 = `
// Write to VFS
await Deno.writeTextFile("/@vfs/hello.txt", "Hello from VFS!");

// Read from VFS
const content = await Deno.readTextFile("/@vfs/hello.txt");
console.log("VFS Content:", content);

// Check VFS stats
console.log("VFS Stats:", $.vfs.stats());
`;

const result1 = await executeCode(script1, config1);
console.log(result1.stdout);
console.log();

// Example 2: VFS with preloaded files
console.log("Example 2: VFS with Preloaded Files");
console.log("=".repeat(50));

const config2: SafeShellConfig = {
  vfs: {
    enabled: true,
    preload: {
      "/@vfs/config.json": JSON.stringify({ version: "1.0.0", debug: true }),
      "/@vfs/data/users.json": JSON.stringify([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]),
      "/@vfs/output": null, // Empty directory
    },
  },
  permissions: {
    read: [],
    write: [],
  },
};

const script2 = `
// Read preloaded config
const config = JSON.parse(await Deno.readTextFile("/@vfs/config.json"));
console.log("Config:", config);

// Read preloaded users
const users = JSON.parse(await Deno.readTextFile("/@vfs/data/users.json"));
console.log("Users:", users);

// Write to output directory
await Deno.writeTextFile("/@vfs/output/result.txt", "Processing complete!");

// List directory
const entries = [];
for await (const entry of Deno.readDir("/@vfs/output")) {
  entries.push(entry.name);
}
console.log("Output files:", entries);
`;

const result2 = await executeCode(script2, config2);
console.log(result2.stdout);
console.log();

// Example 3: VFS with custom configuration
console.log("Example 3: Custom VFS Configuration");
console.log("=".repeat(50));

const config3: SafeShellConfig = {
  vfs: {
    enabled: true,
    prefix: "/virtual/",  // Custom prefix
    maxSize: 1024 * 1024,  // 1MB limit
    maxFiles: 100,
  },
  permissions: {
    read: [],
    write: [],
  },
};

const script3 = `
// Use custom prefix
await Deno.writeTextFile("/virtual/test.txt", "Custom prefix!");
const content = await Deno.readTextFile("/virtual/test.txt");
console.log("Content:", content);
console.log("VFS Prefix:", $.vfs.prefix);
`;

const result3 = await executeCode(script3, config3);
console.log(result3.stdout);
console.log();

// Example 4: VFS + Real FS simultaneously
console.log("Example 4: VFS + Real FS Simultaneously");
console.log("=".repeat(50));

const config4: SafeShellConfig = {
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

const script4 = `
// Write to VFS
await Deno.writeTextFile("/@vfs/vfs-file.txt", "VFS file");

// Write to real FS
await Deno.writeTextFile("/tmp/real-file.txt", "Real FS file");

// Read from both
const vfsContent = await Deno.readTextFile("/@vfs/vfs-file.txt");
const realContent = await Deno.readTextFile("/tmp/real-file.txt");

console.log("VFS:", vfsContent);
console.log("Real FS:", realContent);

// Clean up real FS
await Deno.remove("/tmp/real-file.txt");
`;

const result4 = await executeCode(script4, config4);
console.log(result4.stdout);
console.log();

console.log("✅ All examples completed successfully!");
