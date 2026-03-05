import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { parse, transpile } from "../../src/bash/mod.ts";

describe("SSH-572: IIFE syntax in && chains", () => {
  it("should transpile a command sequence ending in for loop without syntax error", () => {
    const command = "cd dir && for i in 1 2; do echo $i; done";
    const ast = parse(command);
    const tsCode = transpile(ast, { imports: false, strict: false });
    
    // The generated code should NOT have (async () => { ... })() used as a statement
    // without being awaited or returned.
    const lines = tsCode.split("\n");
    for (const line of lines) {
      if (line.includes("})();") && !line.includes("await") && !line.includes("return") && line.trim() !== "})();") {
        throw new Error(`Found un-awaited IIFE statement: ${line}`);
      }
    }
  });

  it("should handle mixed sequence with subshells and loops", () => {
    const command = "echo start && (echo sub) && for i in 1; do echo $i; done && echo end";
    const ast = parse(command);
    const tsCode = transpile(ast, { imports: false, strict: false });
    
    const lines = tsCode.split("\n");
    for (const line of lines) {
      if (line.includes("})();") && !line.includes("await") && !line.includes("return") && line.trim() !== "})();") {
        throw new Error(`Found un-awaited IIFE statement: ${line}`);
      }
    }
  });

  it("should handle the exact user reported command", () => {
    const command = "cd /Users/jc/dev/termcow/mobile/assets/pro/fonts && mkdir -p _tmp && cd _tmp && for font in FiraCode SourceCodePro Hack Inconsolata IBMPlexMono CascadiaCode; do echo $font; done";
    const ast = parse(command);
    const tsCode = transpile(ast, { imports: false, strict: false });
    
    const lines = tsCode.split("\n");
    for (const line of lines) {
      if (line.includes("})();") && !line.includes("await") && !line.includes("return") && line.trim() !== "})();") {
        throw new Error(`Found un-awaited IIFE statement: ${line}`);
      }
    }
  });
});
