import { assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

describe("Bug: Tilde Expansion in String Contexts", () => {
  it("should use a template literal for static for-loop items with tilde expansion", () => {
    const code = transpileBash(
      "for jar in ~/.m2/repository/me/id/anaconda/schema-release/5.1.9/schema-release-5.1.9.jar; do echo $jar; done",
    );

    assertStringIncludes(
      code,
      'for (const jar of [`${Deno.env.get("HOME") || "~"}/.m2/repository/me/id/anaconda/schema-release/5.1.9/schema-release-5.1.9.jar`]) {',
    );
  });

  it("should use a template literal for redirection targets with tilde expansion", () => {
    const code = transpileBash("echo hi > ~/out.txt");

    assertStringIncludes(
      code,
      '.stdout(`${Deno.env.get("HOME") || "~"}/out.txt`)',
    );
  });

  it("should use template literals for array elements with tilde expansion", () => {
    const code = transpileBash("files=(~/one.txt ~/two.txt)");

    assertStringIncludes(
      code,
      'let files = [`${Deno.env.get("HOME") || "~"}/one.txt`, `${Deno.env.get("HOME") || "~"}/two.txt`];',
    );
  });
});
