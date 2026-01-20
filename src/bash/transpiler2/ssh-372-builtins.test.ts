/**
 * SSH-372: Test shell builtin transpilation
 *
 * Tests that the transpiler generates correct $.builtin() calls
 * instead of $.cmd() for shell builtins like cd, pwd, echo, etc.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";

describe("SSH-372 - Shell Builtins", () => {
  it("should use $.cd for cd command", () => {
    const ast = parse("cd /tmp");
    const output = transpile(ast);

    assertStringIncludes(output, '$.cd("/tmp")');
    assertEquals(output.includes('$.cmd("cd"'), false, "Should not use $.cmd for cd");
  });

  it("should use $.pwd for pwd command", () => {
    const ast = parse("pwd");
    const output = transpile(ast);

    assertStringIncludes(output, '$.pwd()');
    assertEquals(output.includes('$.cmd("pwd"'), false, "Should not use $.cmd for pwd");
    // pwd is output type, so should print result
    assertStringIncludes(output, 'console.log');
  });

  it("should use $.echo for echo command", () => {
    const ast = parse("echo hello world");
    const output = transpile(ast);

    assertStringIncludes(output, '$.echo("hello", "world")');
    assertEquals(output.includes('$.cmd("echo"'), false, "Should not use $.cmd for echo");
  });

  it("should use $.pushd for pushd command", () => {
    const ast = parse("pushd /tmp");
    const output = transpile(ast);

    assertStringIncludes(output, '$.pushd("/tmp")');
    assertEquals(output.includes('$.cmd("pushd"'), false, "Should not use $.cmd for pushd");
  });

  it("should use $.popd for popd command", () => {
    const ast = parse("popd");
    const output = transpile(ast);

    assertStringIncludes(output, '$.popd()');
    assertEquals(output.includes('$.cmd("popd"'), false, "Should not use $.cmd for popd");
  });

  it("should use $.dirs for dirs command", () => {
    const ast = parse("dirs");
    const output = transpile(ast);

    assertStringIncludes(output, '$.dirs()');
    assertEquals(output.includes('$.cmd("dirs"'), false, "Should not use $.cmd for dirs");
    // dirs is output type, so should print result
    assertStringIncludes(output, 'console.log');
  });

  it("should use $.test for test command", () => {
    const ast = parse("test -f file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '$.test("-f", "file.txt")');
    assertEquals(output.includes('$.cmd("test"'), false, "Should not use $.cmd for test");
  });

  it("should use $.which for which command", () => {
    const ast = parse("which node");
    const output = transpile(ast);

    assertStringIncludes(output, '$.which("node")');
    assertEquals(output.includes('$.cmd("which"'), false, "Should not use $.cmd for which");
  });

  it("should use $.chmod for chmod command", () => {
    const ast = parse("chmod 755 file.sh");
    const output = transpile(ast);

    assertStringIncludes(output, '$.chmod("755", "file.sh")');
    assertEquals(output.includes('$.cmd("chmod"'), false, "Should not use $.cmd for chmod");
  });

  it("should use $.ln for ln command", () => {
    const ast = parse("ln -s source target");
    const output = transpile(ast);

    assertStringIncludes(output, '$.ln("-s", "source", "target")');
    assertEquals(output.includes('$.cmd("ln"'), false, "Should not use $.cmd for ln");
  });

  it("should use $.rm for rm command", () => {
    const ast = parse("rm file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '$.rm("file.txt")');
    assertEquals(output.includes('$.cmd("rm"'), false, "Should not use $.cmd for rm");
  });

  it("should use $.cp for cp command", () => {
    const ast = parse("cp source.txt dest.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '$.cp("source.txt", "dest.txt")');
    assertEquals(output.includes('$.cmd("cp"'), false, "Should not use $.cmd for cp");
  });

  it("should use $.mv for mv command", () => {
    const ast = parse("mv old.txt new.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '$.mv("old.txt", "new.txt")');
    assertEquals(output.includes('$.cmd("mv"'), false, "Should not use $.cmd for mv");
  });

  it("should use $.mkdir for mkdir command", () => {
    const ast = parse("mkdir new_dir");
    const output = transpile(ast);

    assertStringIncludes(output, '$.mkdir("new_dir")');
    assertEquals(output.includes('$.cmd("mkdir"'), false, "Should not use $.cmd for mkdir");
  });

  it("should use $.touch for touch command", () => {
    const ast = parse("touch file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '$.touch("file.txt")');
    assertEquals(output.includes('$.cmd("touch"'), false, "Should not use $.cmd for touch");
  });

  it("should use $.ls for ls command", () => {
    const ast = parse("ls -la");
    const output = transpile(ast);

    assertStringIncludes(output, '$.ls("-la")');
    assertEquals(output.includes('$.cmd("ls"'), false, "Should not use $.cmd for ls");
    // ls is output type, so should print result
    assertStringIncludes(output, 'console.log');
  });

  describe("Builtins with env assignments should use $.cmd()", () => {
    it("should use $.cmd() when cd has env assignment", () => {
      const ast = parse("VAR=value cd /tmp");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd');
      assertEquals(output.includes('$.cd'), false, "Should not use $.cd with env assignment");
    });

    it("should use $.cmd() when echo has env assignment", () => {
      const ast = parse("VAR=value echo hello");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd');
      assertEquals(output.includes('$.echo'), false, "Should not use $.echo with env assignment");
    });
  });

  describe("Builtins with redirections should use $.cmd()", () => {
    it("should use $.cmd() when echo has stdout redirection", () => {
      const ast = parse("echo hello > file.txt");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("echo"');
      assertEquals(output.includes('$.echo'), false, "Should not use $.echo with redirection");
    });

    it("should use $.cmd() when pwd has stdout redirection", () => {
      const ast = parse("pwd > current_dir.txt");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("pwd"');
      assertEquals(output.includes('$.pwd'), false, "Should not use $.pwd with redirection");
    });
  });

  describe("Builtins in pipelines should use $.cmd()", () => {
    it("should use $.cmd() when echo is in a pipeline", () => {
      const ast = parse("echo hello | grep h");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("echo"');
      assertEquals(output.includes('$.echo'), false, "Should not use $.echo in pipeline");
    });

    it("should use $.cmd() when ls is in a pipeline", () => {
      const ast = parse("ls | wc -l");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("ls"');
      assertEquals(output.includes('$.ls'), false, "Should not use $.ls in pipeline");
    });
  });

  describe("Builtin combinations", () => {
    it("should use $.cd and $.pwd in sequence", () => {
      const ast = parse("cd /tmp\npwd");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cd("/tmp")');
      assertStringIncludes(output, '$.pwd()');
    });

    it("should use $.mkdir and $.cd in sequence", () => {
      const ast = parse("mkdir new_dir\ncd new_dir");
      const output = transpile(ast);

      assertStringIncludes(output, '$.mkdir("new_dir")');
      assertStringIncludes(output, '$.cd("new_dir")');
    });

    it("should use $.echo multiple times", () => {
      const ast = parse("echo first\necho second\necho third");
      const output = transpile(ast);

      assertStringIncludes(output, '$.echo("first")');
      assertStringIncludes(output, '$.echo("second")');
      assertStringIncludes(output, '$.echo("third")');
    });
  });

  describe("Builtin output handling", () => {
    it("should wrap output type builtins with console.log", () => {
      const ast = parse("pwd");
      const output = transpile(ast);

      // pwd returns a value that should be printed
      assertStringIncludes(output, 'console.log($.pwd()');
    });

    it("should not await prints type builtins", () => {
      const ast = parse("echo hello");
      const output = transpile(ast);

      // echo already prints, should not be wrapped in await __printCmd
      assertEquals(output.includes('await'), false, "echo should not be awaited");
      assertStringIncludes(output, '$.echo("hello")');
    });

    it("should await async type builtins", () => {
      const ast = parse("test -f file.txt");
      const output = transpile(ast);

      // test is async and returns a result
      assertStringIncludes(output, '$.test');
    });

    it("should not await silent type builtins", () => {
      const ast = parse("cd /tmp");
      const output = transpile(ast);

      // cd is silent, just execute
      assertEquals(output.includes('await __printCmd($.cd'), false, "cd should not be wrapped in __printCmd");
      assertStringIncludes(output, '$.cd("/tmp")');
    });
  });
});