/**
 * Bug test: tee command should use $.cmd(), not $.tee() transform
 *
 * The bash `tee` command writes input to both stdout and files:
 *   echo "hello" | tee file.txt
 *
 * But $.tee() is a stream transform that expects a callback:
 *   stream.pipe($.tee((item) => console.error(item)))
 *
 * This test verifies that bash `tee` is transpiled to $.cmd("tee", ...)
 * instead of $.tee(...)
 */

import { assertStringIncludes, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

describe("Bug: tee Command Transpilation", () => {
  it("should transpile tee with file argument to $.cmd()", () => {
    const code = transpileBash("echo hello | tee output.txt");

    // Should use $.cmd("tee", "output.txt"), not $.tee()
    assertStringIncludes(code, '$.cmd("tee"');
    assertStringIncludes(code, '"output.txt"');

    // Should NOT use $.tee() transform
    assertEquals(code.includes(".pipe($.tee("), false);
  });

  it("should transpile tee with /dev/stderr", () => {
    const code = transpileBash("ps aux | grep process | tee /dev/stderr");

    // Should use $.cmd("tee", "/dev/stderr")
    assertStringIncludes(code, '$.cmd("tee"');
    assertStringIncludes(code, '"/dev/stderr"');

    // Should NOT use $.tee() transform
    assertEquals(code.includes(".pipe($.tee("), false);
  });

  it("should transpile tee with multiple files", () => {
    const code = transpileBash("echo data | tee file1.txt file2.txt");

    // Should use $.cmd("tee", "file1.txt", "file2.txt")
    assertStringIncludes(code, '$.cmd("tee"');
    assertStringIncludes(code, '"file1.txt"');
    assertStringIncludes(code, '"file2.txt"');
  });

  it("should transpile tee with -a flag (append)", () => {
    const code = transpileBash("echo data | tee -a log.txt");

    // Should use $.cmd("tee", "-a", "log.txt")
    assertStringIncludes(code, '$.cmd("tee"');
    assertStringIncludes(code, '"-a"');
    assertStringIncludes(code, '"log.txt"');
  });

  it("should handle the original failing command", () => {
    const code = transpileBash(`./bin/txcli-go ssh \\
      --relay-url https://relay.termxti.com \\
      --insecure \\
      --email test1@example.com \\
      --password 'Test123!@#' \\
      --agent 073820ba35fa2c97222d80575bb7bc0b2c36bed7249ef0dcafbd61b9b2989af0 \\
      --ssh-user jc \\
      --ssh-pass 'test' \\
      --command 'echo SSH_GO_CLI_TEST; hostname' \\
      -v 2>&1 | tee /dev/stderr`);

    // Should use $.cmd("tee", "/dev/stderr")
    assertStringIncludes(code, '$.cmd("tee"');

    // Should NOT use $.tee() transform which expects a function
    assertEquals(code.includes(".pipe($.tee("), false);
  });
});
