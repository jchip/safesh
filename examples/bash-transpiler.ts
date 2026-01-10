/**
 * Example: Bash to TypeScript Transpiler
 *
 * Demonstrates how to use the bash parser and transpiler to convert
 * bash scripts into SafeShell TypeScript code.
 */

import { parse, transpile } from "../src/bash/mod.ts";

// Example bash scripts
const examples = [
  {
    name: "Simple Command",
    script: "ls -la",
  },
  {
    name: "Pipeline",
    script: "ls -la | grep .ts",
  },
  {
    name: "Logical AND",
    script: "mkdir test && cd test",
  },
  {
    name: "Logical OR",
    script: "test -f file.txt || echo 'File not found'",
  },
  {
    name: "Redirection",
    script: "echo 'hello' > output.txt",
  },
  {
    name: "Variable Assignment",
    script: "NAME=world",
  },
  {
    name: "For Loop",
    script: `for file in *.ts
do
  echo $file
done`,
  },
  {
    name: "If Statement",
    script: `if test -f file.txt
then
  cat file.txt
else
  echo "File not found"
fi`,
  },
  {
    name: "While Loop",
    script: `count=0
while test $count -lt 5
do
  echo $count
  count=$(($count + 1))
done`,
  },
];

// Process each example
for (const example of examples) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Example: ${example.name}`);
  console.log(`${"=".repeat(70)}`);
  console.log("\nBash Script:");
  console.log("```bash");
  console.log(example.script);
  console.log("```");

  try {
    // Parse the bash script
    const ast = parse(example.script);

    // Transpile to TypeScript
    const typescript = transpile(ast, {
      imports: false, // Don't include imports for cleaner output
      strict: false, // Don't include strict mode
    });

    console.log("\nGenerated TypeScript:");
    console.log("```typescript");
    console.log(typescript);
    console.log("```");
  } catch (error) {
    console.error("\nError:", error instanceof Error ? error.message : String(error));
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log("Done!");
