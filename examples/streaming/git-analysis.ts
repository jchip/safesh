#!/usr/bin/env -S deno run --allow-run --allow-env

/**
 * Git Analysis Example
 *
 * Demonstrates command execution and processing git output.
 */

import { git } from "safesh:command";
import { lines, grep, map } from "safesh:transforms";

console.log("=== Git Repository Analysis ===\n");

// Get commit messages with "fix"
console.log("Recent fix commits:");

const fixes = await git("log", "--oneline", "-20")
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix/i))
  .pipe(map((line) => {
    const [hash, ...message] = line.split(" ");
    return { hash, message: message.join(" ") };
  }))
  .collect();

fixes.forEach((commit) => {
  console.log(`  ${commit.hash} - ${commit.message}`);
});

console.log(`\nFound ${fixes.length} fix commits in last 20 commits`);

// Get repository status
console.log("\n=== Repository Status ===\n");

const status = await git("status", "--short").exec();

if (status.stdout.trim()) {
  console.log("Modified files:");
  status.stdout.split("\n").forEach((line) => {
    if (line.trim()) {
      console.log(`  ${line}`);
    }
  });
} else {
  console.log("✓ Working directory clean");
}

// Get branch information
const branch = await git("branch", "--show-current").exec();
console.log(`\nCurrent branch: ${branch.stdout.trim()}`);
