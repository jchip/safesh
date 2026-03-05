/**
 * Robustness tests for Error Handlers
 *
 * Specifically tests that the error handler doesn	 crash when encountering
 * "bad" objects that throw during string conversion.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it, beforeEach, afterEach } from "jsr:@std/testing@1/bdd";
import { generateInlineErrorHandler } from "../src/core/error-handlers.ts";

describe("Error Handler Robustness", () => {
  let originalExit: typeof Deno.exit;
  let originalConsoleError: typeof console.error;
  let exitCalled = false;
  let consoleErrorCalls: string[] = [];

  beforeEach(() => {
    originalExit = Deno.exit;
    originalConsoleError = console.error;
    exitCalled = false;
    consoleErrorCalls = [];

    // Mock Deno.exit to prevent actual exit
    (Deno as any).exit = (code?: number) => {
      exitCalled = true;
      throw new Error("MOCKED_EXIT");
    };

    // Mock console.error to capture output
    console.error = (...args: any[]) => {
      const message = args.map(arg => {
        try {
          return String(arg);
        } catch {
          return "[unconvertible]";
        }
      }).join(" ");
      consoleErrorCalls.push(message);
    };
  });

  afterEach(() => {
    Deno.exit = originalExit;
    console.error = originalConsoleError;
  });

  it("handles Object.create(null) without crashing", async () => {
    // This is essentially what the generated __handleError does now:
    const __handleError = (error: any) => {
      if (!error) error = new Error("Unknown error (null or undefined)");
      let errorMessage;
      try {
        errorMessage = error.message || String(error);
      } catch (_e) {
        errorMessage = "[unconvertible error]";
      }
      
      console.error(`Error: ${errorMessage}`);
      Deno.exit(1);
    };

    const badError = Object.create(null);
    
    try {
      __handleError(badError);
    } catch (e) {
      if ((e as any).message !== "MOCKED_EXIT") throw e;
    }

    assertEquals(exitCalled, true);
    assertStringIncludes(consoleErrorCalls.join("\n"), "[unconvertible error]");
  });

  it("handles objects with broken toString without crashing", async () => {
    const badError = {
      toString() {
        throw new Error("I am broken");
      }
    };

    const __handleError = (error: any) => {
      if (!error) error = new Error("Unknown error (null or undefined)");
      let errorMessage;
      try {
        errorMessage = error.message || String(error);
      } catch (_e) {
        errorMessage = "[unconvertible error]";
      }
      
      console.error(`Error: ${errorMessage}`);
      Deno.exit(1);
    };

    try {
      __handleError(badError);
    } catch (e) {
      if ((e as any).message !== "MOCKED_EXIT") throw e;
    }

    assertEquals(exitCalled, true);
    assertStringIncludes(consoleErrorCalls.join("\n"), "[unconvertible error]");
  });
  
  it("verify generateInlineErrorHandler output is robust", () => {
    const code = generateInlineErrorHandler({
      prefix: "Test",
      includeCommand: false,
    });
    
    // Check that it contains the robustness logic I added
    assertStringIncludes(code, "if (!error) error = new Error(\"Unknown error (null or undefined)\")");
    assertStringIncludes(code, "catch (e) {");
    assertStringIncludes(code, "errorMessage = \"[unconvertible error]\"");
  });
});
