#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * File Processing Example
 *
 * Demonstrates how to process multiple files using glob and transforms.
 */

import { src, dest } from "safesh:fs-streams";
import { filter, map } from "safesh:transforms";

console.log("=== Processing TypeScript Files ===\n");

// Find all TypeScript files, exclude tests, and copy to dist
const processed = await src("src/**/*.ts", "lib/**/*.ts")
  .pipe(filter((file) => {
    const isTest = file.path.includes(".test.") || file.path.includes("test/");
    return !isTest;
  }))
  .pipe(map(async (file) => {
    // Add header comment to each file
    if (typeof file.contents === "string") {
      const header = `/**
 * Auto-generated from ${file.path}
 * Generated at: ${new Date().toISOString()}
 */

`;
      file.contents = header + file.contents;
    }
    return file;
  }))
  .pipe(dest("dist/"))
  .collect();

console.log(`Processed ${processed.length} files:\n`);

processed.forEach((file, index) => {
  const relativePath = file.path.replace(Deno.cwd() + "/", "");
  console.log(`${index + 1}. ${relativePath}`);
});

console.log("\n✓ Files written to dist/");
