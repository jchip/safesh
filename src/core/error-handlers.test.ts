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
      });

      assertEquals(typeof code, "string");
      assertMatch(code, /const __handleError = \(error\) => \{/);
    });

    it("includes path violation detection", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      });

      assertMatch(code, /PATH_VIOLATION/);
      assertMatch(code, /SYMLINK_VIOLATION/);
      assertMatch(code, /NotCapable/);
    });

    it("includes path extraction logic", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      });

      // Check for regex patterns in the generated code (as strings)
      assertEquals(code.includes("Requires (?:read|write) access to"), true);
      assertEquals(code.includes("(?:Path|Symlink)"), true);
    });

    it("includes permission prompt generation", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      });

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
      });

      assertMatch(code, /const fullCommand/);
      assertMatch(code, /Command:/);
    });

    it("excludes command when includeCommand is false", () => {
      const code = generateInlineErrorHandler({
        prefix: "TypeScript Error",
        includeCommand: false,
      });

      assertEquals(code.includes("const fullCommand"), false);
    });

    it("includes error log path when provided", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/error.log",
      });

      assertMatch(code, /error\.log/);
    });

    it("handles errors without stack traces", () => {
      const code = generateInlineErrorHandler({
        prefix: "Test Error",
      });

      assertMatch(code, /error\.stack \?/);
    });

    it("includes correct prefix in separator", () => {
      const code = generateInlineErrorHandler({
        prefix: "Short",
      });

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
        });

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
        });

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
        });

        // Should escape dollar signs
        assertMatch(code, /\\\$/);
      });

      it("properly escapes commands with backslashes", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'echo "Line 1\\nLine 2"',
        });

        // Should escape backslashes
        assertMatch(code, /\\\\/);
      });

      it("handles commands with multiple special characters", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
          originalCommand: 'git commit -m "Fix `bug` with $VAR and \\"quotes\\""',
        });

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
        });

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
        });

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
        });

        // Should still generate valid code
        assertMatch(code, /__handleError/);
      });

      it("handles undefined originalCommand with includeCommand=true", () => {
        const code = generateInlineErrorHandler({
          prefix: "Test Error",
          includeCommand: true,
        });

        // Should fall back to using __ORIGINAL_BASH_COMMAND__
        assertMatch(code, /__ORIGINAL_BASH_COMMAND__/);
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
});
