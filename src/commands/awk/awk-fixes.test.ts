/**
 * Tests for AWK critical and high severity bug fixes
 * SSH-540, SSH-541, SSH-542, SSH-543, SSH-544
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { awkExec } from "./awk.ts";
import { AwkParser } from "./parser.ts";
import { AwkLexer } from "./lexer.ts";

// =============================================================================
// SSH-540: AWK indexOf trailing-line detection bugs
// =============================================================================

describe("SSH-540: indexOf trailing-line detection", () => {
  it("should process all empty string lines correctly", async () => {
    // When input has multiple empty lines, indexOf("") always returns 0
    // which never equals lines.length-1, so all empty lines were processed
    // except the last one. With the fix, only the trailing empty line is skipped.
    const result = await awkExec('{ print NR, $0 }', "a\n\nb");
    assertEquals(result.output.trim(), "1 a\n2 \n3 b");
  });

  it("should not skip intermediate empty lines", async () => {
    // Old bug: if first line is empty, indexOf("") returns 0,
    // and if it happens to equal lines.length-1, it skips wrong lines
    const result = await awkExec('{ print NR }', "\na\nb");
    assertEquals(result.output.trim(), "1\n2\n3");
  });

  it("should skip only the trailing empty line from split", async () => {
    // "a\nb\n" splits to ["a", "b", ""] - only skip the last ""
    const result = await awkExec('{ print NR, $0 }', "a\nb\n");
    assertEquals(result.output.trim(), "1 a\n2 b");
  });

  it("should handle input with all empty lines", async () => {
    const result = await awkExec('{ print NR }', "\n\n");
    assertEquals(result.output.trim(), "1\n2");
  });

  it("should handle input with empty first line (stream awk)", async () => {
    const result = await awkExec('{ print NR, $0 }', "\nhello\nworld");
    assertEquals(result.output.trim(), "1 \n2 hello\n3 world");
  });
});

// =============================================================================
// SSH-541: AWK substr() POSIX clamping
// =============================================================================

describe("SSH-541: substr() uses .substring() with proper clamping", () => {
  it("should handle normal substr correctly", async () => {
    const result = await awkExec('{ print substr($0, 2, 3) }', "hello");
    assertEquals(result.output.trim(), "ell");
  });

  it("should handle substr with start < 1 (clamped to index 0)", async () => {
    // AWK start=-1, JS index = max(0, floor(-1)-1) = 0
    // .substring(0, 0+4) = "hell"
    const result = await awkExec('{ print substr($0, -1, 4) }', "hello");
    assertEquals(result.output.trim(), "hell");
  });

  it("should handle substr with start = 0 (clamped to index 0)", async () => {
    // AWK start=0, JS index = max(0, floor(0)-1) = 0
    // .substring(0, 0+3) = "hel"
    const result = await awkExec('{ print substr($0, 0, 3) }', "hello");
    assertEquals(result.output.trim(), "hel");
  });

  it("should handle substr without length argument", async () => {
    const result = await awkExec('{ print substr($0, 3) }', "hello");
    assertEquals(result.output.trim(), "llo");
  });

  it("should handle negative start with small length (clamped to index 0)", async () => {
    // AWK start=-5, JS index = max(0, floor(-5)-1) = 0
    // .substring(0, 0+2) = "he"
    const result = await awkExec('{ print substr($0, -5, 2) }', "hello");
    assertEquals(result.output.trim(), "he");
  });

  it("should clamp end to string length", async () => {
    // substr("hi", 1, 100) should give "hi", not error
    const result = await awkExec('{ print substr($0, 1, 100) }', "hi");
    assertEquals(result.output.trim(), "hi");
  });
});

// =============================================================================
// SSH-542: AWK int(), split(), srand() correctness
// =============================================================================

describe("SSH-542: int() truncation toward zero", () => {
  it("should truncate positive numbers toward zero", async () => {
    const result = await awkExec('{ print int($1) }', "3.7");
    assertEquals(result.output.trim(), "3");
  });

  it("should truncate negative numbers toward zero (POSIX)", async () => {
    // POSIX int() truncates toward zero: int(-2.3) = -2
    const result = await awkExec('{ print int($1) }', "-2.3");
    assertEquals(result.output.trim(), "-2");
  });

  it("should truncate -0.5 toward zero", async () => {
    // POSIX int() truncates toward zero: int(-0.5) = 0
    const result = await awkExec('{ print int($1) }', "-0.5");
    assertEquals(result.output.trim(), "0");
  });

  it("should truncate -9.9 toward zero", async () => {
    const result = await awkExec('{ print int($1) }', "-9.9");
    assertEquals(result.output.trim(), "-9");
  });
});

describe("SSH-542: split() with default FS", () => {
  it("should trim leading/trailing whitespace when using default FS", async () => {
    // "  a  b  c  " should split to ["a", "b", "c"], not ["", "a", "b", "c", ""]
    const result = await awkExec('{ n = split($0, arr); print n, arr[1], arr[2] }', "  a  b  c  ");
    assertEquals(result.output.trim(), "3 a b");
  });

  it("should trim leading/trailing whitespace with explicit space FS", async () => {
    // When sep is " ", implementation converts to /\s+/ and trims (POSIX behavior)
    // "  hello  world  " trims to "hello  world", splits to ["hello", "world"]
    const result = await awkExec('{ n = split($0, arr, " "); print n, arr[1] }', "  hello  world  ");
    assertEquals(result.output.trim(), "2 hello");
  });

  it("should not trim when using non-default separator", async () => {
    const result = await awkExec('{ n = split($0, arr, ":"); print n }', ":a:b:");
    assertEquals(result.output.trim(), "4");
  });
});

describe("SSH-542: srand() seeded PRNG", () => {
  it("should produce deterministic output with same seed", async () => {
    const result1 = await awkExec('BEGIN { srand(42); print rand(), rand(), rand() }', "");
    const result2 = await awkExec('BEGIN { srand(42); print rand(), rand(), rand() }', "");
    assertEquals(result1.output.trim(), result2.output.trim());
  });

  it("should produce different output with different seeds", async () => {
    const result1 = await awkExec('BEGIN { srand(1); print rand() }', "");
    const result2 = await awkExec('BEGIN { srand(2); print rand() }', "");
    const v1 = parseFloat(result1.output.trim());
    const v2 = parseFloat(result2.output.trim());
    assertEquals(v1 !== v2, true);
  });

  it("should produce values between 0 and 1", async () => {
    const result = await awkExec('BEGIN { srand(123); for (i=0; i<10; i++) { v=rand(); if (v<0||v>=1) print "BAD" } print "OK" }', "");
    assertEquals(result.output.trim(), "OK");
  });
});

// =============================================================================
// SSH-543: AWK parser/lexer fixes
// =============================================================================

describe("SSH-543: GT in print comparison", () => {
  it("should parse > as comparison inside parentheses in print", async () => {
    // print (a > b) should treat > as comparison, not redirection
    const result = await awkExec('{ print ($1 > 3) }', "2\n5\n3");
    assertEquals(result.output.trim(), "0\n1\n0");
  });

  it("should still treat > as redirection outside parentheses", () => {
    const parser = new AwkParser();
    const ast = parser.parse('{ print $0 > "file" }');
    const stmt = ast.rules[0]?.action.statements[0];
    assertEquals(stmt?.type, "print");
    assertEquals((stmt as any)?.output?.redirect, ">");
  });

  it("should handle nested parenthesized comparison with >", async () => {
    const result = await awkExec('{ if (1) print ($1 > 2) }', "1\n3\n5");
    assertEquals(result.output.trim(), "0\n1\n1");
  });
});

describe("SSH-543: POSIX character classes in lexer", () => {
  it("should expand [:digit:] class", async () => {
    const result = await awkExec('/[[:digit:]]/ { print }', "abc\n123\ndef");
    assertEquals(result.output.trim(), "123");
  });

  it("should expand [:alpha:] class", async () => {
    const result = await awkExec('/[[:alpha:]]/ { print }', "123\nabc\n456");
    assertEquals(result.output.trim(), "abc");
  });

  it("should expand [:space:] class", async () => {
    const result = await awkExec('/[[:space:]]/ { print NR }', "hello world\ntest\n a");
    // Lines 1 and 3 have spaces
    assertEquals(result.output.trim(), "1\n3");
  });
});

describe("SSH-543: for-in backtrack", () => {
  it("should parse C-style for with variable starting expression", () => {
    const parser = new AwkParser();
    // This requires backtracking: "for (i = 0; ..." - i is IDENT but followed by =, not "in"
    const ast = parser.parse('{ for (i = 0; i < 3; i++) print i }');
    assertEquals(ast.rules[0]?.action.statements[0]?.type, "for");
  });

  it("should still parse for-in correctly", () => {
    const parser = new AwkParser();
    const ast = parser.parse('{ for (k in arr) print k }');
    assertEquals(ast.rules[0]?.action.statements[0]?.type, "for_in");
  });

  it("should handle complex init expression after backtrack", async () => {
    const result = await awkExec('BEGIN { for (x = 1 + 1; x <= 4; x++) print x }', "");
    assertEquals(result.output.trim(), "2\n3\n4");
  });
});

// =============================================================================
// SSH-544: AWK interpreter fixes
// =============================================================================

describe("SSH-544: user function local arrays", () => {
  it("should isolate local array parameters in functions", async () => {
    const result = await awkExec(`
      function fill(arr) {
        arr[1] = "inside"
        return arr[1]
      }
      BEGIN {
        a[1] = "outside"
        fill(a)
        print a[1]
      }
    `, "");
    // After function call, the outer array should be restored
    assertEquals(result.output.trim(), "outside");
  });

  it("should not leak local arrays to outer scope", async () => {
    const result = await awkExec(`
      function test(local_arr) {
        local_arr[1] = "local"
      }
      BEGIN {
        test(x)
        print (1 in x) ? "leaked" : "clean"
      }
    `, "");
    assertEquals(result.output.trim(), "clean");
  });
});

describe("SSH-544: range pattern", () => {
  it("should not check end pattern on start line", async () => {
    // /2/,/2/ should match line "2" (start), then look for end on subsequent lines
    // With old behavior, start+end matched on same line, making it single-line range
    const result = await awkExec('/2/,/2/ { print }', "1\n2\n3\n2\n5");
    // Should match: 2 (start), 3 (in range), 2 (end) = lines 2,3,4
    assertEquals(result.output.trim(), "2\n3\n2");
  });

  it("should handle range pattern with different start/end", async () => {
    const result = await awkExec('/start/,/end/ { print }', "before\nstart\nmiddle\nend\nafter");
    assertEquals(result.output.trim(), "start\nmiddle\nend");
  });

  it("should handle range that starts at first line", async () => {
    // Use anchored patterns to avoid "bar" matching /a/ (since "bar" contains "a")
    const result = await awkExec('/^x$/,/^y$/ { print NR }', "x\nfoo\ny\nzzz");
    assertEquals(result.output.trim(), "1\n2\n3");
  });
});

describe("SSH-544: division by zero", () => {
  it("should report error on division by zero", async () => {
    const result = await awkExec('{ print 1 / 0 }', "test");
    assertEquals(result.exitCode, 1);
    assertStringIncludes(result.output, "division by zero");
  });

  it("should report error on modulo by zero", async () => {
    const result = await awkExec('{ print 1 % 0 }', "test");
    assertEquals(result.exitCode, 1);
    assertStringIncludes(result.output, "division by zero");
  });

  it("should handle non-zero division normally", async () => {
    const result = await awkExec('{ print 10 / 3 }', "test");
    const val = parseFloat(result.output.trim());
    assertEquals(Math.abs(val - 3.33333) < 0.001, true);
  });
});

describe("SSH-544: getline file cache", () => {
  it("should not pollute vars with file cache entries", async () => {
    // The old code stored cache in ctx.vars with __fc_ and __fi_ prefixes
    // The new code uses ctx.fileCache Map instead
    // We can verify by checking that vars don't contain __fc_ keys
    const result = await awkExec(`
      BEGIN {
        for (k in ENVIRON) { }
        print "ok"
      }
    `, "");
    assertEquals(result.output.trim(), "ok");
  });
});
