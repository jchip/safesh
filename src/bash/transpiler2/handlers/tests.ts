/**
 * Test Expression Handlers
 *
 * Transpiles [[ ... ]] test expressions to TypeScript conditions.
 */

import type * as AST from "../../ast.ts";
import type { VisitorContext } from "../types.ts";
import { escapeForTemplate } from "../utils/mod.ts";

function formatWordForTemplate(
  word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  ctx: VisitorContext,
): string {
  if (word.type === "Word" && word.singleQuoted) {
    return escapeForTemplate(word.value);
  }
  return ctx.visitWord(word);
}

// =============================================================================
// Test Condition Dispatcher
// =============================================================================

/**
 * Visit a TestCondition node and return the transpiled condition
 */
export function visitTestCondition(
  test: AST.TestCondition,
  ctx: VisitorContext,
): string {
  switch (test.type) {
    case "UnaryTest":
      return visitUnaryTest(test, ctx);
    case "BinaryTest":
      return visitBinaryTest(test, ctx);
    case "LogicalTest":
      return visitLogicalTest(test, ctx);
    case "StringTest":
      return visitStringTest(test, ctx);
    default: {
      const _exhaustive: never = test;
      ctx.addDiagnostic({ level: 'warning', message: `Unsupported test condition type: ${(test as any).type}` });
      return "false";
    }
  }
}

// =============================================================================
// Unary Test Handler
// =============================================================================

/**
 * Visit a UnaryTest node (file/string tests)
 */
export function visitUnaryTest(
  test: AST.UnaryTest,
  ctx: VisitorContext,
): string {
  const arg = formatWordForTemplate(test.argument, ctx);

  switch (test.operator) {
    // File existence tests
    case "-e":
      return `await $.fs.exists(\`${arg}\`)`;
    case "-f":
      return `(await $.fs.stat(\`${arg}\`))?.isFile ?? false`;
    case "-d":
      return `(await $.fs.stat(\`${arg}\`))?.isDirectory ?? false`;
    case "-L":
    case "-h":
      return `(await $.fs.stat(\`${arg}\`))?.isSymlink ?? false`;
    case "-b":
      return `(await $.fs.stat(\`${arg}\`))?.isBlockDevice ?? false`;
    case "-c":
      return `(await $.fs.stat(\`${arg}\`))?.isCharDevice ?? false`;
    case "-p":
      return `(await $.fs.stat(\`${arg}\`))?.isFifo ?? false`;
    case "-S":
      return `(await $.fs.stat(\`${arg}\`))?.isSocket ?? false`;
    case "-t":
      return `Deno.isatty(Number(\`${arg}\`))`;

    // File permission tests
    case "-r":
      return `await $.fs.readable(\`${arg}\`)`;
    case "-w":
      return `await $.fs.writable(\`${arg}\`)`;
    case "-x":
      return `await $.fs.executable(\`${arg}\`)`;
    case "-s":
      return `((await $.fs.stat(\`${arg}\`))?.size ?? 0) > 0`;

    // File attribute tests
    case "-g":
      return `(((await $.fs.stat(\`${arg}\`))?.mode ?? 0) & 0o2000) !== 0`;
    case "-u":
      return `(((await $.fs.stat(\`${arg}\`))?.mode ?? 0) & 0o4000) !== 0`;
    case "-k":
      return `(((await $.fs.stat(\`${arg}\`))?.mode ?? 0) & 0o1000) !== 0`;
    case "-O":
      return `(await $.fs.stat(\`${arg}\`))?.uid === Deno.uid()`;
    case "-G":
      return `(await $.fs.stat(\`${arg}\`))?.gid === Deno.gid()`;
    case "-N":
      return `(await (async () => { const _s = await $.fs.stat(\`${arg}\`); return _s?.mtime > _s?.atime; })())`;

    // String tests
    case "-z":
      return `(\`${arg}\`).length === 0`;
    case "-n":
      return `(\`${arg}\`).length > 0`;

    default: {
      const _exhaustive: never = test.operator;
      ctx.addDiagnostic({ level: 'warning', message: `Unsupported unary test operator: ${test.operator}` });
      return "false";
    }
  }
}

// =============================================================================
// Binary Test Handler
// =============================================================================

/**
 * Visit a BinaryTest node (comparisons)
 */
export function visitBinaryTest(
  test: AST.BinaryTest,
  ctx: VisitorContext,
): string {
  const left = formatWordForTemplate(test.left, ctx);
  const right = formatWordForTemplate(test.right, ctx);

  switch (test.operator) {
    // String comparison
    case "=":
    case "==":
      return `\`${left}\` === \`${right}\``;
    case "!=":
      return `\`${left}\` !== \`${right}\``;
    case "<":
      return `\`${left}\` < \`${right}\``;
    case ">":
      return `\`${left}\` > \`${right}\``;

    // Numeric comparison
    case "-eq":
      return `Number(\`${left}\`) === Number(\`${right}\`)`;
    case "-ne":
      return `Number(\`${left}\`) !== Number(\`${right}\`)`;
    case "-lt":
      return `Number(\`${left}\`) < Number(\`${right}\`)`;
    case "-le":
      return `Number(\`${left}\`) <= Number(\`${right}\`)`;
    case "-gt":
      return `Number(\`${left}\`) > Number(\`${right}\`)`;
    case "-ge":
      return `Number(\`${left}\`) >= Number(\`${right}\`)`;

    // File comparison
    case "-nt":
      return `(await $.fs.stat(\`${left}\`))?.mtime > (await $.fs.stat(\`${right}\`))?.mtime`;
    case "-ot":
      return `(await $.fs.stat(\`${left}\`))?.mtime < (await $.fs.stat(\`${right}\`))?.mtime`;
    case "-ef":
      return `(await $.fs.stat(\`${left}\`))?.ino === (await $.fs.stat(\`${right}\`))?.ino`;

    // Regex match
    case "=~":
      return `new RegExp(\`${right}\`).test(\`${left}\`)`;

    default: {
      const _exhaustive: never = test.operator;
      ctx.addDiagnostic({ level: 'warning', message: `Unsupported binary test operator: ${test.operator}` });
      return "false";
    }
  }
}

// =============================================================================
// Logical Test Handler
// =============================================================================

/**
 * Visit a LogicalTest node (&&, ||, !)
 */
export function visitLogicalTest(
  test: AST.LogicalTest,
  ctx: VisitorContext,
): string {
  if (test.operator === "!") {
    return `!(${visitTestCondition(test.right, ctx)})`;
  }

  const left = test.left ? visitTestCondition(test.left, ctx) : "";
  const right = visitTestCondition(test.right, ctx);

  if (test.operator === "&&") {
    return `(${left} && ${right})`;
  } else {
    return `(${left} || ${right})`;
  }
}

// =============================================================================
// String Test Handler
// =============================================================================

/**
 * Visit a StringTest node
 */
export function visitStringTest(
  test: AST.StringTest,
  ctx: VisitorContext,
): string {
  const value = formatWordForTemplate(test.value, ctx);
  return `(\`${value}\`).length > 0`;
}
