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
 *
 * Scope: command words, redirect targets, and cd targets are validated;
 * command-ARGUMENT paths intentionally are not (SSH-598) — see
 * notes/passthrough-permission-surface.md before reporting that as a bug.
 */

import { isAbsolute, normalize } from "@std/path";
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

/**
 * Static working directory tracked through the statement walk (SSH-590).
 *
 * `known` carries a path that is either absolute (after a `cd` to an absolute
 * target) or expressed *relative to the prehook's base cwd* (after a relative
 * `cd`, or "" when no `cd` has happened). The caller resolves relative targets
 * against its real cwd via `resolve(cwd, target)`, so a relative-to-base path
 * round-trips correctly while an absolute one validates as-is.
 *
 * `unknown` means a `cd` went somewhere we cannot statically resolve (unknown
 * variable, command substitution, `~user`, `cd -`, popd/pushd rotation, or a
 * relative `cd` inside a loop body that compounds across iterations). Any later
 * path-dependent target while the cwd is unknown forces ineligibility.
 */
type Cwd =
  | { known: true; path: string }
  | { known: false };

interface AnalyzerContext {
  reasons: string[];
  commands: Set<string>;
  redirects: RedirectTarget[];
  globs: string[];
  vars: Map<string, string>;
  blocked: ReadonlySet<string>;
  env: (name: string) => string | undefined;
  /** Static working directory at the current point of the walk. */
  cwd: Cwd;
  /** >0 while walking a loop body (relative cds there compound, so go unknown). */
  loopDepth: number;
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
    cwd: { known: true, path: "" },
    loopDepth: 0,
  };

  analyzeStatements(ast.body, ctx);

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
// Working-directory tracking (SSH-590)
// =============================================================================

/** Stable string view of the cwd state, for change detection. */
function cwdSnapshot(cwd: Cwd): string {
  return cwd.known ? `K:${cwd.path}` : "U";
}

/**
 * Resolve a (tilde-expanded) target path against the tracked cwd. Returns an
 * absolute path (when the cwd or the target is absolute) or a path relative to
 * the prehook base cwd (which the caller resolves against its real cwd).
 * Undefined when the target is relative and the tracked cwd is unknown.
 */
function resolveAgainstCwd(ctx: AnalyzerContext, target: string): string | undefined {
  if (isAbsolute(target)) return normalize(target);
  if (!ctx.cwd.known) return undefined;
  const base = ctx.cwd.path;
  if (base === "") return normalize(target);
  return normalize(`${base}/${target}`);
}

/**
 * Walk a same-shell child scope (loop/brace-group body, if-test) linearly,
 * then conservatively mark the cwd unknown if the body changed it — after the
 * construct we cannot statically know which path it landed on (a loop may run
 * any number of times; a conditional may or may not have run).
 */
function analyzeChildScope(ctx: AnalyzerContext, walk: () => void): void {
  const before = cwdSnapshot(ctx.cwd);
  walk();
  if (cwdSnapshot(ctx.cwd) !== before) {
    ctx.cwd = { known: false };
  }
}

/**
 * Walk a mutually-exclusive branch (if-consequent/alternate, case body): its
 * cd does not flow into sibling branches, so isolate the cwd and report
 * whether the branch changed it (the caller marks the post-construct cwd
 * unknown if any branch did).
 */
function analyzeBranch(ctx: AnalyzerContext, walk: () => void): boolean {
  const saved = ctx.cwd;
  const before = cwdSnapshot(ctx.cwd);
  walk();
  const changed = cwdSnapshot(ctx.cwd) !== before;
  ctx.cwd = saved;
  return changed;
}

/**
 * Collect every variable name that may be assigned anywhere inside the given
 * statements (over-approximate: subshell/cmdsub assignments don't really leak,
 * but treating them as assigned only loses precision, never soundness). Used to
 * invalidate loop-carried variables before walking a loop body.
 */
function collectAssignedVars(
  stmts: AST.Statement[],
  out: Set<string> = new Set(),
): Set<string> {
  for (const stmt of stmts) collectAssignedVarsStmt(stmt, out);
  return out;
}

function collectAssignedVarsStmt(stmt: AST.Statement, out: Set<string>): void {
  switch (stmt.type) {
    case "VariableAssignment":
      out.add(stmt.name);
      break;
    case "Command":
      for (const a of stmt.assignments) out.add(a.name);
      break;
    case "Pipeline":
      for (const c of stmt.commands) collectAssignedVarsStmt(c, out);
      break;
    case "IfStatement":
      collectAssignedVarsStmt(stmt.test, out);
      collectAssignedVars(stmt.consequent, out);
      if (Array.isArray(stmt.alternate)) collectAssignedVars(stmt.alternate, out);
      else if (stmt.alternate) collectAssignedVarsStmt(stmt.alternate, out);
      break;
    case "ForStatement":
      out.add(stmt.variable);
      collectAssignedVars(stmt.body, out);
      break;
    case "CStyleForStatement":
      collectAssignedVars(stmt.body, out);
      break;
    case "WhileStatement":
    case "UntilStatement":
      collectAssignedVarsStmt(stmt.test, out);
      collectAssignedVars(stmt.body, out);
      break;
    case "CaseStatement":
      for (const clause of stmt.cases) collectAssignedVars(clause.body, out);
      break;
    case "Subshell":
    case "BraceGroup":
      collectAssignedVars(stmt.body, out);
      break;
    default:
      break;
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
      if (stmt.operator === "|") {
        // Each pipe segment runs in its own subshell: a `cd` inside one does
        // not flow to siblings or to the parent shell. Isolate the cwd per
        // segment and leave the parent cwd unchanged after the pipe.
        const saved = ctx.cwd;
        for (const cmd of stmt.commands) {
          ctx.cwd = saved;
          analyzeStatement(cmd, ctx);
        }
        ctx.cwd = saved;
      } else if (stmt.operator === "||") {
        // `a || b`: b runs only if a failed, so a's (failed) cd leaves the cwd
        // unchanged — each operand runs from the pre-chain cwd. After the chain
        // the surviving cwd is whichever operand succeeded, so it's unknown.
        let changed = false;
        for (const cmd of stmt.commands) {
          changed = analyzeBranch(ctx, () => analyzeStatement(cmd, ctx)) || changed;
        }
        if (changed) ctx.cwd = { known: false };
      } else {
        // &&, ;, single command: when operand[i] runs, every prior operand
        // succeeded, so a `cd` leaks linearly into the operands that follow it.
        // (The post-chain cwd is made unknown for *following statements* by
        // analyzeStatements, since an && chain may stop early.)
        for (const cmd of stmt.commands) {
          analyzeStatement(cmd, ctx);
        }
      }
      break;

    case "VariableAssignment":
      analyzeAssignment(stmt, ctx);
      break;

    case "IfStatement": {
      // The construct's own redirect is set up in the enclosing cwd.
      analyzeRedirects(stmt.redirects, ctx);
      const preTest = ctx.cwd;
      // The test always runs; the consequent runs only if it fully succeeded,
      // so the consequent sees the test's resulting (linear) cwd.
      analyzeStatement(stmt.test, ctx);
      const testChangedCwd = cwdSnapshot(ctx.cwd) !== cwdSnapshot(preTest);
      // Consequent and alternate are mutually exclusive: isolate each.
      let changed = analyzeBranch(ctx, () => analyzeStatements(stmt.consequent, ctx));
      // The alternate runs only if the test failed — a failed test cd leaves the
      // cwd uncertain, so the alternate starts from unknown when the test moved.
      if (testChangedCwd) ctx.cwd = { known: false };
      else ctx.cwd = preTest;
      if (Array.isArray(stmt.alternate)) {
        const alt = stmt.alternate;
        changed = analyzeBranch(ctx, () => analyzeStatements(alt, ctx)) || changed;
      } else if (stmt.alternate) {
        const alt = stmt.alternate;
        changed = analyzeBranch(ctx, () => analyzeStatement(alt, ctx)) || changed;
      }
      // After the whole if, the cwd is unknown if any branch moved it or the
      // test moved it (the test may or may not have completed).
      ctx.cwd = (changed || testChangedCwd) ? { known: false } : preTest;
      break;
    }

    case "WhileStatement":
    case "UntilStatement":
      analyzeRedirects(stmt.redirects, ctx);
      {
        // Loop-carried variables and the test re-run every iteration: invalidate
        // anything the body/test may assign before walking either.
        const assigned = collectAssignedVars(stmt.body);
        collectAssignedVarsStmt(stmt.test, assigned);
        ctx.loopDepth++;
        analyzeChildScope(ctx, () => {
          for (const v of assigned) ctx.vars.delete(v);
          analyzeStatement(stmt.test, ctx);
          analyzeStatements(stmt.body, ctx);
        });
        ctx.loopDepth--;
        for (const v of assigned) ctx.vars.delete(v);
      }
      break;

    case "ForStatement":
      for (const item of stmt.iterable) {
        analyzeWordLike(item, ctx, "for iterable", "split");
      }
      analyzeRedirects(stmt.redirects, ctx);
      {
        // The loop variable takes a different (statically-unknown) value each
        // iteration; body-assigned variables carry across iterations too.
        const assigned = collectAssignedVars(stmt.body);
        assigned.add(stmt.variable);
        ctx.loopDepth++;
        analyzeChildScope(ctx, () => {
          for (const v of assigned) ctx.vars.delete(v);
          analyzeStatements(stmt.body, ctx);
        });
        ctx.loopDepth--;
        for (const v of assigned) ctx.vars.delete(v);
      }
      break;

    case "CStyleForStatement":
      // Arithmetic expressions cannot contain command substitutions
      // (the parser rejects them), so init/test/update are safe.
      analyzeRedirects(stmt.redirects, ctx);
      {
        const assigned = collectAssignedVars(stmt.body);
        ctx.loopDepth++;
        analyzeChildScope(ctx, () => {
          for (const v of assigned) ctx.vars.delete(v);
          analyzeStatements(stmt.body, ctx);
        });
        ctx.loopDepth--;
        for (const v of assigned) ctx.vars.delete(v);
      }
      break;

    case "CaseStatement":
      analyzeWordLike(stmt.word, ctx, "case word");
      analyzeRedirects(stmt.redirects, ctx);
      {
        // bash command-substitutes case patterns before matching, so a
        // `$(cmd)` pattern executes cmd — walk patterns like any other word.
        // Clause bodies are mutually exclusive branches (isolate cwd).
        let changed = false;
        for (const clause of stmt.cases) {
          for (const pattern of clause.patterns) {
            analyzeWordLike(pattern, ctx, "case pattern");
          }
          changed = analyzeBranch(ctx, () => analyzeStatements(clause.body, ctx)) || changed;
        }
        if (changed) ctx.cwd = { known: false };
      }
      break;

    case "Subshell":
      // A subshell runs in a child process: its cd does not affect the parent.
      analyzeRedirects(stmt.redirections, ctx);
      {
        const saved = ctx.cwd;
        analyzeStatements(stmt.body, ctx);
        ctx.cwd = saved;
      }
      break;

    case "BraceGroup":
      // A brace group runs in the current shell, so its cd leaks linearly.
      analyzeRedirects(stmt.redirections, ctx);
      analyzeChildScope(ctx, () => analyzeStatements(stmt.body, ctx));
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
    const before = cwdSnapshot(ctx.cwd);
    analyzeStatement(stmt, ctx);
    // An `&&` chain may stop early, so the cwd it leaves is uncertain for the
    // next statement (which runs unconditionally). Targets *inside* the chain
    // already resolved against the linear cwd while it was still known.
    if (
      stmt.type === "Pipeline" && stmt.operator === "&&" &&
      cwdSnapshot(ctx.cwd) !== before
    ) {
      ctx.cwd = { known: false };
    }
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

  // A directory change takes effect only after the command's own redirects are
  // set up (which happens in the enclosing cwd), so compute it here and apply
  // it after analyzeRedirects.
  let pendingCwd: Cwd | undefined;

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
        pendingCwd = analyzeDirectoryChange(stmt, ctx, base);
      } else if (base === "popd") {
        // popd returns to a stack entry we cannot statically know.
        pendingCwd = { known: false };
      }
    }

    for (const arg of stmt.args) {
      analyzeWordLike(arg, ctx, "argument", "split");
    }
  }

  analyzeRedirects(stmt.redirects, ctx);

  if (pendingCwd) ctx.cwd = pendingCwd;
}

/**
 * cd/pushd targets must be static and get path-checked like reads (SSH-590).
 * Returns the working directory the command leaves behind (applied by the
 * caller after redirects). Rejects the script when the target is present but
 * unresolvable.
 */
function analyzeDirectoryChange(
  stmt: AST.Command,
  ctx: AnalyzerContext,
  base: string,
): Cwd {
  // A bare "-" operand is `cd -` (OLDPWD), not a flag; real flags (-L/-P/...)
  // start with "-" and are longer than one character.
  const operands = stmt.args.filter((arg) =>
    !(
      arg.type === "Word" && arg.value.startsWith("-") && arg.value !== "-" &&
      arg.parts.length <= 1
    )
  );

  if (operands.length === 0) {
    if (base === "pushd") {
      return { known: false }; // swaps the top two stack entries
    }
    // `cd` alone goes to HOME.
    const home = ctx.env("HOME");
    if (home && isAbsolute(home)) return { known: true, path: normalize(home) };
    return { known: false };
  }

  const first = operands[0]!;
  const rawValue = first.type === "Word" ? first.value : undefined;

  if (rawValue === "-") {
    return { known: false }; // OLDPWD — not statically known
  }
  if (base === "pushd" && rawValue !== undefined && /^[+-]\d+$/.test(rawValue)) {
    return { known: false }; // stack rotation
  }

  const target = resolveStaticText(first, ctx);
  if (target === undefined) {
    reject(ctx, "cd target is not statically resolvable");
    return ctx.cwd; // already ineligible; keep current state
  }

  const resolved = resolveAgainstCwd(ctx, target);
  if (resolved === undefined) {
    reject(ctx, "cd target depends on an unknown working directory");
    return { known: false };
  }

  ctx.redirects.push({ path: resolved, operation: "read" });

  // A relative cd inside a loop body compounds across iterations, so we cannot
  // pin the cwd; an absolute cd is idempotent and stays known.
  if (!isAbsolute(resolved) && ctx.loopDepth > 0) {
    return { known: false };
  }
  return { known: true, path: resolved };
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
      if (i === 0) {
        const expanded = expandTilde(part.value, word.quoted, ctx);
        if (expanded === undefined) return undefined;
        text += expanded;
      } else {
        text += part.value;
      }
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

/**
 * Classify a redirect operator into the file operations it performs (SSH-590).
 * Returns "heredoc" for here-doc/here-string forms (no static path target),
 * "fd" when the operator/target is a file-descriptor dup/move/close (no path),
 * or the list of operations to record against the target path.
 */
function classifyRedirect(
  op: AST.RedirectionOperator,
  target: AST.Word,
): "heredoc" | "fd" | ("read" | "write")[] {
  switch (op) {
    case "<<":
    case "<<-":
    case "<<<":
      // Heredoc/here-string bodies lose quoting context in the parser, so an
      // embedded $(...) would be invisible to us — caller always falls back.
      return "heredoc";
    case "<":
      return ["read"];
    case "<>":
      return ["read", "write"]; // opens the file for both reading and writing
    case ">":
    case ">>":
    case ">|":
    case "&>":
    case "&>>":
      return ["write"];
    case "<&":
    case ">&": {
      // `<&3` / `>&2-` / `>&-` are fd dup/move/close (no path); `>& file`
      // and `<& file` redirect to/from a file.
      const v = target.value;
      if (v === "-" || /^\d+-?$/.test(v)) return "fd";
      return op === "<&" ? ["read"] : ["write"];
    }
    default:
      return "fd";
  }
}

function analyzeRedirects(
  redirects: AST.Redirection[] | undefined,
  ctx: AnalyzerContext,
): void {
  if (!redirects) return;

  for (const redirect of redirects) {
    const op = redirect.operator;

    // Heredoc bodies are opaque regardless of target representation.
    if (op === "<<" || op === "<<-" || op === "<<<") {
      reject(ctx, "heredoc/here-string");
      continue;
    }

    // fd duplication with a numeric target (e.g. 2>&1) has nothing to check.
    if (typeof redirect.target === "number") continue;

    const operations = classifyRedirect(op, redirect.target);
    if (operations === "heredoc") {
      reject(ctx, "heredoc/here-string");
      continue;
    }
    if (operations === "fd") continue;

    const target = resolveStaticText(redirect.target, ctx);
    if (target === undefined) {
      reject(ctx, "redirect target is not statically resolvable");
      continue;
    }

    const resolved = resolveAgainstCwd(ctx, target);
    if (resolved === undefined) {
      reject(ctx, "redirect target depends on an unknown working directory");
      continue;
    }
    if (DEVICE_PATHS.has(resolved)) continue;

    for (const operation of operations) {
      ctx.redirects.push({ path: resolved, operation });
    }
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
      if (i === 0) {
        const expanded = expandTilde(part.value, node.quoted, ctx);
        if (expanded === undefined) return undefined;
        text += expanded;
      } else {
        text += part.value;
      }
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

/**
 * Expand a leading tilde. `~` and `~/...` use $HOME; `~user...` resolves to
 * another user's home that we cannot know statically, so it returns undefined
 * (SSH-590) and the surrounding word becomes unresolvable — forcing fallback
 * for any cd/redirect target that depends on it.
 */
function expandTilde(
  value: string,
  quoted: boolean,
  ctx: AnalyzerContext,
): string | undefined {
  if (!quoted && value.startsWith("~")) {
    if (value === "~" || value.startsWith("~/")) {
      const home = ctx.env("HOME");
      if (home) return home + value.slice(1);
      return value;
    }
    // ~user or ~user/path — another user's home, not statically resolvable.
    return undefined;
  }
  return value;
}
