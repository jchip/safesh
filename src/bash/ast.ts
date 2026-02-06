/**
 * Bash AST Types for SafeShell
 *
 * Abstract Syntax Tree node definitions for representing bash scripts.
 * These nodes are produced by the parser and consumed by the transpiler.
 */

import type { TokenId } from "./token-id.ts";

// =============================================================================
// Base Types
// =============================================================================

export interface SourceLocation {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
}

export interface BaseNode {
  type: string;
  loc?: SourceLocation;
  /** Unique identifier for this node (assigned during parsing) */
  id?: TokenId;
}

// =============================================================================
// Top-level Program
// =============================================================================

export interface Program extends BaseNode {
  type: "Program";
  body: Statement[];
}

// =============================================================================
// Statements
// =============================================================================

export type Statement =
  | Pipeline
  | Command
  | IfStatement
  | ForStatement
  | CStyleForStatement
  | WhileStatement
  | UntilStatement
  | CaseStatement
  | FunctionDeclaration
  | VariableAssignment
  | Subshell
  | BraceGroup
  | TestCommand
  | ArithmeticCommand
  | ReturnStatement
  | BreakStatement
  | ContinueStatement;

// =============================================================================
// Commands
// =============================================================================

export interface Command extends BaseNode {
  type: "Command";
  name: Word | ParameterExpansion | CommandSubstitution;
  args: (Word | ParameterExpansion | CommandSubstitution)[];
  redirects: Redirection[];
  assignments: VariableAssignment[];
}

export interface Pipeline extends BaseNode {
  type: "Pipeline";
  commands: Statement[];
  operator: "&&" | "||" | "|" | ";" | "&" | null;
  background: boolean;
  negated?: boolean; // True if preceded by '!'
}

// =============================================================================
// Control Flow
// =============================================================================

export interface IfStatement extends BaseNode {
  type: "IfStatement";
  test: Pipeline | Command | TestCommand | ArithmeticCommand;
  consequent: Statement[];
  alternate: Statement[] | IfStatement | null;
}

export interface ForStatement extends BaseNode {
  type: "ForStatement";
  variable: string;
  iterable: (Word | ParameterExpansion | CommandSubstitution)[];
  body: Statement[];
}

export interface CStyleForStatement extends BaseNode {
  type: "CStyleForStatement";
  init: ArithmeticExpression | null;
  test: ArithmeticExpression | null;
  update: ArithmeticExpression | null;
  body: Statement[];
}

export interface WhileStatement extends BaseNode {
  type: "WhileStatement";
  test: Pipeline | Command | TestCommand | ArithmeticCommand;
  body: Statement[];
}

export interface UntilStatement extends BaseNode {
  type: "UntilStatement";
  test: Pipeline | Command | TestCommand | ArithmeticCommand;
  body: Statement[];
}

export interface CaseStatement extends BaseNode {
  type: "CaseStatement";
  word: Word | ParameterExpansion | CommandSubstitution;
  cases: CaseClause[];
}

export interface CaseClause extends BaseNode {
  type: "CaseClause";
  patterns: (Word | ParameterExpansion)[];
  body: Statement[];
}

export interface ReturnStatement extends BaseNode {
  type: "ReturnStatement";
  value?: ArithmeticExpression; // Optional exit code (default: 0)
}

export interface BreakStatement extends BaseNode {
  type: "BreakStatement";
  count?: number; // Optional: number of loop levels to break (default: 1)
}

export interface ContinueStatement extends BaseNode {
  type: "ContinueStatement";
  count?: number; // Optional: number of loop levels to continue (default: 1)
}

// =============================================================================
// Functions and Grouping
// =============================================================================

export interface FunctionDeclaration extends BaseNode {
  type: "FunctionDeclaration";
  name: string;
  body: Statement[];
}

export interface Subshell extends BaseNode {
  type: "Subshell";
  body: Statement[];
  redirections?: Redirection[];
}

export interface BraceGroup extends BaseNode {
  type: "BraceGroup";
  body: Statement[];
  redirections?: Redirection[];
}

export interface TestCommand extends BaseNode {
  type: "TestCommand";
  expression: TestCondition;
}

export interface ArithmeticCommand extends BaseNode {
  type: "ArithmeticCommand";
  expression: ArithmeticExpression;
}

// =============================================================================
// Variables
// =============================================================================

export interface ArrayLiteral extends BaseNode {
  type: "ArrayLiteral";
  elements: (Word | ParameterExpansion | CommandSubstitution)[];
}

export interface VariableAssignment extends BaseNode {
  type: "VariableAssignment";
  name: string;
  value: Word | ParameterExpansion | CommandSubstitution | ArithmeticExpansion | ArrayLiteral;
  exported?: boolean;
}

// =============================================================================
// Redirections
// =============================================================================

export interface Redirection extends BaseNode {
  type: "Redirection";
  operator: RedirectionOperator;
  fd?: number; // File descriptor (default: 0 for input, 1 for output)
  fdVar?: string; // Variable name for {var}>file syntax (Bash 4.1+)
  target: Word | number; // File path or fd number
}

export type RedirectionOperator =
  | "<" // Input
  | ">" // Output
  | ">>" // Append
  | "<>" // Read/write
  | ">&" // Duplicate output fd
  | "<&" // Duplicate input fd
  | ">|" // Clobber
  | "&>" // Redirect stdout and stderr
  | "&>>" // Append stdout and stderr
  | "<<" // Here-document
  | "<<-" // Here-document (strip tabs)
  | "<<<"; // Here-string

// =============================================================================
// Words and Expansions
// =============================================================================

export interface Word extends BaseNode {
  type: "Word";
  value: string;
  quoted: boolean;
  singleQuoted: boolean;
  parts: WordPart[];
}

export type WordPart =
  | LiteralPart
  | ParameterExpansion
  | CommandSubstitution
  | ArithmeticExpansion
  | ProcessSubstitution
  | GlobPattern;

export interface LiteralPart extends BaseNode {
  type: "LiteralPart";
  value: string;
}

export interface ParameterExpansion extends BaseNode {
  type: "ParameterExpansion";
  parameter: string;
  modifier?: ParameterModifier;
  modifierArg?: Word | ParameterExpansion;
  // SSH-303: Array support
  subscript?: string | "@" | "*"; // Array subscript: ${arr[0]}, ${arr[@]}, ${arr[*]}
  indirection?: boolean; // ${!arr[@]} for array indices
}

export type ParameterModifier =
  | ":-" // ${var:-default}
  | "-" // ${var-default}
  | ":=" // ${var:=default}
  | "=" // ${var=default}
  | ":?" // ${var:?error}
  | "?" // ${var?error}
  | ":+" // ${var:+alternate}
  | "+" // ${var+alternate}
  | "#" // ${var#pattern} Remove shortest prefix
  | "##" // ${var##pattern} Remove longest prefix
  | "%" // ${var%pattern} Remove shortest suffix
  | "%%" // ${var%%pattern} Remove longest suffix
  | "/" // ${var/pattern/replacement}
  | "//" // ${var//pattern/replacement}
  | "/#" // ${var/#pattern/replacement}
  | "/%" // ${var/%pattern/replacement}
  | "^" // ${var^pattern} Uppercase first char
  | "^^" // ${var^^pattern} Uppercase all
  | "," // ${var,pattern} Lowercase first char
  | ",," // ${var,,pattern} Lowercase all
  | "@" // ${var@operator}
  | "length" // ${#var}
  | "substring"; // ${var:offset:length}

export interface CommandSubstitution extends BaseNode {
  type: "CommandSubstitution";
  command: Statement[];
  backtick: boolean; // true for `...`, false for $(...)
}

export interface ArithmeticExpansion extends BaseNode {
  type: "ArithmeticExpansion";
  expression: ArithmeticExpression;
}

export interface ProcessSubstitution extends BaseNode {
  type: "ProcessSubstitution";
  operator: "<(" | ">(";
  command: Statement[];
}

// =============================================================================
// Arithmetic
// =============================================================================

export type ArithmeticExpression =
  | NumberLiteral
  | VariableReference
  | BinaryArithmeticExpression
  | UnaryArithmeticExpression
  | ConditionalArithmeticExpression
  | AssignmentExpression
  | GroupedArithmeticExpression
  | ParameterExpansion;

export interface NumberLiteral extends BaseNode {
  type: "NumberLiteral";
  value: number;
}

export interface VariableReference extends BaseNode {
  type: "VariableReference";
  name: string;
}

export interface BinaryArithmeticExpression extends BaseNode {
  type: "BinaryArithmeticExpression";
  operator:
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "**"
    | "<<"
    | ">>"
    | "&"
    | "|"
    | "^"
    | "&&"
    | "||"
    | "=="
    | "!="
    | "<"
    | ">"
    | "<="
    | ">="
    | ","; // Comma operator for sequencing
  left: ArithmeticExpression;
  right: ArithmeticExpression;
}

export interface UnaryArithmeticExpression extends BaseNode {
  type: "UnaryArithmeticExpression";
  operator: "++" | "--" | "+" | "-" | "~" | "!";
  argument: ArithmeticExpression;
  prefix: boolean;
}

export interface ConditionalArithmeticExpression extends BaseNode {
  type: "ConditionalArithmeticExpression";
  test: ArithmeticExpression;
  consequent: ArithmeticExpression;
  alternate: ArithmeticExpression;
}

export interface AssignmentExpression extends BaseNode {
  type: "AssignmentExpression";
  operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "<<=" | ">>=" | "&=" | "|=" | "^=";
  left: VariableReference;
  right: ArithmeticExpression;
}

export interface GroupedArithmeticExpression extends BaseNode {
  type: "GroupedArithmeticExpression";
  expression: ArithmeticExpression;
}

// =============================================================================
// Patterns (for case and parameter expansion)
// =============================================================================

export interface GlobPattern extends BaseNode {
  type: "GlobPattern";
  pattern: string;
}

// =============================================================================
// Test Expressions ([[...]])
// =============================================================================

export interface TestExpression extends BaseNode {
  type: "TestExpression";
  expression: TestCondition;
}

export type TestCondition =
  | UnaryTest
  | BinaryTest
  | LogicalTest
  | StringTest;

export interface UnaryTest extends BaseNode {
  type: "UnaryTest";
  operator: UnaryTestOperator;
  argument: Word | ParameterExpansion;
}

export type UnaryTestOperator =
  | "-e" // exists
  | "-f" // regular file
  | "-d" // directory
  | "-L" | "-h" // symbolic link
  | "-b" // block device
  | "-c" // character device
  | "-p" // named pipe
  | "-S" // socket
  | "-t" // fd is open and refers to terminal
  | "-r" // readable
  | "-w" // writable
  | "-x" // executable
  | "-s" // size > 0
  | "-g" // setgid
  | "-u" // setuid
  | "-k" // sticky
  | "-O" // owned by effective uid
  | "-G" // owned by effective gid
  | "-N" // modified since last read
  | "-z" // string length is zero
  | "-n"; // string length is non-zero

export interface BinaryTest extends BaseNode {
  type: "BinaryTest";
  operator: BinaryTestOperator;
  left: Word | ParameterExpansion;
  right: Word | ParameterExpansion;
}

export type BinaryTestOperator =
  | "=" | "==" // string equality
  | "!=" // string inequality
  | "<" | ">" // string comparison (lexicographic)
  | "-eq" | "-ne" | "-lt" | "-le" | "-gt" | "-ge" // numeric comparison
  | "-nt" | "-ot" | "-ef" // file comparison
  | "=~"; // regex match

export interface LogicalTest extends BaseNode {
  type: "LogicalTest";
  operator: "&&" | "||" | "!";
  left?: TestCondition;
  right: TestCondition;
}

export interface StringTest extends BaseNode {
  type: "StringTest";
  value: Word | ParameterExpansion;
}

// =============================================================================
// Parse Diagnostics (for error recovery)
// =============================================================================

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ParseDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  code?: string; // Optional error code (e.g., "SSH001")
  context?: string; // Optional context info (e.g., "in 'if' statement")
}

export interface ParseResult {
  ast: Program;
  diagnostics: ParseDiagnostic[];
}
