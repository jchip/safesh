/**
 * Unit tests for TypeScript/Hybrid Command Detection
 *
 * SSH-480: Tests for the SafeShell signature prefix path (direct TypeScript execution)
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  detectHybridCommand,
  detectTypeScript,
  SAFESH_SIGNATURE,
} from "./detection.ts";

describe("detection", () => {
  describe("SAFESH_SIGNATURE", () => {
    it("is defined as /*#*/", () => {
      assertEquals(SAFESH_SIGNATURE, "/*#*/");
    });
  });

  describe("detectTypeScript", () => {
    it("detects /*#*/ prefix with code", () => {
      const result = detectTypeScript('/*#*/ console.log("hello")');

      assertEquals(result, 'console.log("hello")');
    });

    it("trims whitespace from detected code", () => {
      const result = detectTypeScript("/*#*/   const x = 1;   ");

      assertEquals(result, "const x = 1;");
    });

    it("handles /*#*/ prefix with multiline code", () => {
      const code = `/*#*/ const data = await $.fs.read("file.txt");
console.log(data);`;

      const result = detectTypeScript(code);

      assertEquals(result, `const data = await $.fs.read("file.txt");
console.log(data);`);
    });

    it("returns '// empty' for /*#*/ with no code", () => {
      const result = detectTypeScript("/*#*/");

      assertEquals(result, "// empty");
    });

    it("returns '// empty' for /*#*/ with only whitespace", () => {
      const result = detectTypeScript("/*#*/   ");

      assertEquals(result, "// empty");
    });

    it("handles leading whitespace before /*#*/", () => {
      const result = detectTypeScript("  /*#*/ console.log(1)");

      assertEquals(result, "console.log(1)");
    });

    it("returns null for commands without /*#*/ prefix", () => {
      const result = detectTypeScript("echo hello");

      assertEquals(result, null);
    });

    it("returns null for commands with /*#*/ not at start", () => {
      const result = detectTypeScript('echo "/*#*/ test"');

      assertEquals(result, null);
    });

    it("detects .ts file path", () => {
      const mockReadFile = (path: string) => {
        if (path === "/path/to/script.ts") {
          return 'console.log("from file")';
        }
        return null;
      };

      const result = detectTypeScript("/path/to/script.ts", mockReadFile);

      assertEquals(result, 'console.log("from file")');
    });

    it("returns null when .ts file cannot be read", () => {
      const mockReadFile = () => null;

      const result = detectTypeScript("/nonexistent/script.ts", mockReadFile);

      assertEquals(result, null);
    });

    it("does not treat paths with spaces as .ts files", () => {
      const mockReadFile = () => "should not be called";

      const result = detectTypeScript("/path/with spaces/script.ts", mockReadFile);

      // Should return null because path contains space
      assertEquals(result, null);
    });

    it("does not treat .ts extension in the middle as .ts file", () => {
      const mockReadFile = () => "should not be called";

      const result = detectTypeScript("script.ts.bak", mockReadFile);

      assertEquals(result, null);
    });

    it("handles complex SafeShell TypeScript code", () => {
      const code = `/*#*/
const files = await $.glob("**/*.ts").map(f => f.path).collect();
for (const file of files) {
  console.log(file);
}`;

      const result = detectTypeScript(code);

      assertEquals(result?.includes("const files ="), true);
      assertEquals(result?.includes("glob"), true);
    });

    it("preserves special characters in code", () => {
      const code = '/*#*/ const regex = /\\d+/g; const str = `Hello ${"world"}`;';

      const result = detectTypeScript(code);

      assertEquals(result, 'const regex = /\\d+/g; const str = `Hello ${"world"}`;');
    });

    it("handles code with async/await", () => {
      const code = "/*#*/ const data = await $.fs.read('/etc/hosts'); console.log(data);";

      const result = detectTypeScript(code);

      assertEquals(result, "const data = await $.fs.read('/etc/hosts'); console.log(data);");
    });
  });

  describe("detectHybridCommand", () => {
    it("detects pipe from bash to TypeScript", () => {
      const result = detectHybridCommand("echo test | /*#*/ console.log(Deno.stdin);");

      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, "echo test");
      assertEquals(result!.tsPart, "console.log(Deno.stdin);");
    });

    it("handles complex bash part", () => {
      const result = detectHybridCommand(
        'git log --oneline -10 | grep "fix" | /*#*/ const lines = await $.text.lines(Deno.stdin);'
      );

      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, 'git log --oneline -10 | grep "fix"');
      assertEquals(result!.tsPart, "const lines = await $.text.lines(Deno.stdin);");
    });

    it("returns null for non-hybrid commands", () => {
      const result = detectHybridCommand("echo hello | grep world");

      assertEquals(result, null);
    });

    it("returns null when /*#*/ is not after pipe", () => {
      const result = detectHybridCommand('/*#*/ console.log("not hybrid")');

      assertEquals(result, null);
    });

    it("returns null for empty bash part", () => {
      const result = detectHybridCommand("| /*#*/ console.log(1)");

      assertEquals(result, null);
    });

    it("returns null for empty TypeScript part", () => {
      const result = detectHybridCommand("echo test | /*#*/");

      assertEquals(result, null);
    });

    it("returns null for whitespace-only TypeScript part", () => {
      const result = detectHybridCommand("echo test | /*#*/   ");

      assertEquals(result, null);
    });

    it("trims whitespace from both parts", () => {
      const result = detectHybridCommand("  echo test  | /*#*/   console.log(1)   ");

      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, "echo test");
      assertEquals(result!.tsPart, "console.log(1)");
    });

    it("handles multiline TypeScript part", () => {
      const result = detectHybridCommand(`cat file.txt | /*#*/
const lines = await $.text.lines(Deno.stdin);
console.log(lines.length);`);

      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, "cat file.txt");
      assertEquals(result!.tsPart.includes("const lines"), true);
      assertEquals(result!.tsPart.includes("console.log"), true);
    });

    it("handles | /*#*/ in quoted strings in bash part", () => {
      // The detection looks for the first occurrence of "| /*#*/"
      // This tests that it finds the right one
      const result = detectHybridCommand('echo "not | /*#*/ this" | /*#*/ console.log(1)');

      // This will detect at the first occurrence in the echo string
      // which is probably not the desired behavior, but tests current behavior
      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, 'echo "not');
    });

    it("finds first | /*#*/ occurrence", () => {
      const result = detectHybridCommand("echo a | /*#*/ code1 | /*#*/ code2");

      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, "echo a");
      assertEquals(result!.tsPart, "code1 | /*#*/ code2");
    });

    it("requires space between pipe and signature", () => {
      const result = detectHybridCommand("echo test |/*#*/ console.log(1)");

      // Without space, it shouldn't match
      assertEquals(result, null);
    });

    it("handles complex real-world example", () => {
      const result = detectHybridCommand(
        `find . -name "*.ts" -type f | /*#*/
const files = await $.text.lines(Deno.stdin);
for (const file of files) {
  const content = await $.fs.read(file);
  if (content.includes("TODO")) {
    console.log(\`Found TODO in: \${file}\`);
  }
}`
      );

      assertEquals(result !== null, true);
      assertEquals(result!.bashPart, 'find . -name "*.ts" -type f');
      assertEquals(result!.tsPart.includes("const files"), true);
      assertEquals(result!.tsPart.includes("TODO"), true);
    });
  });

  describe("integration scenarios", () => {
    it("detectTypeScript returns null for hybrid commands", () => {
      // Hybrid commands start with bash, not /*#*/
      const result = detectTypeScript("echo test | /*#*/ console.log(1)");

      assertEquals(result, null);
    });

    it("detectHybridCommand returns null for direct TypeScript", () => {
      // Direct TypeScript doesn't have a bash part before the pipe
      const result = detectHybridCommand('/*#*/ console.log("hello")');

      assertEquals(result, null);
    });

    it("both functions return null for plain bash", () => {
      const bashCmd = "ls -la | grep .ts";

      assertEquals(detectTypeScript(bashCmd), null);
      assertEquals(detectHybridCommand(bashCmd), null);
    });

    it("detect order: TypeScript first, then hybrid", () => {
      // This tests the expected detection order in bash-prehook
      const tsCmd = '/*#*/ console.log("direct ts")';
      const hybridCmd = 'echo test | /*#*/ console.log("hybrid")';
      const bashCmd = "echo hello";

      // TypeScript detection
      assertEquals(detectTypeScript(tsCmd) !== null, true);
      assertEquals(detectTypeScript(hybridCmd), null);
      assertEquals(detectTypeScript(bashCmd), null);

      // Hybrid detection
      assertEquals(detectHybridCommand(tsCmd), null);
      assertEquals(detectHybridCommand(hybridCmd) !== null, true);
      assertEquals(detectHybridCommand(bashCmd), null);
    });
  });
});
