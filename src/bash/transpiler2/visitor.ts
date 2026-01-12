/**
 * AST Visitor Interface
 *
 * Defines the visitor pattern interface for traversing bash AST nodes.
 * Each node type has a corresponding visit method.
 */

import type * as AST from "../ast.ts";
import type { ExpressionResult, StatementResult, VisitorContext } from "./types.ts";

// =============================================================================
// Statement Visitors
// =============================================================================

export interface PipelineVisitor {
  visitPipeline(node: AST.Pipeline, ctx: VisitorContext): StatementResult;
}

export interface CommandVisitor {
  visitCommand(node: AST.Command, ctx: VisitorContext): StatementResult;
  buildCommand(node: AST.Command, ctx: VisitorContext): ExpressionResult;
}

export interface IfStatementVisitor {
  visitIfStatement(node: AST.IfStatement, ctx: VisitorContext): StatementResult;
}

export interface ForStatementVisitor {
  visitForStatement(node: AST.ForStatement, ctx: VisitorContext): StatementResult;
}

export interface CStyleForStatementVisitor {
  visitCStyleForStatement(node: AST.CStyleForStatement, ctx: VisitorContext): StatementResult;
}

export interface WhileStatementVisitor {
  visitWhileStatement(node: AST.WhileStatement, ctx: VisitorContext): StatementResult;
}

export interface UntilStatementVisitor {
  visitUntilStatement(node: AST.UntilStatement, ctx: VisitorContext): StatementResult;
}

export interface CaseStatementVisitor {
  visitCaseStatement(node: AST.CaseStatement, ctx: VisitorContext): StatementResult;
}

export interface FunctionDeclarationVisitor {
  visitFunctionDeclaration(node: AST.FunctionDeclaration, ctx: VisitorContext): StatementResult;
}

export interface VariableAssignmentVisitor {
  visitVariableAssignment(node: AST.VariableAssignment, ctx: VisitorContext): StatementResult;
  buildVariableAssignment(node: AST.VariableAssignment, ctx: VisitorContext): string;
}

export interface SubshellVisitor {
  visitSubshell(node: AST.Subshell, ctx: VisitorContext): StatementResult;
}

export interface BraceGroupVisitor {
  visitBraceGroup(node: AST.BraceGroup, ctx: VisitorContext): StatementResult;
}

export interface TestCommandVisitor {
  visitTestCommand(node: AST.TestCommand, ctx: VisitorContext): StatementResult;
}

export interface ArithmeticCommandVisitor {
  visitArithmeticCommand(node: AST.ArithmeticCommand, ctx: VisitorContext): StatementResult;
}

// =============================================================================
// Expression Visitors
// =============================================================================

export interface WordVisitor {
  visitWord(node: AST.Word, ctx: VisitorContext): string;
  visitWordPart(part: AST.WordPart, ctx: VisitorContext): string;
}

export interface ParameterExpansionVisitor {
  visitParameterExpansion(node: AST.ParameterExpansion, ctx: VisitorContext): string;
}

export interface CommandSubstitutionVisitor {
  visitCommandSubstitution(node: AST.CommandSubstitution, ctx: VisitorContext): string;
}

export interface ArithmeticExpansionVisitor {
  visitArithmeticExpansion(node: AST.ArithmeticExpansion, ctx: VisitorContext): string;
}

export interface ProcessSubstitutionVisitor {
  visitProcessSubstitution(node: AST.ProcessSubstitution, ctx: VisitorContext): string;
}

// =============================================================================
// Test Condition Visitors
// =============================================================================

export interface TestConditionVisitor {
  visitTestCondition(node: AST.TestCondition, ctx: VisitorContext): string;
  visitUnaryTest(node: AST.UnaryTest, ctx: VisitorContext): string;
  visitBinaryTest(node: AST.BinaryTest, ctx: VisitorContext): string;
  visitLogicalTest(node: AST.LogicalTest, ctx: VisitorContext): string;
  visitStringTest(node: AST.StringTest, ctx: VisitorContext): string;
}

// =============================================================================
// Arithmetic Expression Visitors
// =============================================================================

export interface ArithmeticExpressionVisitor {
  visitArithmeticExpression(node: AST.ArithmeticExpression, ctx: VisitorContext): string;
  visitNumberLiteral(node: AST.NumberLiteral, ctx: VisitorContext): string;
  visitVariableReference(node: AST.VariableReference, ctx: VisitorContext): string;
  visitBinaryArithmetic(node: AST.BinaryArithmeticExpression, ctx: VisitorContext): string;
  visitUnaryArithmetic(node: AST.UnaryArithmeticExpression, ctx: VisitorContext): string;
  visitConditionalArithmetic(node: AST.ConditionalArithmeticExpression, ctx: VisitorContext): string;
  visitAssignmentExpression(node: AST.AssignmentExpression, ctx: VisitorContext): string;
  visitGroupedArithmetic(node: AST.GroupedArithmeticExpression, ctx: VisitorContext): string;
}

// =============================================================================
// Redirection Visitor
// =============================================================================

export interface RedirectionVisitor {
  applyRedirection(cmdExpr: string, redirect: AST.Redirection, ctx: VisitorContext): string;
}

// =============================================================================
// Combined Visitor Interface
// =============================================================================

/**
 * Full AST visitor combining all node type visitors.
 * Implementations can pick which methods to implement.
 */
export type ASTVisitor =
  & PipelineVisitor
  & CommandVisitor
  & IfStatementVisitor
  & ForStatementVisitor
  & CStyleForStatementVisitor
  & WhileStatementVisitor
  & UntilStatementVisitor
  & CaseStatementVisitor
  & FunctionDeclarationVisitor
  & VariableAssignmentVisitor
  & SubshellVisitor
  & BraceGroupVisitor
  & TestCommandVisitor
  & ArithmeticCommandVisitor
  & WordVisitor
  & ParameterExpansionVisitor
  & CommandSubstitutionVisitor
  & ArithmeticExpansionVisitor
  & ProcessSubstitutionVisitor
  & TestConditionVisitor
  & ArithmeticExpressionVisitor
  & RedirectionVisitor;
