/**
 * Comprehensive unit tests for the sed parser
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseMultipleScripts } from "./parser.ts";
import type {
  AddressRange,
  AppendCommand,
  BranchCommand,
  BranchOnNoSubstCommand,
  BranchOnSubstCommand,
  ChangeCommand,
  DeleteCommand,
  DeleteFirstLineCommand,
  ExecuteCommand,
  ExchangeCommand,
  GetAppendCommand,
  GetCommand,
  GroupCommand,
  HoldAppendCommand,
  HoldCommand,
  InsertCommand,
  LabelCommand,
  LineNumberCommand,
  ListCommand,
  NextAppendCommand,
  NextCommand,
  PrintCommand,
  PrintFilenameCommand,
  PrintFirstLineCommand,
  QuitCommand,
  QuitSilentCommand,
  ReadFileCommand,
  ReadFileLineCommand,
  SedAddress,
  SedCommand,
  StepAddress,
  SubstituteCommand,
  TransliterateCommand,
  VersionCommand,
  WriteFileCommand,
  WriteFirstLineCommand,
  ZapCommand,
} from "./types.ts";

describe("Sed Parser", () => {
  describe("Address Parsing", () => {
    describe("Line Numbers", () => {
      it("should parse single line number address", () => {
        const result = parseMultipleScripts(["3p"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as PrintCommand;
        assertEquals(cmd.type, "print");
        assertEquals(cmd.address?.start, 3);
        assertEquals(cmd.address?.end, undefined);
      });

      it("should parse line number range", () => {
        const result = parseMultipleScripts(["2,5p"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as PrintCommand;
        assertEquals(cmd.type, "print");
        assertEquals(cmd.address?.start, 2);
        assertEquals(cmd.address?.end, 5);
      });

      it("should parse dollar sign (last line) address", () => {
        const result = parseMultipleScripts(["$p"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as PrintCommand;
        assertEquals(cmd.type, "print");
        assertEquals(cmd.address?.start, "$");
        assertEquals(cmd.address?.end, undefined);
      });

      it("should parse range to last line", () => {
        const result = parseMultipleScripts(["5,$d"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as DeleteCommand;
        assertEquals(cmd.type, "delete");
        assertEquals(cmd.address?.start, 5);
        assertEquals(cmd.address?.end, "$");
      });
    });

    describe("Pattern Addresses", () => {
      it("should parse pattern address", () => {
        const result = parseMultipleScripts(["/pattern/p"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as PrintCommand;
        assertEquals(cmd.type, "print");
        const start = cmd.address?.start as { pattern: string };
        assertEquals(start.pattern, "pattern");
      });

      it("should parse pattern range", () => {
        const result = parseMultipleScripts(["/start/,/end/d"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as DeleteCommand;
        assertEquals(cmd.type, "delete");
        const start = cmd.address?.start as { pattern: string };
        const end = cmd.address?.end as { pattern: string };
        assertEquals(start.pattern, "start");
        assertEquals(end.pattern, "end");
      });

      it("should parse escaped pattern", () => {
        const result = parseMultipleScripts(["/\\/path\\/to\\/file/p"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as PrintCommand;
        const start = cmd.address?.start as { pattern: string };
        assertEquals(start.pattern, "\\/path\\/to\\/file");
      });

      it("should parse mixed line number and pattern", () => {
        const result = parseMultipleScripts(["5,/pattern/d"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as DeleteCommand;
        assertEquals(cmd.address?.start, 5);
        const end = cmd.address?.end as { pattern: string };
        assertEquals(end.pattern, "pattern");
      });
    });

    describe("Step Patterns", () => {
      it("should parse step pattern (every Nth line)", () => {
        const result = parseMultipleScripts(["1~2p"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as PrintCommand;
        const start = cmd.address?.start as StepAddress;
        assertEquals(start.first, 1);
        assertEquals(start.step, 2);
      });

      it("should parse step pattern starting from zero", () => {
        const result = parseMultipleScripts(["0~3d"]);
        assertEquals(result.error, undefined);
        assertEquals(result.commands.length, 1);

        const cmd = result.commands[0] as DeleteCommand;
        const start = cmd.address?.start as StepAddress;
        assertEquals(start.first, 0);
        assertEquals(start.step, 3);
      });
    });
  });

  describe("Substitute Command", () => {
    it("should parse basic substitution", () => {
      const result = parseMultipleScripts(["s/foo/bar/"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.type, "substitute");
      assertEquals(cmd.pattern, "foo");
      assertEquals(cmd.replacement, "bar");
      assertEquals(cmd.global, false);
      assertEquals(cmd.ignoreCase, false);
      assertEquals(cmd.printOnMatch, false);
    });

    it("should parse substitution with global flag", () => {
      const result = parseMultipleScripts(["s/foo/bar/g"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.global, true);
    });

    it("should parse substitution with case-insensitive flag", () => {
      const result = parseMultipleScripts(["s/foo/bar/i"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.ignoreCase, true);
    });

    it("should parse substitution with print flag", () => {
      const result = parseMultipleScripts(["s/foo/bar/p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.printOnMatch, true);
    });

    it("should parse substitution with multiple flags", () => {
      const result = parseMultipleScripts(["s/foo/bar/gip"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.global, true);
      assertEquals(cmd.ignoreCase, true);
      assertEquals(cmd.printOnMatch, true);
    });

    it("should parse substitution with nth occurrence", () => {
      const result = parseMultipleScripts(["s/foo/bar/2"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.nthOccurrence, 2);
    });

    it("should parse substitution with alternative delimiter", () => {
      const result = parseMultipleScripts(["s|foo|bar|"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.pattern, "foo");
      assertEquals(cmd.replacement, "bar");
    });

    it("should parse substitution with address", () => {
      const result = parseMultipleScripts(["3s/foo/bar/"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.address?.start, 3);
    });

    it("should parse substitution with escaped delimiter", () => {
      const result = parseMultipleScripts(["s/a\\/b/c\\/d/"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.pattern, "a\\/b");
      assertEquals(cmd.replacement, "c\\/d");
    });
  });

  describe("Delete Command", () => {
    it("should parse delete command", () => {
      const result = parseMultipleScripts(["d"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);

      const cmd = result.commands[0] as DeleteCommand;
      assertEquals(cmd.type, "delete");
    });

    it("should parse delete with address", () => {
      const result = parseMultipleScripts(["5d"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as DeleteCommand;
      assertEquals(cmd.address?.start, 5);
    });

    it("should parse delete first line command", () => {
      const result = parseMultipleScripts(["D"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as DeleteFirstLineCommand;
      assertEquals(cmd.type, "deleteFirstLine");
    });
  });

  describe("Print Commands", () => {
    it("should parse print command", () => {
      const result = parseMultipleScripts(["p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      assertEquals(cmd.type, "print");
    });

    it("should parse print first line command", () => {
      const result = parseMultipleScripts(["P"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintFirstLineCommand;
      assertEquals(cmd.type, "printFirstLine");
    });

    it("should parse address-only as print command", () => {
      const result = parseMultipleScripts(["3"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      assertEquals(cmd.type, "print");
      assertEquals(cmd.address?.start, 3);
    });
  });

  describe("Text Commands", () => {
    it("should parse append command", () => {
      const result = parseMultipleScripts(["a\\hello world"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as AppendCommand;
      assertEquals(cmd.type, "append");
      assertEquals(cmd.text, "hello world");
    });

    it("should parse insert command", () => {
      const result = parseMultipleScripts(["i\\hello world"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as InsertCommand;
      assertEquals(cmd.type, "insert");
      assertEquals(cmd.text, "hello world");
    });

    it("should parse change command", () => {
      const result = parseMultipleScripts(["c\\hello world"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ChangeCommand;
      assertEquals(cmd.type, "change");
      assertEquals(cmd.text, "hello world");
    });

    it("should parse text command with address", () => {
      const result = parseMultipleScripts(["5a\\new line"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as AppendCommand;
      assertEquals(cmd.address?.start, 5);
      assertEquals(cmd.text, "new line");
    });

    it("should parse text command without backslash", () => {
      const result = parseMultipleScripts(["a hello"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as AppendCommand;
      assertEquals(cmd.text, "hello");
    });
  });

  describe("Hold Space Commands", () => {
    it("should parse hold command", () => {
      const result = parseMultipleScripts(["h"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as HoldCommand;
      assertEquals(cmd.type, "hold");
    });

    it("should parse hold append command", () => {
      const result = parseMultipleScripts(["H"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as HoldAppendCommand;
      assertEquals(cmd.type, "holdAppend");
    });

    it("should parse get command", () => {
      const result = parseMultipleScripts(["g"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as GetCommand;
      assertEquals(cmd.type, "get");
    });

    it("should parse get append command", () => {
      const result = parseMultipleScripts(["G"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as GetAppendCommand;
      assertEquals(cmd.type, "getAppend");
    });

    it("should parse exchange command", () => {
      const result = parseMultipleScripts(["x"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ExchangeCommand;
      assertEquals(cmd.type, "exchange");
    });
  });

  describe("Next Commands", () => {
    it("should parse next command", () => {
      const result = parseMultipleScripts(["n"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as NextCommand;
      assertEquals(cmd.type, "next");
    });

    it("should parse next append command", () => {
      const result = parseMultipleScripts(["N"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as NextAppendCommand;
      assertEquals(cmd.type, "nextAppend");
    });
  });

  describe("Quit Commands", () => {
    it("should parse quit command", () => {
      const result = parseMultipleScripts(["q"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as QuitCommand;
      assertEquals(cmd.type, "quit");
    });

    it("should parse quit silent command", () => {
      const result = parseMultipleScripts(["Q"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as QuitSilentCommand;
      assertEquals(cmd.type, "quitSilent");
    });

    it("should parse quit with address", () => {
      const result = parseMultipleScripts(["5q"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as QuitCommand;
      assertEquals(cmd.address?.start, 5);
    });
  });

  describe("Transliterate Command", () => {
    it("should parse transliterate command", () => {
      const result = parseMultipleScripts(["y/abc/xyz/"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as TransliterateCommand;
      assertEquals(cmd.type, "transliterate");
      assertEquals(cmd.source, "abc");
      assertEquals(cmd.dest, "xyz");
    });

    it("should parse transliterate with alternative delimiter", () => {
      const result = parseMultipleScripts(["y|abc|xyz|"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as TransliterateCommand;
      assertEquals(cmd.source, "abc");
      assertEquals(cmd.dest, "xyz");
    });

    it("should return error for mismatched transliterate lengths", () => {
      const result = parseMultipleScripts(["y/abc/xy/"]);
      assertExists(result.error);
      assertEquals(result.error, "transliteration sets must have same length");
    });

    it("should parse transliterate with escaped characters", () => {
      const result = parseMultipleScripts(["y/a\\nb/x\\ny/"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as TransliterateCommand;
      assertEquals(cmd.source, "a\nb");
      assertEquals(cmd.dest, "x\ny");
    });
  });

  describe("Branch Commands", () => {
    it("should parse branch command without label", () => {
      const result = parseMultipleScripts(["b"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as BranchCommand;
      assertEquals(cmd.type, "branch");
      assertEquals(cmd.label, undefined);
    });

    it("should parse branch command with label", () => {
      const result = parseMultipleScripts(["b loop"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as BranchCommand;
      assertEquals(cmd.type, "branch");
      assertEquals(cmd.label, "loop");
    });

    it("should parse branch on substitution", () => {
      const result = parseMultipleScripts(["t done"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as BranchOnSubstCommand;
      assertEquals(cmd.type, "branchOnSubst");
      assertEquals(cmd.label, "done");
    });

    it("should parse branch on no substitution", () => {
      const result = parseMultipleScripts(["T retry"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as BranchOnNoSubstCommand;
      assertEquals(cmd.type, "branchOnNoSubst");
      assertEquals(cmd.label, "retry");
    });
  });

  describe("Label Commands", () => {
    it("should parse label definition", () => {
      const result = parseMultipleScripts([":loop"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as LabelCommand;
      assertEquals(cmd.type, "label");
      assertEquals(cmd.name, "loop");
    });

    it("should parse empty label", () => {
      const result = parseMultipleScripts([":"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as LabelCommand;
      assertEquals(cmd.type, "label");
      assertEquals(cmd.name, "");
    });
  });

  describe("Other Commands", () => {
    it("should parse line number command", () => {
      const result = parseMultipleScripts(["="]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as LineNumberCommand;
      assertEquals(cmd.type, "lineNumber");
    });

    it("should parse zap command", () => {
      const result = parseMultipleScripts(["z"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ZapCommand;
      assertEquals(cmd.type, "zap");
    });

    it("should parse list command", () => {
      const result = parseMultipleScripts(["l"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ListCommand;
      assertEquals(cmd.type, "list");
    });

    it("should parse print filename command", () => {
      const result = parseMultipleScripts(["F"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintFilenameCommand;
      assertEquals(cmd.type, "printFilename");
    });

    it("should parse version command", () => {
      const result = parseMultipleScripts(["v"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as VersionCommand;
      assertEquals(cmd.type, "version");
    });
  });

  describe("File Commands", () => {
    it("should parse read file command", () => {
      const result = parseMultipleScripts(["r input.txt"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ReadFileCommand;
      assertEquals(cmd.type, "readFile");
      assertEquals(cmd.filename, "input.txt");
    });

    it("should parse read file line command", () => {
      const result = parseMultipleScripts(["R input.txt"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ReadFileLineCommand;
      assertEquals(cmd.type, "readFileLine");
      assertEquals(cmd.filename, "input.txt");
    });

    it("should parse write file command", () => {
      const result = parseMultipleScripts(["w output.txt"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as WriteFileCommand;
      assertEquals(cmd.type, "writeFile");
      assertEquals(cmd.filename, "output.txt");
    });

    it("should parse write first line command", () => {
      const result = parseMultipleScripts(["W output.txt"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as WriteFirstLineCommand;
      assertEquals(cmd.type, "writeFirstLine");
      assertEquals(cmd.filename, "output.txt");
    });

    it("should parse file command with address", () => {
      const result = parseMultipleScripts(["5w output.txt"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as WriteFileCommand;
      assertEquals(cmd.address?.start, 5);
      assertEquals(cmd.filename, "output.txt");
    });
  });

  describe("Execute Command", () => {
    it("should parse execute command with command", () => {
      const result = parseMultipleScripts(["e echo hello"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ExecuteCommand;
      assertEquals(cmd.type, "execute");
      assertEquals(cmd.command, "echo hello");
    });

    it("should parse execute command without command", () => {
      const result = parseMultipleScripts(["e"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ExecuteCommand;
      assertEquals(cmd.type, "execute");
      assertEquals(cmd.command, undefined);
    });
  });

  describe("Grouped Commands", () => {
    it("should parse simple group", () => {
      const result = parseMultipleScripts(["{p;d}"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);

      const group = result.commands[0] as GroupCommand;
      assertEquals(group.type, "group");
      assertEquals(group.commands.length, 2);
      assertEquals(group.commands[0]?.type, "print");
      assertEquals(group.commands[1]?.type, "delete");
    });

    it("should parse group with address", () => {
      const result = parseMultipleScripts(["/pattern/{p;d}"]);
      assertEquals(result.error, undefined);

      const group = result.commands[0] as GroupCommand;
      assertExists(group.address);
      const start = group.address?.start as { pattern: string };
      assertEquals(start.pattern, "pattern");
    });

    it("should parse group with multiple commands", () => {
      const result = parseMultipleScripts(["{h;n;p;x}"]);
      assertEquals(result.error, undefined);

      const group = result.commands[0] as GroupCommand;
      assertEquals(group.commands.length, 4);
      assertEquals(group.commands[0]?.type, "hold");
      assertEquals(group.commands[1]?.type, "next");
      assertEquals(group.commands[2]?.type, "print");
      assertEquals(group.commands[3]?.type, "exchange");
    });

    it("should parse group with newlines", () => {
      const result = parseMultipleScripts(["{\np\nd\n}"]);
      assertEquals(result.error, undefined);

      const group = result.commands[0] as GroupCommand;
      assertEquals(group.commands.length, 2);
    });

    it("should return error for unmatched brace", () => {
      const result = parseMultipleScripts(["{p;d"]);
      assertExists(result.error);
      assertEquals(result.error, "unmatched brace in grouped commands");
    });
  });

  describe("Multiple Commands", () => {
    it("should parse multiple commands separated by semicolons", () => {
      const result = parseMultipleScripts(["p;d;h"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 3);
      assertEquals(result.commands[0]?.type, "print");
      assertEquals(result.commands[1]?.type, "delete");
      assertEquals(result.commands[2]?.type, "hold");
    });

    it("should parse multiple commands separated by newlines", () => {
      const result = parseMultipleScripts(["p\nd\nh"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 3);
    });

    it("should parse multiple scripts", () => {
      const result = parseMultipleScripts(["s/foo/bar/", "/test/d", "3p"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 3);
      assertEquals(result.commands[0]?.type, "substitute");
      assertEquals(result.commands[1]?.type, "delete");
      assertEquals(result.commands[2]?.type, "print");
    });

    it("should handle empty lines", () => {
      const result = parseMultipleScripts(["p\n\n\nd"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 2);
    });

    it("should handle trailing semicolons", () => {
      const result = parseMultipleScripts(["p;d;"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 2);
    });
  });

  describe("Comments", () => {
    it("should skip comments", () => {
      const result = parseMultipleScripts(["# comment\np\n# another\nd"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 2);
    });

    it("should skip inline comments", () => {
      const result = parseMultipleScripts(["p # inline comment"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);
    });
  });

  describe("Delimiter Handling", () => {
    it("should handle various delimiters in substitute", () => {
      const delimiters = ["/", "|", ":", "@", "#", "%"];
      for (const delim of delimiters) {
        const result = parseMultipleScripts([`s${delim}foo${delim}bar${delim}`]);
        assertEquals(result.error, undefined);
        const cmd = result.commands[0] as SubstituteCommand;
        assertEquals(cmd.pattern, "foo");
        assertEquals(cmd.replacement, "bar");
      }
    });

    it("should handle various delimiters in transliterate", () => {
      const delimiters = ["/", "|", ":", "@", "#", "%"];
      for (const delim of delimiters) {
        const result = parseMultipleScripts([`y${delim}abc${delim}xyz${delim}`]);
        assertEquals(result.error, undefined);
        const cmd = result.commands[0] as TransliterateCommand;
        assertEquals(cmd.source, "abc");
        assertEquals(cmd.dest, "xyz");
      }
    });
  });

  describe("Extended Regex Mode", () => {
    it("should pass extendedRegex flag to substitute command", () => {
      const result = parseMultipleScripts(["s/foo/bar/"], true);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.extendedRegex, true);
    });

    it("should not set extendedRegex flag by default", () => {
      const result = parseMultipleScripts(["s/foo/bar/"], false);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.extendedRegex, false);
    });
  });

  describe("Complex Scripts", () => {
    it("should parse script with labels and branches", () => {
      const result = parseMultipleScripts([
        ":loop",
        "s/foo/bar/",
        "t loop",
        "p",
      ]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 4);
      assertEquals(result.commands[0]?.type, "label");
      assertEquals(result.commands[1]?.type, "substitute");
      assertEquals(result.commands[2]?.type, "branchOnSubst");
      assertEquals(result.commands[3]?.type, "print");
    });

    it("should parse script with conditional and group", () => {
      const result = parseMultipleScripts(["/pattern/{h;s/foo/bar/;p}"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);

      const group = result.commands[0] as GroupCommand;
      assertEquals(group.type, "group");
      assertEquals(group.commands.length, 3);
    });

    it("should parse real-world script example", () => {
      const result = parseMultipleScripts([
        "# Remove blank lines",
        "/^$/d",
        "# Replace foo with bar globally",
        "s/foo/bar/g",
        "# Print line numbers for matches",
        "/pattern/{=;p}",
      ]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 3);
    });

    it("should parse grouped command script with range", () => {
      const result = parseMultipleScripts(["1,5{s/foo/bar/;p;d}"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);

      const group = result.commands[0] as GroupCommand;
      assertEquals(group.commands.length, 3);
      assertEquals(group.address?.start, 1);
      assertEquals(group.address?.end, 5);
    });
  });

  describe("Error Cases", () => {
    it("should return error for invalid command", () => {
      const result = parseMultipleScripts(["X"]);
      assertExists(result.error);
      assertEquals(result.error, "invalid command: X");
    });

    it("should return error for unmatched brace", () => {
      const result = parseMultipleScripts(["{p;d"]);
      assertExists(result.error);
    });

    it("should return error for unknown simple command", () => {
      const result = parseMultipleScripts(["k"]);
      assertExists(result.error);
      assertEquals(result.error, "invalid command: k");
    });

    it("should handle empty script", () => {
      const result = parseMultipleScripts([""]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 0);
    });

    it("should handle whitespace-only script", () => {
      const result = parseMultipleScripts(["   \n\n   "]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle command at end of script without terminator", () => {
      const result = parseMultipleScripts(["p"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 1);
    });

    it("should handle multiple semicolons", () => {
      const result = parseMultipleScripts(["p;;d"]);
      assertEquals(result.error, undefined);
      assertEquals(result.commands.length, 2);
    });

    it("should handle address range with same start and end", () => {
      const result = parseMultipleScripts(["5,5d"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as DeleteCommand;
      assertEquals(cmd.address?.start, 5);
      assertEquals(cmd.address?.end, 5);
    });

    it("should parse pattern with special regex characters", () => {
      const result = parseMultipleScripts(["/^.*$/p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      const start = cmd.address?.start as { pattern: string };
      assertEquals(start.pattern, "^.*$");
    });

    it("should handle empty pattern", () => {
      const result = parseMultipleScripts(["//p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      const start = cmd.address?.start as { pattern: string };
      assertEquals(start.pattern, "");
    });

    it("should handle substitute with empty pattern and replacement", () => {
      const result = parseMultipleScripts(["s///"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as SubstituteCommand;
      assertEquals(cmd.pattern, "");
      assertEquals(cmd.replacement, "");
    });

    it("should handle text command with empty text", () => {
      const result = parseMultipleScripts(["a\\"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as AppendCommand;
      assertEquals(cmd.text, "");
    });

    it("should handle file command with path containing spaces", () => {
      const result = parseMultipleScripts(["r /path/to/my file.txt"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as ReadFileCommand;
      assertEquals(cmd.filename, "/path/to/my file.txt");
    });
  });

  describe("Address Range Combinations", () => {
    it("should parse number to pattern range", () => {
      const result = parseMultipleScripts(["1,/end/p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      assertEquals(cmd.address?.start, 1);
      const end = cmd.address?.end as { pattern: string };
      assertEquals(end.pattern, "end");
    });

    it("should parse pattern to number range", () => {
      const result = parseMultipleScripts(["/start/,10p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      const start = cmd.address?.start as { pattern: string };
      assertEquals(start.pattern, "start");
      assertEquals(cmd.address?.end, 10);
    });

    it("should parse pattern to dollar range", () => {
      const result = parseMultipleScripts(["/start/,$d"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as DeleteCommand;
      const start = cmd.address?.start as { pattern: string };
      assertEquals(start.pattern, "start");
      assertEquals(cmd.address?.end, "$");
    });

    it("should parse dollar to dollar range", () => {
      const result = parseMultipleScripts(["$,$p"]);
      assertEquals(result.error, undefined);

      const cmd = result.commands[0] as PrintCommand;
      assertEquals(cmd.address?.start, "$");
      assertEquals(cmd.address?.end, "$");
    });
  });
});
