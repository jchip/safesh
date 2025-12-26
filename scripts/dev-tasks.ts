#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/**
 * Development Tasks using Streaming Shell
 *
 * Replaces common bash commands with streaming shell API
 */

import { glob, cat, src, dest } from "safesh:fs-streams";
import { lines, grep, map, filter, flatMap } from "safesh:transforms";
import { git, cmd } from "safesh:command";
import { fromArray } from "safesh:stream";

// Instead of: git log --oneline | grep "SSH-" | head -5
console.log("🔍 Find recent SSH commits:");
const sshCommits = await git("log", "--oneline", "--all")
  .stdout()
  .pipe(lines())
  .pipe(grep(/SSH-/))
  .pipe(map(line => {
    const [hash, ...msg] = line.split(" ");
    return `${hash}: ${msg.join(" ")}`;
  }))
  .collect();

console.log(`Found ${sshCommits.length} SSH commits\n`);

// Instead of: find src -name "*.ts" -not -path "*/test/*" | wc -l
console.log("📁 Count production TypeScript files:");
const prodFiles = await glob("src/**/*.ts")
  .pipe(filter(f => !f.path.includes("test") && !f.path.includes(".test.")))
  .count();

console.log(`${prodFiles} production files\n`);

// Instead of: grep -r "TODO" src/**/*.ts
console.log("📝 Extract all TODO comments:");
const todoItems = await glob("src/**/*.ts")
  .pipe(
    flatMap(file =>
      cat(file.path)
        .pipe(lines())
        .pipe(grep(/TODO:/))
        .pipe(map(line => ({
          file: file.path.split("/").pop(),
          task: line.trim().replace(/.*TODO:\s*/, "")
        })))
    )
  )
  .collect();

console.log(`Found ${todoItems.length} TODOs`);
todoItems.slice(0, 3).forEach(item => {
  console.log(`  • ${item.file}: ${item.task}`);
});
console.log("");

// Instead of: cat file.log | grep ERROR | sed 's/ERROR: //' > errors.txt
console.log("🔧 Process log file (simulate):");

// Create sample log
await Deno.writeTextFile(".temp/sample.log",
  "INFO: Started\nERROR: Connection failed\nWARN: Slow\nERROR: Timeout\n"
);

const errors = await cat(".temp/sample.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(map(line => line.replace("ERROR: ", "")))
  .collect();

await Deno.writeTextFile(".temp/errors.txt", errors.join("\n"));
console.log(`Extracted ${errors.length} errors to .temp/errors.txt\n`);

// Instead of: cp src/**/*.ts dist/ (with transforms)
console.log("📦 Copy and transform files:");
const copied = await src("src/stdlib/stream.ts", "src/stdlib/transforms.ts")
  .pipe(map(async file => {
    // Add banner
    if (typeof file.contents === "string") {
      file.contents = `// Processed by streaming shell\n${file.contents}`;
    }
    return file;
  }))
  .pipe(dest(".temp/processed"))
  .count();

console.log(`Processed and copied ${copied} files\n`);

// Instead of: git diff --name-only
console.log("📊 Check repository status:");
const statusResult = await git("status", "--short").exec();
const modifiedCount = statusResult.stdout
  .split("\n")
  .filter(line => line.trim()).length;

console.log(`Modified files: ${modifiedCount}\n`);

// Instead of: for f in *.ts; do echo "$f: $(wc -l $f)"; done
console.log("📏 File sizes in stdlib:");
const fileSizes = await glob("src/stdlib/*.ts")
  .pipe(filter(f => !f.path.includes(".test.")))
  .pipe(map(file => ({
    name: file.path.split("/").pop(),
    lines: typeof file.contents === "string"
      ? file.contents.split("\n").length
      : 0
  })))
  .pipe(filter(f => f.lines > 0))
  .collect();

fileSizes
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 5)
  .forEach(f => {
    console.log(`  ${f.name?.padEnd(20)} ${f.lines} lines`);
  });

console.log("\n✅ All tasks completed using streaming shell API!");
console.log("\nNo bash commands used - pure TypeScript streaming! 🎉");
