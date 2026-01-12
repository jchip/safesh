/**
 * Handlers Module
 *
 * Re-exports all handler functions.
 */

// Command handlers
export {
  buildCommand,
  visitCommand,
  visitPipeline,
  buildVariableAssignment,
  visitVariableAssignment,
  applyRedirection,
} from "./commands.ts";

// Control flow handlers
export {
  visitIfStatement,
  visitForStatement,
  visitCStyleForStatement,
  visitWhileStatement,
  visitUntilStatement,
  visitCaseStatement,
  visitFunctionDeclaration,
  visitSubshell,
  visitBraceGroup,
  visitTestCommand,
  visitArithmeticCommand,
} from "./control.ts";

// Word and expansion handlers
export {
  visitWord,
  visitWordPart,
  visitParameterExpansion,
  visitCommandSubstitution,
  visitArithmeticExpansion,
  visitProcessSubstitution,
} from "./words.ts";

// Test condition handlers
export {
  visitTestCondition,
  visitUnaryTest,
  visitBinaryTest,
  visitLogicalTest,
  visitStringTest,
} from "./tests.ts";

// Arithmetic expression handlers
export {
  visitArithmeticExpression,
  visitNumberLiteral,
  visitVariableReference,
  visitBinaryArithmetic,
  visitUnaryArithmetic,
  visitConditionalArithmetic,
  visitAssignmentExpression,
  visitGroupedArithmetic,
} from "./arithmetic.ts";
