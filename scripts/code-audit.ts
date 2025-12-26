#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/**
 * Code Audit Script
 *
 * Uses streaming shell to audit the codebase for common issues
 */

import { glob, cat } from "safesh:fs-streams";
import { lines, grep, map, filter, flatMap, take } from "safesh:transforms";
import { git } from "safesh:command";

console.log("🔍 SafeShell Code Audit\n");
console.log("=" .repeat(60));

// 1. Find console.log statements (potential debug code)
console.log("\n📝 Finding debug statements...");
const debugStatements = await glob("src/**/*.ts")
  .pipe(
    flatMap((file) =>
      cat(file.path)
        .pipe(lines())
        .pipe(grep(/console\.(log|debug|warn)/))
        .pipe(filter((line) => !line.trim().startsWith("//")))
        .pipe(map((line) => ({
          file: file.path.replace(Deno.cwd() + "/", ""),
          code: line.trim()
        })))
    )
  )
  .pipe(take(10))
  .collect();

if (debugStatements.length > 0) {
  console.log(`   Found ${debugStatements.length} potential debug statements:`);
  debugStatements.slice(0, 5).forEach(stmt => {
    console.log(`   - ${stmt.file}: ${stmt.code.substring(0, 60)}`);
  });
} else {
  console.log("   ✓ No debug statements found");
}

// 2. Find TODO comments
console.log("\n📋 Finding TODO comments...");
const todos = await glob("src/**/*.ts")
  .pipe(
    flatMap((file) =>
      cat(file.path)
        .pipe(lines())
        .pipe(grep(/\/\/.*TODO/i))
        .pipe(map((line) => ({
          file: file.path.replace(Deno.cwd() + "/", ""),
          todo: line.trim()
        })))
    )
  )
  .collect();

if (todos.length > 0) {
  console.log(`   Found ${todos.length} TODO comments:`);
  todos.slice(0, 5).forEach(todo => {
    console.log(`   - ${todo.file}: ${todo.todo.substring(0, 60)}`);
  });
  if (todos.length > 5) {
    console.log(`   ... and ${todos.length - 5} more`);
  }
} else {
  console.log("   ✓ No TODO comments found");
}

// 3. Check for files without tests
console.log("\n🧪 Checking test coverage...");
const sourceFiles = await glob("src/**/*.ts")
  .pipe(filter(f => !f.path.includes(".test.") && !f.path.includes("/test/")))
  .pipe(map(f => ({
    path: f.path,
    name: f.path.split("/").pop()?.replace(".ts", "") ?? ""
  })))
  .collect();

const testFiles = await glob("src/**/*.test.ts")
  .pipe(map(f => f.path.split("/").pop()?.replace(".test.ts", "") ?? ""))
  .collect();

const testFileSet = new Set(testFiles);
const untested = sourceFiles.filter(f => !testFileSet.has(f.name));

console.log(`   Source files: ${sourceFiles.length}`);
console.log(`   Test files: ${testFiles.length}`);
if (untested.length > 0) {
  console.log(`   Files without tests: ${untested.length}`);
  untested.slice(0, 3).forEach(file => {
    console.log(`   - ${file.path.replace(Deno.cwd() + "/", "")}`);
  });
}

// 4. Find long files (potential refactoring candidates)
console.log("\n📏 Finding long files (>500 lines)...");
const longFiles = await glob("src/**/*.ts")
  .pipe(
    map(async (file) => ({
      path: file.path.replace(Deno.cwd() + "/", ""),
      lines: typeof file.contents === "string"
        ? file.contents.split("\n").length
        : 0
    }))
  )
  .pipe(filter(f => f.lines > 500))
  .collect();

longFiles.sort((a, b) => b.lines - a.lines);

if (longFiles.length > 0) {
  console.log(`   Found ${longFiles.length} files over 500 lines:`);
  longFiles.slice(0, 5).forEach(file => {
    console.log(`   - ${file.path}: ${file.lines} lines`);
  });
} else {
  console.log("   ✓ All files under 500 lines");
}

// 5. Check git status
console.log("\n📦 Git status...");
const status = await git("status", "--short").exec();

if (status.stdout.trim()) {
  const files = status.stdout.split("\n").filter(l => l.trim());
  console.log(`   Modified files: ${files.length}`);
  files.slice(0, 5).forEach(file => {
    console.log(`   ${file}`);
  });
} else {
  console.log("   ✓ Working directory clean");
}

// 6. Recent activity
console.log("\n⏰ Recent activity...");
const recentCommits = await git("log", "--oneline", "-5")
  .stdout()
  .pipe(lines())
  .collect();

recentCommits.forEach(commit => {
  console.log(`   ${commit}`);
});

// 7. Check for common anti-patterns
console.log("\n⚠️  Checking for anti-patterns...");

// Find any/unknown types
const anyTypes = await glob("src/**/*.ts")
  .pipe(
    flatMap((file) =>
      cat(file.path)
        .pipe(lines())
        .pipe(grep(/:\s*any|:\s*unknown/))
        .pipe(filter(line => !line.includes("//") && !line.includes("@ts-")))
        .pipe(map(() => file.path.replace(Deno.cwd() + "/", "")))
    )
  )
  .pipe(take(10))
  .collect();

if (anyTypes.length > 0) {
  const uniqueFiles = new Set(anyTypes);
  console.log(`   Found 'any' or 'unknown' types in ${uniqueFiles.size} files`);
} else {
  console.log("   ✓ No 'any' or 'unknown' types found");
}

// 8. Summary
console.log("\n" + "=".repeat(60));
console.log("📊 Audit Summary:");
console.log(`   • Debug statements: ${debugStatements.length}`);
console.log(`   • TODO comments: ${todos.length}`);
console.log(`   • Untested files: ${untested.length}`);
console.log(`   • Long files (>500 lines): ${longFiles.length}`);
console.log(`   • Files with 'any' types: ${new Set(anyTypes).size}`);
console.log("=".repeat(60));

console.log("\n✓ Audit complete!");
