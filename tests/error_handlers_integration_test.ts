/**
 * Integration Tests for Error Handler Flow
 *
 * Tests the complete error handling flow from detection to pending file creation
 * and error logging. Uses mocking to isolate tests and prevent actual process exits.
 *
 * Test Coverage:
 * 1. Path violation detection and pending file creation
 * 2. Error log flow and file writing
 * 3. Console output verification
 * 4. Integration between error detection and handling functions
 */

import { assertEquals, assertExists, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing@1/bdd";
import {
  createErrorHandler,
  detectPathViolation,
  extractOperationFromError,
  generatePathPromptMessage,
  handlePathViolationAndExit,
} from "../src/core/error-handlers.ts";
import { getTempRoot } from "../src/core/temp.ts";
import { readJsonFileSync } from "../src/core/io-utils.ts";
import type { PendingPathRequest } from "../src/core/pending.ts";

/**
 * Mock state for capturing test behavior
 */
interface MockState {
  exitCalled: boolean;
  exitCode?: number;
  consoleErrorCalls: string[];
  filesWritten: Map<string, string>;
  originalExit: typeof Deno.exit;
  originalConsoleError: typeof console.error;
  originalWriteTextFileSync: typeof Deno.writeTextFileSync;
}

let mockState: MockState;

/**
 * Setup mocks before each test
 * Mocks Deno.exit, console.error, and file writes
 */
function setupMocks() {
  mockState = {
    exitCalled: false,
    exitCode: undefined,
    consoleErrorCalls: [],
    filesWritten: new Map(),
    originalExit: Deno.exit,
    originalConsoleError: console.error,
    originalWriteTextFileSync: Deno.writeTextFileSync,
  };

  // Mock Deno.exit to prevent actual exit
  Deno.exit = ((code?: number) => {
    mockState.exitCalled = true;
    mockState.exitCode = code ?? 0;
    throw new Error("MOCKED_EXIT"); // Throw to stop execution
  }) as typeof Deno.exit;

  // Mock console.error to capture output
  console.error = (...args: any[]) => {
    const message = args.map(String).join(" ");
    mockState.consoleErrorCalls.push(message);
  };

  // Mock Deno.writeTextFileSync to capture file writes AND actually write them
  Deno.writeTextFileSync = (path: string | URL, data: string) => {
    const pathStr = typeof path === "string" ? path : path.pathname;
    mockState.filesWritten.set(pathStr, data);
    // Actually write the file so the system works properly
    try {
      mockState.originalWriteTextFileSync(pathStr, data);
    } catch (e) {
      // Ignore write errors in tests
    }
  };
}

/**
 * Restore original functions after each test
 */
function restoreMocks() {
  Deno.exit = mockState.originalExit;
  console.error = mockState.originalConsoleError;
  Deno.writeTextFileSync = mockState.originalWriteTextFileSync;
}

/**
 * Clean up temporary test files
 */
async function cleanupTempFiles() {
  try {
    const tempRoot = getTempRoot();
    const entries = Array.from(Deno.readDirSync(tempRoot));
    for (const entry of entries) {
      if (entry.name.startsWith("pending-path-") && entry.name.endsWith(".json")) {
        try {
          await Deno.remove(`${tempRoot}/${entry.name}`);
        } catch {
          // Ignore errors
        }
      }
    }
  } catch {
    // Ignore if temp root doesn't exist
  }
}

describe("Error Handler Integration Tests", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(async () => {
    restoreMocks();
    await cleanupTempFiles();
  });

  describe("Path Violation Flow", () => {
    it("detects path violation and creates pending file correctly", async () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/passwd' is outside allowed directories",
      };

      const testCwd = "/home/user/project";
      const testScriptHash = "abc123";

      // Call handlePathViolationAndExit
      try {
        handlePathViolationAndExit(error, {
          scriptHash: testScriptHash,
          cwd: testCwd,
        });
      } catch (e) {
        // Expected to throw MOCKED_EXIT
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify Deno.exit was called with code 1
      assertEquals(mockState.exitCalled, true);
      assertEquals(mockState.exitCode, 1);

      // Verify console.error was called with permission prompt
      assertEquals(mockState.consoleErrorCalls.length >= 1, true);
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "[SAFESH] PATH BLOCKED: /etc/passwd");
      assertStringIncludes(output, "Allow once");
      assertStringIncludes(output, "Allow for session");
      assertStringIncludes(output, "Always allow");
      assertStringIncludes(output, "desh retry-path --id=");

      // Verify pending file was created
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      // Verify pending file content
      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      assertExists(pendingContent);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.path, "/etc/passwd");
      assertEquals(pending.operation, "read");
      assertEquals(pending.cwd, testCwd);
      assertEquals(pending.scriptHash, testScriptHash);
      assertExists(pending.id);
      assertExists(pending.createdAt);
    });

    it("handles symlink violation and extracts real path", async () => {
      const error = {
        code: "SYMLINK_VIOLATION",
        message: "Symlink '/etc/hosts' points to '/private/etc/hosts' which is outside allowed directories",
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/test" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify the real path (not the symlink path) is used
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /private/etc/hosts");

      // Verify pending file has the real path
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.path, "/private/etc/hosts");
    });

    it("handles Deno NotCapable error format", async () => {
      const error = {
        code: "NotCapable",
        message: 'Requires read access to "/var/log/app.log", run again with --allow-read',
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/app" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify correct path was extracted
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /var/log/app.log");

      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.path, "/var/log/app.log");
    });

    it("generates unique pending IDs for concurrent requests", async () => {
      const error1 = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/file1' is outside allowed directories",
      };
      const error2 = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/file2' is outside allowed directories",
      };

      // First violation
      try {
        handlePathViolationAndExit(error1, { cwd: "/test" });
      } catch (e) {
        // Expected
      }
      const firstOutput = mockState.consoleErrorCalls.join("\n");
      const firstPendingId = firstOutput.match(/--id=([^ \n]+)/)?.[1];

      // Save first pending ID before resetting mocks
      const savedFirstId = firstPendingId;

      // Reset mock state for second violation
      mockState.consoleErrorCalls = [];
      mockState.exitCalled = false;
      mockState.filesWritten.clear();

      // Add small delay to ensure timestamp is different
      await new Promise((resolve) => setTimeout(resolve, 2));

      // Second violation
      try {
        handlePathViolationAndExit(error2, { cwd: "/test" });
      } catch (e) {
        // Expected
      }
      const secondOutput = mockState.consoleErrorCalls.join("\n");
      const secondPendingId = secondOutput.match(/--id=([^ \n]+)/)?.[1];

      // IDs should be different
      assertExists(savedFirstId);
      assertExists(secondPendingId);
      assertEquals(savedFirstId === secondPendingId, false);
    });

    it("handles write access violations", async () => {
      const error = {
        name: "NotCapable",
        message: 'Requires write access to "/var/log/output.txt"',
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/app" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify message shows correct path
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /var/log/output.txt");

      // Verify pending file is created
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      // SSH-502: Verify operation is "write" not "read"
      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.operation, "write");
    });

    it("SSH-502: sets operation to 'read' for read access violations", async () => {
      const error = {
        code: "NotCapable",
        message: 'Requires read access to "/var/log/app.log", run again with --allow-read',
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/app" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.operation, "read");
    });

    it("SSH-502: sets operation to 'write' for write access violations via Deno NotCapable", async () => {
      const error = {
        name: "NotCapable",
        message: 'Requires write access to "/tmp/output.txt", run again with --allow-write',
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/app" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.operation, "write");
    });

    it("SSH-502: defaults to 'read' for SafeShell PATH_VIOLATION errors", async () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/passwd' is outside allowed directories",
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/test" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.operation, "read");
    });

    it("handles path with spaces correctly", async () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/home/user/My Documents/file.txt' is outside allowed directories",
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/home/user" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /home/user/My Documents/file.txt");

      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.path, "/home/user/My Documents/file.txt");
    });

    it("shows correct directory path in prompt", async () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/var/log/app/debug.log' is outside allowed directories",
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/test" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Entire directory /var/log/app/");
    });

    it("handles gracefully when pending file write fails", async () => {
      // Mock write to throw error
      Deno.writeTextFileSync = () => {
        throw new Error("Write failed");
      };

      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/hosts' is outside allowed directories",
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/test" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should still exit and show message, but with warning
      assertEquals(mockState.exitCalled, true);
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Warning: Could not write pending path file");
      assertStringIncludes(output, "PATH BLOCKED: /etc/hosts");
    });
  });

  describe("Error Log Flow", () => {
    it("creates error log file for SafeShell errors", async () => {
      const handler = createErrorHandler({
        prefix: "TypeScript Error",
        errorLogPath: "/tmp/safesh/test-error.log",
        includeCommand: false,
      });

      const error = new Error("ReferenceError: foo is not defined");
      error.stack = "Error: ReferenceError\n  at <anonymous>:1:1";

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify exit was called
      assertEquals(mockState.exitCalled, true);
      assertEquals(mockState.exitCode, 1);

      // Verify error log was written
      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertExists(logFile);
      assertStringIncludes(logFile, "=== TypeScript Error ===");
      assertStringIncludes(logFile, "Error: ReferenceError: foo is not defined");
      assertStringIncludes(logFile, "Stack trace:");
      assertStringIncludes(logFile, "at <anonymous>:1:1");

      // Verify console output
      const consoleOutput = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(consoleOutput, "Error log: /tmp/safesh/test-error.log");
      assertStringIncludes(consoleOutput, "=== TypeScript Error ===");
    });

    it("includes command in error log when includeCommand is true", async () => {
      const handler = createErrorHandler({
        prefix: "Bash Command Error",
        errorLogPath: "/tmp/safesh/bash-error.log",
        includeCommand: true,
        originalCommand: "docker ps",
      });

      const error = new Error("Command not found: docker");

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const logFile = mockState.filesWritten.get("/tmp/safesh/bash-error.log");
      assertExists(logFile);
      assertStringIncludes(logFile, "Command: docker ps");
      assertStringIncludes(logFile, "Error: Command not found: docker");
    });

    it("does not create error log for command failure errors", async () => {
      const handler = createErrorHandler({
        prefix: "Bash Command Error",
        errorLogPath: "/tmp/safesh/test-error.log",
        includeCommand: false,
      });

      const error = new Error("Pipeline failed: upstream command exited with code 1");

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify no log file was written (command failures don't log)
      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertEquals(logFile, undefined);

      // But still outputs to console
      const consoleOutput = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(consoleOutput, "Pipeline failed");
    });

    it("handles error without stack trace", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/test-error.log",
      });

      const error = new Error("Simple error");
      delete (error as any).stack;

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertExists(logFile);
      assertStringIncludes(logFile, "Error: Simple error");
      // Should not have "Stack trace:" section
      assertEquals(logFile.includes("Stack trace:"), false);
    });

    it("handles gracefully when error log write fails", async () => {
      // Mock write to throw error for log file
      Deno.writeTextFileSync = (path: string | URL) => {
        const pathStr = typeof path === "string" ? path : path.pathname;
        if (pathStr.includes("error.log")) {
          throw new Error("Write failed");
        }
      };

      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/error.log",
      });

      try {
        handler(new Error("Test"));
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should still exit and output to console
      assertEquals(mockState.exitCalled, true);
      const consoleOutput = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(consoleOutput, "Warning: Could not write error log");
      assertStringIncludes(consoleOutput, "Test Error");
    });

    it("skips error log when errorLogPath is not provided", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        // No errorLogPath
      });

      try {
        handler(new Error("Test error"));
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // No log files should be written
      assertEquals(mockState.filesWritten.size, 0);

      // But error should still be output to console
      const consoleOutput = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(consoleOutput, "=== Test Error ===");
      assertStringIncludes(consoleOutput, "Error: Test error");
    });
  });

  describe("Console Output Verification", () => {
    it("outputs error message with correct format", async () => {
      const handler = createErrorHandler({
        prefix: "TypeScript Error",
      });

      try {
        handler(new Error("Syntax error"));
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      assertMatch(output, /^=== TypeScript Error ===/m);
      assertStringIncludes(output, "Error: Syntax error");
      assertMatch(output, /^========================/m);
    });

    it("outputs separator with correct length", async () => {
      const handler = createErrorHandler({
        prefix: "Short",
      });

      try {
        handler(new Error("Test"));
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      // "Short" = 5 chars, so 5 + 8 = 13 "=" characters
      assertMatch(output, /^=============$/m);
    });

    it("includes command in console output when specified", async () => {
      const handler = createErrorHandler({
        prefix: "Bash Error",
        includeCommand: true,
        originalCommand: "git push origin main",
      });

      try {
        handler(new Error("Permission denied"));
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Command: git push origin main");
      assertStringIncludes(output, "Error: Permission denied");
    });

    it("outputs stack trace when available", async () => {
      const handler = createErrorHandler({
        prefix: "Runtime Error",
      });

      const error = new Error("Test error");
      error.stack = "Error: Test error\n  at foo (file.ts:10:5)\n  at bar (file.ts:20:10)";

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Stack trace:");
      assertStringIncludes(output, "at foo (file.ts:10:5)");
      assertStringIncludes(output, "at bar (file.ts:20:10)");
    });
  });

  describe("Error Handler Prioritization", () => {
    it("prioritizes path violations over other errors", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/test-error.log",
      });

      // Error that is both a path violation and has other properties
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/passwd' is outside allowed directories",
        extraInfo: "some other error info",
      };

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should handle as path violation (create pending file, show prompt)
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /etc/passwd");
      assertStringIncludes(output, "desh retry-path");

      // Should NOT create error log file (path violations don't log)
      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertEquals(logFile, undefined);

      // Should have created pending file instead
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);
    });

    it("handles non-path-violation errors normally", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/test-error.log",
      });

      const error = new Error("Regular JavaScript error");

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should create error log (not a path violation)
      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertExists(logFile);
      assertStringIncludes(logFile, "Regular JavaScript error");

      // Should NOT create pending file
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 0);
    });
  });

  describe("Edge Cases", () => {
    it("handles errors with circular references gracefully", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
      });

      const error: any = new Error("Test");
      error.circular = error; // Create circular reference

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should not crash, should still output error
      assertEquals(mockState.exitCalled, true);
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Test Error");
    });

    it("handles Error subclasses correctly", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/test-error.log",
      });

      const error = new TypeError("Invalid type");

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertExists(logFile);
      assertStringIncludes(logFile, "Invalid type");
    });

    it("handles null error gracefully", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
      });

      try {
        handler(null);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should still exit and output something
      assertEquals(mockState.exitCalled, true);
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Test Error");
    });

    it("handles undefined error gracefully", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
      });

      try {
        handler(undefined);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      assertEquals(mockState.exitCalled, true);
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "Test Error");
    });

    it("handles string error", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
      });

      try {
        handler("String error message");
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "String error message");
    });

    it("handles error with empty message", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
      });

      const error = new Error("");

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should still output error header
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "=== Test Error ===");
    });

    it("handles very long error messages", async () => {
      const handler = createErrorHandler({
        prefix: "Test Error",
        errorLogPath: "/tmp/safesh/test-error.log",
      });

      const longMessage = "Error: " + "x".repeat(10000);
      const error = new Error(longMessage);

      try {
        handler(error);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should handle without crashing
      assertEquals(mockState.exitCalled, true);
      const logFile = mockState.filesWritten.get("/tmp/safesh/test-error.log");
      assertExists(logFile);
      assertStringIncludes(logFile, "x".repeat(1000));
    });

    it("handles path with unknown format", async () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Some weird error format without proper path",
      };

      try {
        handlePathViolationAndExit(error, { cwd: "/test" });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should still show prompt with "unknown" path
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: unknown");

      // Should still create pending file
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.path, "unknown");
    });
  });

  describe("Integration Flow Tests", () => {
    it("complete flow: detect -> extract -> prompt -> pending", async () => {
      const errorMessage = "Path '/home/user/.ssh/id_rsa' is outside allowed directories";
      const error = {
        code: "PATH_VIOLATION",
        message: errorMessage,
      };

      // Step 1: Detection
      const violation = detectPathViolation(error);
      assertEquals(violation.isPathViolation, true);
      assertEquals(violation.path, "/home/user/.ssh/id_rsa");

      // Step 2: Prompt generation
      const pendingId = "test-123-456";
      const prompt = generatePathPromptMessage(violation.path!, pendingId);
      assertStringIncludes(prompt, "PATH BLOCKED: /home/user/.ssh/id_rsa");
      assertStringIncludes(prompt, "desh retry-path --id=test-123-456");

      // Step 3: Full handler flow
      try {
        handlePathViolationAndExit(error, {
          scriptHash: "hash123",
          cwd: "/home/user",
        });
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Verify complete flow
      assertEquals(mockState.exitCalled, true);
      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /home/user/.ssh/id_rsa");

      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      const pendingContent = mockState.filesWritten.get(pendingFiles[0]!);
      const pending = JSON.parse(pendingContent!) as PendingPathRequest;
      assertEquals(pending.path, "/home/user/.ssh/id_rsa");
      assertEquals(pending.scriptHash, "hash123");
      assertEquals(pending.cwd, "/home/user");
    });

    it("error handler routes path violations to correct handler", async () => {
      const handler = createErrorHandler({
        prefix: "TypeScript Error",
        errorLogPath: "/tmp/safesh/ts-error.log",
      });

      const pathError = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/shadow' is outside allowed directories",
      };

      try {
        handler(pathError);
      } catch (e) {
        assertEquals((e as Error).message, "MOCKED_EXIT");
      }

      // Should route to path violation handler (not error log)
      const logFile = mockState.filesWritten.get("/tmp/safesh/ts-error.log");
      assertEquals(logFile, undefined);

      // Should have pending file
      const pendingFiles = Array.from(mockState.filesWritten.keys()).filter(
        (path) => path.includes("pending-path-")
      );
      assertEquals(pendingFiles.length, 1);

      const output = mockState.consoleErrorCalls.join("\n");
      assertStringIncludes(output, "PATH BLOCKED: /etc/shadow");
    });
  });

  describe("SSH-502: extractOperationFromError", () => {
    it("returns 'write' for Deno write access error", () => {
      assertEquals(
        extractOperationFromError('Requires write access to "/tmp/file.txt"'),
        "write",
      );
    });

    it("returns 'read' for Deno read access error", () => {
      assertEquals(
        extractOperationFromError('Requires read access to "/etc/passwd"'),
        "read",
      );
    });

    it("returns 'read' for SafeShell PATH_VIOLATION", () => {
      assertEquals(
        extractOperationFromError("Path '/etc/hosts' is outside allowed directories"),
        "read",
      );
    });

    it("returns 'read' for unknown error format", () => {
      assertEquals(
        extractOperationFromError("Some unknown error"),
        "read",
      );
    });
  });

  describe("SSH-502: detectPathViolation includes operation", () => {
    it("sets operation to 'read' for read access Deno error", () => {
      const error = {
        code: "NotCapable",
        message: 'Requires read access to "/var/log/app.log"',
      };
      const result = detectPathViolation(error);
      assertEquals(result.isPathViolation, true);
      assertEquals(result.operation, "read");
    });

    it("sets operation to 'write' for write access Deno error", () => {
      const error = {
        name: "NotCapable",
        message: 'Requires write access to "/tmp/output.txt"',
      };
      const result = detectPathViolation(error);
      assertEquals(result.isPathViolation, true);
      assertEquals(result.operation, "write");
    });

    it("sets operation to 'read' for PATH_VIOLATION (no write indicator)", () => {
      const error = {
        code: "PATH_VIOLATION",
        message: "Path '/etc/passwd' is outside allowed directories",
      };
      const result = detectPathViolation(error);
      assertEquals(result.isPathViolation, true);
      assertEquals(result.operation, "read");
    });

    it("does not set operation when not a path violation", () => {
      const error = { message: "Regular error" };
      const result = detectPathViolation(error);
      assertEquals(result.isPathViolation, false);
      assertEquals(result.operation, undefined);
    });
  });
});
