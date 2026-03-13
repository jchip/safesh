import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

describe("Bug: Double-Quoted Literals", () => {
  it("should preserve object literals inside node -e payloads", () => {
    const command =
      `node -e "const shell = require('shelljs'); const r = shell.exec('./mvnw compile -pl packages/db-schema -q', {cwd: '/Users/joel.chen/workspace/workflow-engine', silent: false}); process.exit(r.code);"`;
    const code = transpileBash(command);
    const payload =
      "const shell = require('shelljs'); const r = shell.exec('./mvnw compile -pl packages/db-schema -q', {cwd: '/Users/joel.chen/workspace/workflow-engine', silent: false}); process.exit(r.code);";

    assertStringIncludes(code, payload);
    assertEquals((code.match(/const shell = require\('shelljs'\)/g) ?? []).length, 1);
  });

  it("should not brace-expand literal text inside double quotes", () => {
    const code = transpileBash('echo "{a,b}"');

    assertStringIncludes(code, '"{a,b}"');
    assertEquals(code.includes('"a b"'), false);
  });
});
