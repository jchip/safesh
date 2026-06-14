/**
 * SSH-642: command-position glob expansion — transpiler detection.
 *
 * Verifies which command arguments are lowered to a `$.__expandGlob` spread
 * (unquoted glob literals) vs. left as plain literals (quoted, partially
 * quoted, expansion-bearing, or non-glob words).
 */

import { assert, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../parser.ts";
import { transpile } from "./mod.ts";

function tp(src: string): string {
  return transpile(parse(src), { imports: false, strict: false });
}

describe("SSH-642 command-position glob expansion", () => {
  it("expands an unquoted glob via a $.__expandGlob spread", () => {
    assertStringIncludes(tp("ls *.js"), '...(await $.__expandGlob("*.js"))');
  });

  it("expands a multi-segment path glob", () => {
    assertStringIncludes(tp("ls demo/main-*.js"), '$.__expandGlob("demo/main-*.js")');
  });

  it("expands ? and [...] patterns", () => {
    assertStringIncludes(tp("ls a?b"), '$.__expandGlob("a?b")');
    assertStringIncludes(tp("ls [ab].js"), '$.__expandGlob("[ab].js")');
  });

  it("does not expand a double-quoted glob", () => {
    assert(!tp('ls "*.js"').includes("__expandGlob"));
  });

  it("does not expand a single-quoted glob", () => {
    assert(!tp("ls '*.js'").includes("__expandGlob"));
  });

  it("does not expand a partially quoted word (pre\"*\"x)", () => {
    assert(!tp('ls pre"*"x').includes("__expandGlob"));
  });

  it("does not expand a plain non-glob argument", () => {
    assert(!tp("ls foo.js").includes("__expandGlob"));
  });

  it("does not expand an expansion-bearing word ($dir/*.js)", () => {
    // Post-variable-expansion globbing is out of scope; such words are skipped.
    assert(!tp("ls $dir/*.js").includes("__expandGlob"));
  });

  it("expands across command kinds: builtin, destructive, specialized, external", () => {
    assertStringIncludes(tp("ls *.js"), '$.__expandGlob("*.js")'); // shell-builtin
    assertStringIncludes(tp("rm *.tmp"), '$.__expandGlob("*.tmp")'); // destructive builtin
    assertStringIncludes(tp("git add *.ts"), '$.__expandGlob("*.ts")'); // specialized
    assertStringIncludes(tp("find . -name *.js"), '$.__expandGlob("*.js")'); // external $.cmd
    assertStringIncludes(tp("timeout 5 grepx *.log"), '$.__expandGlob("*.log")'); // timeout-wrapped
  });
});
