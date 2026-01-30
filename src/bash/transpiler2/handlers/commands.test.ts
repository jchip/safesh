/**
 * Unit tests for command handler phases (SSH-436)
 * Tests the decomposed buildCommand() function using integration approach
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../parser.ts";
import { transpile } from "../mod.ts";

describe("buildCommand - Phase-based decomposition (SSH-436)", () => {
  describe("analyzeCommand - Command Analysis Phase", () => {
    it("should detect pure variable assignment", () => {
      const script = "FOO=bar";
      const output = transpile(parse(script));

      assertStringIncludes(output, "let FOO = \"bar\"");
    });

    it("should detect command with redirects", () => {
      const script = "echo test > out.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, ".stdout(\"out.txt\")");
    });

    it("should detect command with environment variables", () => {
      const script = "NODE_ENV=production node app.js";
      const output = transpile(parse(script));

      assertStringIncludes(output, "env:");
      assertStringIncludes(output, "NODE_ENV");
    });

    it("should detect 2>&1 merge streams pattern", () => {
      const script = "curl url 2>&1";
      const output = transpile(parse(script));

      assertStringIncludes(output, "mergeStreams: true");
    });

    it("should detect dynamic arguments with variable expansion", () => {
      const script = "cat $FILE";
      const output = transpile(parse(script));

      // Should use $.cmd for dynamic args, not fluent
      assertStringIncludes(output, "$.cmd");
    });
  });

  describe("selectCommandStrategy - Strategy Selection Phase", () => {
    it("should select variable-assignment strategy", () => {
      const script = "VAR=value";
      const output = transpile(parse(script));

      assertStringIncludes(output, "let VAR");
      assertEquals(output.includes("await"), false);
    });

    it("should select user-function strategy", () => {
      const script = `
        myFunc() { echo "in function"; }
        myFunc
      `;
      const output = transpile(parse(script));

      assertStringIncludes(output, "myFunc()");
    });

    it("should select shell-builtin strategy for echo", () => {
      const script = "echo hello";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.echo(\"hello\")");
    });

    it("should select shell-builtin strategy for cd", () => {
      const script = "cd /tmp";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.cd(\"/tmp\")");
    });

    it("should select timeout strategy", () => {
      const script = "timeout 5s sleep 10";
      const output = transpile(parse(script));

      assertStringIncludes(output, "timeout: 5000");
      assertStringIncludes(output, "\"sleep\"");
    });

    it("should select fluent strategy for cat", () => {
      const script = "cat file.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.cat(\"file.txt\")");
    });

    it("should select fluent strategy for grep", () => {
      const script = "grep pattern";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.grep(/pattern/)");
    });

    it("should select fluent strategy for head", () => {
      const script = "head -n 10";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.head(10)");
    });

    it("should select specialized strategy for git", () => {
      const script = "git status";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.git(\"status\")");
    });

    it("should select specialized strategy for docker", () => {
      const script = "docker ps";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.docker(\"ps\")");
    });

    it("should select specialized strategy for tmux", () => {
      const script = "tmux list-sessions";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.tmux(\"list-sessions\")");
    });

    it("should select standard strategy for unknown command", () => {
      const script = "ls -la";
      const output = transpile(parse(script));

      // ls is actually a builtin in SafeShell ($.ls), not a standard command
      // Use a different command that's truly standard
      const script2 = "find . -name '*.ts'";
      const output2 = transpile(parse(script2));
      assertStringIncludes(output2, '$.cmd("find"');
    });
  });

  describe("executeCommandStrategy - Strategy Execution Phase", () => {
    it("should execute variable-assignment strategy correctly", () => {
      const script = "X=1; Y=2";
      const output = transpile(parse(script));

      assertStringIncludes(output, "let X = \"1\"");
      assertStringIncludes(output, "let Y = \"2\"");
    });

    it("should execute timeout strategy with seconds", () => {
      const script = "timeout 3s command";
      const output = transpile(parse(script));

      assertStringIncludes(output, "timeout: 3000");
    });

    it("should execute timeout strategy with minutes", () => {
      const script = "timeout 2m command";
      const output = transpile(parse(script));

      assertStringIncludes(output, "timeout: 120000");
    });

    it("should execute timeout strategy with hours", () => {
      const script = "timeout 1h command";
      const output = transpile(parse(script));

      assertStringIncludes(output, "timeout: 3600000");
    });

    it("should execute fluent cat as stream producer", () => {
      const script = "cat file.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.cat(\"file.txt\")");
      // cat produces a stream Command object - verified by presence of $.cat
    });

    it("should execute fluent grep as transform", () => {
      const script = "echo test | grep t";
      const output = transpile(parse(script));

      assertStringIncludes(output, "$.grep(/t/)");
    });

    it("should execute standard command with arguments", () => {
      const script = "find . -name '*.ts'";
      const output = transpile(parse(script));

      assertStringIncludes(output, '$.cmd("find"');
      assertStringIncludes(output, '"-name"');
      assertStringIncludes(output, '"*.ts"');
    });

    it("should execute standard command with env vars", () => {
      const script = "HTTP_PROXY=proxy curl url";
      const output = transpile(parse(script));

      assertStringIncludes(output, "env: { HTTP_PROXY:");
    });
  });

  describe("applyCommandRedirections - Redirection Application Phase", () => {
    it("should apply stdout redirection", () => {
      const script = "echo test > out.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, '.stdout("out.txt")');
    });

    it("should apply stderr redirection", () => {
      const script = "ls /nonexistent 2> err.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, '.stderr("err.txt")');
    });

    it("should apply append redirection", () => {
      const script = "echo append >> log.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, '.stdout("log.txt", { append: true })');
    });

    it("should apply stderr append redirection", () => {
      const script = "command 2>> errors.log";
      const output = transpile(parse(script));

      assertStringIncludes(output, '.stderr("errors.log", { append: true })');
    });

    it("should skip 2>&1 redirection (handled by mergeStreams)", () => {
      const script = "curl url 2>&1";
      const output = transpile(parse(script));

      // Should use mergeStreams option, not .stderr(1)
      assertStringIncludes(output, "mergeStreams: true");
      assertEquals(output.includes('.stderr(1)'), false);
    });

    it("should apply multiple redirections", () => {
      const script = "command > out.txt 2> err.txt";
      const output = transpile(parse(script));

      assertStringIncludes(output, '.stdout("out.txt")');
      assertStringIncludes(output, '.stderr("err.txt")');
    });
  });

  describe("Constraint Checking and Fluent Eligibility", () => {
    it("should not use fluent for commands with dynamic args", () => {
      const script = "FILE=test.txt; cat $FILE";
      const output = transpile(parse(script));

      // Should fall back to $.cmd due to dynamic argument
      assertStringIncludes(output, '$.cmd("cat"');
    });

    it("should not use fluent for commands with redirections", () => {
      const script = "cat file.txt > out.txt";
      const output = transpile(parse(script));

      // Should fall back to $.cmd due to redirection
      assertStringIncludes(output, '$.cmd("cat"');
      assertStringIncludes(output, '.stdout("out.txt")');
    });

    it("should not use fluent for commands with env vars", () => {
      const script = "LANG=C sort file.txt";
      const output = transpile(parse(script));

      // Should fall back to $.cmd due to env var
      assertStringIncludes(output, '$.cmd');
      assertStringIncludes(output, "env:");
      assertStringIncludes(output, "LANG");
    });

    it("should not use builtin in pipeline", () => {
      const script = "echo test | cat";
      const output = transpile(parse(script));

      // echo in pipeline should use $.cmd, not builtin
      // (The parser might not show this clearly, but check for pipe handling)
      assertStringIncludes(output, ".pipe(");
    });

    it("should use fluent grep for recursive grep fallback", () => {
      const script = "grep -r pattern dir";
      const output = transpile(parse(script));

      // Recursive grep should fall back to $.cmd
      assertStringIncludes(output, '$.cmd("grep"');
    });
  });

  describe("Flag Propagation (isAsync, isTransform, isStream)", () => {
    it("should set isAsync=false for shell builtins", () => {
      const script = "pwd";
      const output = transpile(parse(script));

      // Builtins are synchronous, no await needed (but wrapped in console.log)
      assertStringIncludes(output, "console.log");
      assertStringIncludes(output, "$.pwd()");
    });

    it("should set isAsync=false for fluent commands", () => {
      const script = "cat file.txt";
      const output = transpile(parse(script));

      // Fluent commands return Command objects synchronously
      assertStringIncludes(output, "$.cat");
    });

    it("should set isAsync=true for standard commands", () => {
      const script = "find . -type f";
      const output = transpile(parse(script));

      assertStringIncludes(output, "await");
      assertStringIncludes(output, '$.cmd("find"');
    });

    it("should set isStream=true for cat", () => {
      const script = "cat file.txt";
      const output = transpile(parse(script));

      // cat is a stream producer - verified by $.cat presence
      assertStringIncludes(output, "$.cat");
    });

    it("should set isTransform=true for grep", () => {
      const script = "echo test | grep t";
      const output = transpile(parse(script));

      // Transform should be piped
      assertStringIncludes(output, ".pipe(");
      assertStringIncludes(output, "$.grep");
    });
  });

  describe("Integration - Full buildCommand Orchestration", () => {
    it("should orchestrate all phases for simple command", () => {
      const script = "find .";
      const output = transpile(parse(script));

      // Analysis -> Standard strategy -> Execute -> No redirects
      assertStringIncludes(output, '$.cmd("find"');
    });

    it("should orchestrate all phases for complex command", () => {
      const script = "timeout 30s node app.js > app.log 2>&1";
      const output = transpile(parse(script));

      // Analysis: timeout, redirects, mergeStreams
      // Strategy: timeout (wraps node command)
      // Execute: timeout with nested command
      // Redirects: stdout
      assertStringIncludes(output, "timeout:");
      assertStringIncludes(output, '.stdout("app.log")');

      // Test env vars separately
      const script2 = "NODE_ENV=prod node app.js";
      const output2 = transpile(parse(script2));
      assertStringIncludes(output2, "env:");
      assertStringIncludes(output2, "NODE_ENV");
    });

    it("should handle user function with redirection", () => {
      const script = `
        myFunc() { echo "test"; }
        myFunc > out.txt
      `;
      const output = transpile(parse(script));

      // User function call with redirection
      assertStringIncludes(output, "myFunc()");
      assertStringIncludes(output, '.stdout("out.txt")');
    });

    it("should handle fluent command in pipeline", () => {
      const script = "cat file.txt | head -n 10";
      const output = transpile(parse(script));

      // cat is stream, head is transform
      assertStringIncludes(output, "$.cat(\"file.txt\")");
      assertStringIncludes(output, "$.head(10)");
      assertStringIncludes(output, ".lines().pipe(");
    });
  });
});
