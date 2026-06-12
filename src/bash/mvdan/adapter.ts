/**
 * mvdan/sh → SafeShell AST adapter (SSH-585)
 *
 * Parses bash with mvdan/sh (npm:mvdan-sh, GopherJS build) and converts the
 * result into the SafeShell AST shape consumed by the passthrough analyzer
 * (src/hooks/passthrough-analyzer.ts).
 *
 * PURPOSE AND SOUNDNESS RULE: this adapter exists to make PERMISSION
 * decisions, not to feed the transpiler. Any construct it cannot map with
 * certainty becomes a node type the analyzer does not know
 * ("MvdanUnsupported" / "MvdanUnsupportedPart"), which the analyzer's
 * default-deny branches turn into transpile fallback. Never guess-map: a
 * wrong mapping here can let a command or path through unchecked, while an
 * unsupported marker only costs a fallback.
 *
 * Operator/test enum values in produced nodes are best-effort placeholders
 * where the analyzer ignores them (it only walks operands); do not reuse this
 * adapter for consumers that interpret those operators.
 */

// deno-lint-ignore-file no-explicit-any

import mvdan from "mvdan-sh";
import type * as AST from "../ast.ts";

const syntax = (mvdan as any).syntax;

/** Thrown when mvdan/sh rejects the source. */
export class MvdanParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MvdanParseError";
  }
}

// BinaryCmd token values (probed against mvdan-sh 0.10.1)
const BINARY_OPS: Record<number, "&&" | "||" | "|"> = {
  10: "&&",
  11: "||",
  12: "|",
  // 13 = |& intentionally absent → unsupported
};

// Redirect token values (probed against mvdan-sh 0.10.1)
const REDIRECT_OPS: Record<number, AST.RedirectionOperator> = {
  54: ">",
  55: ">>",
  56: "<",
  57: "<>",
  58: "<&",
  59: ">&",
  60: ">|",
  61: "<<",
  62: "<<-",
  63: "<<<",
  64: "&>",
  65: "&>>",
};

function nodeType(n: any): string {
  try {
    return syntax.NodeType(n);
  } catch {
    return "<unknown>";
  }
}

function unsupported(reason: string): AST.Statement {
  return { type: "MvdanUnsupported", reason } as unknown as AST.Statement;
}

function unsupportedPart(reason: string): AST.WordPart {
  return { type: "MvdanUnsupportedPart", reason } as unknown as AST.WordPart;
}

/** A Word that can never resolve statically (carries an unsupported part). */
function opaqueWord(reason: string): AST.Word {
  return {
    type: "Word",
    value: "",
    quoted: false,
    singleQuoted: false,
    parts: [unsupportedPart(reason)],
  };
}

/** True when any node in the subtree is a command/process substitution. */
function containsSubstitution(node: any): boolean {
  if (node === null || node === undefined) return false;
  let found = false;
  syntax.Walk(node, (n: any) => {
    if (n === null || n === undefined) return true;
    const t = nodeType(n);
    if (t === "CmdSubst" || t === "ProcSubst") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

// =============================================================================
// Parse entry point
// =============================================================================

export function parseWithMvdan(source: string): AST.Program {
  const parser = syntax.NewParser(syntax.Variant(syntax.LangBash));
  let file: any;
  try {
    file = parser.Parse(source, "command.sh");
  } catch (error) {
    const message = (error as any)?.message ??
      (typeof (error as any)?.Error === "function" ? (error as any).Error() : String(error));
    throw new MvdanParseError(String(message));
  }
  return {
    type: "Program",
    body: (file.Stmts ?? []).map((s: any) => convertStmt(s)),
  };
}

// =============================================================================
// Statements
// =============================================================================

function convertStmt(stmt: any): AST.Statement {
  if (stmt.Coprocess) return unsupported("coproc");

  let inner = convertCommandNode(stmt.Cmd, stmt.Redirs ?? []);

  if (stmt.Negated) {
    inner = {
      type: "Pipeline",
      commands: [inner],
      operator: null,
      background: false,
      negated: true,
    } satisfies AST.Pipeline;
  }
  if (stmt.Background) {
    inner = {
      type: "Pipeline",
      commands: [inner],
      operator: null,
      background: true,
    } satisfies AST.Pipeline;
  }
  return inner;
}

function convertStmts(stmts: any[] | undefined): AST.Statement[] {
  return (stmts ?? []).map((s) => convertStmt(s));
}

/**
 * Convert a Stmt.Cmd node, attaching the statement's redirects to node kinds
 * that carry them in the SafeShell AST. Redirects on anything else are
 * unsupported (sound: the analyzer then rejects).
 */
function convertCommandNode(cmd: any, redirs: any[]): AST.Statement {
  if (cmd === null || cmd === undefined) {
    // Redirect-only statement (e.g. `> file`): model as empty command
    return {
      type: "Command",
      name: emptyWord(),
      args: [],
      redirects: convertRedirects(redirs),
      assignments: [],
    } satisfies AST.Command;
  }

  const t = nodeType(cmd);
  switch (t) {
    case "CallExpr":
      return convertCallExpr(cmd, redirs);

    case "DeclClause":
      return convertDeclClause(cmd, redirs);

    case "BinaryCmd": {
      const op = BINARY_OPS[cmd.Op as number];
      if (op === undefined) return unsupported(`binary op ${cmd.Op}`);
      if (redirs.length > 0) return unsupported("redirect on logical/pipe chain");
      return {
        type: "Pipeline",
        commands: [convertStmt(cmd.X), convertStmt(cmd.Y)],
        operator: op,
        background: false,
      } satisfies AST.Pipeline;
    }

    case "IfClause":
      return convertIfClause(cmd, redirs);

    case "WhileClause": {
      const base = {
        test: wrapCondition(cmd.Cond),
        body: convertStmts(cmd.Do),
        redirects: convertRedirects(redirs),
      };
      return cmd.Until
        ? ({ type: "UntilStatement", ...base } satisfies AST.UntilStatement)
        : ({ type: "WhileStatement", ...base } satisfies AST.WhileStatement);
    }

    case "ForClause": {
      if (cmd.Select) return unsupported("select loop");
      const loop = cmd.Loop;
      const loopType = nodeType(loop);
      if (loopType === "WordIter") {
        return {
          type: "ForStatement",
          variable: loop.Name?.Value ?? "",
          iterable: (loop.Items ?? []).map((w: any) => convertWord(w)),
          body: convertStmts(cmd.Do),
          redirects: convertRedirects(redirs),
        } satisfies AST.ForStatement;
      }
      if (loopType === "CStyleLoop") {
        // The analyzer assumes C-style arithmetic cannot hide commands (the
        // legacy parser rejects $() there); mvdan allows it, so check.
        if (
          containsSubstitution(loop.Init) || containsSubstitution(loop.Cond) ||
          containsSubstitution(loop.Post)
        ) {
          return unsupported("substitution in C-style for header");
        }
        return {
          type: "CStyleForStatement",
          init: null,
          test: null,
          update: null,
          body: convertStmts(cmd.Do),
          redirects: convertRedirects(redirs),
        } satisfies AST.CStyleForStatement;
      }
      return unsupported(`for loop kind ${loopType}`);
    }

    case "CaseClause":
      return {
        type: "CaseStatement",
        word: convertWord(cmd.Word),
        cases: (cmd.Items ?? []).map((item: any) => ({
          type: "CaseClause",
          patterns: (item.Patterns ?? []).map((w: any) => convertWord(w)),
          body: convertStmts(item.Stmts),
        } satisfies AST.CaseClause)),
        redirects: convertRedirects(redirs),
      } satisfies AST.CaseStatement;

    case "Subshell":
      return {
        type: "Subshell",
        body: convertStmts(cmd.Stmts),
        redirections: convertRedirects(redirs),
      } satisfies AST.Subshell;

    case "Block":
      return {
        type: "BraceGroup",
        body: convertStmts(cmd.Stmts),
        redirections: convertRedirects(redirs),
      } satisfies AST.BraceGroup;

    case "FuncDecl":
      // The analyzer rejects function declarations on sight; still convert
      // the body so the rejection reason stays accurate.
      return {
        type: "FunctionDeclaration",
        name: cmd.Name?.Value ?? "",
        body: [convertStmt(cmd.Body)],
      } satisfies AST.FunctionDeclaration;

    case "TestClause": {
      if (redirs.length > 0) return unsupported("redirect on [[ ]]");
      const expr = convertTestExpr(cmd.X);
      if (expr === undefined) return unsupported("unmappable [[ ]] expression");
      return { type: "TestCommand", expression: expr } satisfies AST.TestCommand;
    }

    case "ArithmCmd": {
      if (containsSubstitution(cmd.X)) {
        return unsupported("substitution in (( ))");
      }
      if (redirs.length > 0) return unsupported("redirect on (( ))");
      return {
        type: "ArithmeticCommand",
        expression: { type: "NumberLiteral", value: 0 },
      } satisfies AST.ArithmeticCommand;
    }

    default:
      return unsupported(`command kind ${t}`);
  }
}

function convertCallExpr(call: any, redirs: any[]): AST.Statement {
  const assignments: AST.VariableAssignment[] = [];
  for (const assign of call.Assigns ?? []) {
    const converted = convertAssign(assign);
    if (converted === undefined) return unsupported("unmappable assignment");
    assignments.push(converted);
  }

  const args: any[] = call.Args ?? [];
  const name = args.length > 0 ? convertWord(args[0]) : emptyWord();

  // break/continue/return are statement types in the legacy AST, not
  // commands — mapping them as commands would put "break" in the enumerated
  // command set and fail the allowlist. Only when nothing can hide: no
  // assignments/redirects, and at most one purely numeric argument.
  if (assignments.length === 0 && redirs.length === 0 && args.length <= 2) {
    const loopCtl = name.parts.length === 0 ? name.value : undefined;
    if (loopCtl === "break" || loopCtl === "continue" || loopCtl === "return") {
      const countWord = args.length === 2 ? convertWord(args[1]) : undefined;
      const literalCount = countWord === undefined ||
        (countWord.parts.length === 0 && /^\d+$/.test(countWord.value));
      if (literalCount) {
        if (loopCtl === "break") return { type: "BreakStatement" } satisfies AST.BreakStatement;
        if (loopCtl === "continue") {
          return { type: "ContinueStatement" } satisfies AST.ContinueStatement;
        }
        return { type: "ReturnStatement" } satisfies AST.ReturnStatement;
      }
    }
  }

  return {
    type: "Command",
    name,
    args: args.slice(1).map((w) => convertWord(w)),
    redirects: convertRedirects(redirs),
    assignments,
  } satisfies AST.Command;
}

/**
 * export/local/declare/typeset/readonly/nameref. Modeled as a Command named
 * after the variant whose assignments are analyzed like any other (this is
 * how the legacy parser presents them to the analyzer).
 */
function convertDeclClause(decl: any, redirs: any[]): AST.Statement {
  const variant = decl.Variant?.Value;
  if (typeof variant !== "string" || variant === "") {
    return unsupported("declaration without variant");
  }
  const assignments: AST.VariableAssignment[] = [];
  for (const arg of decl.Args ?? []) {
    const converted = convertAssign(arg);
    if (converted === undefined) return unsupported("unmappable declaration argument");
    assignments.push(converted);
  }
  return {
    type: "Command",
    name: literalWord(variant),
    args: [],
    redirects: convertRedirects(redirs),
    assignments,
  } satisfies AST.Command;
}

/**
 * Assign → VariableAssignment. Returns undefined for forms whose static
 * value semantics we cannot represent (+=, naked, subscripted): mapping them
 * as plain assignments could make the analyzer's static resolution WRONG
 * (e.g. `cd $a` checked against a stale value), which is unsound rather than
 * conservative.
 */
function convertAssign(assign: any): AST.VariableAssignment | undefined {
  const name = assign.Name?.Value;
  if (typeof name !== "string" || name === "") return undefined;
  if (assign.Append) return undefined;
  if (assign.Index !== null && assign.Index !== undefined) return undefined;
  if (assign.Naked) return undefined;

  if (assign.Array !== null && assign.Array !== undefined) {
    return {
      type: "VariableAssignment",
      name,
      value: {
        type: "ArrayLiteral",
        elements: (assign.Array.Elems ?? []).map((e: any) => convertWord(e.Value)),
      } satisfies AST.ArrayLiteral,
    };
  }

  return {
    type: "VariableAssignment",
    name,
    value: assign.Value ? convertWord(assign.Value) : literalWord(""),
  };
}

function convertIfClause(ifc: any, redirs: any[]): AST.IfStatement {
  // mvdan chains elif/else as nested IfClause; the terminal else is an
  // IfClause with an empty Cond whose Then holds the else body.
  let alternate: AST.Statement[] | AST.IfStatement | null = null;
  const elseClause = ifc.Else;
  if (elseClause !== null && elseClause !== undefined) {
    if ((elseClause.Cond ?? []).length === 0) {
      alternate = convertStmts(elseClause.Then);
    } else {
      alternate = convertIfClause(elseClause, []);
    }
  }
  return {
    type: "IfStatement",
    test: wrapCondition(ifc.Cond),
    consequent: convertStmts(ifc.Then),
    alternate,
    redirects: convertRedirects(redirs),
  } satisfies AST.IfStatement;
}

/**
 * Condition statement lists (`if a; b; then`) wrap into a Pipeline so the
 * analyzer walks every statement; a single statement passes through.
 */
function wrapCondition(cond: any[] | undefined): AST.IfStatement["test"] {
  const stmts = convertStmts(cond);
  if (stmts.length === 1) {
    return stmts[0] as AST.IfStatement["test"];
  }
  return {
    type: "Pipeline",
    commands: stmts,
    operator: null,
    background: false,
  } satisfies AST.Pipeline;
}

// =============================================================================
// Test expressions ([[ ]])
// =============================================================================

// && / || token values inside [[ ]] match BinaryCmd's (probed: 10 / 11);
// 34 is `!`. Other operators are reduced to placeholder operands-only forms —
// the analyzer never reads test operators, only walks the operand words.
function convertTestExpr(node: any): AST.TestCondition | undefined {
  const t = nodeType(node);

  if (t === "Word") {
    return { type: "StringTest", value: convertWord(node) as AST.Word };
  }

  if (t === "ParenTest") {
    return convertTestExpr(node.X);
  }

  if (t === "UnaryTest") {
    const op = node.Op as number;
    const inner = node.X;
    if (op === 34) {
      const right = convertTestExpr(inner);
      if (right === undefined) return undefined;
      return { type: "LogicalTest", operator: "!", right };
    }
    if (nodeType(inner) !== "Word") return undefined;
    return {
      type: "UnaryTest",
      operator: "-n", // placeholder; analyzer ignores test operators
      argument: convertWord(inner) as AST.Word,
    };
  }

  if (t === "BinaryTest") {
    const op = node.Op as number;
    if (op === 10 || op === 11) {
      const left = convertTestExpr(node.X);
      const right = convertTestExpr(node.Y);
      if (left === undefined || right === undefined) return undefined;
      return { type: "LogicalTest", operator: op === 10 ? "&&" : "||", left, right };
    }
    if (nodeType(node.X) !== "Word" || nodeType(node.Y) !== "Word") return undefined;
    return {
      type: "BinaryTest",
      operator: "==", // placeholder; analyzer ignores test operators
      left: convertWord(node.X) as AST.Word,
      right: convertWord(node.Y) as AST.Word,
    };
  }

  return undefined;
}

// =============================================================================
// Redirects
// =============================================================================

function convertRedirects(redirs: any[]): AST.Redirection[] {
  return redirs.map((r) => {
    const op = REDIRECT_OPS[r.Op as number];
    if (op === undefined) {
      // Unknown operator: opaque target keeps the analyzer conservative
      return {
        type: "Redirection",
        operator: ">",
        target: opaqueWord(`redirect op ${r.Op}`),
      } satisfies AST.Redirection;
    }
    const fdText: string | undefined = r.N?.Value;
    const fd = fdText !== undefined && /^\d+$/.test(fdText) ? Number(fdText) : undefined;
    return {
      type: "Redirection",
      operator: op,
      fd,
      target: convertWord(r.Word),
    } satisfies AST.Redirection;
  });
}

// =============================================================================
// Words
// =============================================================================

function emptyWord(): AST.Word {
  return { type: "Word", value: "", quoted: false, singleQuoted: false, parts: [] };
}

function literalWord(value: string): AST.Word {
  return { type: "Word", value, quoted: false, singleQuoted: false, parts: [] };
}

/**
 * Convert an mvdan Word. Mirrors the legacy lexer's conventions the analyzer
 * depends on:
 * - a purely literal word has parts: [] and its text in value
 * - glob characters stay inside literal text (no GlobPattern nodes); the
 *   analyzer finds them by regex on resolved text
 * - quoted/singleQuoted describe whole-word quoting; partially quoted words
 *   keep quoted=false, which only makes hazard checks stricter
 */
function convertWord(word: any): AST.Word {
  if (word === null || word === undefined) return emptyWord();

  const mvParts: any[] = word.Parts ?? [];

  // Whole-word single quote: 'a b'
  if (mvParts.length === 1 && nodeType(mvParts[0]) === "SglQuoted" && !mvParts[0].Dollar) {
    return {
      type: "Word",
      value: mvParts[0].Value ?? "",
      quoted: false,
      singleQuoted: true,
      parts: [],
    };
  }

  // Whole-word double quote: "a $b"
  if (mvParts.length === 1 && nodeType(mvParts[0]) === "DblQuoted") {
    const inner = convertParts(mvParts[0].Parts ?? []);
    if (inner.kind === "literal") {
      return { type: "Word", value: inner.text, quoted: true, singleQuoted: false, parts: [] };
    }
    return { type: "Word", value: inner.text, quoted: true, singleQuoted: false, parts: inner.parts };
  }

  const converted = convertParts(mvParts);
  if (converted.kind === "literal") {
    // The analyzer's glob detection (resolveGlobText) walks parts, so words
    // with glob characters keep their literal parts; plain words use the
    // bare-value form like the legacy lexer.
    const hasGlobChars = /[*?[]/.test(converted.text);
    return {
      type: "Word",
      value: converted.text,
      quoted: false,
      singleQuoted: false,
      parts: hasGlobChars ? converted.parts : [],
    };
  }
  return {
    type: "Word",
    value: converted.text,
    quoted: false,
    singleQuoted: false,
    parts: converted.parts,
  };
}

interface ConvertedParts {
  kind: "literal" | "mixed";
  /** Concatenated text with expansions contributing "" (prefix checks only) */
  text: string;
  parts: AST.WordPart[];
}

function convertParts(mvParts: any[]): ConvertedParts {
  const parts: AST.WordPart[] = [];
  let text = "";
  let allLiteral = true;

  for (const part of mvParts) {
    const t = nodeType(part);
    switch (t) {
      case "Lit":
        text += part.Value ?? "";
        parts.push({ type: "LiteralPart", value: part.Value ?? "" });
        break;

      case "SglQuoted":
        if (part.Dollar) {
          // $'...' ANSI-C escapes: resolving them wrong could mis-resolve a
          // checked path — unsupported instead
          allLiteral = false;
          parts.push(unsupportedPart("$'...' quoting"));
          break;
        }
        text += part.Value ?? "";
        parts.push({ type: "LiteralPart", value: part.Value ?? "" });
        break;

      case "DblQuoted": {
        // Embedded double-quoted segment inside a larger word. Quote removal
        // makes its text literal; expansions inside keep their nodes. The
        // enclosing word stays quoted=false (stricter hazard checks).
        const inner = convertParts(part.Parts ?? []);
        // Inner expansions are protected from word splitting by the quotes,
        // but representing that segment-level protection is impossible in the
        // legacy Word shape — keeping them as bare expansion parts is the
        // conservative direction (more hazards detected, never fewer).
        text += inner.text;
        parts.push(...inner.parts);
        if (inner.parts.some((p) => p.type !== "LiteralPart")) allLiteral = false;
        break;
      }

      case "ParamExp": {
        const pe = convertParamExp(part);
        parts.push(pe);
        allLiteral = false;
        break;
      }

      case "CmdSubst":
        parts.push({
          type: "CommandSubstitution",
          command: convertStmts(part.Stmts),
          backtick: !!part.Backquotes,
        } satisfies AST.CommandSubstitution);
        allLiteral = false;
        break;

      case "ProcSubst":
        parts.push({
          type: "ProcessSubstitution",
          operator: "<(",
          command: convertStmts(part.Stmts),
        } satisfies AST.ProcessSubstitution);
        allLiteral = false;
        break;

      case "ArithmExp":
        if (containsSubstitution(part.X)) {
          parts.push(unsupportedPart("substitution in $(( ))"));
        } else {
          parts.push({
            type: "ArithmeticExpansion",
            expression: { type: "NumberLiteral", value: 0 },
          } satisfies AST.ArithmeticExpansion);
        }
        allLiteral = false;
        break;

      case "ExtGlob":
        parts.push(unsupportedPart("extended glob"));
        allLiteral = false;
        break;

      default:
        parts.push(unsupportedPart(`word part ${t}`));
        allLiteral = false;
        break;
    }
  }

  return { kind: allLiteral ? "literal" : "mixed", text, parts };
}

/**
 * ParamExp → ParameterExpansion. Every form whose value the analyzer must
 * not statically resolve carries a non-undefined modifier/subscript/
 * indirection (resolveStaticParam then returns undefined). Forms that can
 * hide commands in sub-words are walked or marked unsupported.
 */
function convertParamExp(pe: any): AST.WordPart {
  const parameter = pe.Param?.Value;
  if (typeof parameter !== "string" || parameter === "") {
    return unsupportedPart("parameter expansion without name");
  }

  // ${x/pat/repl}: the pattern word could hide $(), and the legacy shape has
  // no slot to expose both pattern and replacement for analysis
  if (pe.Repl !== null && pe.Repl !== undefined) {
    return unsupportedPart("pattern replacement expansion");
  }

  const result: AST.ParameterExpansion = { type: "ParameterExpansion", parameter };

  if (pe.Excl) result.indirection = true;
  if (pe.Length) result.modifier = "length";

  if (pe.Index !== null && pe.Index !== undefined) {
    if (containsSubstitution(pe.Index)) {
      return unsupportedPart("substitution in array subscript");
    }
    result.subscript = "0"; // placeholder; non-undefined blocks static resolution
  }

  if (pe.Slice !== null && pe.Slice !== undefined) {
    if (containsSubstitution(pe.Slice.Offset) || containsSubstitution(pe.Slice.Length)) {
      return unsupportedPart("substitution in slice expansion");
    }
    result.modifier = "substring";
  }

  if (pe.Exp !== null && pe.Exp !== undefined) {
    // ${x:-word} family: keep the operand word visible to the analyzer.
    // The placeholder operator only needs to be non-undefined.
    result.modifier = ":-";
    if (pe.Exp.Word !== null && pe.Exp.Word !== undefined) {
      result.modifierArg = convertWord(pe.Exp.Word);
    }
  }

  return result;
}
