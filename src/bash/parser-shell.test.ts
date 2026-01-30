/**
 * Tests for Parser shell dialect support.
 */

import { assertEquals, assertExists } from "@std/assert";
import { Parser, parse, parseWithRecovery } from "./parser.ts";
import { Shell } from "./shell-dialect.ts";

Deno.test("Parser defaults to Bash", () => {
  const parser = new Parser("echo hello");
  assertEquals(parser.getShell(), Shell.Bash);
});

Deno.test("Parser accepts shell parameter", () => {
  const parser = new Parser("echo hello", Shell.Sh);
  assertEquals(parser.getShell(), Shell.Sh);
});

Deno.test("Parser accepts Dash shell", () => {
  const parser = new Parser("echo hello", Shell.Dash);
  assertEquals(parser.getShell(), Shell.Dash);
});

Deno.test("Parser accepts Ksh shell", () => {
  const parser = new Parser("echo hello", Shell.Ksh);
  assertEquals(parser.getShell(), Shell.Ksh);
});

Deno.test("Parser accepts Zsh shell", () => {
  const parser = new Parser("echo hello", Shell.Zsh);
  assertEquals(parser.getShell(), Shell.Zsh);
});

Deno.test("getShell() returns correct shell", () => {
  const bashParser = new Parser("echo hello", Shell.Bash);
  assertEquals(bashParser.getShell(), Shell.Bash);

  const shParser = new Parser("echo hello", Shell.Sh);
  assertEquals(shParser.getShell(), Shell.Sh);

  const zshParser = new Parser("echo hello", Shell.Zsh);
  assertEquals(zshParser.getShell(), Shell.Zsh);
});

Deno.test("getCapabilities() returns correct capabilities for Bash", () => {
  const parser = new Parser("echo hello", Shell.Bash);
  const caps = parser.getCapabilities();

  assertExists(caps);
  assertEquals(caps.hasArrays, true);
  assertEquals(caps.hasAssociativeArrays, true);
  assertEquals(caps.hasExtendedGlob, true);
  assertEquals(caps.hasProcessSubstitution, true);
  assertEquals(caps.hasDoubleSquareBracket, true);
  assertEquals(caps.hasCoproc, true);
  assertEquals(caps.hasNameref, true);
  assertEquals(caps.hasAnsiCQuoting, true);
  assertEquals(caps.hasLocaleQuoting, true);
  assertEquals(caps.hasFdVariables, true);
  assertEquals(caps.hasPipeStderr, true);
  assertEquals(caps.hasAppendStderrRedirect, true);
});

Deno.test("getCapabilities() returns correct capabilities for Sh", () => {
  const parser = new Parser("echo hello", Shell.Sh);
  const caps = parser.getCapabilities();

  assertExists(caps);
  assertEquals(caps.hasArrays, false);
  assertEquals(caps.hasAssociativeArrays, false);
  assertEquals(caps.hasExtendedGlob, false);
  assertEquals(caps.hasProcessSubstitution, false);
  assertEquals(caps.hasDoubleSquareBracket, false);
  assertEquals(caps.hasCoproc, false);
  assertEquals(caps.hasNameref, false);
  assertEquals(caps.hasAnsiCQuoting, false);
  assertEquals(caps.hasLocaleQuoting, false);
  assertEquals(caps.hasFdVariables, false);
  assertEquals(caps.hasPipeStderr, false);
  assertEquals(caps.hasAppendStderrRedirect, false);
});

Deno.test("getCapabilities() returns correct capabilities for Zsh", () => {
  const parser = new Parser("echo hello", Shell.Zsh);
  const caps = parser.getCapabilities();

  assertExists(caps);
  assertEquals(caps.hasArrays, true);
  assertEquals(caps.hasAssociativeArrays, true);
  assertEquals(caps.hasExtendedGlob, true);
  assertEquals(caps.hasProcessSubstitution, true);
  assertEquals(caps.hasDoubleSquareBracket, true);
  assertEquals(caps.hasCoproc, true);
  assertEquals(caps.hasNameref, false);  // zsh doesn't have nameref
  assertEquals(caps.hasAnsiCQuoting, true);
  assertEquals(caps.hasLocaleQuoting, true);
  assertEquals(caps.hasFdVariables, true);
  assertEquals(caps.hasPipeStderr, true);
  assertEquals(caps.hasAppendStderrRedirect, true);
});

Deno.test("hasCapability() works correctly for Bash", () => {
  const parser = new Parser("echo hello", Shell.Bash);

  assertEquals(parser.hasCapability("hasArrays"), true);
  assertEquals(parser.hasCapability("hasAssociativeArrays"), true);
  assertEquals(parser.hasCapability("hasExtendedGlob"), true);
  assertEquals(parser.hasCapability("hasProcessSubstitution"), true);
  assertEquals(parser.hasCapability("hasDoubleSquareBracket"), true);
  assertEquals(parser.hasCapability("hasCoproc"), true);
  assertEquals(parser.hasCapability("hasNameref"), true);
  assertEquals(parser.hasCapability("hasAnsiCQuoting"), true);
  assertEquals(parser.hasCapability("hasLocaleQuoting"), true);
  assertEquals(parser.hasCapability("hasFdVariables"), true);
  assertEquals(parser.hasCapability("hasPipeStderr"), true);
  assertEquals(parser.hasCapability("hasAppendStderrRedirect"), true);
});

Deno.test("hasCapability() works correctly for Sh", () => {
  const parser = new Parser("echo hello", Shell.Sh);

  assertEquals(parser.hasCapability("hasArrays"), false);
  assertEquals(parser.hasCapability("hasAssociativeArrays"), false);
  assertEquals(parser.hasCapability("hasExtendedGlob"), false);
  assertEquals(parser.hasCapability("hasProcessSubstitution"), false);
  assertEquals(parser.hasCapability("hasDoubleSquareBracket"), false);
  assertEquals(parser.hasCapability("hasCoproc"), false);
  assertEquals(parser.hasCapability("hasNameref"), false);
  assertEquals(parser.hasCapability("hasAnsiCQuoting"), false);
  assertEquals(parser.hasCapability("hasLocaleQuoting"), false);
  assertEquals(parser.hasCapability("hasFdVariables"), false);
  assertEquals(parser.hasCapability("hasPipeStderr"), false);
  assertEquals(parser.hasCapability("hasAppendStderrRedirect"), false);
});

Deno.test("parse() function accepts shell parameter", () => {
  const bashAst = parse("echo hello", Shell.Bash);
  assertExists(bashAst);
  assertEquals(bashAst.body.length, 1);

  const shAst = parse("echo hello", Shell.Sh);
  assertExists(shAst);
  assertEquals(shAst.body.length, 1);
});

Deno.test("parse() function defaults to Bash", () => {
  const ast = parse("echo hello");
  assertExists(ast);
  assertEquals(ast.body.length, 1);
});

Deno.test("parseWithRecovery() accepts shell parameter", () => {
  const bashResult = parseWithRecovery("echo hello", Shell.Bash);
  assertExists(bashResult);
  assertExists(bashResult.ast);
  assertEquals(bashResult.ast.body.length, 1);

  const shResult = parseWithRecovery("echo hello", Shell.Sh);
  assertExists(shResult);
  assertExists(shResult.ast);
  assertEquals(shResult.ast.body.length, 1);
});

Deno.test("parseWithRecovery() defaults to Bash", () => {
  const result = parseWithRecovery("echo hello");
  assertExists(result);
  assertExists(result.ast);
  assertEquals(result.ast.body.length, 1);
});

Deno.test("Parser maintains shell info throughout parsing", () => {
  const parser = new Parser("echo hello; echo world", Shell.Zsh);
  assertEquals(parser.getShell(), Shell.Zsh);

  const ast = parser.parse();
  assertExists(ast);

  // Shell info should remain unchanged after parsing
  assertEquals(parser.getShell(), Shell.Zsh);
  assertEquals(parser.hasCapability("hasArrays"), true);
  assertEquals(parser.hasCapability("hasNameref"), false);
});
