/**
 * Tests for centralized argument parser
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  createParser,
  type FlagDefinition,
  parseArgs,
  type ParseResult,
} from "./arg-parser.ts";

describe("parseArgs - boolean flags", () => {
  const defs: FlagDefinition[] = [
    { name: "ignoreCase", aliases: ["-i", "--ignore-case"], type: "boolean", default: false },
    { name: "invert", aliases: ["-v", "--invert"], type: "boolean", default: false },
    { name: "lineNumbers", aliases: ["-n", "--line-numbers"], type: "boolean", default: false },
  ];

  it("should parse single short boolean flag", () => {
    const result = parseArgs(["-i", "file.txt"], defs);
    assertEquals(result.flags.ignoreCase, true);
    assertEquals(result.flags.invert, false);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse multiple short boolean flags", () => {
    const result = parseArgs(["-i", "-v", "file.txt"], defs);
    assertEquals(result.flags.ignoreCase, true);
    assertEquals(result.flags.invert, true);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse long boolean flag", () => {
    const result = parseArgs(["--ignore-case", "file.txt"], defs);
    assertEquals(result.flags.ignoreCase, true);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse combined short boolean flags", () => {
    const result = parseArgs(["-iv", "file.txt"], defs);
    assertEquals(result.flags.ignoreCase, true);
    assertEquals(result.flags.invert, true);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse three combined short boolean flags", () => {
    const result = parseArgs(["-ivn", "file.txt"], defs);
    assertEquals(result.flags.ignoreCase, true);
    assertEquals(result.flags.invert, true);
    assertEquals(result.flags.lineNumbers, true);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should apply default values for unprovided flags", () => {
    const result = parseArgs(["file.txt"], defs);
    assertEquals(result.flags.ignoreCase, false);
    assertEquals(result.flags.invert, false);
    assertEquals(result.positional, ["file.txt"]);
  });

  it("should error on unknown flag", () => {
    const result = parseArgs(["-z", "file.txt"], defs);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("Unknown flag"), true);
  });

  it("should error on unknown flag in combined flags", () => {
    const result = parseArgs(["-iz", "file.txt"], defs);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("Unknown flag"), true);
  });

  it("should error on non-boolean flag in combined flags", () => {
    const defsWithNumber: FlagDefinition[] = [
      ...defs,
      { name: "count", aliases: ["-c"], type: "number" },
    ];
    const result = parseArgs(["-ic", "file.txt"], defsWithNumber);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("Non-boolean flag"), true);
  });
});

describe("parseArgs - number flags", () => {
  const defs: FlagDefinition[] = [
    { name: "count", aliases: ["-n", "--count"], type: "number", default: 10 },
    { name: "afterContext", aliases: ["-A", "--after"], type: "number", allowAttached: true },
  ];

  it("should parse number flag with space", () => {
    const result = parseArgs(["-n", "20", "file.txt"], defs);
    assertEquals(result.flags.count, 20);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse number flag with attached value", () => {
    const result = parseArgs(["-A3", "file.txt"], defs);
    assertEquals(result.flags.afterContext, 3);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse long flag with equals", () => {
    const result = parseArgs(["--count=15", "file.txt"], defs);
    assertEquals(result.flags.count, 15);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse long flag with space", () => {
    const result = parseArgs(["--count", "25", "file.txt"], defs);
    assertEquals(result.flags.count, 25);
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should error on missing value", () => {
    const result = parseArgs(["-n"], defs);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("requires a value"), true);
  });

  it("should error on invalid number", () => {
    const result = parseArgs(["-n", "abc", "file.txt"], defs);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("Expected number"), true);
  });

  it("should use default value when flag not provided", () => {
    const result = parseArgs(["file.txt"], defs);
    assertEquals(result.flags.count, 10);
  });

  it("should error on value for boolean flag with equals", () => {
    const defsWithBool: FlagDefinition[] = [
      { name: "verbose", aliases: ["--verbose"], type: "boolean" },
    ];
    const result = parseArgs(["--verbose=true"], defsWithBool);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("does not accept a value"), true);
  });
});

describe("parseArgs - string flags", () => {
  const defs: FlagDefinition[] = [
    { name: "delimiter", aliases: ["-d", "--delimiter"], type: "string", default: "," },
    { name: "pattern", aliases: ["-e", "--pattern"], type: "string", allowAttached: true },
  ];

  it("should parse string flag with space", () => {
    const result = parseArgs(["-d", ":", "file.txt"], defs);
    assertEquals(result.flags.delimiter, ":");
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse string flag with attached value", () => {
    const result = parseArgs(["-e.*error", "file.txt"], defs);
    assertEquals(result.flags.pattern, ".*error");
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse long flag with equals", () => {
    const result = parseArgs(["--delimiter=|", "file.txt"], defs);
    assertEquals(result.flags.delimiter, "|");
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should use default value when flag not provided", () => {
    const result = parseArgs(["file.txt"], defs);
    assertEquals(result.flags.delimiter, ",");
  });

  it("should allow empty string value", () => {
    const result = parseArgs(["-d", "", "file.txt"], defs);
    assertEquals(result.flags.delimiter, "");
    assertEquals(result.positional, ["file.txt"]);
  });
});

describe("parseArgs - positional arguments", () => {
  const defs: FlagDefinition[] = [
    { name: "verbose", aliases: ["-v"], type: "boolean" },
  ];

  it("should collect all positional arguments", () => {
    const result = parseArgs(["-v", "file1.txt", "file2.txt", "file3.txt"], defs);
    assertEquals(result.positional, ["file1.txt", "file2.txt", "file3.txt"]);
  });

  it("should handle no positional arguments", () => {
    const result = parseArgs(["-v"], defs);
    assertEquals(result.positional, []);
  });

  it("should handle only positional arguments", () => {
    const result = parseArgs(["file1.txt", "file2.txt"], defs);
    assertEquals(result.positional, ["file1.txt", "file2.txt"]);
  });

  it("should handle flags interspersed with positional args", () => {
    const result = parseArgs(["file1.txt", "-v", "file2.txt"], defs);
    assertEquals(result.flags.verbose, true);
    assertEquals(result.positional, ["file1.txt", "file2.txt"]);
  });
});

describe("parseArgs - double dash", () => {
  const defs: FlagDefinition[] = [
    { name: "verbose", aliases: ["-v"], type: "boolean" },
  ];

  it("should stop parsing flags after --", () => {
    const result = parseArgs(["-v", "--", "-not-a-flag", "file.txt"], defs);
    assertEquals(result.flags.verbose, true);
    assertEquals(result.positional, ["-not-a-flag", "file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should treat everything after -- as positional", () => {
    const result = parseArgs(["--", "-v", "--verbose"], defs);
    assertEquals(result.flags.verbose, undefined);
    assertEquals(result.positional, ["-v", "--verbose"]);
  });
});

describe("parseArgs - parser options", () => {
  const defs: FlagDefinition[] = [
    { name: "a", aliases: ["-a"], type: "boolean" },
    { name: "b", aliases: ["-b"], type: "boolean" },
  ];

  it("should disable combined flags when option set", () => {
    const result = parseArgs(["-ab"], defs, { allowCombinedFlags: false });
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.includes("Unknown flag"), true);
  });

  it("should allow flags after positional when option set", () => {
    const result = parseArgs(["file.txt", "-a"], defs, { allowFlagsAfterPositional: true });
    assertEquals(result.flags.a, true);
    assertEquals(result.positional, ["file.txt"]);
  });

  it("should not allow flags after positional when option disabled", () => {
    const result = parseArgs(["file.txt", "-a"], defs, { allowFlagsAfterPositional: false });
    assertEquals(result.flags.a, undefined);
    assertEquals(result.positional, ["file.txt", "-a"]);
  });

  it("should not stop at -- when option disabled", () => {
    const result = parseArgs(["-a", "--", "-b"], defs, { stopAtDoubleDash: false });
    assertEquals(result.flags.a, true);
    assertEquals(result.flags.b, true);
    assertEquals(result.positional, ["--"]);
  });
});

describe("createParser - helper function", () => {
  it("should create a reusable parser", () => {
    const defs: FlagDefinition[] = [
      { name: "verbose", aliases: ["-v"], type: "boolean", default: false },
      { name: "count", aliases: ["-n"], type: "number", default: 10 },
    ];

    const parser = createParser(defs);

    const result1 = parser(["-v", "file.txt"]);
    assertEquals(result1.flags.verbose, true);
    assertEquals(result1.positional, ["file.txt"]);

    const result2 = parser(["-n", "20", "file.txt"]);
    assertEquals(result2.flags.count, 20);
    assertEquals(result2.positional, ["file.txt"]);
  });

  it("should apply custom options", () => {
    const defs: FlagDefinition[] = [
      { name: "a", aliases: ["-a"], type: "boolean" },
      { name: "b", aliases: ["-b"], type: "boolean" },
    ];

    const parser = createParser(defs, { allowCombinedFlags: false });
    const result = parser(["-ab"]);
    assertEquals(result.errors.length > 0, true);
  });
});

describe("parseArgs - complex real-world scenarios", () => {
  it("should parse grep-like arguments", () => {
    const defs: FlagDefinition[] = [
      { name: "ignoreCase", aliases: ["-i", "--ignore-case"], type: "boolean" },
      { name: "invertMatch", aliases: ["-v", "--invert-match"], type: "boolean" },
      { name: "lineNumbers", aliases: ["-n", "--line-number"], type: "boolean" },
      { name: "afterContext", aliases: ["-A", "--after-context"], type: "number", allowAttached: true },
      { name: "beforeContext", aliases: ["-B", "--before-context"], type: "number", allowAttached: true },
    ];

    const result = parseArgs(["-in", "-A3", "pattern", "file.txt"], defs);
    assertEquals(result.flags.ignoreCase, true);
    assertEquals(result.flags.lineNumbers, true);
    assertEquals(result.flags.afterContext, 3);
    assertEquals(result.positional, ["pattern", "file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should parse sort-like arguments", () => {
    const defs: FlagDefinition[] = [
      { name: "numeric", aliases: ["-n", "--numeric-sort"], type: "boolean" },
      { name: "reverse", aliases: ["-r", "--reverse"], type: "boolean" },
      { name: "unique", aliases: ["-u", "--unique"], type: "boolean" },
      { name: "fieldDelimiter", aliases: ["-t", "--field-separator"], type: "string", allowAttached: true },
    ];

    const result = parseArgs(["-nr", "-t:", "file.txt"], defs);
    assertEquals(result.flags.numeric, true);
    assertEquals(result.flags.reverse, true);
    assertEquals(result.flags.fieldDelimiter, ":");
    assertEquals(result.positional, ["file.txt"]);
    assertEquals(result.errors, []);
  });

  it("should handle head/tail -n flag variations", () => {
    const defs: FlagDefinition[] = [
      { name: "lines", aliases: ["-n", "--lines"], type: "number", default: 10, allowAttached: true },
    ];

    // -n 20
    let result = parseArgs(["-n", "20", "file.txt"], defs);
    assertEquals(result.flags.lines, 20);

    // -n20
    result = parseArgs(["-n20", "file.txt"], defs);
    assertEquals(result.flags.lines, 20);

    // Default
    result = parseArgs(["file.txt"], defs);
    assertEquals(result.flags.lines, 10);
  });
});
