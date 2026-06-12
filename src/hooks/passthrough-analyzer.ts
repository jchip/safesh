/**
 * Passthrough Analyzer (SSH-576)
 *
 * Decides whether a parsed bash script is safe to hand to REAL bash
 * (Claude Code's Bash tool) instead of transpiling: every command it could
 * execute must be statically enumerable, and constructs that can hide
 * commands or bypass sandboxed builtins must force fallback to transpile.
 *
 * Design rule: DEFAULT DENY. Every AST node type is handled explicitly;
 * anything unknown or unresolvable marks the script ineligible (the caller
 * then falls back to the existing transpile path, so a false negative only
 * costs performance, never safety).
 */

import type * as AST from "../bash/ast.ts";

/** A statically-known file path the script would read or write. */
export interface RedirectTarget {
  path: string;
  operation: "read" | "write";
}

export interface PassthroughAnalysis {
  /** True if every command is statically enumerable and none is blocked */
  eligible: boolean;
  /** Why the script is ineligible (empty when eligible) */
  reasons: string[];
  /** Every command name the script can execute, builtins included */
  commands: Set<string>;
  /** Static redirect/cd targets the caller must path-check before passthrough */
  redirects: RedirectTarget[];
  /**
   * Glob patterns the caller must verify match at least one file (SSH-579).
   * When a glob matches, bash and zsh expand it identically; when it does
   * not, bash passes the literal while zsh aborts the command — so
   * non-matching globs must fall back to transpile.
   */
  globs: string[];
}

export interface AnalyzeOptions {
  /** Additional command names that force ineligibility (e.g. DANGEROUS_COMMANDS) */
  blockedCommands?: ReadonlySet<string>;
  /** Environment lookup used for static expansion (default: Deno.env.get) */
  env?: (name: string) => string | undefined;
}

/**
 * Commands that execute other commands from their arguments. Static analysis
 * cannot enumerate their payloads, so they always force transpile fallback.
 */
const CARRIER_COMMANDS = new Set([
  "eval",
  "source",
  ".",
  "exec",
  "command",
  "builtin",
  "env",
  "xargs",
  "find", // -exec/-execdir/-ok payloads
  "parallel",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "nohup",
  "time",
  "timeout",
  "nice",
  "ionice",
  "setsid",
  "stdbuf",
  "watch",
  "script",
  "sudo",
  "su",
  "doas",
  "ssh",
]);

/**
 * Commands that transpile to SafeShell's sandboxed implementations with
 * runtime path checks. Passing them to real bash would skip those checks,
 * so they force fallback.
 */
const SANDBOXED_FILE_COMMANDS = new Set([
  "rm",
  "rmdir",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "ln",
  "chmod",
]);

/** Paths bash commonly redirects to that need no permission check. */
const DEVICE_PATHS = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/stdin",
  "/dev/tty",
]);

interface AnalyzerContext {
  reasons: string[];
  commands: Set<string>;
  redirects: RedirectTarget[];
  globs: string[];
  vars: Map<string, string>;
  blocked: ReadonlySet<string>;
  env: (name: string) => string | undefined;
}

/**
 * Expansion context for a word (SSH-579). In "split" contexts (command
 * arguments, for-loop iterables, array elements) bash word-splits and globs
 * unquoted expansions while zsh does neither, so zsh-divergent constructs
 * force fallback. "nosplit" contexts (assignment values, [[ ]] operands,
 * case words) behave identically in both shells.
 */
type WordContext = "split" | "nosplit";

/**
 * Analyze a parsed bash program for passthrough eligibility.
 *
 * The returned command set is intentionally sound (a superset of what the
 * script can run) only when `eligible` is true; when ineligible the set is
 * partial and must not be used for permission decisions.
 */
export function analyzeForPassthrough(
  ast: AST.Program,
  options: AnalyzeOptions = {},
): PassthroughAnalysis {
  const ctx: AnalyzerContext = {
    reasons: [],
    commands: new Set(),
    redirects: [],
    globs: [],
    vars: new Map(),
    blocked: options.blockedCommands ?? new Set(),
    env: options.env ?? ((name) => Deno.env.get(name)),
  };

  for (const stmt of ast.body) {
    analyzeStatement(stmt, ctx);
  }

  return {
    eligible: ctx.reasons.length === 0,
    reasons: ctx.reasons,
    commands: ctx.commands,
    redirects: ctx.redirects,
    globs: ctx.globs,
  };
}

function reject(ctx: AnalyzerContext, reason: string): void {
  if (!ctx.reasons.includes(reason)) {
    ctx.reasons.push(reason);
  }
}

// =============================================================================
// Statements
// =============================================================================

function analyzeStatement(stmt: AST.Statement, ctx: AnalyzerContext): void {
  switch (stmt.type) {
    case "Command":
      analyzeCommand(stmt, ctx);
      break;

    case "Pipeline":
      if (stmt.background) {
        reject(ctx, "background job");
      }
      for (const cmd of stmt.commands) {
        analyzeStatement(cmd, ctx);
      }
      break;

    case "VariableAssignment":
      analyzeAssignment(stmt, ctx);
      break;

    case "IfStatement":
      analyzeStatement(stmt.test, ctx);
      analyzeStatements(stmt.consequent, ctx);
      if (Array.isArray(stmt.alternate)) {
        analyzeStatements(stmt.alternate, ctx);
      } else if (stmt.alternate) {
        analyzeStatement(stmt.alternate, ctx);
      }
      analyzeRedirects(stmt.redirects, ctx);
      break;

    case "WhileStatement":
    case "UntilStatement":
      analyzeStatement(stmt.test, ctx);
      analyzeStatements(stmt.body, ctx);
      analyzeRedirects(stmt.redirects, ctx);
      break;

    case "ForStatement":
      for (const item of stmt.iterable) {
        analyzeWordLike(item, ctx, "for iterable", "split");
      }
      analyzeStatements(stmt.body, ctx);
      analyzeRedirects(stmt.redirects, ctx);
      break;

    case "CStyleForStatement":
      // Arithmetic expressions cannot contain command substitutions
      // (the parser rejects them), so init/test/update are safe.
      analyzeStatements(stmt.body, ctx);
      analyzeRedirects(stmt.redirects, ctx);
      break;

    case "CaseStatement":
      analyzeWordLike(stmt.word, ctx, "case word");
      for (const clause of stmt.cases) {
        analyzeStatements(clause.body, ctx);
      }
      analyzeRedirects(stmt.redirects, ctx);
      break;

    case "Subshell":
    case "BraceGroup":
      analyzeStatements(stmt.body, ctx);
      analyzeRedirects(stmt.redirections, ctx);
      break;

    case "TestCommand":
      analyzeTestCondition(stmt.expression, ctx);
      break;

    case "ArithmeticCommand":
    case "ReturnStatement":
    case "BreakStatement":
    case "ContinueStatement":
      // No commands can hide in these (arithmetic rejects $(...) at parse time)
      break;

    case "FunctionDeclaration":
      // Function call sites can't be matched against the allowlist statically
      reject(ctx, "function declaration");
      break;

    default:
      reject(ctx, `unsupported construct: ${(stmt as AST.BaseNode).type}`);
  }
}

function analyzeStatements(stmts: AST.Statement[], ctx: AnalyzerContext): void {
  for (const stmt of stmts) {
    analyzeStatement(stmt, ctx);
  }
}

// =============================================================================
// Commands
// =============================================================================

function isAssignmentOnly(stmt: AST.Command): boolean {
  return stmt.name.type === "Word" && stmt.name.value === "" &&
    stmt.assignments.length > 0;
}

function analyzeCommand(stmt: AST.Command, ctx: AnalyzerContext): void {
  for (const assignment of stmt.assignments) {
    analyzeAssignment(assignment, ctx);
  }

  if (!isAssignmentOnly(stmt)) {
    const name = resolveStaticText(stmt.name, ctx);
    if (name === undefined || name === "") {
      reject(ctx, "command name is not statically resolvable");
    } else if (/\s/.test(name)) {
      // bash would word-split a resolved name like "tool --flag"; zsh would
      // run it as one word — divergent, and unsafe to enumerate either way
      reject(ctx, "command name resolves to multiple words");
    } else if (name.startsWith("=")) {
      reject(ctx, "zsh =-expansion hazard in command name");
    } else {
      ctx.commands.add(name);
      const base = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
      if (CARRIER_COMMANDS.has(base)) {
        reject(ctx, `command carrier requires transpile: ${base}`);
      }
      if (SANDBOXED_FILE_COMMANDS.has(base)) {
        reject(ctx, `sandboxed file command requires transpile: ${base}`);
      }
      if (ctx.blocked.has(base)) {
        reject(ctx, `blocked command: ${base}`);
      }
      if (base === "cd" || base === "pushd") {
        analyzeDirectoryChange(stmt, ctx);
      }
    }

    for (const arg of stmt.args) {
      analyzeWordLike(arg, ctx, "argument", "split");
    }
  }

  analyzeRedirects(stmt.redirects, ctx);
}

/** cd/pushd targets must be static and get path-checked like reads. */
function analyzeDirectoryChange(stmt: AST.Command, ctx: AnalyzerContext): void {
  const operands = stmt.args.filter((arg) =>
    !(arg.type === "Word" && arg.value.startsWith("-") && arg.parts.length <= 1)
  );
  if (operands.length === 0) {
    return; // `cd` alone goes to HOME, covered by default read paths
  }
  const target = resolveStaticText(operands[0]!, ctx);
  if (target === undefined || target === "-") {
    if (target === undefined) {
      reject(ctx, "cd target is not statically resolvable");
    }
    return; // `cd -` returns to a previously-visited (already checked) dir
  }
  ctx.redirects.push({ path: target, operation: "read" });
}

function analyzeAssignment(
  assignment: AST.VariableAssignment,
  ctx: AnalyzerContext,
): void {
  const value = assignment.value;

  if (value.type === "ArrayLiteral") {
    // Array elements glob in both shells but only bash word-splits
    // expansions — treat as a split context.
    for (const elem of value.elements) {
      analyzeWordLike(elem, ctx, "array element", "split");
    }
    ctx.vars.delete(assignment.name);
    return;
  }

  if (value.type === "ArithmeticExpansion") {
    ctx.vars.delete(assignment.name);
    return;
  }

  analyzeWordLike(value, ctx, "assignment value");

  const resolved = resolveStaticText(value, ctx);
  if (resolved === undefined) {
    ctx.vars.delete(assignment.name);
  } else {
    ctx.vars.set(assignment.name, resolved);
  }
}

// =============================================================================
// Words and expansions
// =============================================================================

/**
 * Walk a word-like node for hidden commands. Command substitutions recurse
 * (their statements are analyzed like any other); process substitutions and
 * unsupported part types force fallback. In "split" contexts, constructs
 * whose expansion diverges between bash and zsh also force fallback
 * (SSH-579: the Bash tool may execute passthrough commands under zsh).
 */
function analyzeWordLike(
  node: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  ctx: AnalyzerContext,
  where: string,
  wordContext: WordContext = "nosplit",
): void {
  if (node.type === "CommandSubstitution") {
    analyzeStatements(node.command, ctx);
    return;
  }
  if (node.type === "ParameterExpansion") {
    analyzeParameterExpansion(node, ctx, where);
    if (wordContext === "split") {
      checkUnquotedExpansionHazard(node, ctx, where);
    }
    return;
  }

  for (const part of node.parts) {
    analyzeWordPart(part, ctx, where);
  }

  if (wordContext === "split" && !node.singleQuoted && !node.quoted) {
    analyzeUnquotedWordHazards(node, ctx, where);
  }
}

/**
 * zsh-divergence checks for an unquoted word in a split context (SSH-579).
 */
function analyzeUnquotedWordHazards(
  word: AST.Word,
  ctx: AnalyzerContext,
  where: string,
): void {
  // zsh =-expansion: a word starting with '=' resolves to a command path
  // and errors when none exists; bash passes it literally.
  if (word.value.startsWith("=")) {
    reject(ctx, `zsh =-expansion hazard in ${where}`);
    return;
  }

  for (const part of word.parts) {
    if (part.type === "ParameterExpansion") {
      checkUnquotedExpansionHazard(part, ctx, where);
    }
  }

  // The lexer flattens glob characters into literal parts (no GlobPattern
  // nodes), so detect globs in the resolved text. Globs expand identically
  // in both shells only when they match; on a non-match bash passes the
  // literal while zsh aborts — collect the pattern so the caller can verify
  // it matches at least one file.
  const text = resolveGlobText(word, ctx);
  if (text !== undefined && /[*?[]/.test(text)) {
    ctx.globs.push(text);
  }
}

/**
 * bash word-splits and globs unquoted parameter expansions; zsh does
 * neither. The expansion is safe only when its value is statically known
 * and contains no whitespace or glob metacharacters.
 */
function checkUnquotedExpansionHazard(
  expansion: AST.ParameterExpansion,
  ctx: AnalyzerContext,
  where: string,
): void {
  const value = resolveStaticParam(expansion, ctx);
  if (value === undefined) {
    reject(ctx, `unquoted expansion is not statically resolvable in ${where}`);
    return;
  }
  if (/[\s*?[\]]/.test(value)) {
    reject(ctx, `unquoted expansion would word-split or glob in ${where}`);
  }
}

/**
 * Resolve a word containing glob parts to its pattern text, expanding
 * literals and statically-known parameters. Undefined when any segment
 * cannot be known at analysis time.
 */
function resolveGlobText(word: AST.Word, ctx: AnalyzerContext): string | undefined {
  let text = "";
  for (let i = 0; i < word.parts.length; i++) {
    const part = word.parts[i]!;
    if (part.type === "LiteralPart") {
      text += i === 0 ? expandTilde(part.value, word.quoted, ctx) : part.value;
    } else if (part.type === "GlobPattern") {
      text += part.pattern;
    } else if (part.type === "ParameterExpansion") {
      const value = resolveStaticParam(part, ctx);
      if (value === undefined) return undefined;
      text += value;
    } else {
      return undefined;
    }
  }
  return text;
}

function analyzeWordPart(
  part: AST.WordPart,
  ctx: AnalyzerContext,
  where: string,
): void {
  switch (part.type) {
    case "LiteralPart":
    case "GlobPattern":
      break;
    case "ParameterExpansion":
      analyzeParameterExpansion(part, ctx, where);
      break;
    case "CommandSubstitution":
      analyzeStatements(part.command, ctx);
      break;
    case "ArithmeticExpansion":
      // Safe: the arithmetic parser rejects embedded $(...)
      break;
    case "ProcessSubstitution":
      reject(ctx, `process substitution in ${where}`);
      break;
    default:
      reject(ctx, `unsupported word part in ${where}: ${(part as AST.BaseNode).type}`);
  }
}

function analyzeParameterExpansion(
  expansion: AST.ParameterExpansion,
  ctx: AnalyzerContext,
  where: string,
): void {
  // Modifier arguments may contain nested words with command substitutions
  if (expansion.modifierArg) {
    analyzeWordLike(expansion.modifierArg, ctx, where);
  }
}

function analyzeTestCondition(cond: AST.TestCondition, ctx: AnalyzerContext): void {
  switch (cond.type) {
    case "UnaryTest":
      analyzeWordLike(cond.argument, ctx, "test expression");
      break;
    case "BinaryTest":
      analyzeWordLike(cond.left, ctx, "test expression");
      analyzeWordLike(cond.right, ctx, "test expression");
      break;
    case "LogicalTest":
      if (cond.left) analyzeTestCondition(cond.left, ctx);
      analyzeTestCondition(cond.right, ctx);
      break;
    case "StringTest":
      analyzeWordLike(cond.value, ctx, "test expression");
      break;
  }
}

// =============================================================================
// Redirections
// =============================================================================

function analyzeRedirects(
  redirects: AST.Redirection[] | undefined,
  ctx: AnalyzerContext,
): void {
  if (!redirects) return;

  for (const redirect of redirects) {
    const op = redirect.operator;

    // Heredoc bodies lose quoting context in the parser, so embedded
    // $(...) would be invisible to us — always fall back.
    if (op === "<<" || op === "<<-" || op === "<<<") {
      reject(ctx, "heredoc/here-string");
      continue;
    }

    // fd duplication (2>&1) has a numeric target — nothing to check
    if (typeof redirect.target === "number") continue;
    if ((op === ">&" || op === "<&") && /^\d+$/.test(redirect.target.value)) {
      continue;
    }

    const target = resolveStaticText(redirect.target, ctx);
    if (target === undefined) {
      reject(ctx, "redirect target is not statically resolvable");
      continue;
    }
    if (DEVICE_PATHS.has(target)) continue;

    const operation = op === "<" ? "read" : "write";
    ctx.redirects.push({ path: target, operation });
  }
}

// =============================================================================
// Static text resolution
// =============================================================================

/**
 * Resolve a word to the literal text real bash would expand it to, using
 * only in-script assignments and the (shared) process environment.
 * Returns undefined when the value cannot be known statically.
 */
function resolveStaticText(
  node: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  ctx: AnalyzerContext,
): string | undefined {
  if (node.type === "CommandSubstitution") return undefined;
  if (node.type === "ParameterExpansion") return resolveStaticParam(node, ctx);

  if (node.singleQuoted) return node.value;

  if (node.parts.length === 0) {
    return expandTilde(node.value, node.quoted, ctx);
  }

  let text = "";
  for (let i = 0; i < node.parts.length; i++) {
    const part = node.parts[i]!;
    if (part.type === "LiteralPart") {
      text += i === 0 ? expandTilde(part.value, node.quoted, ctx) : part.value;
    } else if (part.type === "ParameterExpansion") {
      const value = resolveStaticParam(part, ctx);
      if (value === undefined) return undefined;
      text += value;
    } else {
      return undefined;
    }
  }
  return text;
}

function resolveStaticParam(
  expansion: AST.ParameterExpansion,
  ctx: AnalyzerContext,
): string | undefined {
  if (expansion.modifier || expansion.subscript !== undefined || expansion.indirection) {
    return undefined;
  }
  const name = expansion.parameter;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined;
  return ctx.vars.get(name) ?? ctx.env(name);
}

function expandTilde(value: string, quoted: boolean, ctx: AnalyzerContext): string {
  if (!quoted && (value === "~" || value.startsWith("~/"))) {
    const home = ctx.env("HOME");
    if (home) return home + value.slice(1);
  }
  return value;
}
