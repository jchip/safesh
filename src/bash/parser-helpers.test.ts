/**
 * Tests for Parser Helper Functions
 */

import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import {
  acceptButWarn,
  acceptButInfo,
  acceptButHint,
  acceptIf,
  acceptWithCompatibilityCheck,
  type AcceptResult,
} from "./parser-helpers.ts";
import { DiagnosticCollector } from "./diagnostic-collector.ts";
import type { DiagnosticCodeType } from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";

// Helper to create a test location
function createLoc(): SourceLocation {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 10, offset: 9 },
  };
}

describe("Parser Helpers", () => {
  describe("acceptButWarn", () => {
    it("should add warning and return value", () => {
      const collector = new DiagnosticCollector();
      const value = { type: "TestNode", value: 42 };
      const loc = createLoc();

      const result = acceptButWarn(
        collector,
        value,
        "SSH_2001" as DiagnosticCodeType,
        "Test warning message",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(true);
      expect(collector.hasWarnings()).toBe(true);
      expect(collector.warnings.length).toBe(1);
      expect(collector.warnings[0]!.code).toBe("SSH_2001");
      expect(collector.warnings[0]!.message).toBe("Test warning message");
      expect(collector.warnings[0]!.severity).toBe("warning");
    });

    it("should include context and fixHint when provided", () => {
      const collector = new DiagnosticCollector();
      const value = "test";
      const loc = createLoc();

      acceptButWarn(
        collector,
        value,
        "SSH_2001" as DiagnosticCodeType,
        "Variable should be quoted",
        loc,
        {
          context: "in command expansion",
          fixHint: 'Use "$variable" instead',
        },
      );

      expect(collector.warnings[0]!.context).toBe("in command expansion");
      expect(collector.warnings[0]!.fixHint).toBe('Use "$variable" instead');
    });
  });

  describe("acceptButInfo", () => {
    it("should add info and return value", () => {
      const collector = new DiagnosticCollector();
      const value = { type: "TestNode", value: 42 };
      const loc = createLoc();

      const result = acceptButInfo(
        collector,
        value,
        "SSH_2002" as DiagnosticCodeType,
        "Test info message",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(true);
      expect(collector.infos.length).toBe(1);
      expect(collector.infos[0]!.code).toBe("SSH_2002");
      expect(collector.infos[0]!.message).toBe("Test info message");
      expect(collector.infos[0]!.severity).toBe("info");
    });

    it("should not affect warnings or errors", () => {
      const collector = new DiagnosticCollector();
      const value = "test";
      const loc = createLoc();

      acceptButInfo(
        collector,
        value,
        "SSH_2002" as DiagnosticCodeType,
        "Info message",
        loc,
      );

      expect(collector.hasWarnings()).toBe(false);
      expect(collector.hasErrors()).toBe(false);
      expect(collector.infos.length).toBe(1);
    });
  });

  describe("acceptButHint", () => {
    it("should add hint and return value", () => {
      const collector = new DiagnosticCollector();
      const value = { type: "TestNode", value: 42 };
      const loc = createLoc();

      const result = acceptButHint(
        collector,
        value,
        "SSH_4001" as DiagnosticCodeType,
        "Test hint message",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(true);
      expect(collector.hints.length).toBe(1);
      expect(collector.hints[0]!.code).toBe("SSH_4001");
      expect(collector.hints[0]!.message).toBe("Test hint message");
      expect(collector.hints[0]!.severity).toBe("hint");
    });

    it("should include optional fields", () => {
      const collector = new DiagnosticCollector();
      const value = "test";
      const loc = createLoc();

      acceptButHint(
        collector,
        value,
        "SSH_4001" as DiagnosticCodeType,
        "Style hint",
        loc,
        {
          context: "in test expression",
          fixHint: "Use [[ ]] instead of [ ]",
        },
      );

      expect(collector.hints[0]!.context).toBe("in test expression");
      expect(collector.hints[0]!.fixHint).toBe("Use [[ ]] instead of [ ]");
    });
  });

  describe("acceptIf", () => {
    it("should add warning when condition is true", () => {
      const collector = new DiagnosticCollector();
      const value = "test";
      const loc = createLoc();

      const result = acceptIf(
        collector,
        value,
        true,
        "SSH_2001" as DiagnosticCodeType,
        "Conditional warning",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(true);
      expect(collector.hasWarnings()).toBe(true);
      expect(collector.warnings.length).toBe(1);
      expect(collector.warnings[0]!.message).toBe("Conditional warning");
    });

    it("should not add warning when condition is false", () => {
      const collector = new DiagnosticCollector();
      const value = "test";
      const loc = createLoc();

      const result = acceptIf(
        collector,
        value,
        false,
        "SSH_2001" as DiagnosticCodeType,
        "Should not appear",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(false);
      expect(collector.hasWarnings()).toBe(false);
      expect(collector.warnings.length).toBe(0);
    });

    it("should handle complex conditions", () => {
      const collector = new DiagnosticCollector();
      const value = { quoted: false, name: "var" };
      const loc = createLoc();

      const result = acceptIf(
        collector,
        value,
        !value.quoted,
        "SSH_2001" as DiagnosticCodeType,
        `Variable '${value.name}' should be quoted`,
        loc,
        { fixHint: `Use "$${value.name}" instead` },
      );

      expect(result.warned).toBe(true);
      expect(collector.warnings[0]!.message).toBe(
        "Variable 'var' should be quoted",
      );
      expect(collector.warnings[0]!.fixHint).toBe('Use "$var" instead');
    });
  });

  describe("acceptWithCompatibilityCheck", () => {
    it("should warn for unsupported features", () => {
      const collector = new DiagnosticCollector();
      const value = { type: "ArrayNode" };
      const loc = createLoc();

      const result = acceptWithCompatibilityCheck(
        collector,
        value,
        false, // feature not supported
        "bash arrays",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(true);
      expect(collector.hasWarnings()).toBe(true);
      expect(collector.warnings.length).toBe(1);
      expect(collector.warnings[0]!.code).toBe("SSH_3001");
      expect(collector.warnings[0]!.message).toBe(
        "Feature 'bash arrays' may not be supported in target shell",
      );
      expect(collector.warnings[0]!.fixHint).toBe(
        "Consider using POSIX-compatible alternatives",
      );
    });

    it("should not warn for supported features", () => {
      const collector = new DiagnosticCollector();
      const value = { type: "ArrayNode" };
      const loc = createLoc();

      const result = acceptWithCompatibilityCheck(
        collector,
        value,
        true, // feature supported
        "bash arrays",
        loc,
      );

      expect(result.value).toBe(value);
      expect(result.warned).toBe(false);
      expect(collector.hasWarnings()).toBe(false);
      expect(collector.warnings.length).toBe(0);
    });

    it("should handle different feature names", () => {
      const collector = new DiagnosticCollector();
      const value = "test";
      const loc = createLoc();

      acceptWithCompatibilityCheck(
        collector,
        value,
        false,
        "process substitution",
        loc,
      );

      expect(collector.warnings[0]!.message).toContain("process substitution");

      acceptWithCompatibilityCheck(
        collector,
        value,
        false,
        "[[ ]] test syntax",
        loc,
      );

      expect(collector.warnings[1]!.message).toContain("[[ ]] test syntax");
    });
  });

  describe("warned flag consistency", () => {
    it("should set warned=true for all warning functions", () => {
      const collector = new DiagnosticCollector();
      const loc = createLoc();

      const warn = acceptButWarn(
        collector,
        "v",
        "SSH_2001" as DiagnosticCodeType,
        "msg",
        loc,
      );
      const info = acceptButInfo(
        collector,
        "v",
        "SSH_2002" as DiagnosticCodeType,
        "msg",
        loc,
      );
      const hint = acceptButHint(
        collector,
        "v",
        "SSH_4001" as DiagnosticCodeType,
        "msg",
        loc,
      );

      expect(warn.warned).toBe(true);
      expect(info.warned).toBe(true);
      expect(hint.warned).toBe(true);
    });

    it("should set warned=false when no diagnostic emitted", () => {
      const collector = new DiagnosticCollector();
      const loc = createLoc();

      const ifResult = acceptIf(
        collector,
        "v",
        false,
        "SSH_2001" as DiagnosticCodeType,
        "msg",
        loc,
      );
      const compatResult = acceptWithCompatibilityCheck(
        collector,
        "v",
        true,
        "feature",
        loc,
      );

      expect(ifResult.warned).toBe(false);
      expect(compatResult.warned).toBe(false);
    });
  });

  describe("integration scenarios", () => {
    it("should handle multiple warnings on same value", () => {
      const collector = new DiagnosticCollector();
      const value = { type: "CommandNode", name: "cmd" };
      const loc = createLoc();

      const result1 = acceptButWarn(
        collector,
        value,
        "SSH_2001" as DiagnosticCodeType,
        "First warning",
        loc,
      );
      const result2 = acceptButWarn(
        collector,
        result1.value,
        "SSH_3001" as DiagnosticCodeType,
        "Second warning",
        loc,
      );

      expect(result2.value).toBe(value);
      expect(collector.warnings.length).toBe(2);
      expect(collector.warnings[0]!.message).toBe("First warning");
      expect(collector.warnings[1]!.message).toBe("Second warning");
    });

    it("should work with mixed diagnostic levels", () => {
      const collector = new DiagnosticCollector();
      const value = "node";
      const loc = createLoc();

      acceptButHint(
        collector,
        value,
        "SSH_4001" as DiagnosticCodeType,
        "Style hint",
        loc,
      );
      acceptButInfo(
        collector,
        value,
        "SSH_2002" as DiagnosticCodeType,
        "Info message",
        loc,
      );
      acceptButWarn(
        collector,
        value,
        "SSH_3001" as DiagnosticCodeType,
        "Warning message",
        loc,
      );

      expect(collector.hints.length).toBe(1);
      expect(collector.infos.length).toBe(1);
      expect(collector.warnings.length).toBe(1);
      expect(collector.count).toBe(3);
    });

    it("should preserve all diagnostic information", () => {
      const collector = new DiagnosticCollector();
      const value = { data: "test" };
      const loc: SourceLocation = {
        start: { line: 5, column: 10, offset: 50 },
        end: { line: 5, column: 20, offset: 60 },
      };

      acceptButWarn(
        collector,
        value,
        "SSH_2001" as DiagnosticCodeType,
        "Detailed warning",
        loc,
        {
          context: "in function definition",
          fixHint: "Add quotes around expansion",
        },
      );

      const warning = collector.warnings[0]!;
      expect(warning.loc.start.line).toBe(5);
      expect(warning.loc.start.column).toBe(10);
      expect(warning.loc.end.line).toBe(5);
      expect(warning.loc.end.column).toBe(20);
      expect(warning.context).toBe("in function definition");
      expect(warning.fixHint).toBe("Add quotes around expansion");
    });
  });

  describe("type safety", () => {
    it("should preserve value type", () => {
      const collector = new DiagnosticCollector();
      const loc = createLoc();

      interface CustomNode {
        type: string;
        id: number;
      }

      const node: CustomNode = { type: "Custom", id: 123 };
      const result: AcceptResult<CustomNode> = acceptButWarn(
        collector,
        node,
        "SSH_2001" as DiagnosticCodeType,
        "msg",
        loc,
      );

      // TypeScript should infer the correct type
      expect(result.value.type).toBe("Custom");
      expect(result.value.id).toBe(123);
    });

    it("should work with different value types", () => {
      const collector = new DiagnosticCollector();
      const loc = createLoc();

      const strResult = acceptButWarn(
        collector,
        "string",
        "SSH_2001" as DiagnosticCodeType,
        "msg",
        loc,
      );
      const numResult = acceptButWarn(
        collector,
        42,
        "SSH_2001" as DiagnosticCodeType,
        "msg",
        loc,
      );
      const objResult = acceptButWarn(
        collector,
        { a: 1 },
        "SSH_2001" as DiagnosticCodeType,
        "msg",
        loc,
      );

      expect(typeof strResult.value).toBe("string");
      expect(typeof numResult.value).toBe("number");
      expect(typeof objResult.value).toBe("object");
    });
  });
});
