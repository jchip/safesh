#!/usr/bin/env -S deno run --allow-read

/**
 * Log File Analysis Example
 *
 * Demonstrates how to analyze log files using the streaming shell API.
 */

import { cat } from "safesh:fs-streams";
import { lines, grep, map } from "safesh:transforms";
import { stdout } from "safesh:io";

// Process log file and extract errors
console.log("=== Analyzing app.log for errors ===\n");

const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(map((line) => {
    // Extract timestamp and message
    const match = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] ERROR: (.+)/);
    return match ? { time: match[1], message: match[2] } : { time: "unknown", message: line };
  }))
  .collect();

console.log(`Found ${errors.length} errors:\n`);

errors.forEach((error, index) => {
  console.log(`${index + 1}. [${error.time}] ${error.message}`);
});

// Count errors by category
console.log("\n=== Error Categories ===\n");

const categories = new Map<string, number>();

errors.forEach((error) => {
  const category = error.message?.split(":")[0] ?? "unknown";
  categories.set(category, (categories.get(category) ?? 0) + 1);
});

for (const [category, count] of categories.entries()) {
  console.log(`${category}: ${count}`);
}
