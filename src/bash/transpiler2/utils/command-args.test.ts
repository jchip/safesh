/**
 * Tests for command argument parsing utilities
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  collectFlagOptions,
  collectFlagOptionsAndFiles,
  parseCountArg,
  parseTailCountArg,
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

describe("parseTailCountArg", () => {
  it("should parse +N with -n as from-start", () => {
    const result = parseTailCountArg(["-n", "+3", "file.txt"]);
    assertEquals(result, { count: 3, files: ["file.txt"], fromStart: true });
  });

  it("should parse inline -n+N as from-start", () => {
    const result = parseTailCountArg(["-n+2", "file.txt"]);
    assertEquals(result, { count: 2, files: ["file.txt"], fromStart: true });
  });

  it("should keep normal tail count semantics without plus", () => {
    const result = parseTailCountArg(["-n", "4", "file.txt"]);
    assertEquals(result, { count: 4, files: ["file.txt"], fromStart: false });
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
    assertEquals(result, { options: ["lines: true"], files: ["file.txt"], unknownFlags: [] });
  });

  it("should handle multiple flags and files", () => {
    const flagMap = { "-l": "lines: true", "-w": "words: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-w", "file1.txt", "file2.txt"], flagMap);
    assertEquals(result, {
      options: ["lines: true", "words: true"],
      files: ["file1.txt", "file2.txt"],
      unknownFlags: [],
    });
  });

  it("should report unmapped flags so the caller can fall back (SSH-616)", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-v", "file.txt"], flagMap);
    assertEquals(result, {
      options: ["lines: true"],
      files: ["file.txt"],
      unknownFlags: ["-v"],
    });
  });

  it("should report value-bearing and partially-known short flags as unknown (SSH-616)", () => {
    const flagMap = { "-n": "numeric: true", "-r": "reverse: true" };
    // `sort -k2` and the partially-known combo `sort -rk2` must force a fallback.
    assertEquals(collectFlagOptionsAndFiles(["-k2", "data.txt"], flagMap), {
      options: [],
      files: ["data.txt"],
      unknownFlags: ["-k2"],
    });
    assertEquals(collectFlagOptionsAndFiles(["-rk2"], flagMap), {
      options: [],
      files: [],
      unknownFlags: ["-rk2"],
    });
  });

  it("should handle only flags", () => {
    const flagMap = { "-l": "lines: true", "-w": "words: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-w"], flagMap);
    assertEquals(result, {
      options: ["lines: true", "words: true"],
      files: [],
      unknownFlags: [],
    });
  });

  it("should handle only files", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["file1.txt", "file2.txt"], flagMap);
    assertEquals(result, { options: [], files: ["file1.txt", "file2.txt"], unknownFlags: [] });
  });

  it("should handle no arguments", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles([], flagMap);
    assertEquals(result, { options: [], files: [], unknownFlags: [] });
  });

  it("should treat dash-prefixed non-flags as unknown flags, never filenames", () => {
    const flagMap = { "-l": "lines: true" };
    const result = collectFlagOptionsAndFiles(["-l", "-unknownflag", "file.txt"], flagMap);
    // -unknownflag is not in flagMap, so it's reported for fallback (never a file).
    assertEquals(result, {
      options: ["lines: true"],
      files: ["file.txt"],
      unknownFlags: ["-unknownflag"],
    });
  });
});
