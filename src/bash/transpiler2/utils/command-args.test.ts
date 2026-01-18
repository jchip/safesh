/**
 * Tests for command argument parsing utilities
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  parseCountArg,
  collectFlagOptions,
  collectFlagOptionsAndFiles,
} from "./command-args.ts";

describe("parseCountArg", () => {
  it("should parse -n with space", () => {
    const result = parseCountArg(["-n", "20", "file.txt"]);
    assertEquals(result, { count: 20, files: ["file.txt"] });
  });

  it("should parse -n without space", () => {
    const result = parseCountArg(["-n20", "file.txt"]);
    assertEquals(result, { count: 20, files: ["file.txt"] });
  });

  it("should parse -N shorthand", () => {
    const result = parseCountArg(["-20", "file.txt"]);
    assertEquals(result, { count: 20, files: ["file.txt"] });
  });

  it("should use default value when no count specified", () => {
    const result = parseCountArg(["file.txt"]);
    assertEquals(result, { count: 10, files: ["file.txt"] });
  });

  it("should use custom default value", () => {
    const result = parseCountArg(["file.txt"], 5);
    assertEquals(result, { count: 5, files: ["file.txt"] });
  });

  it("should handle multiple files", () => {
    const result = parseCountArg(["-n", "15", "file1.txt", "file2.txt"]);
    assertEquals(result, { count: 15, files: ["file1.txt", "file2.txt"] });
  });

  it("should ignore unknown flags", () => {
    const result = parseCountArg(["-v", "-n", "10", "file.txt"]);
    assertEquals(result, { count: 10, files: ["file.txt"] });
  });

  it("should handle no arguments", () => {
    const result = parseCountArg([]);
    assertEquals(result, { count: 10, files: [] });
  });

  it("should handle invalid count as default", () => {
    const result = parseCountArg(["-n", "invalid", "file.txt"]);
    assertEquals(result, { count: 10, files: ["file.txt"] });
  });
});

describe("collectFlagOptions", () => {
  it("should collect single flag", () => {
    const flagMap = { "-n": "numeric: true" };
    const result = collectFlagOptions(["-n"], flagMap);
    assertEquals(result, ["numeric: true"]);
  });

  it("should collect multiple flags", () => {
    const flagMap = { "-n": "numeric: true", "-r": "reverse: true" };
    const result = collectFlagOptions(["-n", "-r"], flagMap);
    assertEquals(result, ["numeric: true", "reverse: true"]);
  });

  it("should ignore unmapped flags", () => {
    const flagMap = { "-n": "numeric: true" };
    const result = collectFlagOptions(["-n", "-v", "-r"], flagMap);
    assertEquals(result, ["numeric: true"]);
  });

  it("should handle no flags", () => {
    const flagMap = { "-n": "numeric: true" };
    const result = collectFlagOptions([], flagMap);
    assertEquals(result, []);
  });

  it("should handle empty flag map", () => {
    const result = collectFlagOptions(["-n", "-r"], {});
    assertEquals(result, []);
  });
});

describe("collectFlagOptionsAndFiles", () => {
  it("should separate flags and files", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["-l", "file.txt"], flagMap);
    assertEquals(result, { options: ["lines: true"], files: ["file.txt"] });
  });

  it("should handle multiple flags and files", () => {
    const flagMap = { "-l": "lines: true", "-w": "words: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-w", "file1.txt", "file2.txt"], flagMap);
    assertEquals(result, {
      options: ["lines: true", "words: true"],
      files: ["file1.txt", "file2.txt"],
    });
  });

  it("should ignore unmapped flags", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-v", "file.txt"], flagMap);
    assertEquals(result, { options: ["lines: true"], files: ["file.txt"] });
  });

  it("should handle only flags", () => {
    const flagMap = { "-l": "lines: true", "-w": "words: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-w"], flagMap);
    assertEquals(result, { options: ["lines: true", "words: true"], files: [] });
  });

  it("should handle only files", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["file1.txt", "file2.txt"], flagMap);
    assertEquals(result, { options: [], files: ["file1.txt", "file2.txt"] });
  });

  it("should handle no arguments", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles([], flagMap);
    assertEquals(result, { options: [], files: [] });
  });

  it("should not include flag-like filenames starting with dash", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-unknownflag", "file.txt"], flagMap);
    // -unknownflag starts with dash but is not in flagMap, so it's treated as unknown flag and ignored
    assertEquals(result, { options: ["lines: true"], files: ["file.txt"] });
  });
});
