/**
 * Arithmetic Expression Handlers
 *
 * Transpiles bash arithmetic expressions to TypeScript.
 */

import type * as AST from "../../ast.ts";
import type { VisitorContext } from "../types.ts";

// =============================================================================
// Arithmetic Expression Dispatcher
// =============================================================================

/**
 * Visit an ArithmeticExpression node
 */
export function visitArithmeticExpression(
  expr: AST.ArithmeticExpression,
  _ctx: VisitorContext,
): string {
  switch (expr.type) {
    case "NumberLiteral":
      return visitNumberLiteral(expr);
    case "VariableReference":
      return visitVariableReference(expr);
    case "BinaryArithmeticExpression":
      return visitBinaryArithmetic(expr, _ctx);
    case "UnaryArithmeticExpression":
      return visitUnaryArithmetic(expr, _ctx);
    case "ConditionalArithmeticExpression":
      return visitConditionalArithmetic(expr, _ctx);
    case "AssignmentExpression":
      return visitAssignmentExpression(expr, _ctx);
    case "GroupedArithmeticExpression":
      return visitGroupedArithmetic(expr, _ctx);
    default: {
      const _exhaustive: never = expr;
      _ctx.addDiagnostic({ level: 'warning', message: `Unsupported arithmetic expression type: ${(expr as any).type}` });
      return "0";
    }
  }
}

// =============================================================================
// Number Literal Handler
// =============================================================================

export function visitNumberLiteral(node: AST.NumberLiteral): string {
  return node.value.toString();
}

// =============================================================================
// Variable Reference Handler
// =============================================================================

export function visitVariableReference(node: AST.VariableReference): string {
  // Use ?? 0 to match Bash behavior: unset variables in arithmetic evaluate to 0
  return `Number(${node.name} ?? 0)`;
}

// =============================================================================
// Binary Arithmetic Handler
// =============================================================================

export function visitBinaryArithmetic(
  node: AST.BinaryArithmeticExpression,
  ctx: VisitorContext,
): string {
  const left = visitArithmeticExpression(node.left, ctx);
  const right = visitArithmeticExpression(node.right, ctx);

  // Handle power operator (bash ** -> JS **)
  if (node.operator === "**") {
    return `(${left} ** ${right})`;
  }

  return `(${left} ${node.operator} ${right})`;
}

// =============================================================================
// Unary Arithmetic Handler
// =============================================================================

export function visitUnaryArithmetic(
  node: AST.UnaryArithmeticExpression,
  ctx: VisitorContext,
): string {
  const arg = visitArithmeticExpression(node.argument, ctx);

  if (node.prefix) {
    return `(${node.operator}${arg})`;
  } else {
    return `(${arg}${node.operator})`;
  }
}

// =============================================================================
// Conditional Arithmetic Handler
// =============================================================================

export function visitConditionalArithmetic(
  node: AST.ConditionalArithmeticExpression,
  ctx: VisitorContext,
): string {
  const test = visitArithmeticExpression(node.test, ctx);
  const consequent = visitArithmeticExpression(node.consequent, ctx);
  const alternate = visitArithmeticExpression(node.alternate, ctx);

  return `(${test} ? ${consequent} : ${alternate})`;
}

// =============================================================================
// Assignment Expression Handler
// =============================================================================

export function visitAssignmentExpression(
  node: AST.AssignmentExpression,
  ctx: VisitorContext,
): string {
  const right = visitArithmeticExpression(node.right, ctx);
  return `(${node.left.name} ${node.operator} ${right})`;
}

// =============================================================================
// Grouped Arithmetic Handler
// =============================================================================

export function visitGroupedArithmetic(
  node: AST.GroupedArithmeticExpression,
  ctx: VisitorContext,
): string {
  return `(${visitArithmeticExpression(node.expression, ctx)})`;
}
