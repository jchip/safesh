/**
 * Unit tests for error-handlers.ts
 *
 * Tests the unified error detection and handling logic.
 */

import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  createErrorHandler,
  detectPathViolation,
  extractPathFromError,
  generateInlineErrorHandler,
  generatePathPromptMessage,
} from "./error-handlers.ts";

describe("error-handlers", () => {
  describe("detectPathViolation", () => {
    it("identifies SafeShell PATH_VIOLATION", () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/hosts' is outside allowed directories",
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, true);
      assertEquals(result.path, "/etc/hosts");
      assertEquals(result.errorCode, "PATH_VIOLATION");
    });

    it("identifies SafeShell SYMLINK_VIOLATION", () => {
      const error = {
        code: "SYMLINK_VIOLATION",
        message: "Symlink '/etc/hosts' points to '/private/etc/hosts' which is outside allowed directories",
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, true);
      assertEquals(result.path, "/private/etc/hosts"); // Should extract real path
      assertEquals(result.errorCode, "SYMLINK_VIOLATION");
    });

    it("identifies Deno NotCapable error by code", () => {
      const error = {
        code: "NotCapable",
        message: 'Requires read access to "/etc/passwd", run again with --allow-read',
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, true);
      assertEquals(result.path, "/etc/passwd");
      assertEquals(result.errorCode, "NotCapable");
    });

    it("identifies Deno NotCapable error by name", () => {
      const error = {
        name: "NotCapable",
        message: 'Requires write access to "/var/log/app.log"',
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, true);
      assertEquals(result.path, "/var/log/app.log");
    });

    it("identifies by message content (outside allowed directories)", () => {
      const error = {
        message: "Path '/home/user/.bashrc' is outside allowed directories",
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, true);
      assertEquals(result.path, "/home/user/.bashrc");
    });

    it("returns false for non-path-violation errors", () => {
      const error = {
        message: "TypeError: undefined is not a function",
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, false);
      assertEquals(result.path, undefined);
    });

    it("returns false for command failure errors", () => {
      const error = {
        message: "Pipeline failed: upstream command exited with code 1",
      };

      const result = detectPathViolation(error);

      assertEquals(result.isPathViolation, false);
    });
  });

  describe("extractPathFromError", () => {
    it("handles SafeShell PATH_VIOLATION format", () => {
      const message = "Path '/etc/hosts' is outside allowed directories";

      const result = extractPathFromError(message);

      assertEquals(result, "/etc/hosts");
    });

    it("handles SafeShell SYMLINK_VIOLATION format", () => {
      const message = "Symlink '/etc/hosts' points to '/private/etc/hosts' which is outside allowed directories";

      const result = extractPathFromError(message, "SYMLINK_VIOLATION");

      assertEquals(result, "/private/etc/hosts");
    });

    it("handles Deno read access format", () => {
      const message = 'Requires read access to "/etc/passwd", run again with --allow-read';

      const result = extractPathFromError(message);

      assertEquals(result, "/etc/passwd");
    });

    it("handles Deno write access format", () => {
      const message = 'Requires write access to "/var/log/app.log"';

      const result = extractPathFromError(message);

      assertEquals(result, "/var/log/app.log");
    });

    it("handles paths with spaces", () => {
      const message = 'Path \'/home/user/My Documents/file.txt\' is outside allowed directories';

      const result = extractPathFromError(message);

      assertEquals(result, "/home/user/My Documents/file.txt");
    });

    it("returns 'unknown' for unparseable messages", () => {
      const message = "Some random error message";

      const result = extractPathFromError(message);

      assertEquals(result, "unknown");
    });

    it("extracts symlink target path when error code is SYMLINK_VIOLATION", () => {
      const message = "Symlink '/usr/bin/node' points to '/opt/node/bin/node' which is outside";

      const result = extractPathFromError(message, "SYMLINK_VIOLATION");

      assertEquals(result, "/opt/node/bin/node");
    });

    it("extracts original path when not a symlink violation", () => {
      const message = "Path '/etc/shadow' is outside allowed directories";

      const result = extractPathFromError(message, "PATH_VIOLATION");

      assertEquals(result, "/etc/shadow");
    });
  });

  describe("generatePathPromptMessage", () => {
    it("includes the blocked path", () => {
      const message = generatePathPromptMessage("/etc/hosts", "12345-678");

      assertMatch(message, /PATH BLOCKED: \/etc\/hosts/);
    });

    it("includes all permission options", () => {
      const message = generatePathPromptMessage("/etc/hosts", "12345-678");

      // File-level options
      assertMatch(message, /r1, w1, rw1/);
      assertMatch(message, /r2, w2, rw2/);
      assertMatch(message, /r3, w3, rw3/);

      // Directory-level options
      assertMatch(message, /r1d, w1d, rw1d/);
      assertMatch(message, /r2d, w2d, rw2d/);
      assertMatch(message, /r3d, w3d, rw3d/);

      // Deny option
      assertMatch(message, /4\. Deny/);
    });

    it("includes directory path options", () => {
      const message = generatePathPromptMessage("/var/log/app.log", "12345-678");

      assertMatch(message, /Entire directory \/var\/log\//);
    });

    it("handles root directory files", () => {
      const message = generatePathPromptMessage("/hosts", "12345-678");

      // Should show root directory
      assertMatch(message, /Entire directory \//);
    });

    it("includes retry command with correct pending ID", () => {
      const pendingId = "1234567890-9999";
      const message = generatePathPromptMessage("/etc/passwd", pendingId);

      assertMatch(message, /desh retry-path --id=1234567890-9999/);
    });

    it("shows all three scope levels", () => {
      const message = generatePathPromptMessage("/home/user/file.txt", "test-id");

      // 1 = once, 2 = session, 3 = always
      assertMatch(message, /1\. Allow once/);
      assertMatch(message, /2\. Allow for session/);
      assertMatch(message, /3\. Always allow/);
    });
  });

  describe("createErrorHandler", () => {
    it("creates a function", () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
      });

      assertEquals(typeof handler, "function");
    });

    it("generates error message with prefix", () => {
      // This is hard to test directly since it calls Deno.exit
      // We can at least verify it's callable
      const handler = createErrorHandler({
        prefix: "TypeScript Error",
      });

      assertEquals(typeof handler, "function");
    });

    it("respects includeCommand option", () => {
      const handler = createErrorHandler({
        prefix: "Bash Command Error",
        includeCommand: true,
        originalCommand: "ls -la",
      });

      assertEquals(typeof handler, "function");
    });

    it("respects errorLogPath option", () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/error.log",
      });

      assertEquals(typeof handler, "function");
    });
  });

  describe("generateInlineErrorHandler", () => {
    it("generates JavaScript code as string", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      assertEquals(typeof code, "string");
      assertMatch(code, /const __handleError = \(error\) => \{/);
    });

    it("includes path violation detection", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      assertMatch(code, /PATH_VIOLATION/);
      assertMatch(code, /SYMLINK_VIOLATION/);
      assertMatch(code, /NotCapable/);
    });

    it("includes path extraction logic", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      // Check for regex patterns in the generated code (as strings)
      assertEquals(code.includes("Requires (?:read|write) access to"), true);
      assertEquals(code.includes("(?:Path|Symlink)"), true);
    });

    it("includes permission prompt generation", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      assertMatch(code, /PATH BLOCKED/);
      assertMatch(code, /Allow once/);
      assertMatch(code, /Allow for session/);
      assertMatch(code, /Always allow/);
      assertMatch(code, /desh retry-path/);
    });

    it("includes command when includeCommand is true", () => {
      const code = generateInlineErrorHandler({
        prefix: "Bash Command Error",
        includeCommand: true,
        originalCommand: "docker ps",
      }, false);

      assertMatch(code, /const fullCommand/);
      assertMatch(code, /Command:/);
    });

    it("excludes command when includeCommand is false", () => {
      const code = generateInlineErrorHandler({
        prefix: "TypeScript Error",
        includeCommand: false,
      }, false);

      assertEquals(code.includes("const fullCommand"), false);
    });

    it("includes error log path when provided", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/error.log",
      }, false);

      assertMatch(code, /error\.log/);
    });

    it("includes transpiled code when provided (SSH-475)", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        transpiledCode: '$.cmd("sleep", "10")',
      }, false);

      // Should include the transpiled code constant
      assertMatch(code, /const __TRANSPILED_CODE__/);
      assertMatch(code, /sleep/);
      // Should reference transpiled code in error log parts
      assertMatch(code, /Transpiled TypeScript/);
    });

    it("excludes transpiled code when not provided (SSH-475)", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      // Should NOT include the transpiled code constant
      assertEquals(code.includes("__TRANSPILED_CODE__"), false);
      assertEquals(code.includes("Transpiled TypeScript"), false);
    });

    it("handles errors without stack traces", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      assertMatch(code, /error\.stack \?/);
    });

    it("includes correct prefix in separator", () => {
      const code = generateInlineErrorHandler({
        prefix: "Short",
      }, false);

      // Separator should be "=" repeated (prefix.length + 8) times
      // "Short" = 5 chars, so 5 + 8 = 13 "=" characters
      assertMatch(code, /=============/) ;
    });

    // Bug fix tests (commits: fff217d, 9151561)
    describe("command escaping and embedding", () => {
      it("properly escapes commands with double quotes", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'git commit -m "Fix bug with quotes"',
        }, false);

        // Should define fullCommand in a template literal (backticks)
        assertMatch(code, /const fullCommand = `git commit -m "Fix bug with quotes"`/);
        // Should contain the command text
        assertMatch(code, /git commit -m/);
        // Template literals can safely contain double quotes, so this is OK
        assertEquals(code.includes('`git commit'), true, "Should use template literal");
      });

      it("properly escapes commands with backticks", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'echo `date`',
        }, false);

        // Should escape backticks
        assertMatch(code, /\\`/);
        // Should not break template literal syntax
        assertEquals(code.includes('`date`'), false, "Should not have unescaped backticks");
      });

      it("properly escapes commands with dollar signs", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'echo $HOME',
        }, false);

        // Should escape dollar signs
        assertMatch(code, /\\\$/);
      });

      it("properly escapes commands with backslashes", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'echo "Line 1\\nLine 2"',
        }, false);

        // Should escape backslashes
        assertMatch(code, /\\\\/);
      });

      it("handles commands with multiple special characters", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'git commit -m "Fix `bug` with $VAR and \\"quotes\\""',
        }, false);

        // Should contain the command text
        assertMatch(code, /git commit/);
        // Should have escaped special chars
        assertMatch(code, /\\\$/);
        assertMatch(code, /\\`/);
        assertMatch(code, /\\\\/);
      });

      it("uses template literal to safely contain injection attempts", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'malicious"; alert("xss")',
        }, false);

        // Should define the command in a template literal (which safely contains quotes)
        assertMatch(code, /const fullCommand = `malicious"; alert\("xss"\)`/);
        // The malicious string is contained safely in a template literal, not executable
        // The key is it's in backticks, not double quotes that could break out
        assertEquals(code.includes('const fullCommand = `'), true, "Should use template literal");
        // Should not be able to break out of the template literal
        assertEquals(code.includes('`; alert('), false, "Should not break out of template literal");
      });

      it("passes command as variable value not string literal", () => {
        // This tests the fix from commit fff217d
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'test command',
        }, false);

        // Should define fullCommand from template literal with escaped command
        assertMatch(code, /const fullCommand = `test command`/);
        // Should not have '${bashCommandEscaped}' as a literal string
        assertEquals(code.includes('${bashCommandEscaped}'), false, "Should not have variable interpolation in string");
      });

      it("handles empty command gracefully", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: '',
        }, false);

        // Should still generate valid code
        assertMatch(code, /__handleError/);
      });

      it("handles undefined originalCommand with includeCommand=true", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
        }, false);

        // Should fall back to using __ORIGINAL_BASH_COMMAND__
        assertMatch(code, /__ORIGINAL_BASH_COMMAND__/);
      });

      // SSH-403: Edge case tests for command escaping
      describe("SSH-403: additional edge cases", () => {
        it("handles commands with single quotes", () => {
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: "git commit -m 'Fix bug'",
          }, false);

          // Should contain the command with single quotes preserved
          assertMatch(code, /git commit -m 'Fix bug'/);
          // Should use template literal
          assertMatch(code, /const fullCommand = `git commit -m 'Fix bug'`/);
        });

        it("handles commands with mixed quotes", () => {
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: 'echo "It\'s working"',
          }, false);

          // Should preserve both double and single quotes
          assertMatch(code, /echo "It's working"/);
          // Should use template literal that can safely contain both quote types
          assertMatch(code, /const fullCommand = `echo "It's working"`/);
        });

        it("handles commands with newlines", () => {
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: 'git commit -m "Line 1\nLine 2"',
          }, false);

          // Should contain the git commit command
          assertMatch(code, /git commit -m "Line 1/);
          assertMatch(code, /Line 2"/);
          // Template literals can contain actual newlines, which is valid
          assertEquals(code.includes('git commit -m "Line 1\nLine 2"'), true, "Should preserve newlines in template literal");
        });

        it("handles very long commands", () => {
          const longCommand = 'echo "' + 'x'.repeat(10000) + '"';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: longCommand,
          }, false);

          // Should contain the echo command
          assertMatch(code, /echo "/);
          // Should generate valid code without truncation or corruption
          assertMatch(code, /__handleError/);
          // Should have the template literal assignment
          assertMatch(code, /const fullCommand = `/);
          // The generated code should contain a significant portion of the x's
          assertEquals(code.includes('x'.repeat(1000)), true, "Should preserve long command content");
        });

        it("handles commands with unicode characters", () => {
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: 'git commit -m "Fix 🐛 bug"',
          }, false);

          // Should preserve unicode emoji
          assertMatch(code, /Fix 🐛 bug/);
          // Should use template literal
          assertMatch(code, /const fullCommand = `git commit -m "Fix 🐛 bug"`/);
        });

        it("handles commands with multiple edge cases combined", () => {
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: 'git commit -m "Fix 🐛: It\'s working\\nLine 2"',
          }, false);

          // Should contain all the special elements
          assertMatch(code, /git commit/);
          assertMatch(code, /🐛/);
          assertMatch(code, /It's working/);
          assertMatch(code, /\\\\/); // Escaped backslash
        });
      });

      // SSH-404: Security tests for command injection prevention
      describe("SSH-404: command injection prevention", () => {
        it("safely escapes template literal escape attempts", () => {
          const maliciousCommand = 'test`; Deno.exit(0); console.log(`';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: maliciousCommand,
          }, false);

          // Should escape backticks to prevent breaking out of template literal
          assertMatch(code, /\\`/);
          // The escaped command should be safely contained in template literal
          assertMatch(code, /const fullCommand = `test\\`; Deno\.exit\(0\); console\.log\(\\``/);
          // Verify backticks are escaped (cannot break out of template literal)
          const unescapedBacktickPattern = /const fullCommand = `[^\\]`/;
          assertEquals(
            unescapedBacktickPattern.test(code),
            false,
            "Should not have unescaped backticks that could break out of template literal"
          );
        });

        it("safely escapes JavaScript code injection attempts", () => {
          const maliciousCommand = 'test"); Deno.exit(0); ("';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: maliciousCommand,
          }, false);

          // The malicious command is safely contained in a template literal
          // Double quotes and parentheses don't need escaping in template literals
          // They're just literal characters with no special meaning
          assertEquals(
            code.includes('const fullCommand = `test"); Deno.exit(0); ("`'),
            true,
            "Should contain the command safely in a template literal"
          );
          // Verify it's in a template literal (backticks), not double quotes
          assertEquals(
            code.includes('const fullCommand = "'),
            false,
            "Should not use double quotes which could be broken out of"
          );
          // The key security feature: using template literals instead of double quotes
          // means the "); cannot close a string and execute code
          assertEquals(
            code.includes('const fullCommand = `'),
            true,
            "Should use template literal for safe containment"
          );
        });

        it("safely escapes variable access attempts", () => {
          const maliciousCommand = 'test${Deno.env.get("SECRET")}test';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: maliciousCommand,
          }, false);

          // Should escape $ to prevent template literal interpolation
          assertMatch(code, /\\\$/);
          // The variable access should be rendered harmless
          assertMatch(code, /const fullCommand = `test\\\$\{Deno\.env\.get\("SECRET"\)\}test`/);
          // Should not have unescaped ${...} that could execute
          const hasUnescapedInterpolation = code.match(/const fullCommand = `[^\\]\$\{/);
          assertEquals(
            hasUnescapedInterpolation,
            null,
            "Should not have unescaped template literal interpolation"
          );
        });

        it("safely handles combined injection attempts", () => {
          const maliciousCommand = 'cmd`; ${Deno.env.get("KEY")}; Deno.exit(0); `';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: maliciousCommand,
          }, false);

          // Should escape all special characters
          assertMatch(code, /\\`/);
          assertMatch(code, /\\\$/);
          // Should not have any executable interpolation
          assertEquals(
            code.includes('`; ${Deno.env'),
            false,
            "Should not have unescaped injection vector"
          );
        });

        it("prevents code execution through nested template literals", () => {
          const maliciousCommand = 'test`${`${Deno.exit(0)}`}`';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: maliciousCommand,
          }, false);

          // All backticks should be escaped
          assertMatch(code, /\\`/);
          // All $ should be escaped
          assertMatch(code, /\\\$/);
          // Should not contain nested template literals
          const nestedBackticks = code.match(/`[^\\]`[^\\]`/);
          assertEquals(
            nestedBackticks,
            null,
            "Should not have nested unescaped template literals"
          );
        });

        it("handles shell command substitution attempts", () => {
          const maliciousCommand = 'test$(rm -rf /) `whoami` ${USER}';
          const code = generateInlineErrorHandler({
            prefix: "Test Error",
            includeCommand: true,
            originalCommand: maliciousCommand,
          }, false);

          // Should escape all special characters
          assertMatch(code, /\\\$/);
          assertMatch(code, /\\`/);
          // Command substitutions should be rendered harmless
          assertEquals(
            code.includes('\\$'),
            true,
            "Should escape dollar signs"
          );
          assertEquals(
            code.includes('\\`'),
            true,
            "Should escape backticks"
          );
        });
      });
    });

    it("uses Deno.writeTextFileSync for pending file, not writeJsonFileSync", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      // The inline handler must use Deno.writeTextFileSync + JSON.stringify
      // because writeJsonFileSync is not available in the generated script context
      assertEquals(code.includes("Deno.writeTextFileSync(pendingFile, JSON.stringify(pending"), true,
        "Should use Deno.writeTextFileSync with JSON.stringify");
      assertEquals(code.includes("writeJsonFileSync"), false,
        "Should NOT reference writeJsonFileSync which is unavailable at runtime");
    });

    it("ensures temp directory exists before writing pending file", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      }, false);

      // Should mkdir the temp root before writing
      assertEquals(code.includes("Deno.mkdirSync("), true,
        "Should ensure directory exists before writing pending file");
    });

    describe("includeListeners parameter", () => {
      it("includes event listeners when includeListeners is true (default)", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
        }); // Default is true

        assertMatch(code, /globalThis\.addEventListener\("error"/);
        assertMatch(code, /globalThis\.addEventListener\("unhandledrejection"/);
        assertMatch(code, /__handleError\(event\.error\)/);
        assertMatch(code, /__handleError\(event\.reason\)/);
      });

      it("includes event listeners when includeListeners is explicitly true", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
        }, true);

        assertMatch(code, /globalThis\.addEventListener\("error"/);
        assertMatch(code, /globalThis\.addEventListener\("unhandledrejection"/);
      });

      it("excludes event listeners when includeListeners is false", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
        }, false);

        assertEquals(code.includes("globalThis.addEventListener"), false);
        assertEquals(code.includes("event.error"), false);
        assertEquals(code.includes("event.reason"), false);
      });

      it("listeners call event.preventDefault()", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
        }, true);

        assertMatch(code, /event\.preventDefault\(\)/);
      });

      it("both listeners correctly pass errors to __handleError", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
        }, true);

        // Should have both event listeners that call __handleError
        const errorListener = code.match(/addEventListener\("error",.*?\{[^}]*__handleError\(event\.error\)/s);
        const rejectionListener = code.match(/addEventListener\("unhandledrejection",.*?\{[^}]*__handleError\(event\.reason\)/s);

        assertEquals(errorListener !== null, true, "Should have error listener");
        assertEquals(rejectionListener !== null, true, "Should have unhandledrejection listener");
      });
    });
  });

  describe("edge cases", () => {
    it("handles null error", () => {
      const result = detectPathViolation(null);

      assertEquals(result.isPathViolation, false);
    });

    it("handles undefined error", () => {
      const result = detectPathViolation(undefined);

      assertEquals(result.isPathViolation, false);
    });

    it("handles string error", () => {
      const result = detectPathViolation("Some error string");

      assertEquals(result.isPathViolation, false);
    });

    it("handles error with no message property", () => {
      const result = detectPathViolation({});

      assertEquals(result.isPathViolation, false);
    });

    it("extracts path from complex error messages", () => {
      const message = "Nested error: Path '/very/long/path/to/file.txt' is outside allowed directories (additional context)";

      const result = extractPathFromError(message);

      assertEquals(result, "/very/long/path/to/file.txt");
    });
  });

  // SSH-480: Generated code syntax validation tests
  describe("generated code syntax validation", () => {
    /**
     * Helper to validate that generated code is syntactically valid JavaScript
     * Uses Function constructor to parse without executing
     */
    function validateJavaScriptSyntax(code: string): { valid: boolean; error?: string } {
      try {
        // Wrap in async function to allow await in the code
        new Function(`return async function() { ${code} }`);
        return { valid: true };
      } catch (e) {
        return { valid: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    it("SSH-479 regression: generates valid array syntax with includeCommand=true", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        includeCommand: true,
        originalCommand: "docker ps",
      }, false);

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("SSH-479 regression: generates valid array syntax with transpiledCode", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        transpiledCode: 'await $.cmd("sleep", "10");',
      }, false);

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("SSH-479 regression: generates valid array syntax with both includeCommand and transpiledCode", () => {
      const code = generateInlineErrorHandler({
        prefix: "Bash Command Error",
        includeCommand: true,
        originalCommand: "for i in $(seq 1 10); do echo $i; done",
        transpiledCode: 'for await (const i of $.seq(1, 10)) { console.log(i); }',
      }, false);

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("SSH-479 regression: generates valid array syntax with errorLogPath", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/errors/test.log",
        includeCommand: true,
        originalCommand: "test command",
      }, false);

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("SSH-479 regression: generates valid array syntax with all options combined", () => {
      const code = generateInlineErrorHandler({
        prefix: "Complex Error",
        errorLogPath: "/tmp/safesh/errors/test.log",
        includeCommand: true,
        originalCommand: 'git commit -m "Fix bug"',
        transpiledCode: 'await $.cmd("git", "commit", "-m", "Fix bug");',
      }, false);

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("SSH-479 regression: generates valid array syntax with minimal options", () => {
      const code = generateInlineErrorHandler({
        prefix: "Minimal Error",
      }, false);

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("generates valid code with event listeners included", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        includeCommand: true,
        originalCommand: "test",
        transpiledCode: "console.log('test');",
        errorLogPath: "/tmp/error.log",
      }, true); // Include listeners

      const result = validateJavaScriptSyntax(code);
      assertEquals(result.valid, true, `Generated code has syntax error: ${result.error}`);
    });

    it("errorLogParts array has proper comma separation", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test",
        includeCommand: true,
        originalCommand: "test",
        transpiledCode: "test",
      }, false);

      // Extract the errorLogParts array from the code
      const arrayMatch = code.match(/const errorLogParts = \[([\s\S]*?)\]\.filter/);
      assertEquals(arrayMatch !== null, true, "Should contain errorLogParts array");

      // Each non-empty line in the array should end with a comma (except the last)
      const arrayContent = arrayMatch![1]!;
      const lines = arrayContent
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      // All lines except the last should end with comma
      for (let i = 0; i < lines.length - 1; i++) {
        assertEquals(
          lines[i]!.endsWith(','),
          true,
          `Line ${i + 1} should end with comma: "${lines[i]}"`
        );
      }
    });

    it("consoleMsg array has proper comma separation", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test",
        includeCommand: true,
        originalCommand: "test",
      }, false);

      // Extract the consoleMsg array from the code
      const arrayMatch = code.match(/const consoleMsg = \[([\s\S]*?)\]\.join/);
      assertEquals(arrayMatch !== null, true, "Should contain consoleMsg array");

      // Each non-empty line in the array should end with a comma (except the last)
      const arrayContent = arrayMatch![1]!;
      const lines = arrayContent
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      // All lines except the last should end with comma
      for (let i = 0; i < lines.length - 1; i++) {
        assertEquals(
          lines[i]!.endsWith(','),
          true,
          `Line ${i + 1} should end with comma: "${lines[i]}"`
        );
      }
    });
  });
});
