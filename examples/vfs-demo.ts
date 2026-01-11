/**
 * Virtual File System Demo
 *
 * Demonstrates usage of SafeShell's VFS for in-memory filesystem operations.
 * Run with: deno run --allow-all examples/vfs-demo.ts
 */

import { VirtualFileSystem, setupVFS } from "../src/vfs/mod.ts";

console.log("🚀 Virtual File System Demo\n");

// Create VFS with custom configuration
const vfs = new VirtualFileSystem({
  prefix: "/@vfs/",
  maxSize: 10 * 1024 * 1024, // 10MB limit
  maxFiles: 100, // Max 100 files
});

console.log("📊 Initial VFS Stats:");
console.log(vfs.stats());
console.log();

// Setup VFS interception (routes /@vfs/* paths to VFS)
const restore = setupVFS(vfs);

try {
  console.log("✍️  Writing files to VFS...");

  // Write text files
  await Deno.writeTextFile("/@vfs/config.json", JSON.stringify({
    app: "SafeShell",
    version: "1.0.0",
    features: ["VFS", "Sandboxing", "Security"],
  }, null, 2));

  await Deno.writeTextFile("/@vfs/README.md", `# Virtual File System

This file exists only in memory!

## Features
- In-memory storage
- Deno API compatible
- Configurable limits
- Path isolation
`);

  // Create nested directories and files
  await Deno.mkdir("/@vfs/data/logs", { recursive: true });
  await Deno.writeTextFile("/@vfs/data/logs/app.log", "[INFO] Application started\n");
  await Deno.writeTextFile("/@vfs/data/logs/error.log", "[ERROR] Example error\n");

  console.log("✅ Files written successfully\n");

  // Read files back
  console.log("📖 Reading files from VFS...");

  const config = await Deno.readTextFile("/@vfs/config.json");
  console.log("Config:", config);
  console.log();

  const readme = await Deno.readTextFile("/@vfs/README.md");
  console.log("README:", readme);
  console.log();

  // List directory contents
  console.log("📁 Directory listing of /@vfs/data/logs/:");
  for await (const entry of Deno.readDir("/@vfs/data/logs")) {
    console.log(`  - ${entry.name} (${entry.isFile ? "file" : "dir"})`);
  }
  console.log();

  // Get file stats
  const stat = await Deno.stat("/@vfs/config.json");
  console.log("📊 File stats for config.json:");
  console.log(`  Size: ${stat.size} bytes`);
  console.log(`  Created: ${stat.birthtime?.toISOString()}`);
  console.log(`  Modified: ${stat.mtime?.toISOString()}`);
  console.log();

  // Show VFS stats
  console.log("📊 VFS Stats after operations:");
  console.log(vfs.stats());
  console.log();

  // Demonstrate VFS interception
  console.log("🔍 VFS Interception Active:");
  console.log("  /@vfs/config.json in VFS (direct check):", vfs.exists("/@vfs/config.json"));

  // When VFS is active, Deno.stat routes to VFS for /@vfs/* paths
  const vfsCheck = await Deno.stat("/@vfs/config.json");
  console.log("  Deno.stat('/@vfs/config.json') works:", vfsCheck.isFile, "✅");
  console.log("  (Intercepted by VFS, not touching real filesystem)");
  console.log();

  // Clean up VFS
  console.log("🧹 Cleaning up VFS...");
  vfs.clear();

  console.log("📊 VFS Stats after cleanup:");
  console.log(vfs.stats());
  console.log();

  console.log("✅ Demo completed successfully!");
} catch (error) {
  console.error("❌ Error:", error);
} finally {
  // Restore original Deno APIs
  restore();
  console.log("\n🔄 Original Deno APIs restored");
}
