/**
 * AWK Expression Evaluation
 *
 * Async expression evaluator supporting file I/O operations.
 */

import type {
  AwkArrayAccess,
  AwkExpr,
  AwkFieldRef,
  AwkFunctionDef,
  AwkVariable,
} from "../ast.ts";
import { awkBuiltins } from "../builtins.ts";
import type { AwkRuntimeContext } from "./context.ts";
import { getField, setCurrentLine, setField } from "./fields.ts";
import {
  isTruthy,
  looksLikeNumber,
  matchRegex,
  toAwkString,
  toNumber,
  getCachedRegex,
} from "./helpers.ts";
import type { AwkValue } from "./types.ts";
import {
  getArrayElement,
  getVariable,
  hasArrayElement,
  setArrayElement,
  setVariable,
} from "./variables.ts";

// Forward declaration for statement executor (needed for user functions)
export type BlockExecutor = (
  ctx: AwkRuntimeContext,
  statements: import("../ast.ts").AwkStmt[],
) => Promise<void>;

let executeBlockFn: BlockExecutor | null = null;

/**
 * Set the block executor function (called from statements.ts to avoid circular deps)
 */
export function setBlockExecutor(fn: BlockExecutor): void {
  executeBlockFn = fn;
}

/**
 * Custom error for execution limits
 */
export class ExecutionLimitError extends Error {
  constructor(
    message: string,
    public limitType: "iterations" | "recursion",
    public partialOutput: string,
  ) {
    super(message);
    this.name = "ExecutionLimitError";
  }
}

/**
 * Evaluate an AWK expression asynchronously.
 */
export async function evalExpr(
  ctx: AwkRuntimeContext,
  expr: AwkExpr,
): Promise<AwkValue> {
  switch (expr.type) {
    case "number":
      return expr.value;

    case "string":
      return expr.value;

    case "regex":
      // Regex used as expression matches against $0
      return matchRegex(expr.pattern, ctx.line, ctx) ? 1 : 0;

    case "field":
      return evalFieldRef(ctx, expr);

    case "variable":
      return getVariable(ctx, expr.name);

    case "array_access":
      return evalArrayAccess(ctx, expr);

    case "binary":
      return evalBinaryOp(ctx, expr);

    case "unary":
      return evalUnaryOp(ctx, expr);

    case "ternary":
      return isTruthy(await evalExpr(ctx, expr.condition))
        ? evalExpr(ctx, expr.consequent)
        : evalExpr(ctx, expr.alternate);

    case "call":
      return evalFunctionCall(ctx, expr.name, expr.args);

    case "assignment":
      return evalAssignment(ctx, expr);

    case "pre_increment":
      return evalIncrDecr(ctx, expr.operand, 1, false);

    case "pre_decrement":
      return evalIncrDecr(ctx, expr.operand, -1, false);

    case "post_increment":
      return evalIncrDecr(ctx, expr.operand, 1, true);

    case "post_decrement":
      return evalIncrDecr(ctx, expr.operand, -1, true);

    case "in":
      return evalInExpr(ctx, expr.key, expr.array);

    case "getline":
      return evalGetline(ctx, expr.variable, expr.file);

    case "tuple":
      return evalTuple(ctx, expr.elements);

    default:
      return "";
  }
}

async function evalFieldRef(
  ctx: AwkRuntimeContext,
  expr: AwkFieldRef,
): Promise<AwkValue> {
  const index = Math.floor(toNumber(await evalExpr(ctx, expr.index)));
  return getField(ctx, index);
}

async function evalArrayAccess(
  ctx: AwkRuntimeContext,
  expr: AwkArrayAccess,
): Promise<AwkValue> {
  const key = toAwkString(await evalExpr(ctx, expr.key));
  return getArrayElement(ctx, expr.array, key);
}

async function evalBinaryOp(
  ctx: AwkRuntimeContext,
  expr: { operator: string; left: AwkExpr; right: AwkExpr },
): Promise<AwkValue> {
  const op = expr.operator;

  // Short-circuit evaluation for logical operators
  if (op === "||") {
    return isTruthy(await evalExpr(ctx, expr.left)) ||
      isTruthy(await evalExpr(ctx, expr.right))
      ? 1
      : 0;
  }
  if (op === "&&") {
    return isTruthy(await evalExpr(ctx, expr.left)) &&
      isTruthy(await evalExpr(ctx, expr.right))
      ? 1
      : 0;
  }

  // Regex match operators - handle regex literal specially
  if (op === "~") {
    const left = await evalExpr(ctx, expr.left);
    const pattern =
      expr.right.type === "regex"
        ? expr.right.pattern
        : toAwkString(await evalExpr(ctx, expr.right));
    try {
      return getCachedRegex(ctx, pattern).test(toAwkString(left)) ? 1 : 0;
    } catch {
      return 0;
    }
  }
  if (op === "!~") {
    const left = await evalExpr(ctx, expr.left);
    const pattern =
      expr.right.type === "regex"
        ? expr.right.pattern
        : toAwkString(await evalExpr(ctx, expr.right));
    try {
      return getCachedRegex(ctx, pattern).test(toAwkString(left)) ? 0 : 1;
    } catch {
      return 1;
    }
  }

  const left = await evalExpr(ctx, expr.left);
  const right = await evalExpr(ctx, expr.right);

  // String concatenation
  if (op === " ") {
    return toAwkString(left) + toAwkString(right);
  }

  // Comparison operators
  if (isComparisonOp(op)) {
    return evalComparison(left, right, op);
  }

  // Arithmetic operators
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);
  return applyNumericBinaryOp(leftNum, rightNum, op);
}

function isComparisonOp(op: string): boolean {
  return ["<", "<=", ">", ">=", "==", "!="].includes(op);
}

function evalComparison(left: AwkValue, right: AwkValue, op: string): number {
  const leftIsNum = looksLikeNumber(left);
  const rightIsNum = looksLikeNumber(right);

  if (leftIsNum && rightIsNum) {
    const l = toNumber(left);
    const r = toNumber(right);
    switch (op) {
      case "<":
        return l < r ? 1 : 0;
      case "<=":
        return l <= r ? 1 : 0;
      case ">":
        return l > r ? 1 : 0;
      case ">=":
        return l >= r ? 1 : 0;
      case "==":
        return l === r ? 1 : 0;
      case "!=":
        return l !== r ? 1 : 0;
    }
  }

  const l = toAwkString(left);
  const r = toAwkString(right);
  switch (op) {
    case "<":
      return l < r ? 1 : 0;
    case "<=":
      return l <= r ? 1 : 0;
    case ">":
      return l > r ? 1 : 0;
    case ">=":
      return l >= r ? 1 : 0;
    case "==":
      return l === r ? 1 : 0;
    case "!=":
      return l !== r ? 1 : 0;
  }
  return 0;
}

function applyNumericBinaryOp(left: number, right: number, op: string): number {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0) throw new Error("awk: fatal: division by zero attempted");
      return left / right;
    case "%":
      if (right === 0) throw new Error("awk: fatal: division by zero attempted");
      return left % right;
    case "^":
      return Math.pow(left, right);
    default:
      return 0;
  }
}

async function evalUnaryOp(
  ctx: AwkRuntimeContext,
  expr: { operator: string; operand: AwkExpr },
): Promise<AwkValue> {
  const val = await evalExpr(ctx, expr.operand);
  switch (expr.operator) {
    case "!":
      return isTruthy(val) ? 0 : 1;
    case "-":
      return -toNumber(val);
    case "+":
      return +toNumber(val);
    default:
      return val;
  }
}

async function evalFunctionCall(
  ctx: AwkRuntimeContext,
  name: string,
  args: AwkExpr[],
): Promise<AwkValue> {
  // Check for built-in functions first
  const builtin = awkBuiltins[name];
  if (builtin) {
    return builtin(args, ctx, { evalExpr: (e: AwkExpr) => evalExpr(ctx, e) });
  }

  // Check for user-defined function
  const userFunc = ctx.functions.get(name);
  if (userFunc) {
    return callUserFunction(ctx, userFunc, args);
  }

  return "";
}

async function callUserFunction(
  ctx: AwkRuntimeContext,
  func: AwkFunctionDef,
  args: AwkExpr[],
): Promise<AwkValue> {
  // Check recursion depth limit
  ctx.currentRecursionDepth++;
  if (ctx.currentRecursionDepth > ctx.maxRecursionDepth) {
    ctx.currentRecursionDepth--;
    throw new ExecutionLimitError(
      `awk: recursion depth exceeded maximum (${ctx.maxRecursionDepth})`,
      "recursion",
      ctx.output,
    );
  }

  // Save only parameter variables (they are local in AWK)
  const savedParams: Record<string, AwkValue | undefined> = {};
  const savedArrays: Record<string, Record<string, AwkValue> | undefined> = {};
  for (const param of func.params) {
    savedParams[param] = ctx.vars[param];
    savedArrays[param] = ctx.arrays[param];
    delete ctx.arrays[param]; // clean for local scope
  }

  // Set up parameters
  for (let i = 0; i < func.params.length; i++) {
    const param = func.params[i]!;
    const value = i < args.length ? await evalExpr(ctx, args[i]!) : "";
    ctx.vars[param] = value;
  }

  // Execute function body
  ctx.hasReturn = false;
  ctx.returnValue = undefined;

  if (executeBlockFn) {
    await executeBlockFn(ctx, func.body.statements);
  }

  const result = ctx.returnValue ?? "";

  // Restore only parameter variables and arrays
  for (const param of func.params) {
    if (savedParams[param] !== undefined) {
      ctx.vars[param] = savedParams[param];
    } else {
      delete ctx.vars[param];
    }
    if (savedArrays[param] !== undefined) {
      ctx.arrays[param] = savedArrays[param]!;
    } else {
      delete ctx.arrays[param];
    }
  }

  ctx.hasReturn = false;
  ctx.returnValue = undefined;
  ctx.currentRecursionDepth--;

  return result;
}

async function evalAssignment(
  ctx: AwkRuntimeContext,
  expr: {
    operator: string;
    target: AwkFieldRef | AwkVariable | AwkArrayAccess;
    value: AwkExpr;
  },
): Promise<AwkValue> {
  const value = await evalExpr(ctx, expr.value);
  const target = expr.target;
  const op = expr.operator;

  let finalValue: AwkValue;

  if (op === "=") {
    finalValue = value;
  } else {
    // Compound assignment - get current value
    let current: AwkValue;
    if (target.type === "field") {
      const index = Math.floor(toNumber(await evalExpr(ctx, target.index)));
      current = getField(ctx, index);
    } else if (target.type === "variable") {
      current = getVariable(ctx, target.name);
    } else {
      const key = toAwkString(await evalExpr(ctx, target.key));
      current = getArrayElement(ctx, target.array, key);
    }

    const currentNum = toNumber(current);
    const valueNum = toNumber(value);

    switch (op) {
      case "+=":
        finalValue = currentNum + valueNum;
        break;
      case "-=":
        finalValue = currentNum - valueNum;
        break;
      case "*=":
        finalValue = currentNum * valueNum;
        break;
      case "/=":
        finalValue = valueNum !== 0 ? currentNum / valueNum : 0;
        break;
      case "%=":
        finalValue = valueNum !== 0 ? currentNum % valueNum : 0;
        break;
      case "^=":
        finalValue = currentNum ** valueNum;
        break;
      default:
        finalValue = value;
    }
  }

  // Assign to target
  if (target.type === "field") {
    const index = Math.floor(toNumber(await evalExpr(ctx, target.index)));
    setField(ctx, index, finalValue);
  } else if (target.type === "variable") {
    setVariable(ctx, target.name, finalValue);
  } else {
    const key = toAwkString(await evalExpr(ctx, target.key));
    setArrayElement(ctx, target.array, key, finalValue);
  }

  return finalValue;
}

/**
 * Unified increment/decrement evaluator.
 * delta: +1 for increment, -1 for decrement
 * returnOld: true for post-increment/decrement (return old value),
 *            false for pre-increment/decrement (return new value)
 */
async function evalIncrDecr(
  ctx: AwkRuntimeContext,
  operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
  delta: number,
  returnOld: boolean,
): Promise<AwkValue> {
  let oldVal: number;

  if (operand.type === "field") {
    const index = Math.floor(toNumber(await evalExpr(ctx, operand.index)));
    oldVal = toNumber(getField(ctx, index));
    setField(ctx, index, oldVal + delta);
  } else if (operand.type === "variable") {
    oldVal = toNumber(getVariable(ctx, operand.name));
    setVariable(ctx, operand.name, oldVal + delta);
  } else {
    const key = toAwkString(await evalExpr(ctx, operand.key));
    oldVal = toNumber(getArrayElement(ctx, operand.array, key));
    setArrayElement(ctx, operand.array, key, oldVal + delta);
  }

  return returnOld ? oldVal : oldVal + delta;
}

async function evalInExpr(
  ctx: AwkRuntimeContext,
  key: AwkExpr,
  array: string,
): Promise<AwkValue> {
  let keyStr: string;
  if (key.type === "tuple") {
    // Multi-dimensional key: join with SUBSEP
    const parts: string[] = [];
    for (const e of key.elements) {
      parts.push(toAwkString(await evalExpr(ctx, e)));
    }
    keyStr = parts.join(ctx.SUBSEP);
  } else {
    keyStr = toAwkString(await evalExpr(ctx, key));
  }
  return hasArrayElement(ctx, array, keyStr) ? 1 : 0;
}

/**
 * Evaluate getline - reads next line from current input or from file.
 */
async function evalGetline(
  ctx: AwkRuntimeContext,
  variable?: string,
  file?: AwkExpr,
): Promise<AwkValue> {
  // getline < "file" - read from external file
  if (file) {
    return evalGetlineFromFile(ctx, variable, file);
  }

  // Plain getline - read from current input
  if (!ctx.lines || ctx.lineIndex === undefined) {
    return -1;
  }

  const nextLineIndex = ctx.lineIndex + 1;
  if (nextLineIndex >= ctx.lines.length) {
    return 0; // No more lines
  }

  const nextLine = ctx.lines[nextLineIndex]!;

  if (variable) {
    setVariable(ctx, variable, nextLine);
  } else {
    setCurrentLine(ctx, nextLine);
  }

  ctx.NR++;
  ctx.lineIndex = nextLineIndex;

  return 1;
}

/**
 * Read a line from an external file.
 */
async function evalGetlineFromFile(
  ctx: AwkRuntimeContext,
  variable: string | undefined,
  fileExpr: AwkExpr,
): Promise<AwkValue> {
  if (!ctx.fs || !ctx.cwd) {
    return -1; // No filesystem access
  }

  const filename = toAwkString(await evalExpr(ctx, fileExpr));
  const filePath = ctx.fs.resolvePath(ctx.cwd, filename);

  let cached = ctx.fileCache.get(filePath);

  if (!cached) {
    try {
      const content = await ctx.fs.readFile(filePath);
      const lines = content.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      cached = { lines, index: -1 };
      ctx.fileCache.set(filePath, cached);
    } catch {
      return -1;
    }
  }

  const nextIndex = cached.index + 1;
  if (nextIndex >= cached.lines.length) {
    return 0;
  }

  const line = cached.lines[nextIndex]!;
  cached.index = nextIndex;

  if (variable) {
    setVariable(ctx, variable, line);
  } else {
    setCurrentLine(ctx, line);
  }

  return 1;
}

async function evalTuple(
  ctx: AwkRuntimeContext,
  elements: AwkExpr[],
): Promise<AwkValue> {
  if (elements.length === 0) return "";
  for (let i = 0; i < elements.length - 1; i++) {
    await evalExpr(ctx, elements[i]!);
  }
  return evalExpr(ctx, elements[elements.length - 1]!);
}
