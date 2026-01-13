/**
 * Control Flow Handlers
 *
 * Transpiles control flow statements (if, for, while, case, etc.)
 */

import { globToRegExp } from "@std/path";
import type * as AST from "../../ast.ts";
import type { StatementResult, VisitorContext } from "../types.ts";

// =============================================================================
// If Statement Handler
// =============================================================================

export function visitIfStatement(
  stmt: AST.IfStatement,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  // Build test condition
  const testVar = ctx.getTempVar();
  const testExpr = ctx.buildTestExpression(stmt.test);
  lines.push(`${indent}const ${testVar} = await ${testExpr.code};`);
  lines.push(`${indent}if (${testVar}.code === 0) {`);

  // Consequent block
  ctx.indent();
  for (const s of stmt.consequent) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }
  ctx.dedent();

  // Alternate block
  if (stmt.alternate) {
    if (Array.isArray(stmt.alternate)) {
      lines.push(`${indent}} else {`);
      ctx.indent();
      for (const s of stmt.alternate) {
        const result = ctx.visitStatement(s);
        lines.push(...result.lines);
      }
      ctx.dedent();
      lines.push(`${indent}}`);
    } else {
      // else-if chain
      lines.push(`${indent}} else {`);
      ctx.indent();
      const elseIf = visitIfStatement(stmt.alternate, ctx);
      lines.push(...elseIf.lines);
      ctx.dedent();
      lines.push(`${indent}}`);
    }
  } else {
    lines.push(`${indent}}`);
  }

  return { lines };
}

// =============================================================================
// For Statement Handler
// =============================================================================

export function visitForStatement(
  stmt: AST.ForStatement,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  // Build iterable
  const items = stmt.iterable.map((item) => {
    const value = ctx.visitWord(item);
    return `"${value}"`;
  });
  const itemsExpr = `[${items.join(", ")}]`;

  lines.push(`${indent}for (const ${stmt.variable} of ${itemsExpr}) {`);

  // Push a new scope for loop body (loop variable is scoped by JS `const`)
  ctx.pushScope();
  ctx.indent();
  for (const s of stmt.body) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }
  ctx.dedent();
  ctx.popScope();

  lines.push(`${indent}}`);
  return { lines };
}

// =============================================================================
// C-Style For Statement Handler
// =============================================================================

export function visitCStyleForStatement(
  stmt: AST.CStyleForStatement,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  const init = stmt.init ? ctx.visitArithmetic(stmt.init) : "";
  const test = stmt.test ? ctx.visitArithmetic(stmt.test) : "true";
  const update = stmt.update ? ctx.visitArithmetic(stmt.update) : "";

  lines.push(`${indent}for (${init}; ${test}; ${update}) {`);

  // Body
  ctx.indent();
  for (const s of stmt.body) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }
  ctx.dedent();

  lines.push(`${indent}}`);
  return { lines };
}

// =============================================================================
// While Statement Handler
// =============================================================================

export function visitWhileStatement(
  stmt: AST.WhileStatement,
  ctx: VisitorContext,
): StatementResult {
  return visitLoop(stmt, ctx, false);
}

// =============================================================================
// Until Statement Handler
// =============================================================================

export function visitUntilStatement(
  stmt: AST.UntilStatement,
  ctx: VisitorContext,
): StatementResult {
  return visitLoop(stmt, ctx, true);
}

/**
 * Shared helper for while/until loops
 * @param breakOnSuccess - true for until (break when code === 0), false for while
 */
function visitLoop(
  stmt: AST.WhileStatement | AST.UntilStatement,
  ctx: VisitorContext,
  breakOnSuccess: boolean,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  lines.push(`${indent}while (true) {`);
  ctx.indent();

  const innerIndent = ctx.getIndent();
  const testVar = ctx.getTempVar();
  const testExpr = ctx.buildTestExpression(stmt.test);
  lines.push(`${innerIndent}const ${testVar} = await ${testExpr.code};`);

  // Break condition differs: while breaks on failure, until breaks on success
  const breakCondition = breakOnSuccess
    ? `${testVar}.code === 0`
    : `${testVar}.code !== 0`;
  lines.push(`${innerIndent}if (${breakCondition}) break;`);
  lines.push("");

  for (const s of stmt.body) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }

  ctx.dedent();
  lines.push(`${indent}}`);
  return { lines };
}

// =============================================================================
// Case Statement Handler
// =============================================================================

export function visitCaseStatement(
  stmt: AST.CaseStatement,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  const wordVar = ctx.getTempVar();
  const word = ctx.visitWord(stmt.word);
  lines.push(`${indent}const ${wordVar} = "${word}";`);

  let first = true;

  for (const caseClause of stmt.cases) {
    const patterns = caseClause.patterns
      .map((p) => {
        const pattern = ctx.visitWord(p);
        // Convert glob pattern to regex at transpile time
        const regex = globToRegExp(pattern);
        // Serialize regex to string that can be used in generated code
        return `${regex}.test(${wordVar})`;
      })
      .join(" || ");

    if (first) {
      lines.push(`${indent}if (${patterns}) {`);
      first = false;
    } else {
      lines.push(`${indent}} else if (${patterns}) {`);
    }

    ctx.indent();
    for (const s of caseClause.body) {
      const result = ctx.visitStatement(s);
      lines.push(...result.lines);
    }
    ctx.dedent();
  }

  if (!first) {
    lines.push(`${indent}}`);
  }

  return { lines };
}

// =============================================================================
// Function Declaration Handler
// =============================================================================

export function visitFunctionDeclaration(
  stmt: AST.FunctionDeclaration,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  // Register the function so calls to it are transpiled as direct calls
  ctx.declareFunction(stmt.name);

  lines.push(`${indent}async function ${stmt.name}() {`);

  // Push a new scope for function variables
  ctx.pushScope();
  ctx.indent();
  for (const s of stmt.body) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }
  ctx.dedent();
  ctx.popScope();

  lines.push(`${indent}}`);
  return { lines };
}

// =============================================================================
// Subshell Handler
// =============================================================================

export function visitSubshell(
  stmt: AST.Subshell,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  lines.push(`${indent}await (async () => {`);

  ctx.indent();
  for (const s of stmt.body) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }
  ctx.dedent();

  lines.push(`${indent}})();`);
  return { lines };
}

// =============================================================================
// Brace Group Handler
// =============================================================================

export function visitBraceGroup(
  stmt: AST.BraceGroup,
  ctx: VisitorContext,
): StatementResult {
  const lines: string[] = [];
  const indent = ctx.getIndent();

  lines.push(`${indent}{`);

  ctx.indent();
  for (const s of stmt.body) {
    const result = ctx.visitStatement(s);
    lines.push(...result.lines);
  }
  ctx.dedent();

  lines.push(`${indent}}`);
  return { lines };
}

// =============================================================================
// Test Command Handler
// =============================================================================

export function visitTestCommand(
  stmt: AST.TestCommand,
  ctx: VisitorContext,
): StatementResult {
  const indent = ctx.getIndent();
  const condition = ctx.visitTestCondition(stmt.expression);
  return { lines: [`${indent}if (${condition}) { /* test passed */ }`] };
}

// =============================================================================
// Arithmetic Command Handler
// =============================================================================

export function visitArithmeticCommand(
  stmt: AST.ArithmeticCommand,
  ctx: VisitorContext,
): StatementResult {
  const indent = ctx.getIndent();
  const expr = ctx.visitArithmetic(stmt.expression);
  return { lines: [`${indent}${expr};`] };
}
