/**
 * Arithmetic Expression Handlers
 *
 * Transpiles bash arithmetic expressions to TypeScript.
 */

import type * as AST from "../../ast.ts";
import type { VisitorContext } from "../types.ts";
import { visitCommandSubstitution, visitParameterExpansion } from "./words.ts";
import { sanitizeVarName } from "../utils/mod.ts";

/**
 * SSH-690: Lower an arithmetic write target (`i` in `((i++))` or `i = 0`) to an
 * assignable JS identifier, requesting the hoisted declaration that makes it
 * one. Without the declaration the bare identifier is a free variable and the
 * strict-mode wrapper throws ReferenceError before the expression runs.
 */
function arithmeticTarget(name: string, ctx: VisitorContext): string {
  // Hoist under the raw shell name (what isDeclared is keyed on); sanitize only
  // for the emitted identifier.
  ctx.hoistVariable(name);
  return sanitizeVarName(name);
}

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
      return visitVariableReference(expr, _ctx);
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
    case "ParameterExpansion":
      return visitParameterExpansionInArithmetic(expr, _ctx);
    case "CommandSubstitution":
      return visitCommandSubstitutionInArithmetic(expr, _ctx);
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

export function visitVariableReference(
  node: AST.VariableReference,
  _ctx?: VisitorContext,
): string {
  // $? is the last exit status, recorded as Deno.exitCode (SSH-581/SSH-583)
  if (node.name === "?") {
    return `Number(Deno.exitCode ?? 0)`;
  }
  // SSH-690: a bare identifier throws ReferenceError when the shell variable
  // was never assigned in-script, so guard the read with typeof and fall back
  // to the environment — bash reads exported variables in arithmetic, e.g.
  // `LIM=2 bash -c 'for ((i=0;i<LIM;i++)); do ...'`.
  // Use ?? 0 to match Bash behavior: unset variables in arithmetic evaluate to 0
  const jsName = sanitizeVarName(node.name);
  return `Number((typeof ${jsName} !== "undefined" ? ${jsName} : ($.ENV.${node.name} ?? $.VARS?.${node.name})) ?? 0)`;
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

  // SSH-623: bash $((...)) is integer arithmetic. Division truncates toward
  // zero (C semantics), so `7/2`=3 and `-7/2`=-3. Math.trunc matches that.
  // Truncation must apply PER division (each operator is integer in bash), so
  // `3/2*2`=2 because 3/2 truncates to 1 first. Other operators keep integer
  // inputs integer, so only `/` needs wrapping.
  if (node.operator === "/") {
    return `Math.trunc(${left} / ${right})`;
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
  // For increment/decrement operators, we need the raw variable name
  // because Number(i ?? 0)++ is invalid JavaScript
  const isIncrementDecrement = node.operator === "++" || node.operator === "--";

  if (isIncrementDecrement && node.argument.type === "VariableReference") {
    // Use the variable name directly for ++/-- operators
    const target = arithmeticTarget(node.argument.name, ctx);
    // SSH-690: normalize to a number before stepping. The hoisted binding is
    // undefined until first assigned, and `undefined++` yields NaN where bash
    // counts an unset variable as 0; this also coerces a string-valued shell
    // variable, so `i="5"; ((i++))` gives 6 rather than "51".
    const current = visitVariableReference(node.argument, ctx);
    const step = node.prefix ? `${node.operator}${target}` : `${target}${node.operator}`;
    return `((${target} = ${current}), ${step})`;
  }

  // For other unary operators or complex expressions, use the full expression
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
  const target = arithmeticTarget(node.left.name, ctx);

  if (node.operator === "=") {
    return `(${target} = ${right})`;
  }

  // SSH-690: a compound assignment reads the target first, so it has to go
  // through the guarded read — `undefined += 5` is NaN, where bash counts an
  // unset variable as 0 and yields 5.
  const current = visitVariableReference(node.left, ctx);

  // SSH-623: `/=` must truncate toward zero like bash integer division.
  // JS `i /= 2` would store a float, so lower to an explicit Math.trunc assign.
  if (node.operator === "/=") {
    return `(${target} = Math.trunc(${current} / ${right}))`;
  }

  // Expand `i op= n` to `i = i op n` so the read is the guarded one
  return `(${target} = ${current} ${node.operator.slice(0, -1)} ${right})`;
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

// =============================================================================
// Parameter Expansion Handler (for arithmetic context)
// =============================================================================

/**
 * Visit a ParameterExpansion node in arithmetic context
 * Note: Full parameter expansion support is in words.ts, but we reuse
 * that handler to maintain consistent behavior
 */
export function visitParameterExpansionInArithmetic(
  node: AST.ParameterExpansion,
  ctx: VisitorContext,
): string {
  // Use the full parameter expansion handler from words.ts
  const expansion = visitParameterExpansion(node, ctx);

  // In arithmetic context, wrap the result with Number() and default to 0
  // to match Bash behavior where unset/empty variables evaluate to 0
  return `Number(${expansion} ?? 0)`;
}

// =============================================================================
// Command Substitution Handler (for arithmetic context) — SSH-627
// =============================================================================

/**
 * Visit a CommandSubstitution node in arithmetic context.
 *
 * Bash allows $(...) / `...` as an arithmetic operand (e.g. $(( $(echo 2) + 3 )))
 * and coerces the captured stdout to a number. We reuse visitCommandSubstitution
 * from words.ts (which emits a `${await __cmdSubText(...)}` template fragment and
 * handles the subshell-exit case), wrap it in a template literal to materialize
 * the stdout string, trim the trailing newline, and coerce with Number(). The
 * `|| 0` keeps empty output evaluating to 0, matching bash's arithmetic default.
 */
export function visitCommandSubstitutionInArithmetic(
  node: AST.CommandSubstitution,
  ctx: VisitorContext,
): string {
  const fragment = visitCommandSubstitution(node, ctx);
  return `(Number(\`${fragment}\`.trim()) || 0)`;
}
