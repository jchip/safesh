/**
 * Tests for `!` pipeline negation parsing (SSH-602).
 *
 * Bash accepts `!` before any pipeline operand, not just the first:
 * `a && ! b`, `a || ! b`. The parser records negation on the operand
 * pipeline itself; the chain node mirrors only the LEADING operand's flag
 * (existing convention the transpiler compensates for — see SSH-594 notes
 * in transpiler2/handlers/commands.ts).
 */

import { assertEquals } from "@std/assert";
import { parse } from "./parser.ts";
import type * as AST from "./ast.ts";

function chainOf(script: string): AST.Pipeline {
  const program = parse(script);
  const stmt = program.body[0]!;
  assertEquals(stmt.type, "Pipeline");
  return stmt as AST.Pipeline;
}

Deno.test("SSH-602: `a && ! b` parses with negation on the right operand", () => {
  const chain = chainOf("true && ! false");
  assertEquals(chain.operator, "&&");
  assertEquals(chain.commands.length, 2);
  const right = chain.commands[1]!;
  assertEquals(right.type, "Pipeline");
  assertEquals((right as AST.Pipeline).negated, true);
  // chain-level flag mirrors only the LEADING operand (convention)
  assertEquals(chain.negated, false);
});

Deno.test("SSH-602: `a || ! b` parses with negation on the right operand", () => {
  const chain = chainOf("false || ! false");
  assertEquals(chain.operator, "||");
  const right = chain.commands[1]!;
  assertEquals(right.type, "Pipeline");
  assertEquals((right as AST.Pipeline).negated, true);
});

Deno.test("SSH-602: leading negation convention is unchanged", () => {
  const chain = chainOf("! true && echo x");
  assertEquals(chain.operator, "&&");
  // parser copies the leading operand's flag onto the chain node
  assertEquals(chain.negated, true);
  const left = chain.commands[0]!;
  assertEquals(left.type, "Pipeline");
  assertEquals((left as AST.Pipeline).negated, true);
});

Deno.test("SSH-602: `! b` after && negates a multi-command pipeline operand", () => {
  const chain = chainOf("true && ! false | true");
  const right = chain.commands[1]!;
  assertEquals(right.type, "Pipeline");
  assertEquals((right as AST.Pipeline).negated, true);
  assertEquals((right as AST.Pipeline).commands.length, 2);
});
