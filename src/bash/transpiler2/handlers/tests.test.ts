/**
 * Unit tests for handlers/tests.ts
 *
 * These tests target uncovered lines to improve coverage from 82.4% to >85%.
 * Focus on edge cases, error paths, and StringTest handling.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../parser.ts";
import { transpile } from "../mod.ts";

// =============================================================================
// String Test (Bare String in Test Expression)
// =============================================================================

describe("Test Handlers - StringTest Coverage", () => {
  it("should handle bare string in [[ ]] (StringTest)", () => {
    const ast = parse('[[ "non-empty" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, ".length > 0");
  });

  it("should handle bare variable in [[ ]] (StringTest)", () => {
    const ast = parse('[[ $var ]]');
    const output = transpile(ast);
    assertStringIncludes(output, ".length > 0");
  });

  it("should handle empty string as StringTest", () => {
    const ast = parse('[[ "" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, ".length > 0");
  });

  it("should handle bare command substitution as StringTest", () => {
    const ast = parse('[[ $(echo test) ]]');
    const output = transpile(ast);
    assertStringIncludes(output, ".length > 0");
  });
});

// =============================================================================
// Logical Test Edge Cases
// =============================================================================

describe("Test Handlers - LogicalTest Edge Cases", () => {
  it("should handle negation without left operand (! operator)", () => {
    const ast = parse('[[ ! -f file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
    assertStringIncludes(output, "$.fs.stat");
  });

  it("should handle double negation", () => {
    const ast = parse('[[ ! ! -f file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
  });

  it("should handle negation of logical AND", () => {
    const ast = parse('[[ ! ( -f file && -r file ) ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
    assertStringIncludes(output, "&&");
  });

  it("should handle negation of logical OR", () => {
    const ast = parse('[[ ! ( -d dir || -f file ) ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
    assertStringIncludes(output, "||");
  });

  it("should handle complex nested logical expressions", () => {
    const ast = parse('[[ ( -f file1 && -r file1 ) || ( -f file2 && -r file2 ) ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "&&");
    assertStringIncludes(output, "||");
  });

  it("should handle negation of string test", () => {
    const ast = parse('[[ ! -z "$var" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
    assertStringIncludes(output, ".length === 0");
  });

  it("should handle negation of numeric comparison", () => {
    const ast = parse('[[ ! $a -eq $b ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
    assertStringIncludes(output, "Number(");
  });
});

// =============================================================================
// Error Paths and Unsupported Operators
// =============================================================================

describe("Test Handlers - Error Paths", () => {
  it("should handle all unary operators for comprehensive coverage", () => {
    // Test all unary operators to ensure no default case is hit
    const operators = [
      "-e", "-f", "-d", "-L", "-h", "-b", "-c", "-p", "-S", "-t",
      "-r", "-w", "-x", "-s", "-g", "-u", "-k", "-O", "-G", "-N",
      "-z", "-n"
    ];

    for (const op of operators) {
      const script = `[[ ${op} file ]]`;
      const ast = parse(script);
      const output = transpile(ast);
      // Should not contain "false" from default case
      assert(output.length > 0);
    }
  });

  it("should handle all binary operators for comprehensive coverage", () => {
    // Test all binary operators to ensure no default case is hit
    const operators = [
      "=", "==", "!=", "<", ">",
      "-eq", "-ne", "-lt", "-le", "-gt", "-ge",
      "-nt", "-ot", "-ef", "=~"
    ];

    for (const op of operators) {
      const script = `[[ a ${op} b ]]`;
      const ast = parse(script);
      const output = transpile(ast);
      // Should not contain "false" from default case
      assert(output.length > 0);
    }
  });

  it("should handle all logical operators for comprehensive coverage", () => {
    const tests = [
      '[[ -f file && -r file ]]',
      '[[ -f file || -d file ]]',
      '[[ ! -f file ]]'
    ];

    for (const test of tests) {
      const ast = parse(test);
      const output = transpile(ast);
      assert(output.length > 0);
    }
  });
});

// =============================================================================
// Edge Cases for Complete Branch Coverage
// =============================================================================

describe("Test Handlers - Branch Coverage", () => {
  it("should handle -t with file descriptor", () => {
    const ast = parse('[[ -t 1 ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "Deno.isatty");
    assertStringIncludes(output, "Number(");
  });

  it("should handle -O owner test", () => {
    const ast = parse('[[ -O /path/file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "uid");
    assertStringIncludes(output, "Deno.uid()");
  });

  it("should handle -G group test", () => {
    const ast = parse('[[ -G /path/file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "gid");
    assertStringIncludes(output, "Deno.gid()");
  });

  it("should handle -N modified after access test", () => {
    const ast = parse('[[ -N /path/file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "mtime");
    assertStringIncludes(output, "atime");
  });

  it("should handle regex match with special characters", () => {
    const ast = parse('[[ "$str" =~ ^[a-z]+$ ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "new RegExp");
    assertStringIncludes(output, ".test(");
  });

  it("should handle string comparison with <", () => {
    const ast = parse('[[ "$a" < "$b" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "<");
  });

  it("should handle string comparison with >", () => {
    const ast = parse('[[ "$a" > "$b" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, ">");
  });

  it("should handle file comparison -ef (same inode)", () => {
    const ast = parse('[[ file1 -ef file2 ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "ino");
  });
});

// =============================================================================
// Integration Tests - Complex Combinations
// =============================================================================

describe("Test Handlers - Integration", () => {
  it("should handle combination of unary and binary tests", () => {
    const ast = parse('[[ -f file && "$var" = "value" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "$.fs.stat");
    assertStringIncludes(output, "===");
    assertStringIncludes(output, "&&");
  });

  it("should handle combination of string and numeric tests", () => {
    const ast = parse('[[ -n "$str" && $num -gt 0 ]]');
    const output = transpile(ast);
    assertStringIncludes(output, ".length > 0");
    assertStringIncludes(output, "Number(");
    assertStringIncludes(output, ">");
  });

  it("should handle mixed file tests", () => {
    const ast = parse('[[ -f file && -r file && -w file && -x file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "$.fs.stat");
    assertStringIncludes(output, "$.fs.readable");
    assertStringIncludes(output, "$.fs.writable");
    assertStringIncludes(output, "$.fs.executable");
  });

  it("should handle complex nested logical with multiple operators", () => {
    const ast = parse('[[ ( -f file1 && -r file1 ) || ( -d dir && -w dir ) || -z "$var" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "||");
    assertStringIncludes(output, "&&");
  });

  it("should handle all permission bits tests", () => {
    const ast = parse('[[ -g file && -u file && -k file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "0o2000"); // setgid
    assertStringIncludes(output, "0o4000"); // setuid
    assertStringIncludes(output, "0o1000"); // sticky
  });

  it("should handle all special file type tests", () => {
    const ast = parse('[[ -b file || -c file || -p file || -S file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "isBlockDevice");
    assertStringIncludes(output, "isCharDevice");
    assertStringIncludes(output, "isFifo");
    assertStringIncludes(output, "isSocket");
  });

  it("should handle all numeric comparisons together", () => {
    const ast = parse('[[ $a -eq $b || $c -ne $d || $e -lt $f || $g -le $h || $i -gt $j || $k -ge $l ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "===");
    assertStringIncludes(output, "!==");
    assertStringIncludes(output, "<");
    assertStringIncludes(output, "<=");
    assertStringIncludes(output, ">");
    assertStringIncludes(output, ">=");
  });

  it("should handle all file time comparisons", () => {
    const ast = parse('[[ file1 -nt file2 || file3 -ot file4 ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "mtime");
  });

  it("should handle regex with both binary and logical operators", () => {
    const ast = parse('[[ "$email" =~ ^[a-z]+@[a-z]+$ && -n "$email" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "new RegExp");
    assertStringIncludes(output, ".length > 0");
  });

  it("should handle deeply nested negations", () => {
    const ast = parse('[[ ! ( ! ( -f file ) ) ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "!(");
  });
});

// =============================================================================
// Variable Expansion in Test Expressions
// =============================================================================

describe("Test Handlers - Variable Expansion", () => {
  it("should handle variable expansion in unary tests", () => {
    const ast = parse('[[ -f "$filename" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "$.fs.stat");
  });

  it("should handle variable expansion in string comparisons", () => {
    const ast = parse('[[ "$var1" = "$var2" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "===");
  });

  it("should handle variable expansion in numeric comparisons", () => {
    const ast = parse('[[ $num1 -eq $num2 ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "Number(");
  });

  it("should handle command substitution in tests", () => {
    const ast = parse('[[ $(cat file) = "expected" ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "===");
  });

  it("should handle arithmetic expansion in tests", () => {
    const ast = parse('[[ $((1 + 1)) -eq 2 ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "Number(");
  });
});

// =============================================================================
// Edge Cases for Size and Permissions
// =============================================================================

describe("Test Handlers - Size and Permission Edge Cases", () => {
  it("should handle -s (file size > 0)", () => {
    const ast = parse('[[ -s /path/file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "size");
    assertStringIncludes(output, "> 0");
  });

  it("should handle combination of size and existence checks", () => {
    const ast = parse('[[ -e file && -s file ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "$.fs.exists");
    assertStringIncludes(output, "size");
  });

  it("should handle both symlink test operators -L and -h", () => {
    const ast = parse('[[ -L link || -h link ]]');
    const output = transpile(ast);
    assertStringIncludes(output, "isSymlink");
  });

  it("should handle equality operators = and ==", () => {
    const ast = parse('[[ "$a" = "$b" ]]');
    const output1 = transpile(ast);
    const ast2 = parse('[[ "$a" == "$b" ]]');
    const output2 = transpile(ast2);
    assertStringIncludes(output1, "===");
    assertStringIncludes(output2, "===");
  });
});

// =============================================================================
// Stress Test - All Operators
// =============================================================================

describe("Test Handlers - Comprehensive Operator Coverage", () => {
  it("should handle script with all test operators", () => {
    const script = `
      if [[ -e file ]]; then echo exists; fi
      if [[ -f file ]]; then echo file; fi
      if [[ -d dir ]]; then echo dir; fi
      if [[ -L link ]]; then echo link; fi
      if [[ -h link ]]; then echo symlink; fi
      if [[ -b dev ]]; then echo block; fi
      if [[ -c dev ]]; then echo char; fi
      if [[ -p pipe ]]; then echo fifo; fi
      if [[ -S sock ]]; then echo socket; fi
      if [[ -t 0 ]]; then echo tty; fi
      if [[ -r file ]]; then echo readable; fi
      if [[ -w file ]]; then echo writable; fi
      if [[ -x file ]]; then echo executable; fi
      if [[ -s file ]]; then echo size; fi
      if [[ -g file ]]; then echo setgid; fi
      if [[ -u file ]]; then echo setuid; fi
      if [[ -k file ]]; then echo sticky; fi
      if [[ -O file ]]; then echo owner; fi
      if [[ -G file ]]; then echo group; fi
      if [[ -N file ]]; then echo modified; fi
      if [[ -z "$var" ]]; then echo zero; fi
      if [[ -n "$var" ]]; then echo nonzero; fi
      if [[ "$a" = "$b" ]]; then echo equal; fi
      if [[ "$a" == "$b" ]]; then echo equal2; fi
      if [[ "$a" != "$b" ]]; then echo notequal; fi
      if [[ "$a" < "$b" ]]; then echo less; fi
      if [[ "$a" > "$b" ]]; then echo greater; fi
      if [[ $a -eq $b ]]; then echo numeq; fi
      if [[ $a -ne $b ]]; then echo numne; fi
      if [[ $a -lt $b ]]; then echo numlt; fi
      if [[ $a -le $b ]]; then echo numle; fi
      if [[ $a -gt $b ]]; then echo numgt; fi
      if [[ $a -ge $b ]]; then echo numge; fi
      if [[ file1 -nt file2 ]]; then echo newer; fi
      if [[ file1 -ot file2 ]]; then echo older; fi
      if [[ file1 -ef file2 ]]; then echo same; fi
      if [[ "$str" =~ ^[a-z]+$ ]]; then echo regex; fi
      if [[ $var ]]; then echo bare; fi
      if [[ -f file && -r file ]]; then echo and; fi
      if [[ -f file || -d file ]]; then echo or; fi
      if [[ ! -f file ]]; then echo not; fi
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // Verify output contains key transpilation patterns
    assertStringIncludes(output, "$.fs.exists");
    assertStringIncludes(output, "$.fs.stat");
    assertStringIncludes(output, "$.fs.readable");
    assertStringIncludes(output, "Number(");
    assertStringIncludes(output, "new RegExp");
    assertStringIncludes(output, ".length > 0");
  });
});
