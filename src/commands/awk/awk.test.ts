/**
 * AWK Command Tests
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { awkExec } from "./awk.ts";

describe("AWK", () => {
  describe("basic patterns", () => {
    it("prints all lines with no pattern", async () => {
      const result = await awkExec("{ print }", "hello\nworld");
      assertEquals(result.output.trim(), "hello\nworld");
      assertEquals(result.exitCode, 0);
    });

    it("prints specific field", async () => {
      const result = await awkExec("{ print $1 }", "hello world\nfoo bar");
      assertEquals(result.output.trim(), "hello\nfoo");
    });

    it("prints multiple fields", async () => {
      const result = await awkExec("{ print $2, $1 }", "a b\nc d");
      assertEquals(result.output.trim(), "b a\nd c");
    });
  });

  describe("field separator", () => {
    it("uses custom field separator", async () => {
      const result = await awkExec(
        "{ print $2 }",
        "a:b:c\nd:e:f",
        { fieldSeparator: ":" }
      );
      assertEquals(result.output.trim(), "b\ne");
    });

    it("uses regex field separator", async () => {
      const result = await awkExec(
        "{ print $2 }",
        "a  b  c\nd   e   f",
        { fieldSeparator: /\s+/ }
      );
      assertEquals(result.output.trim(), "b\ne");
    });
  });

  describe("built-in variables", () => {
    it("uses NR (record number)", async () => {
      const result = await awkExec("{ print NR, $0 }", "a\nb\nc");
      assertEquals(result.output.trim(), "1 a\n2 b\n3 c");
    });

    it("uses NF (number of fields)", async () => {
      const result = await awkExec("{ print NF }", "a b c\nd e");
      assertEquals(result.output.trim(), "3\n2");
    });
  });

  describe("patterns", () => {
    it("matches regex pattern", async () => {
      const result = await awkExec("/hello/ { print }", "hello\nworld\nhello world");
      assertEquals(result.output.trim(), "hello\nhello world");
    });

    it("matches BEGIN pattern", async () => {
      const result = await awkExec('BEGIN { print "start" }', "ignored");
      assertEquals(result.output.trim(), "start");
    });

    it("matches END pattern", async () => {
      const result = await awkExec('END { print "done" }', "ignored");
      assertEquals(result.output.trim(), "done");
    });

    it("matches numeric comparison", async () => {
      const result = await awkExec("$1 > 5 { print }", "3\n7\n5\n10");
      assertEquals(result.output.trim(), "7\n10");
    });
  });

  describe("string functions", () => {
    it("length()", async () => {
      const result = await awkExec("{ print length($0) }", "hello\nhi");
      assertEquals(result.output.trim(), "5\n2");
    });

    it("substr()", async () => {
      const result = await awkExec("{ print substr($0, 2, 3) }", "hello");
      assertEquals(result.output.trim(), "ell");
    });

    it("index()", async () => {
      const result = await awkExec('{ print index($0, "ll") }', "hello");
      assertEquals(result.output.trim(), "3");
    });

    it("tolower()", async () => {
      const result = await awkExec("{ print tolower($0) }", "HELLO");
      assertEquals(result.output.trim(), "hello");
    });

    it("toupper()", async () => {
      const result = await awkExec("{ print toupper($0) }", "hello");
      assertEquals(result.output.trim(), "HELLO");
    });
  });

  describe("math functions", () => {
    it("int()", async () => {
      const result = await awkExec("{ print int($1) }", "3.7\n-2.3");
      // AWK int() truncates toward zero (POSIX): int(-2.3) = -2
      assertEquals(result.output.trim(), "3\n-2");
    });

    it("sqrt()", async () => {
      const result = await awkExec("{ print sqrt($1) }", "4\n9");
      assertEquals(result.output.trim(), "2\n3");
    });
  });

  describe("printf", () => {
    it("formats strings", async () => {
      const result = await awkExec('{ printf "%s: %d\\n", $1, $2 }', "a 1\nb 2");
      assertEquals(result.output, "a: 1\nb: 2\n");
    });

    it("pads with width", async () => {
      const result = await awkExec('{ printf "%5s\\n", $1 }', "hi");
      assertEquals(result.output, "   hi\n");
    });
  });

  describe("variables", () => {
    it("sets and uses variables", async () => {
      const result = await awkExec("{ sum += $1 } END { print sum }", "1\n2\n3");
      assertEquals(result.output.trim(), "6");
    });

    it("uses -v variables", async () => {
      const result = await awkExec(
        "{ print x, $1 }",
        "a\nb",
        { variables: { x: "prefix" } }
      );
      assertEquals(result.output.trim(), "prefix a\nprefix b");
    });
  });

  describe("arrays", () => {
    it("uses associative arrays", async () => {
      const result = await awkExec(
        '{ count[$1]++ } END { for (k in count) print k, count[k] }',
        "a\nb\na\na\nb"
      );
      // Order may vary, so just check presence
      const lines = result.output.trim().split("\n").sort();
      assertEquals(lines.length, 2);
    });
  });

  describe("control flow", () => {
    it("uses if statement", async () => {
      const result = await awkExec(
        '{ if ($1 > 5) print "big"; else print "small" }',
        "3\n7"
      );
      assertEquals(result.output.trim(), "small\nbig");
    });

    it("uses for loop", async () => {
      const result = await awkExec(
        'BEGIN { for (i = 1; i <= 3; i++) print i }',
        ""
      );
      assertEquals(result.output.trim(), "1\n2\n3");
    });

    it("uses while loop", async () => {
      const result = await awkExec(
        'BEGIN { i = 1; while (i <= 3) { print i; i++ } }',
        ""
      );
      assertEquals(result.output.trim(), "1\n2\n3");
    });
  });

  describe("user functions", () => {
    it("defines and calls function", async () => {
      const result = await awkExec(
        'function double(x) { return x * 2 } { print double($1) }',
        "3\n5"
      );
      assertEquals(result.output.trim(), "6\n10");
    });
  });

  describe("gsub and sub", () => {
    it("gsub replaces all", async () => {
      const result = await awkExec(
        '{ gsub(/a/, "X"); print }',
        "banana"
      );
      assertEquals(result.output.trim(), "bXnXnX");
    });

    it("sub replaces first", async () => {
      const result = await awkExec(
        '{ sub(/a/, "X"); print }',
        "banana"
      );
      assertEquals(result.output.trim(), "bXnana");
    });
  });

  describe("split", () => {
    it("splits string into array", async () => {
      const result = await awkExec(
        '{ n = split($0, arr, ":"); print n, arr[2] }',
        "a:b:c"
      );
      assertEquals(result.output.trim(), "3 b");
    });
  });

  describe("match", () => {
    it("returns match position", async () => {
      const result = await awkExec(
        '{ print match($0, /[0-9]+/) }',
        "abc123def"
      );
      assertEquals(result.output.trim(), "4");
    });
  });
});
