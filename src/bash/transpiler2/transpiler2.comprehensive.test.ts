/**
 * Comprehensive unit tests for transpiler2
 *
 * These tests cover edge cases, complex scenarios, and realistic bash scripts
 * to ensure robust transpilation from Bash to TypeScript/SafeShell.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile, BashTranspiler2 } from "./mod.ts";
import { TranspilerContext } from "./context.ts";
import { OutputEmitter } from "./emitter.ts";
import { resolveOptions } from "./types.ts";
import {
  escapeForTemplate,
  escapeForQuotes,
  escapeForSingleQuotes,
  escapeRegex,
  globToRegex,
} from "./utils/escape.ts";

// =============================================================================
// Extended Escape Utilities Tests
// =============================================================================

describe("Extended Escape Utilities", () => {
  describe("escapeForTemplate - Edge Cases", () => {
    it("should escape multiple backticks", () => {
      assertEquals(escapeForTemplate("``cmd``"), "\\`\\`cmd\\`\\`");
    });

    it("should escape nested template literals", () => {
      const result = escapeForTemplate("${foo${bar}}");
      assertStringIncludes(result, "\\");
    });

    it("should handle empty string", () => {
      assertEquals(escapeForTemplate(""), "");
    });

    it("should escape mixed special characters", () => {
      const input = 'echo `$var` and ${other}';
      const result = escapeForTemplate(input);
      assertStringIncludes(result, "\\`");
      assertStringIncludes(result, "\\$");
    });
  });

  describe("escapeForQuotes - Edge Cases", () => {
    it("should escape carriage returns", () => {
      assertEquals(escapeForQuotes("line\r"), "line\\r");
    });

    it("should handle mixed whitespace", () => {
      assertEquals(escapeForQuotes("a\tb\nc\rd"), "a\\tb\\nc\\rd");
    });

    it("should escape multiple consecutive quotes", () => {
      assertEquals(escapeForQuotes('say """'), 'say \\"\\"\\"');
    });
  });

  describe("escapeForSingleQuotes", () => {
    it("should escape single quotes", () => {
      assertEquals(escapeForSingleQuotes("it's"), "it\\'s");
    });

    it("should escape backslashes before single quotes", () => {
      assertEquals(escapeForSingleQuotes("path\\'s"), "path\\\\\\'s");
    });
  });

  describe("globToRegex - Extended", () => {
    it("should handle character class", () => {
      assertEquals(globToRegex("[abc]"), "[abc]");
    });

    it("should handle negated character class", () => {
      assertEquals(globToRegex("[!abc]"), "[^abc]");
    });

    it("should handle multiple wildcards", () => {
      assertEquals(globToRegex("*.*"), "[^/]*\\.[^/]*");
    });

    it("should handle complex path patterns", () => {
      const result = globToRegex("src/**/*.{ts,tsx}");
      assertStringIncludes(result, ".*");
      assertStringIncludes(result, "[^/]*");
    });
  });
});

// =============================================================================
// Command Handler Edge Cases
// =============================================================================

describe("Command Handler - Edge Cases", () => {
  it("should handle command with special characters in arguments", () => {
    const ast = parse("echo 'hello world'");
    const output = transpile(ast);
    assertStringIncludes(output, "$.cmd`echo");
  });

  it("should handle command with variable in name", () => {
    const ast = parse('"$CMD" arg1 arg2');
    const output = transpile(ast);
    // Variable in command name gets escaped in template literal
    assertStringIncludes(output, "CMD");
  });

  it("should handle multiple variable assignments", () => {
    const ast = parse("A=1 B=2 C=3");
    const output = transpile(ast);
    assertStringIncludes(output, "const A");
    assertStringIncludes(output, "const B");
    assertStringIncludes(output, "const C");
  });

  it("should handle variable assignment with command", () => {
    const ast = parse("VAR=value command arg");
    const output = transpile(ast);
    assertStringIncludes(output, "$.cmd`command");
  });

  it("should handle command with escaped quotes", () => {
    const ast = parse('echo "say \\"hello\\""');
    const output = transpile(ast);
    assertStringIncludes(output, "$.cmd`echo");
  });

  it("should handle empty command gracefully", () => {
    const ast = parse(":");
    const output = transpile(ast);
    // Colon is a noop command
    assertStringIncludes(output, "$.cmd`:`");
  });

  it("should handle true and false builtins", () => {
    const ast1 = parse("true");
    const ast2 = parse("false");
    assertStringIncludes(transpile(ast1), "$.cmd`true`");
    assertStringIncludes(transpile(ast2), "$.cmd`false`");
  });
});

// =============================================================================
// Fluent Commands - Comprehensive Tests
// =============================================================================

describe("Fluent Commands - Comprehensive", () => {
  describe("grep options", () => {
    it("should handle grep with -v (invert match)", () => {
      const ast = parse("grep -v pattern file.txt");
      const output = transpile(ast);
      assertStringIncludes(output, "$.cat");
      assertStringIncludes(output, ".grep(");
      assertStringIncludes(output, "filter");
    });

    it("should handle grep with -i (case insensitive)", () => {
      const ast = parse("grep -i pattern file.txt");
      const output = transpile(ast);
      assertStringIncludes(output, "/pattern/i");
    });

    it("should handle grep with -n (line numbers)", () => {
      const ast = parse("grep -n pattern file.txt");
      const output = transpile(ast);
      assertStringIncludes(output, "map");
    });

    it("should handle grep with multiple options", () => {
      const ast = parse("grep -v -i pattern file.txt");
      const output = transpile(ast);
      assertStringIncludes(output, "/pattern/i");
      assertStringIncludes(output, "filter");
    });

    it("should handle grep without file (as transform)", () => {
      const ast = parse("grep pattern");
      const output = transpile(ast);
      assertStringIncludes(output, "$.grep(/pattern/)");
    });
  });

  describe("cut options", () => {
    it("should handle cut with -d and -f", () => {
      const ast = parse("cut -d: -f1,2");
      const output = transpile(ast);
      assertStringIncludes(output, '$.cut(');
      assertStringIncludes(output, 'delimiter: ":"');
      assertStringIncludes(output, "fields:");
    });

    it("should handle cut with separated -d option", () => {
      const ast = parse("cut -d , -f 1");
      const output = transpile(ast);
      assertStringIncludes(output, "$.cut(");
      assertStringIncludes(output, "delimiter");
    });
  });

  describe("tr command", () => {
    it("should handle tr with character classes", () => {
      const ast = parse("tr a-z A-Z");
      const output = transpile(ast);
      assertStringIncludes(output, '$.tr("a-z", "A-Z")');
    });

    it("should handle tr with special characters", () => {
      const ast = parse("tr '\\n' ' '");
      const output = transpile(ast);
      assertStringIncludes(output, "$.tr(");
    });
  });

  describe("tee command", () => {
    it("should handle tee with file", () => {
      const ast = parse("tee output.log");
      const output = transpile(ast);
      assertStringIncludes(output, '$.tee("output.log")');
    });

    it("should handle tee without file (stdin)", () => {
      const ast = parse("tee");
      const output = transpile(ast);
      assertStringIncludes(output, '$.tee("-")');
    });
  });

  describe("sort with all options", () => {
    it("should handle sort with -n -r -u", () => {
      const ast = parse("sort -n -r -u");
      const output = transpile(ast);
      assertStringIncludes(output, "numeric: true");
      assertStringIncludes(output, "reverse: true");
      assertStringIncludes(output, "unique: true");
    });

    it("should handle sort without options", () => {
      const ast = parse("sort");
      const output = transpile(ast);
      assertStringIncludes(output, "$.sort()");
    });
  });

  describe("uniq with all options", () => {
    it("should handle uniq with -c -i", () => {
      const ast = parse("uniq -c -i");
      const output = transpile(ast);
      assertStringIncludes(output, "count: true");
      assertStringIncludes(output, "ignoreCase: true");
    });
  });

  describe("wc with all options", () => {
    it("should handle wc with -l -w -c -m", () => {
      const ast = parse("wc -l -w -c -m");
      const output = transpile(ast);
      assertStringIncludes(output, "lines: true");
      assertStringIncludes(output, "words: true");
      assertStringIncludes(output, "bytes: true");
      assertStringIncludes(output, "chars: true");
    });
  });

  describe("head and tail variants", () => {
    it("should handle head with -n flag", () => {
      // Parser requires -nN format (no space)
      const ast = parse("head -n20");
      const output = transpile(ast);
      assertStringIncludes(output, "$.head(20)");
    });

    it("should handle tail with combined flag", () => {
      const ast = parse("tail -15");
      const output = transpile(ast);
      assertStringIncludes(output, "$.tail(15)");
    });
  });

  describe("sed and awk fallback", () => {
    it("should use explicit style for sed", () => {
      const ast = parse("sed 's/old/new/g'");
      const output = transpile(ast);
      assertStringIncludes(output, "$.cmd`sed");
    });

    it("should use explicit style for awk", () => {
      const ast = parse("awk '{print $1}'");
      const output = transpile(ast);
      assertStringIncludes(output, "$.cmd`awk");
    });
  });
});

// =============================================================================
// Pipeline Tests - Complex Scenarios
// =============================================================================

describe("Pipelines - Complex Scenarios", () => {
  it("should handle long pipeline chains", () => {
    const ast = parse("cat file | grep pattern | sort | uniq | head -5");
    const output = transpile(ast);
    assertStringIncludes(output, ".pipe(");
  });

  it("should handle AND pipeline", () => {
    const ast = parse("cmd1 && cmd2");
    const output = transpile(ast);
    assertStringIncludes(output, ".then(");
  });

  it("should handle OR pipeline", () => {
    const ast = parse("cmd1 || cmd2");
    const output = transpile(ast);
    assertStringIncludes(output, ".catch(");
  });

  it("should handle pipeline with redirections", () => {
    const ast = parse("cat file | grep test > output.txt");
    const output = transpile(ast);
    assertStringIncludes(output, ".pipe(");
    assertStringIncludes(output, ".stdout(");
  });

  it("should handle simple subshell", () => {
    const ast = parse("(echo hello)");
    const output = transpile(ast);
    assertStringIncludes(output, "(async () => {");
  });

  it("should handle two-command AND chain", () => {
    const ast = parse("mkdir -p dir && cd dir");
    const output = transpile(ast);
    assertStringIncludes(output, ".then(");
  });

  it("should handle two-command OR chain", () => {
    const ast = parse("cmd1 || cmd2");
    const output = transpile(ast);
    assertStringIncludes(output, ".catch(");
  });
});

// =============================================================================
// Control Flow - Complex Scenarios
// =============================================================================

describe("Control Flow - Complex Scenarios", () => {
  describe("Nested If Statements", () => {
    it("should handle deeply nested if statements", () => {
      const script = `
        if test -f file1
        then
          if test -f file2
          then
            echo "both exist"
          else
            echo "only file1"
          fi
        else
          echo "no file1"
        fi
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "if (");
      assertStringIncludes(output, "} else {");
      // Should have nested structure
      const ifCount = (output.match(/if \(/g) || []).length;
      assertEquals(ifCount >= 2, true);
    });

    it("should handle if-else statement", () => {
      const script = `
        if test "$a" = 1
        then
          echo "one"
        else
          echo "other"
        fi
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "if (");
      assertStringIncludes(output, "} else {");
    });
  });

  describe("For Loop Variants", () => {
    it("should handle for loop with command substitution", () => {
      const script = `
        for file in $(ls *.txt)
        do
          echo "$file"
        done
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "for (const file of");
    });

    it("should handle for loop with word list", () => {
      const script = `
        for i in a b c
        do
          echo "$i"
        done
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "for (const i of");
      assertStringIncludes(output, '["a", "b", "c"]');
    });

    it("should handle simple for loop", () => {
      const script = `
        for x in one two
        do
          echo "$x"
        done
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "for (const x of");
    });
  });

  describe("C-Style For Loop", () => {
    it("should handle C-style for with all parts", () => {
      // C-style for loops need newlines after do
      const script = `for ((i=0; i<10; i++))
do
echo "$i"
done`;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "for (");
    });

    it("should handle simple C-style for", () => {
      const script = `for ((x=1; x<5; x++))
do
echo test
done`;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "for (");
    });
  });

  describe("While and Until Loops", () => {
    it("should handle while with complex condition", () => {
      const script = `
        while test "$count" -lt 10
        do
          count=$((count + 1))
          echo "$count"
        done
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "while (true)");
      assertStringIncludes(output, ".code !== 0) break;");
    });

    it("should handle until loop", () => {
      const script = `
        until test -f lockfile
        do
          sleep 1
        done
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "while (true)");
      assertStringIncludes(output, ".code === 0) break;");
    });

    it("should handle nested while loops", () => {
      const script = `
        while test -f outer
        do
          while test -f inner
          do
            sleep 1
          done
        done
      `;
      const ast = parse(script);
      const output = transpile(ast);
      // Should have two while loops
      const whileCount = (output.match(/while \(true\)/g) || []).length;
      assertEquals(whileCount, 2);
    });
  });

  describe("Case Statement", () => {
    it("should handle case with multiple patterns", () => {
      const script = `
        case "$opt" in
          -h|--help)
            echo "help"
            ;;
          -v|--version)
            echo "version"
            ;;
          *)
            echo "unknown"
            ;;
        esac
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "if (");
      assertStringIncludes(output, "} else if (");
      assertStringIncludes(output, '=== "-h"');
      assertStringIncludes(output, '=== "--help"');
    });

    it("should handle case with glob patterns", () => {
      const script = `
        case "$file" in
          *.txt)
            echo "text file"
            ;;
          *.sh)
            echo "shell script"
            ;;
        esac
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "if (");
    });
  });

  describe("Function Declarations", () => {
    it("should handle function with multiple statements", () => {
      const script = `
        function setup {
          echo "Setting up..."
          mkdir -p /tmp/work
          cd /tmp/work
          echo "Done"
        }
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "async function setup()");
      assertStringIncludes(output, "mkdir");
    });

    it("should handle function keyword syntax", () => {
      const script = `
        function greet {
          echo "Hello"
        }
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "async function greet()");
    });

    it("should handle function with local variables", () => {
      const script = `
        function compute {
          local result=0
          result=$((result + 1))
          echo "$result"
        }
      `;
      const ast = parse(script);
      const output = transpile(ast);
      assertStringIncludes(output, "async function compute()");
    });
  });
});

// =============================================================================
// Variable Expansion - All Modifiers
// =============================================================================

describe("Variable Expansion - All Modifiers", () => {
  describe("Default Value Operators", () => {
    it("should handle ${VAR:-default} (use default if unset/null)", () => {
      const ast = parse('echo "${VAR:-default_value}"');
      const output = transpile(ast);
      assertStringIncludes(output, "??");
    });

    it("should handle ${VAR-default} (use default if unset only)", () => {
      const ast = parse('echo "${VAR-default_value}"');
      const output = transpile(ast);
      assertStringIncludes(output, "!== undefined");
    });

    it("should handle ${VAR:=default} (assign default)", () => {
      const ast = parse('echo "${VAR:=default_value}"');
      const output = transpile(ast);
      assertStringIncludes(output, "??=");
    });

    it("should handle ${VAR:?error} (error if unset)", () => {
      const ast = parse('echo "${VAR:?Variable not set}"');
      const output = transpile(ast);
      assertStringIncludes(output, "throw new Error");
    });

    it("should handle ${VAR:+alternate} (use alternate if set)", () => {
      const ast = parse('echo "${VAR:+is_set}"');
      const output = transpile(ast);
      assertStringIncludes(output, "VAR ?");
    });
  });

  describe("String Manipulation", () => {
    it("should handle ${#VAR} (length)", () => {
      const ast = parse('echo "${#VAR}"');
      const output = transpile(ast);
      assertStringIncludes(output, "VAR.length");
    });

    it("should handle ${VAR#pattern} (remove shortest prefix)", () => {
      const ast = parse('echo "${PATH#*:}"');
      const output = transpile(ast);
      assertStringIncludes(output, ".replace(/^");
    });

    it("should handle ${VAR##pattern} (remove longest prefix)", () => {
      const ast = parse('echo "${PATH##*:}"');
      const output = transpile(ast);
      assertStringIncludes(output, ".replace(/^");
    });

    it("should handle ${VAR%pattern} (remove shortest suffix)", () => {
      const ast = parse('echo "${FILE%.txt}"');
      const output = transpile(ast);
      assertStringIncludes(output, ".replace(/");
      assertStringIncludes(output, "$/, \"\")");
    });

    it("should handle ${VAR%%pattern} (remove longest suffix)", () => {
      const ast = parse('echo "${FILE%%.*}"');
      const output = transpile(ast);
      assertStringIncludes(output, ".replace(/");
    });
  });

  describe("Case Modification", () => {
    it("should handle ${VAR^} (uppercase first char)", () => {
      const ast = parse('echo "${VAR^}"');
      const output = transpile(ast);
      assertStringIncludes(output, "charAt(0).toUpperCase()");
      assertStringIncludes(output, ".slice(1)");
    });

    it("should handle ${VAR^^} (uppercase all)", () => {
      const ast = parse('echo "${VAR^^}"');
      const output = transpile(ast);
      assertStringIncludes(output, ".toUpperCase()");
    });

    it("should handle ${VAR,} (lowercase first char)", () => {
      const ast = parse('echo "${VAR,}"');
      const output = transpile(ast);
      assertStringIncludes(output, "charAt(0).toLowerCase()");
      assertStringIncludes(output, ".slice(1)");
    });

    it("should handle ${VAR,,} (lowercase all)", () => {
      const ast = parse('echo "${VAR,,}"');
      const output = transpile(ast);
      assertStringIncludes(output, ".toLowerCase()");
    });
  });

  describe("Substitution", () => {
    it("should handle ${VAR/pattern/replacement} (replace first)", () => {
      const ast = parse('echo "${VAR/old/new}"');
      const output = transpile(ast);
      assertStringIncludes(output, '.replace("old", "new")');
    });

    it("should handle ${VAR//pattern/replacement} (replace all)", () => {
      const ast = parse('echo "${VAR//old/new}"');
      const output = transpile(ast);
      assertStringIncludes(output, '.replaceAll("old", "new")');
    });
  });

  describe("Special Variables", () => {
    it("should handle positional parameters", () => {
      const ast = parse('echo "$1" "$2" "$@"');
      const output = transpile(ast);
      assertStringIncludes(output, "${1}");
      assertStringIncludes(output, "${2}");
      assertStringIncludes(output, "${@}");
    });

    it("should handle special shell variables", () => {
      const ast = parse('echo "$?" "$!" "$$" "$#"');
      const output = transpile(ast);
      assertStringIncludes(output, "${?}");
      assertStringIncludes(output, "${!}");
      assertStringIncludes(output, "${$}");
      assertStringIncludes(output, "${#}");
    });
  });
});

// =============================================================================
// Test Expressions - Comprehensive
// =============================================================================

describe("Test Expressions - Comprehensive", () => {
  describe("File Existence Tests", () => {
    it("should handle -e (exists)", () => {
      const ast = parse("[[ -e /path/to/file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "$.fs.exists");
    });

    it("should handle -f (regular file)", () => {
      const ast = parse("[[ -f /path/to/file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "$.fs.stat");
      assertStringIncludes(output, "isFile");
    });

    it("should handle -d (directory)", () => {
      const ast = parse("[[ -d /path/to/dir ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isDirectory");
    });

    it("should handle -L (symlink)", () => {
      const ast = parse("[[ -L /path/to/link ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isSymlink");
    });

    it("should handle -h (symlink, alias)", () => {
      const ast = parse("[[ -h /path/to/link ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isSymlink");
    });

    it("should handle -b (block device)", () => {
      const ast = parse("[[ -b /dev/sda ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isBlockDevice");
    });

    it("should handle -c (character device)", () => {
      const ast = parse("[[ -c /dev/tty ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isCharDevice");
    });

    it("should handle -p (named pipe)", () => {
      const ast = parse("[[ -p /tmp/pipe ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isFifo");
    });

    it("should handle -S (socket)", () => {
      const ast = parse("[[ -S /var/run/sock ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "isSocket");
    });
  });

  describe("File Permission Tests", () => {
    it("should handle -r (readable)", () => {
      const ast = parse("[[ -r file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "$.fs.readable");
    });

    it("should handle -w (writable)", () => {
      const ast = parse("[[ -w file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "$.fs.writable");
    });

    it("should handle -x (executable)", () => {
      const ast = parse("[[ -x file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "$.fs.executable");
    });

    it("should handle -s (size > 0)", () => {
      const ast = parse("[[ -s file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "size");
      assertStringIncludes(output, "> 0");
    });
  });

  describe("File Attribute Tests", () => {
    it("should handle -g (setgid)", () => {
      const ast = parse("[[ -g file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "0o2000");
    });

    it("should handle -u (setuid)", () => {
      const ast = parse("[[ -u file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "0o4000");
    });

    it("should handle -k (sticky bit)", () => {
      const ast = parse("[[ -k file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "0o1000");
    });

    it("should handle -t (terminal)", () => {
      const ast = parse("[[ -t 0 ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "Deno.isatty");
    });

    it("should handle -O (owner)", () => {
      const ast = parse("[[ -O file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "uid");
      assertStringIncludes(output, "Deno.uid()");
    });

    it("should handle -G (group)", () => {
      const ast = parse("[[ -G file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "gid");
      assertStringIncludes(output, "Deno.gid()");
    });

    it("should handle -N (newer than access)", () => {
      const ast = parse("[[ -N file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "mtime");
      assertStringIncludes(output, "atime");
    });
  });

  describe("String Tests", () => {
    it("should handle -z (zero length)", () => {
      const ast = parse('[[ -z "$var" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, ".length === 0");
    });

    it("should handle -n (non-zero length)", () => {
      const ast = parse('[[ -n "$var" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, ".length > 0");
    });
  });

  describe("String Comparisons", () => {
    it("should handle = (equal)", () => {
      const ast = parse('[[ "$a" = "$b" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, "===");
    });

    it("should handle == (equal)", () => {
      const ast = parse('[[ "$a" == "$b" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, "===");
    });

    it("should handle != (not equal)", () => {
      const ast = parse('[[ "$a" != "$b" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, "!==");
    });

    it("should handle < (less than)", () => {
      const ast = parse('[[ "$a" < "$b" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, "<");
    });

    it("should handle > (greater than)", () => {
      const ast = parse('[[ "$a" > "$b" ]]');
      const output = transpile(ast);
      assertStringIncludes(output, ">");
    });
  });

  describe("Numeric Comparisons", () => {
    it("should handle -eq (equal)", () => {
      const ast = parse("[[ $a -eq $b ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "Number(");
      assertStringIncludes(output, "===");
    });

    it("should handle -ne (not equal)", () => {
      const ast = parse("[[ $a -ne $b ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "!==");
    });

    it("should handle -lt (less than)", () => {
      const ast = parse("[[ $a -lt $b ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "Number(");
      assertStringIncludes(output, "<");
    });

    it("should handle -le (less or equal)", () => {
      const ast = parse("[[ $a -le $b ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "<=");
    });

    it("should handle -gt (greater than)", () => {
      const ast = parse("[[ $a -gt $b ]]");
      const output = transpile(ast);
      assertStringIncludes(output, ">");
    });

    it("should handle -ge (greater or equal)", () => {
      const ast = parse("[[ $a -ge $b ]]");
      const output = transpile(ast);
      assertStringIncludes(output, ">=");
    });
  });

  describe("File Comparisons", () => {
    it("should handle -nt (newer than)", () => {
      const ast = parse("[[ file1 -nt file2 ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "mtime");
      assertStringIncludes(output, ">");
    });

    it("should handle -ot (older than)", () => {
      const ast = parse("[[ file1 -ot file2 ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "mtime");
      assertStringIncludes(output, "<");
    });

    it("should handle -ef (same file)", () => {
      const ast = parse("[[ file1 -ef file2 ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "ino");
      assertStringIncludes(output, "===");
    });
  });

  describe("Regex Matching", () => {
    it("should handle =~ (regex match)", () => {
      const ast = parse('[[ "$str" =~ ^[0-9]+$ ]]');
      const output = transpile(ast);
      assertStringIncludes(output, "new RegExp");
      assertStringIncludes(output, ".test(");
    });

    it("should handle =~ with complex pattern", () => {
      const ast = parse('[[ "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$ ]]');
      const output = transpile(ast);
      assertStringIncludes(output, "new RegExp");
      assertStringIncludes(output, ".test(");
    });
  });

  describe("Logical Operators", () => {
    it("should handle && (and)", () => {
      const ast = parse("[[ -f file && -r file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "&&");
    });

    it("should handle || (or)", () => {
      const ast = parse("[[ -f file || -d file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "||");
    });

    it("should handle ! (not)", () => {
      const ast = parse("[[ ! -f file ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "!(");
    });

    it("should handle complex logical expressions", () => {
      const ast = parse("[[ -f file && ( -r file || -w file ) ]]");
      const output = transpile(ast);
      assertStringIncludes(output, "&&");
      assertStringIncludes(output, "||");
    });
  });
});

// =============================================================================
// Arithmetic Expressions - Comprehensive
// =============================================================================

describe("Arithmetic Expressions - Comprehensive", () => {
  describe("Basic Arithmetic", () => {
    it("should handle addition", () => {
      const ast = parse("echo $((1 + 2))");
      const output = transpile(ast);
      assertStringIncludes(output, "(1 + 2)");
    });

    it("should handle subtraction", () => {
      const ast = parse("echo $((5 - 3))");
      const output = transpile(ast);
      assertStringIncludes(output, "(5 - 3)");
    });

    it("should handle multiplication", () => {
      const ast = parse("echo $((4 * 3))");
      const output = transpile(ast);
      assertStringIncludes(output, "(4 * 3)");
    });

    it("should handle division", () => {
      const ast = parse("echo $((10 / 2))");
      const output = transpile(ast);
      assertStringIncludes(output, "(10 / 2)");
    });

    it("should handle modulo", () => {
      const ast = parse("echo $((10 % 3))");
      const output = transpile(ast);
      assertStringIncludes(output, "(10 % 3)");
    });

    it("should handle exponentiation", () => {
      const ast = parse("echo $((2 ** 8))");
      const output = transpile(ast);
      assertStringIncludes(output, "(2 ** 8)");
    });
  });

  describe("Bitwise Operations", () => {
    it("should handle bitwise AND", () => {
      const ast = parse("echo $((a & b))");
      const output = transpile(ast);
      assertStringIncludes(output, "&");
    });

    it("should handle bitwise OR", () => {
      const ast = parse("echo $((a | b))");
      const output = transpile(ast);
      assertStringIncludes(output, "|");
    });

    it("should handle bitwise XOR", () => {
      const ast = parse("echo $((a ^ b))");
      const output = transpile(ast);
      assertStringIncludes(output, "^");
    });

    it("should handle left shift", () => {
      const ast = parse("echo $((a << 2))");
      const output = transpile(ast);
      assertStringIncludes(output, "<<");
    });

    it("should handle right shift", () => {
      const ast = parse("echo $((a >> 2))");
      const output = transpile(ast);
      assertStringIncludes(output, ">>");
    });
  });

  describe("Unary Operations", () => {
    it("should handle unary minus", () => {
      const ast = parse("echo $((-x))");
      const output = transpile(ast);
      assertStringIncludes(output, "-");
    });

    it("should handle unary plus", () => {
      const ast = parse("echo $((+x))");
      const output = transpile(ast);
      assertStringIncludes(output, "+");
    });

    it("should handle logical NOT", () => {
      const ast = parse("echo $((!x))");
      const output = transpile(ast);
      assertStringIncludes(output, "!");
    });

    it("should handle bitwise NOT", () => {
      const ast = parse("echo $((~x))");
      const output = transpile(ast);
      assertStringIncludes(output, "~");
    });

    it("should handle pre-increment", () => {
      const ast = parse("echo $((++x))");
      const output = transpile(ast);
      assertStringIncludes(output, "++");
    });

    it("should handle post-increment", () => {
      const ast = parse("echo $((x++))");
      const output = transpile(ast);
      assertStringIncludes(output, "++");
    });

    it("should handle pre-decrement", () => {
      const ast = parse("echo $((--x))");
      const output = transpile(ast);
      assertStringIncludes(output, "--");
    });

    it("should handle post-decrement", () => {
      const ast = parse("echo $((x--))");
      const output = transpile(ast);
      assertStringIncludes(output, "--");
    });
  });

  describe("Comparison Operations", () => {
    it("should handle comparison operators", () => {
      const ast = parse("echo $((a < b))");
      const output = transpile(ast);
      assertStringIncludes(output, "<");
    });

    it("should handle equality", () => {
      const ast = parse("echo $((a == b))");
      const output = transpile(ast);
      assertStringIncludes(output, "==");
    });
  });

  describe("Assignment Operations", () => {
    it("should handle simple assignment", () => {
      const ast = parse("((x = 5))");
      const output = transpile(ast);
      assertStringIncludes(output, "x = 5");
    });

    it("should handle compound assignment +=", () => {
      const ast = parse("((x += 5))");
      const output = transpile(ast);
      assertStringIncludes(output, "x += 5");
    });

    it("should handle compound assignment -=", () => {
      const ast = parse("((x -= 5))");
      const output = transpile(ast);
      assertStringIncludes(output, "x -= 5");
    });

    it("should handle compound assignment *=", () => {
      const ast = parse("((x *= 5))");
      const output = transpile(ast);
      assertStringIncludes(output, "x *= 5");
    });

    it("should handle compound assignment /=", () => {
      const ast = parse("((x /= 5))");
      const output = transpile(ast);
      assertStringIncludes(output, "x /= 5");
    });

    it("should handle compound assignment %=", () => {
      const ast = parse("((x %= 5))");
      const output = transpile(ast);
      assertStringIncludes(output, "x %= 5");
    });
  });

  describe("Ternary Operator", () => {
    it("should handle ternary expression", () => {
      const ast = parse("echo $((a > b ? a : b))");
      const output = transpile(ast);
      assertStringIncludes(output, "?");
      assertStringIncludes(output, ":");
    });
  });

  describe("Complex Expressions", () => {
    it("should handle nested arithmetic", () => {
      const ast = parse("echo $(((a + b) * (c - d)))");
      const output = transpile(ast);
      assertStringIncludes(output, "+");
      assertStringIncludes(output, "*");
      assertStringIncludes(output, "-");
    });

    it("should handle operator precedence", () => {
      const ast = parse("echo $((2 + 3 * 4))");
      const output = transpile(ast);
      assertStringIncludes(output, "2 +");
      assertStringIncludes(output, "3 * 4");
    });
  });
});

// =============================================================================
// Redirections - All Types
// =============================================================================

describe("Redirections - All Types", () => {
  it("should handle input redirection <", () => {
    const ast = parse("cat < input.txt");
    const output = transpile(ast);
    assertStringIncludes(output, '.stdin("input.txt")');
  });

  it("should handle output redirection >", () => {
    const ast = parse("echo hello > output.txt");
    const output = transpile(ast);
    assertStringIncludes(output, '.stdout("output.txt")');
  });

  it("should handle append redirection >>", () => {
    const ast = parse("echo hello >> output.txt");
    const output = transpile(ast);
    assertStringIncludes(output, '.stdout("output.txt", { append: true })');
  });

  it("should handle combined stdout and stderr &>", () => {
    const ast = parse("cmd &> all.log");
    const output = transpile(ast);
    assertStringIncludes(output, ".stdout(");
    assertStringIncludes(output, ".stderr(");
  });

  it("should handle combined append &>>", () => {
    const ast = parse("cmd &>> all.log");
    const output = transpile(ast);
    assertStringIncludes(output, "append: true");
  });

  it("should handle here-string <<<", () => {
    const ast = parse("cat <<< 'hello world'");
    const output = transpile(ast);
    assertStringIncludes(output, ".stdin(");
  });

  it("should handle input and output redirections", () => {
    const ast = parse("cmd < in.txt > out.txt");
    const output = transpile(ast);
    assertStringIncludes(output, ".stdin(");
    assertStringIncludes(output, ".stdout(");
  });
});

// =============================================================================
// Command Substitution
// =============================================================================

describe("Command Substitution", () => {
  it("should handle simple command substitution", () => {
    const ast = parse('echo "Today is $(date)"');
    const output = transpile(ast);
    assertStringIncludes(output, "async () =>");
    assertStringIncludes(output, ".text()");
    assertStringIncludes(output, ".trim()");
  });

  it("should handle command substitution in variable assignment", () => {
    const ast = parse('CURRENT_DIR=$(pwd)');
    const output = transpile(ast);
    assertStringIncludes(output, "const CURRENT_DIR");
  });

  it("should handle command substitution with pipeline", () => {
    const ast = parse('COUNT=$(ls | wc -l)');
    const output = transpile(ast);
    assertStringIncludes(output, "const COUNT");
  });
});

// =============================================================================
// Process Substitution
// =============================================================================

describe("Process Substitution", () => {
  it("should handle input process substitution <()", () => {
    const ast = parse("diff <(ls dir1) <(ls dir2)");
    const output = transpile(ast);
    assertStringIncludes(output, "Deno.makeTempFile");
  });

  it("should handle output process substitution >()", () => {
    const ast = parse("tee >(grep pattern > matches.txt)");
    const output = transpile(ast);
    assertStringIncludes(output, "Deno.makeTempFile");
  });
});

// =============================================================================
// Grouping Constructs
// =============================================================================

describe("Grouping Constructs", () => {
  it("should handle simple subshell", () => {
    const ast = parse("(echo hello)");
    const output = transpile(ast);
    assertStringIncludes(output, "(async () => {");
    assertStringIncludes(output, "})();");
  });

  it("should handle subshell with single command", () => {
    const ast = parse("(ls)");
    const output = transpile(ast);
    assertStringIncludes(output, "(async () => {");
    assertStringIncludes(output, "$.cmd`ls`");
  });
});

// =============================================================================
// Complex Realistic Bash Scripts
// =============================================================================

describe("Complex Realistic Bash Scripts", () => {
  it("should transpile a file backup script", () => {
    const script = `
      BACKUP_DIR="/tmp/backup"
      DATE=$(date +%Y%m%d)

      if test -d "$BACKUP_DIR"
      then
        echo "Backup dir exists"
      fi

      for file in one two three
      do
        cp "$file" "$BACKUP_DIR/$file.bak"
      done

      echo "Backup complete"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'const BACKUP_DIR');
    assertStringIncludes(output, 'const DATE');
    assertStringIncludes(output, 'if (');
    assertStringIncludes(output, 'for (const file of');
    assertStringIncludes(output, '$.cmd`cp');
  });

  it("should transpile a log analysis script", () => {
    const script = `
      LOG_FILE="/var/log/app.log"

      echo "=== Error Analysis ==="
      grep ERROR "$LOG_FILE" | sort

      echo "=== Warning Count ==="
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // grep with file produces $.cat().grep() pipeline
    assertStringIncludes(output, '.grep(');
    assertStringIncludes(output, '.pipe(');
  });

  it("should transpile a function script", () => {
    const script = `
      function deploy {
        echo "Starting deployment..."

        if test -f "package.json"
        then
          echo "Found package.json"
        fi

        npm install && npm run build

        echo "Build complete"
      }

      deploy
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'async function deploy()');
    assertStringIncludes(output, 'npm');
  });

  it("should transpile a while loop script", () => {
    const script = `
      COUNTER=0

      while test $COUNTER -lt 10
      do
        echo "Counter: $COUNTER"
        COUNTER=$((COUNTER + 1))
      done

      echo "Done"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'while (true)');
    assertStringIncludes(output, 'const COUNTER');
  });

  it("should transpile a for loop with variable iteration", () => {
    const script = `
      TARGETS="a b c"

      for target in $TARGETS
      do
        echo "Processing $target"
      done

      echo "All done"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'for (const target of');
    assertStringIncludes(output, '$.cmd`echo');
  });

  it("should transpile a case statement script", () => {
    const script = `
      case "$1" in
        start)
          echo "Starting"
          ;;
        stop)
          echo "Stopping"
          ;;
      esac
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'if (');
    assertStringIncludes(output, '} else if (');
  });

  it("should transpile a pipeline processing script", () => {
    const script = `
      INPUT_DIR="./data"
      OUTPUT_DIR="./processed"

      mkdir -p "$OUTPUT_DIR"

      cat file.txt | grep pattern > output.txt

      echo "Done"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    // cat produces $.cat(file)
    assertStringIncludes(output, 'file.txt');
    assertStringIncludes(output, '.pipe(');
  });

  it("should transpile a conditional script", () => {
    const script = `
      BRANCH=$(git branch --show-current)

      if test "$BRANCH" = "main"
      then
        echo "Cannot run on main branch"
        exit 1
      fi

      git fetch origin main

      echo "Branch updated"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'const BRANCH');
    assertStringIncludes(output, 'if (');
    assertStringIncludes(output, '$.cmd`git');
  });

  it("should transpile a health check script", () => {
    const script = `
      SERVICES="api worker"
      FAILED=""

      for service in $SERVICES
      do
        echo "Checking $service"

        if test "$response" != "200"
        then
          FAILED="$FAILED $service"
          echo "FAIL: $service"
        else
          echo "OK: $service"
        fi
      done

      echo "Check complete"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'for (const service of');
    assertStringIncludes(output, 'if (');
  });

  it("should transpile a database backup script", () => {
    const script = `
      DB_NAME="mydb"
      BACKUP_PATH="/backups/$DB_NAME.sql.gz"

      echo "Backing up database: $DB_NAME"

      pg_dump "$DB_NAME" | gzip > "$BACKUP_PATH"

      echo "Backup complete"
    `;
    const ast = parse(script);
    const output = transpile(ast);

    assertStringIncludes(output, 'const DB_NAME');
    assertStringIncludes(output, 'pg_dump');
    assertStringIncludes(output, '.pipe(');
  });
});

// =============================================================================
// TranspilerContext Extended Tests
// =============================================================================

describe("TranspilerContext Extended", () => {
  it("should handle multiple scope levels", () => {
    const ctx = new TranspilerContext(resolveOptions());

    ctx.declareVariable("a", "const");
    ctx.pushScope();
    ctx.declareVariable("b", "let");
    ctx.pushScope();
    ctx.declareVariable("c", "let");

    assertEquals(ctx.isDeclared("a"), true);
    assertEquals(ctx.isDeclared("b"), true);
    assertEquals(ctx.isDeclared("c"), true);

    ctx.popScope();
    assertEquals(ctx.isDeclared("c"), false);
    assertEquals(ctx.isDeclared("b"), true);

    ctx.popScope();
    assertEquals(ctx.isDeclared("b"), false);
    assertEquals(ctx.isDeclared("a"), true);
  });

  it("should generate unique temp vars with different prefixes", () => {
    const ctx = new TranspilerContext(resolveOptions());

    assertEquals(ctx.getTempVar("cmd"), "cmd0");
    assertEquals(ctx.getTempVar("cmd"), "cmd1");
    assertEquals(ctx.getTempVar("result"), "result2");
    assertEquals(ctx.getTempVar(), "_tmp3");
  });

  it("should handle complex snapshot/restore scenarios", () => {
    const ctx = new TranspilerContext(resolveOptions());

    ctx.indent();
    ctx.indent();
    ctx.getTempVar();
    ctx.declareVariable("x", "const");

    const snap1 = ctx.snapshot();

    ctx.indent();
    ctx.getTempVar();
    ctx.declareVariable("y", "let");

    const snap2 = ctx.snapshot();

    ctx.restore(snap1);
    assertEquals(ctx.getIndentLevel(), 2);
    assertEquals(ctx.isDeclared("x"), true);

    ctx.restore(snap2);
    assertEquals(ctx.getIndentLevel(), 3);
    assertEquals(ctx.isDeclared("y"), true);
  });
});

// =============================================================================
// OutputEmitter Extended Tests
// =============================================================================

describe("OutputEmitter Extended", () => {
  it("should handle multiple imports from same module", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    emitter.addImport("./mod.ts", "$");
    emitter.addImport("./mod.ts", "cmd");
    emitter.addImport("./mod.ts", "pipe");
    emitter.emit("code");

    const output = emitter.toString();
    assertStringIncludes(output, 'import { $, cmd, pipe } from "./mod.ts"');
  });

  it("should handle default imports", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    emitter.addDefaultImport("./module.ts", "Module");
    emitter.emit("code");

    const output = emitter.toString();
    assertStringIncludes(output, 'import Module from "./module.ts"');
  });

  it("should handle nested blocks", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    emitter.emitBlock("if (a) ", () => {
      emitter.emitBlock("if (b) ", () => {
        emitter.emit("deep();");
      });
    });

    const output = emitter.toString();
    assertStringIncludes(output, "if (a) {");
    assertStringIncludes(output, "  if (b) {");
    assertStringIncludes(output, "    deep();");
  });

  it("should handle raw emission", () => {
    const ctx = new TranspilerContext(resolveOptions());
    const emitter = new OutputEmitter(ctx);

    ctx.indent();
    emitter.emitRaw("// no indent");
    emitter.emit("with indent");

    const lines = emitter.getLines();
    assertEquals(lines[0], "// no indent");
    assertEquals(lines[1], "  with indent");
  });
});

// =============================================================================
// BashTranspiler2 Class Extended Tests
// =============================================================================

describe("BashTranspiler2 Class Extended", () => {
  it("should handle custom indent string", () => {
    const transpiler = new BashTranspiler2({ indent: "\t" });
    const ast = parse("echo hello");
    const output = transpiler.transpile(ast);

    assertStringIncludes(output, "\tawait");
  });

  it("should handle different import paths", () => {
    const transpiler = new BashTranspiler2({
      importPath: "@safesh/runtime",
      imports: true
    });
    const ast = parse("ls");
    const output = transpiler.transpile(ast);

    assertStringIncludes(output, 'from "@safesh/runtime"');
  });

  it("should be thread-safe for multiple transpilations", () => {
    const transpiler = new BashTranspiler2();

    const scripts = [
      "echo one",
      "echo two",
      "echo three",
      "echo four",
      "echo five",
    ];

    const outputs = scripts.map(s => transpiler.transpile(parse(s)));

    assertStringIncludes(outputs[0]!, "echo one");
    assertStringIncludes(outputs[1]!, "echo two");
    assertStringIncludes(outputs[2]!, "echo three");
    assertStringIncludes(outputs[3]!, "echo four");
    assertStringIncludes(outputs[4]!, "echo five");
  });
});
