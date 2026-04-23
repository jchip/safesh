import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";

function transpileBash(bash: string): string {
  const ast = parse(bash);
  return transpile(ast);
}

async function captureFirstCmdArgs(bash: string): Promise<unknown[]> {
  const code = transpileBash(bash).replace(/^import .*;\n\n/, "");
  const calls: unknown[][] = [];
  const run = new Function(
    "$",
    "__printCmd",
    `${code}; return undefined;`,
  ) as ($: { cmd: (...args: unknown[]) => unknown }, __printCmd: (cmd: unknown) => unknown) => Promise<void>;

  await run(
    {
      cmd: (...args: unknown[]) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    async (cmd: unknown) => cmd,
  );

  return calls[0] ?? [];
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

  it("should preserve single-quoted JSON payloads in external command args", async () => {
    const args = await captureFirstCmdArgs(`curl -d '{"iplCode":"test"}'`);

    assertEquals(args, ["curl", "-d", '{"iplCode":"test"}']);
  });
});
