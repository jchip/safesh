/**
 * Comprehensive Lexer Test Suite
 *
 * Tests for the bash lexer tokenization logic, focusing on:
 * - Public API methods (next, peek, peekAt, advance, match, getPosition, isAtEnd)
 * - Array subscript assignments (arr[0]=value, arr[x]=value, arr[arr[0]]=value)
 * - Heredoc handling (<<, <<-)
 * - Special brace handling ({}, literal braces)
 * - Edge cases in quote handling
 * - Streaming API
 * - Untested code paths and branches
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Token } from "./lexer.ts";
import { Lexer, tokenize, TokenType } from "./lexer.ts";

// =============================================================================
// Public API Methods
// =============================================================================

describe("Lexer Public API", () => {
  describe("next() - streaming API", () => {
    it("should return tokens one at a time using next()", () => {
      const lexer = new Lexer("echo hello");
      const token1 = lexer.next();
      assertEquals(token1?.type, TokenType.NAME);
      assertEquals(token1?.value, "echo");

      const token2 = lexer.next();
      assertEquals(token2?.type, TokenType.NAME);
      assertEquals(token2?.value, "hello");

      const token3 = lexer.next();
      assertEquals(token3?.type, TokenType.EOF);
    });

    it("should handle heredocs with streaming API", () => {
      const lexer = new Lexer("cat <<EOF\nline1\nline2\nEOF");

      let token = lexer.next();
      assertEquals(token?.type, TokenType.NAME); // cat

      token = lexer.next();
      assertEquals(token?.type, TokenType.DLESS); // <<

      token = lexer.next();
      assertEquals(token?.type, TokenType.NAME); // EOF

      token = lexer.next();
      assertEquals(token?.type, TokenType.NEWLINE); // \n

      token = lexer.next();
      assertEquals(token?.type, TokenType.HEREDOC_CONTENT);
      assertEquals(token?.value, "line1\nline2\n");
    });

    it("should handle empty input with next()", () => {
      const lexer = new Lexer("");
      const token = lexer.next();
      assertEquals(token?.type, TokenType.EOF);
    });

    it("should consume tokens from buffer before generating new ones", () => {
      const lexer = new Lexer("cat <<EOF\nhello\nEOF\necho done");
      // Consume tokens - heredoc handling puts content in buffer
      const tokens: Token[] = [];
      let tok = lexer.next();
      while (tok && tok.type !== TokenType.EOF) {
        tokens.push(tok);
        tok = lexer.next();
      }
      // Verify we got all tokens including heredoc content
      assert(tokens.some(t => t.type === TokenType.HEREDOC_CONTENT));
      // Verify we got tokens after heredoc
      assert(tokens.some(t => t.type === TokenType.NAME && t.value === "echo"));
      assert(tokens.some(t => t.type === TokenType.DONE && t.value === "done"));
    });
  });

  describe("peek() and peekAt()", () => {
    it("should peek at current character", () => {
      const lexer = new Lexer("echo");
      assertEquals(lexer.peek(), "e");
    });

    it("should peek at character with offset", () => {
      const lexer = new Lexer("echo");
      assertEquals(lexer.peekAt(0), "e");
      assertEquals(lexer.peekAt(1), "c");
      assertEquals(lexer.peekAt(2), "h");
      assertEquals(lexer.peekAt(3), "o");
      assertEquals(lexer.peekAt(4), "");
    });

    it("should return empty string when peeking beyond end", () => {
      const lexer = new Lexer("hi");
      assertEquals(lexer.peekAt(10), "");
    });
  });

  describe("advance()", () => {
    it("should advance position and return character", () => {
      const lexer = new Lexer("ab\nc");
      assertEquals(lexer.advance(), "a");
      assertEquals(lexer.advance(), "b");
      assertEquals(lexer.advance(), "\n");
      assertEquals(lexer.advance(), "c");
      assertEquals(lexer.advance(), "");
    });

    it("should track line and column correctly on advance", () => {
      const lexer = new Lexer("ab\ncd");
      lexer.advance(); // a
      let pos = lexer.getPosition();
      assertEquals(pos.line, 1);
      assertEquals(pos.column, 2);

      lexer.advance(); // b
      lexer.advance(); // \n
      pos = lexer.getPosition();
      assertEquals(pos.line, 2);
      assertEquals(pos.column, 1);
    });
  });

  describe("match()", () => {
    it("should match and advance for matching string", () => {
      const lexer = new Lexer("echo hello");
      assert(lexer.match("echo"));
      assertEquals(lexer.peek(), " ");
    });

    it("should not advance for non-matching string", () => {
      const lexer = new Lexer("echo hello");
      assert(!lexer.match("test"));
      assertEquals(lexer.peek(), "e");
    });

    it("should handle multi-character match", () => {
      const lexer = new Lexer("&&");
      assert(lexer.match("&&"));
      assertEquals(lexer.peek(), "");
    });
  });

  describe("getPosition()", () => {
    it("should return current position", () => {
      const lexer = new Lexer("test");
      const pos = lexer.getPosition();
      assertEquals(pos.offset, 0);
      assertEquals(pos.line, 1);
      assertEquals(pos.column, 1);
    });
  });

  describe("isAtEnd()", () => {
    it("should return false at start", () => {
      const lexer = new Lexer("test");
      assertEquals(lexer.isAtEnd(), false);
    });

    it("should return true at end", () => {
      const lexer = new Lexer("");
      assertEquals(lexer.isAtEnd(), true);
    });

    it("should return true after consuming all tokens", () => {
      const lexer = new Lexer("x");
      lexer.next(); // x
      lexer.next(); // EOF
      assertEquals(lexer.isAtEnd(), true);
    });
  });

  describe("addPendingHeredoc()", () => {
    it("should allow external heredoc registration", () => {
      const lexer = new Lexer("\nline1\nline2\nEND");
      lexer.addPendingHeredoc("END", false, false);

      const token1 = lexer.next(); // newline
      assertEquals(token1?.type, TokenType.NEWLINE);

      const token2 = lexer.next(); // heredoc content
      assertEquals(token2?.type, TokenType.HEREDOC_CONTENT);
      assertEquals(token2?.value, "line1\nline2\n");
    });

    it("should handle heredoc with stripTabs", () => {
      const lexer = new Lexer("\n\t\tindented\n\t\tmore\nEND");
      lexer.addPendingHeredoc("END", true, false);

      lexer.next(); // newline
      const token = lexer.next(); // heredoc content
      assertEquals(token?.type, TokenType.HEREDOC_CONTENT);
      assertEquals(token?.value, "indented\nmore\n");
    });
  });
});

// =============================================================================
// Array Subscript Assignments
// =============================================================================

describe("Array Subscript Assignments", () => {
  it("should tokenize simple array assignment", () => {
    const tokens = tokenize("arr[0]=value");
    assertEquals(tokens[0]?.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(tokens[0]?.value, "arr[0]=value");
  });

  it("should tokenize array assignment with variable index", () => {
    const tokens = tokenize("arr[x]=value");
    assertEquals(tokens[0]?.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(tokens[0]?.value, "arr[x]=value");
  });

  it("should tokenize nested array assignment", () => {
    const tokens = tokenize("arr[arr[0]]=value");
    assertEquals(tokens[0]?.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(tokens[0]?.value, "arr[arr[0]]=value");
  });

  it("should tokenize array assignment with arithmetic", () => {
    const tokens = tokenize("arr[x+1]=value");
    assertEquals(tokens[0]?.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(tokens[0]?.value, "arr[x+1]=value");
  });

  it("should tokenize append array assignment", () => {
    const tokens = tokenize("arr+=value");
    assertEquals(tokens[0]?.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(tokens[0]?.value, "arr+=value");
  });

  it("should tokenize array with append operator after subscript", () => {
    const tokens = tokenize("arr[0]+=value");
    assertEquals(tokens[0]?.type, TokenType.ASSIGNMENT_WORD);
    assertEquals(tokens[0]?.value, "arr[0]+=value");
  });

  it("should reject malformed array subscript - unclosed bracket", () => {
    const tokens = tokenize("arr[0=value");
    assertEquals(tokens[0]?.type, TokenType.WORD); // Not an assignment
  });

  it("should reject malformed array subscript - nested unclosed", () => {
    const tokens = tokenize("arr[arr[0]=value");
    assertEquals(tokens[0]?.type, TokenType.WORD); // Not an assignment
  });

  it("should reject malformed array subscript - invalid characters after", () => {
    const tokens = tokenize("arr[0]x=value");
    assertEquals(tokens[0]?.type, TokenType.WORD); // Not an assignment
  });
});

// =============================================================================
// Heredoc Handling
// =============================================================================

describe("Heredoc Handling", () => {
  it("should handle heredoc with quoted delimiter", () => {
    const tokens = tokenize(`cat <<'EOF'
line1
line2
EOF`);

    assertEquals(tokens[0]?.type, TokenType.NAME); // cat
    assertEquals(tokens[1]?.type, TokenType.DLESS); // <<
    assertEquals(tokens[2]?.type, TokenType.NAME); // 'EOF' - quoted NAME
    assertEquals(tokens[2]?.quoted, true);
    assertEquals(tokens[2]?.singleQuoted, true);
    assertEquals(tokens[3]?.type, TokenType.NEWLINE);
    assertEquals(tokens[4]?.type, TokenType.HEREDOC_CONTENT);
    assertEquals(tokens[4]?.value, "line1\nline2\n");
  });

  it("should handle heredoc with double-quoted delimiter", () => {
    const tokens = tokenize(`cat <<"EOF"
content
EOF`);

    assertEquals(tokens[4]?.type, TokenType.HEREDOC_CONTENT);
  });

  it("should handle heredoc with <<- and tab stripping", () => {
    const tokens = tokenize(`cat <<-END
\t\tindented
\t\tmore
END`);

    assertEquals(tokens[1]?.type, TokenType.DLESSDASH); // <<-
    const heredocToken = tokens.find(t => t.type === TokenType.HEREDOC_CONTENT);
    assertEquals(heredocToken?.value, "indented\nmore\n");
  });

  it("should handle heredoc with special delimiter characters", () => {
    const tokens = tokenize(`cat <<EOF_123
content
EOF_123`);

    const heredocToken = tokens.find(t => t.type === TokenType.HEREDOC_CONTENT);
    assertExists(heredocToken);
  });

  it("should handle multiple heredocs", () => {
    const tokens = tokenize(`cat <<EOF1 <<EOF2
content1
EOF1
content2
EOF2`);

    const heredocTokens = tokens.filter(t => t.type === TokenType.HEREDOC_CONTENT);
    assertEquals(heredocTokens.length, 2);
  });

  it("should handle heredoc delimiter with no trailing content", () => {
    const tokens = tokenize(`cat <<EOF
content
EOF`);

    const heredocToken = tokens.find(t => t.type === TokenType.HEREDOC_CONTENT);
    assertEquals(heredocToken?.value, "content\n");
  });
});

// =============================================================================
// Special Brace Handling
// =============================================================================

describe("Special Brace Handling", () => {
  it("should tokenize empty braces as word", () => {
    const tokens = tokenize("{}");
    assertEquals(tokens[0]?.type, TokenType.WORD);
    assertEquals(tokens[0]?.value, "{}");
  });

  it("should tokenize standalone opening brace", () => {
    const tokens = tokenize("{ echo; }");
    assertEquals(tokens[0]?.type, TokenType.LBRACE);
    assertEquals(tokens[0]?.value, "{");
  });

  it("should tokenize standalone closing brace", () => {
    const tokens = tokenize("{ echo; }");
    const rbrace = tokens.find(t => t.type === TokenType.RBRACE);
    assertEquals(rbrace?.value, "}");
  });

  it("should tokenize brace expansion", () => {
    const tokens = tokenize("echo {a,b,c}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "{a,b,c}");
  });

  it("should tokenize brace expansion with range", () => {
    const tokens = tokenize("echo {1..10}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "{1..10}");
  });

  it("should tokenize nested brace expansion", () => {
    const tokens = tokenize("echo {a,{b,c}}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "{a,{b,c}}");
  });

  it("should tokenize literal brace word", () => {
    const tokens = tokenize("{word}");
    assertEquals(tokens[0]?.type, TokenType.WORD);
    assertEquals(tokens[0]?.value, "{word}");
  });

  it("should tokenize } followed by word char", () => {
    const tokens = tokenize("}abc");
    assertEquals(tokens[0]?.type, TokenType.WORD);
    assertEquals(tokens[0]?.value, "}abc");
  });

  it("should tokenize { at end without space as LBRACE", () => {
    const tokens = tokenize("echo {");
    assertEquals(tokens[1]?.type, TokenType.LBRACE);
  });

  it("should tokenize brace with command substitution", () => {
    const tokens = tokenize("echo {$(cmd),b}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should tokenize brace with parameter expansion", () => {
    const tokens = tokenize("echo {${var},b}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should tokenize brace with backtick", () => {
    const tokens = tokenize("echo {`cmd`,b}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });
});

// =============================================================================
// Quote Handling Edge Cases
// =============================================================================

describe("Quote Handling Edge Cases", () => {
  it("should handle $\"...\" locale quoting", () => {
    const tokens = tokenize('echo $"translated"');
    assertEquals(tokens[1]?.type, TokenType.NAME); // Note: "translated" is a valid name
    assertEquals(tokens[1]?.quoted, true);
  });

  it("should handle unterminated single quote", () => {
    const tokens = tokenize("echo 'unterminated");
    assertEquals(tokens[1]?.type, TokenType.NAME); // "unterminated" is valid NAME
    assertEquals(tokens[1]?.singleQuoted, true);
  });

  it("should handle unterminated double quote", () => {
    const tokens = tokenize('echo "unterminated');
    assertEquals(tokens[1]?.type, TokenType.NAME); // "unterminated" is valid NAME
    assertEquals(tokens[1]?.quoted, true);
  });

  it("should handle unterminated $' ANSI quote", () => {
    const tokens = tokenize("echo $'unterminated");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle escaped quote in unquoted context", () => {
    const tokens = tokenize("echo \\\"test");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle escaped single quote in unquoted context", () => {
    const tokens = tokenize("echo \\'test");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });
});

// =============================================================================
// ANSI-C and Locale Quoting Tests
// =============================================================================

describe("ANSI-C and Locale Quoting", () => {
  it("should tokenize ANSI-C quoting $'...'", () => {
    const tokens = tokenize("echo $'hello\\nworld'");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "$'hello\\nworld'");
  });

  it("should tokenize ANSI-C quoting with tab escape", () => {
    const tokens = tokenize("echo $'tab\\there'");
    assert(tokens[1]?.value.includes("$'"));
    assert(tokens[1]?.value.includes("\\t"));
  });

  it("should tokenize ANSI-C quoting with various escapes", () => {
    const tokens = tokenize("echo $'line1\\nline2\\ttab'");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "$'line1\\nline2\\ttab'");
  });

  it("should tokenize locale quoting $\"...\"", () => {
    const tokens = tokenize('echo $"localized"');
    // Verify it tokenizes correctly
    assertEquals(tokens.length, 3); // echo, localized, EOF
    // Note: locale quoting produces a NAME token with the quoted content
    assertEquals(tokens[1]?.type, TokenType.NAME);
  });

  it("should tokenize mixed quoting styles", () => {
    const tokens = tokenize("echo 'single' \"double\" $'ansi' $\"locale\"");
    const wordTokens = tokens.filter(t => t.type === TokenType.NAME || t.type === TokenType.WORD);
    assertEquals(wordTokens.length, 5); // echo, 'single', "double", $'ansi', $"locale"
  });

  it("should tokenize ANSI-C quoting with escaped backslash", () => {
    const tokens = tokenize("echo $'back\\\\slash'");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assert(tokens[1]?.value.includes("\\\\"));
  });

  it("should tokenize locale quoting with escaped characters", () => {
    const tokens = tokenize('echo $"test\\"quote"');
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });
});

// =============================================================================
// Operator and Special Character Handling
// =============================================================================

describe("Operator and Special Character Handling", () => {
  it("should tokenize != as word", () => {
    const tokens = tokenize("!=");
    assertEquals(tokens[0]?.type, TokenType.WORD);
    assertEquals(tokens[0]?.value, "!=");
  });

  it("should tokenize three-char operator ;;& ", () => {
    const tokens = tokenize(";;&");
    assertEquals(tokens[0]?.type, TokenType.SEMI_SEMI_AND);
  });

  it("should tokenize three-char operator <<< ", () => {
    const tokens = tokenize("<<<");
    assertEquals(tokens[0]?.type, TokenType.TLESS);
  });

  it("should tokenize three-char operator &>> ", () => {
    const tokens = tokenize("&>>");
    assertEquals(tokens[0]?.type, TokenType.AND_DGREAT);
  });

  it("should handle <<- operator", () => {
    const tokens = tokenize("cat <<- END\nEND");
    assertEquals(tokens[1]?.type, TokenType.DLESSDASH);
  });
});

// =============================================================================
// Tokenize Function
// =============================================================================

describe("tokenize() convenience function", () => {
  it("should tokenize empty string", () => {
    const tokens = tokenize("");
    assertEquals(tokens.length, 1);
    assertEquals(tokens[0]?.type, TokenType.EOF);
  });

  it("should tokenize whitespace only", () => {
    const tokens = tokenize("   \t\t  ");
    assertEquals(tokens.length, 1);
    assertEquals(tokens[0]?.type, TokenType.EOF);
  });

  it("should handle line continuation in whitespace", () => {
    const tokens = tokenize("echo\\\n  hello");
    assertEquals(tokens[0]?.type, TokenType.NAME);
    assertEquals(tokens[0]?.value, "echo");
    assertEquals(tokens[1]?.type, TokenType.NAME);
    assertEquals(tokens[1]?.value, "hello");
  });
});

// =============================================================================
// Command Substitution and Expansions in readWord
// =============================================================================

describe("Expansions in readWord", () => {
  it("should handle $[...] old-style arithmetic", () => {
    const tokens = tokenize("echo $[1+2]");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "$[1+2]");
  });

  it("should handle ${...} parameter expansion", () => {
    const tokens = tokenize("echo ${var}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "${var}");
  });

  it("should handle nested ${...} expansions", () => {
    const tokens = tokenize("echo ${a${b}}");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle special variables $# $? $$ $! $@ $* $-", () => {
    const tokens = tokenize("$# $? $$ $! $@ $* $- $0 $1");
    assertEquals(tokens[0]?.value, "$#");
    assertEquals(tokens[1]?.value, "$?");
    assertEquals(tokens[2]?.value, "$$");
    assertEquals(tokens[3]?.value, "$!");
    assertEquals(tokens[4]?.value, "$@");
    assertEquals(tokens[5]?.value, "$*");
    assertEquals(tokens[6]?.value, "$-");
    assertEquals(tokens[7]?.value, "$0");
    assertEquals(tokens[8]?.value, "$1");
  });

  it("should handle backtick command substitution", () => {
    const tokens = tokenize("echo `date`");
    assertEquals(tokens[1]?.type, TokenType.WORD);
    assertEquals(tokens[1]?.value, "`date`");
  });

  it("should handle backtick with escape", () => {
    const tokens = tokenize("echo `echo \\`nested\\``");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle unterminated backtick", () => {
    const tokens = tokenize("echo `unterminated");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });
});

// =============================================================================
// Edge Cases and Error Recovery
// =============================================================================

describe("Edge Cases and Error Recovery", () => {
  it("should handle empty word token", () => {
    const tokens = tokenize('""');
    assertEquals(tokens[0]?.type, TokenType.WORD);
    assertEquals(tokens[0]?.value, "");
    assertEquals(tokens[0]?.quoted, true);
  });

  it("should handle word starting with number", () => {
    const tokens = tokenize("2>&1");
    assertEquals(tokens[0]?.type, TokenType.NUMBER);
    assertEquals(tokens[0]?.value, "2");
  });

  it("should handle newline in word with quotes", () => {
    const tokens = tokenize('echo "line1\nline2"');
    assertEquals(tokens[1]?.value, "line1\nline2");
  });

  it("should track position correctly through complex input", () => {
    const tokens = tokenize("echo\n  hello\n    world");
    assertEquals(tokens[0]?.line, 1);
    assertEquals(tokens[1]?.line, 1); // newline
    assertEquals(tokens[2]?.line, 2); // hello
    assertEquals(tokens[3]?.line, 2); // newline
    assertEquals(tokens[4]?.line, 3); // world
  });
});

// =============================================================================
// Reserved Words
// =============================================================================

describe("Reserved Words", () => {
  it("should identify 'select' as reserved word", () => {
    const tokens = tokenize("select x in a b c");
    assertEquals(tokens[0]?.type, TokenType.SELECT);
  });

  it("should identify 'time' as reserved word", () => {
    const tokens = tokenize("time ls");
    assertEquals(tokens[0]?.type, TokenType.TIME);
  });

  it("should identify 'coproc' as reserved word", () => {
    const tokens = tokenize("coproc cmd");
    assertEquals(tokens[0]?.type, TokenType.COPROC);
  });

  it("should not identify quoted reserved word", () => {
    const tokens = tokenize('"if"');
    assertEquals(tokens[0]?.type, TokenType.NAME); // "if" is still a valid NAME
    assertEquals(tokens[0]?.quoted, true);
  });
});

// =============================================================================
// Complex Scenarios
// =============================================================================

describe("Complex Scenarios", () => {
  it("should handle command substitution with case statement", () => {
    const tokens = tokenize("echo $(case $x in a) echo a;; esac)");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle command substitution with nested $()", () => {
    const tokens = tokenize("echo $(echo $(echo test))");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle comment in command substitution", () => {
    const tokens = tokenize("echo $(cmd # comment\nother)");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle case pattern in command substitution", () => {
    const tokens = tokenize("echo $(case x in (a) echo a;; esac)");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });

  it("should handle arithmetic context in command substitution", () => {
    const tokens = tokenize("echo $((1+2))");
    assertEquals(tokens[1]?.type, TokenType.WORD);
  });
});
