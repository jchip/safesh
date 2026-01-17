/**
 * SSH-372: Test shell builtin transpilation
 *
 * Tests that the transpiler generates correct __builtin() calls
 * instead of $.cmd() for shell builtins like cd, pwd, echo, etc.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";

describe("SSH-372 - Shell Builtins", () => {
  it("should use __cd for cd command", () => {
    const ast = parse("cd /tmp");
    const output = transpile(ast);

    assertStringIncludes(output, '__cd("/tmp")');
    assertEquals(output.includes('$.cmd("cd"'), false, "Should not use $.cmd for cd");
  });

  it("should use __pwd for pwd command", () => {
    const ast = parse("pwd");
    const output = transpile(ast);

    assertStringIncludes(output, '__pwd()');
    assertEquals(output.includes('$.cmd("pwd"'), false, "Should not use $.cmd for pwd");
    // pwd is output type, so should print result
    assertStringIncludes(output, 'console.log');
  });

  it("should use __echo for echo command", () => {
    const ast = parse("echo hello world");
    const output = transpile(ast);

    assertStringIncludes(output, '__echo("hello", "world")');
    assertEquals(output.includes('$.cmd("echo"'), false, "Should not use $.cmd for echo");
  });

  it("should use __pushd for pushd command", () => {
    const ast = parse("pushd /tmp");
    const output = transpile(ast);

    assertStringIncludes(output, '__pushd("/tmp")');
    assertEquals(output.includes('$.cmd("pushd"'), false, "Should not use $.cmd for pushd");
  });

  it("should use __popd for popd command", () => {
    const ast = parse("popd");
    const output = transpile(ast);

    assertStringIncludes(output, '__popd()');
    assertEquals(output.includes('$.cmd("popd"'), false, "Should not use $.cmd for popd");
  });

  it("should use __dirs for dirs command", () => {
    const ast = parse("dirs");
    const output = transpile(ast);

    assertStringIncludes(output, '__dirs()');
    assertEquals(output.includes('$.cmd("dirs"'), false, "Should not use $.cmd for dirs");
    // dirs is output type, so should print result
    assertStringIncludes(output, 'console.log');
  });

  it("should use __test for test command", () => {
    const ast = parse("test -f file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '__test("-f", "file.txt")');
    assertEquals(output.includes('$.cmd("test"'), false, "Should not use $.cmd for test");
  });

  it("should use __which for which command", () => {
    const ast = parse("which node");
    const output = transpile(ast);

    assertStringIncludes(output, '__which("node")');
    assertEquals(output.includes('$.cmd("which"'), false, "Should not use $.cmd for which");
  });

  it("should use __chmod for chmod command", () => {
    const ast = parse("chmod 755 file.sh");
    const output = transpile(ast);

    assertStringIncludes(output, '__chmod("755", "file.sh")');
    assertEquals(output.includes('$.cmd("chmod"'), false, "Should not use $.cmd for chmod");
  });

  it("should use __ln for ln command", () => {
    const ast = parse("ln -s source target");
    const output = transpile(ast);

    assertStringIncludes(output, '__ln("-s", "source", "target")');
    assertEquals(output.includes('$.cmd("ln"'), false, "Should not use $.cmd for ln");
  });

  it("should use __rm for rm command", () => {
    const ast = parse("rm file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '__rm("file.txt")');
    assertEquals(output.includes('$.cmd("rm"'), false, "Should not use $.cmd for rm");
  });

  it("should use __cp for cp command", () => {
    const ast = parse("cp source.txt dest.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '__cp("source.txt", "dest.txt")');
    assertEquals(output.includes('$.cmd("cp"'), false, "Should not use $.cmd for cp");
  });

  it("should use __mv for mv command", () => {
    const ast = parse("mv old.txt new.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '__mv("old.txt", "new.txt")');
    assertEquals(output.includes('$.cmd("mv"'), false, "Should not use $.cmd for mv");
  });

  it("should use __mkdir for mkdir command", () => {
    const ast = parse("mkdir new_dir");
    const output = transpile(ast);

    assertStringIncludes(output, '__mkdir("new_dir")');
    assertEquals(output.includes('$.cmd("mkdir"'), false, "Should not use $.cmd for mkdir");
  });

  it("should use __touch for touch command", () => {
    const ast = parse("touch file.txt");
    const output = transpile(ast);

    assertStringIncludes(output, '__touch("file.txt")');
    assertEquals(output.includes('$.cmd("touch"'), false, "Should not use $.cmd for touch");
  });

  it("should use __ls for ls command", () => {
    const ast = parse("ls -la");
    const output = transpile(ast);

    assertStringIncludes(output, '__ls("-la")');
    assertEquals(output.includes('$.cmd("ls"'), false, "Should not use $.cmd for ls");
    // ls is output type, so should print result
    assertStringIncludes(output, 'console.log');
  });

  describe("Builtins with env assignments should use $.cmd()", () => {
    it("should use $.cmd() when cd has env assignment", () => {
      const ast = parse("VAR=value cd /tmp");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd');
      assertEquals(output.includes('__cd'), false, "Should not use __cd with env assignment");
    });

    it("should use $.cmd() when echo has env assignment", () => {
      const ast = parse("VAR=value echo hello");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd');
      assertEquals(output.includes('__echo'), false, "Should not use __echo with env assignment");
    });
  });

  describe("Builtins with redirections should use $.cmd()", () => {
    it("should use $.cmd() when echo has stdout redirection", () => {
      const ast = parse("echo hello > file.txt");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("echo"');
      assertEquals(output.includes('__echo'), false, "Should not use __echo with redirection");
    });

    it("should use $.cmd() when pwd has stdout redirection", () => {
      const ast = parse("pwd > current_dir.txt");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("pwd"');
      assertEquals(output.includes('__pwd'), false, "Should not use __pwd with redirection");
    });
  });

  describe("Builtins in pipelines should use $.cmd()", () => {
    it("should use $.cmd() when echo is in a pipeline", () => {
      const ast = parse("echo hello | grep h");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("echo"');
      assertEquals(output.includes('__echo'), false, "Should not use __echo in pipeline");
    });

    it("should use $.cmd() when ls is in a pipeline", () => {
      const ast = parse("ls | wc -l");
      const output = transpile(ast);

      assertStringIncludes(output, '$.cmd("ls"');
      assertEquals(output.includes('__ls'), false, "Should not use __ls in pipeline");
    });
  });

  describe("Builtin combinations", () => {
    it("should use __cd and __pwd in sequence", () => {
      const ast = parse("cd /tmp\npwd");
      const output = transpile(ast);

      assertStringIncludes(output, '__cd("/tmp")');
      assertStringIncludes(output, '__pwd()');
    });

    it("should use __mkdir and __cd in sequence", () => {
      const ast = parse("mkdir new_dir\ncd new_dir");
      const output = transpile(ast);

      assertStringIncludes(output, '__mkdir("new_dir")');
      assertStringIncludes(output, '__cd("new_dir")');
    });

    it("should use __echo multiple times", () => {
      const ast = parse("echo first\necho second\necho third");
      const output = transpile(ast);

      assertStringIncludes(output, '__echo("first")');
      assertStringIncludes(output, '__echo("second")');
      assertStringIncludes(output, '__echo("third")');
    });
  });

  describe("Builtin output handling", () => {
    it("should wrap output type builtins with console.log", () => {
      const ast = parse("pwd");
      const output = transpile(ast);

      // pwd returns a value that should be printed
      assertStringIncludes(output, 'console.log(__pwd()');
    });

    it("should not await prints type builtins", () => {
      const ast = parse("echo hello");
      const output = transpile(ast);

      // echo already prints, should not be wrapped in await __printCmd
      assertEquals(output.includes('await'), false, "echo should not be awaited");
      assertStringIncludes(output, '__echo("hello")');
    });

    it("should await async type builtins", () => {
      const ast = parse("test -f file.txt");
      const output = transpile(ast);

      // test is async and returns a result
      assertStringIncludes(output, 'await __printCmd(__test');
    });

    it("should not await silent type builtins", () => {
      const ast = parse("cd /tmp");
      const output = transpile(ast);

      // cd is silent, just execute
      assertEquals(output.includes('await __printCmd(__cd'), false, "cd should not be wrapped in __printCmd");
      assertStringIncludes(output, '__cd("/tmp")');
    });
  });
});
