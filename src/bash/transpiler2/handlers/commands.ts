/**
 * Command and Pipeline Handlers
 *
 * Transpiles Command and Pipeline AST nodes to TypeScript.
 * Uses fluent style for common text processing commands,
 * explicit $.cmd() function call style for everything else.
 */

import type * as AST from "../../ast.ts";
import type { ExpressionResult, StatementResult, VisitorContext } from "../types.ts";
import { isFluentCommand } from "../types.ts";
import {
  collectFlagOptions,
  collectFlagOptionsAndFiles,
  escapeForQuotes,
  escapeRegex,
  parseCountArg,
  sanitizeVarName,
  templateEscapedToLiteral,
  templateEscapedToRegexSource,
} from "../utils/mod.ts";
import { type BuiltinConfig, SHELL_BUILTINS } from "../builtins.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format argument for TypeScript output.
 *
 * @param arg - The string to format
 * @param hasExpansion - Explicit flag: true for template literal, false for double-quoted.
 *   When omitted, detects unescaped `${` via regex. Explicit flag avoids false positives
 *   from escaped `\${` that still contains the `${` substring (SSH-532).
 * @param templateEscapedLiteral - Whether arg came from escapeForTemplate() and needs to
 *   be restored before escaping for a double-quoted string.
 */
function formatArg(arg: string, hasExpansion?: boolean, templateEscapedLiteral = false): string {
  // SSH-532: Use explicit AST metadata when available; otherwise detect unescaped ${
  const isTemplate = hasExpansion ?? /(?<!\\)\$\{/.test(arg);
  if (isTemplate) {
    return `\`${arg}\``;
  }
  const literal = templateEscapedLiteral ? templateEscapedToLiteral(arg) : arg;
  return `"${escapeForQuotes(literal)}"`;
}

/**
 * SSH-532: Check if an AST word node contains real expansions (not just literal parts).
 */
function wordHasExpansion(
  word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
): boolean {
  if (word.type === "ParameterExpansion" || word.type === "CommandSubstitution") {
    return true;
  }
  if (word.type === "Word" && word.parts.length > 0) {
    if (
      word.parts.some(
        (part) => part.type !== "LiteralPart" && part.type !== "GlobPattern",
      )
    ) return true;
    // SSH-561: Tilde expansion in LiteralPart generates ${Deno.env.get("HOME")}
    // which needs template literal wrapping (backticks, not double quotes)
    const first = word.parts[0];
    if (
      first &&
      first.type === "LiteralPart" &&
      !word.quoted &&
      !word.singleQuoted &&
      (first.value === "~" || first.value.startsWith("~/"))
    ) {
      return true;
    }
  }
  return false;
}

function wordIsTemplateEscapedLiteral(
  word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
): boolean {
  return word.type === "Word" && !word.singleQuoted &&
    (word.parts.length === 0 || word.parts.every((part) => part.type === "LiteralPart"));
}

function formatRedirectionTarget(redirect: AST.Redirection, ctx: VisitorContext): string {
  if (typeof redirect.target === "number") {
    return redirect.target.toString();
  }

  if (redirect.operator === "<<" || redirect.operator === "<<-") {
    return `"${escapeForQuotes(redirect.target.value)}"`;
  }

  return formatArg(
    ctx.visitWord(redirect.target),
    wordHasExpansion(redirect.target),
    wordIsTemplateEscapedLiteral(redirect.target),
  );
}

/**
 * specialized command wrappers that provide enhanced functionality
 * These commands use dedicated wrapper functions instead of generic $.cmd()
 */
const SPECIALIZED_COMMANDS = new Set([
  "git",
  "docker",
  "tmux",
]);

// =============================================================================
// Command Builder Strategies
// =============================================================================

function handleUserFunction(name: string): string {
  return `${name}()`;
}

function handleShellBuiltin(
  name: string,
  args: string[],
  builtin: { fn: string; type: string },
  argExpansions?: boolean[],
  hasRedirects = false,
  captureOutput = false,
): ExpressionResult & {
  isShellBuiltin?: boolean;
  isSilentShellBuiltin?: boolean;
  formatsOutput?: boolean;
} {
  if (name === "exit") {
    const code = args.length > 0
      ? `Number(${formatArg(args[0] ?? "0", argExpansions?.[0])}) || 0`
      : "0";
    return {
      code: `Deno.exit(${code})`,
      async: false,
      isShellBuiltin: true,
      isSilentShellBuiltin: true,
    };
  }

  const argsArray = args.length > 0
    ? args.map((a, i) => formatArg(a, argExpansions?.[i])).join(", ")
    : "";

  if (builtin.type === "output") {
    const outputExpr = `${builtin.fn}(${argsArray})`;
    if (captureOutput) {
      return {
        code: outputExpr,
        async: false,
        isShellBuiltin: true,
      };
    }

    if (hasRedirects) {
      return {
        code: outputExpr,
        async: false,
        isShellBuiltin: true,
        formatsOutput: true,
      };
    }

    // Output builtins should print their result
    return {
      code: `console.log(` +
        `((__out: unknown) => Array.isArray(__out) ? __out.join("\\n") : String(__out))` +
        `(await Promise.resolve(${outputExpr}))` +
        `)`,
      async: false,
      isShellBuiltin: true,
    };
  } else if (builtin.type === "prints") {
    if ((hasRedirects || captureOutput) && name === "echo") {
      return {
        code: argsArray
          ? `${builtin.fn}({ silent: true }, ${argsArray})`
          : `${builtin.fn}({ silent: true })`,
        async: false,
        isShellBuiltin: true,
      };
    }

    // Prints builtins already output, just execute
    return {
      code: `${builtin.fn}(${argsArray})`,
      async: false,
      isShellBuiltin: true,
    };
  } else if (builtin.type === "async") {
    // Async builtins that need await
    return {
      code: `${builtin.fn}(${argsArray})`,
      async: true,
      isShellBuiltin: true,
    };
  } else {
    // Silent builtins (cd, pushd, popd) suppress stdout but may return stderr.
    return {
      code: `${builtin.fn}(${argsArray})`,
      async: false,
      isShellBuiltin: true,
      isSilentShellBuiltin: true,
    };
  }
}

function handleTmuxSendKeys(
  args: string[],
  argExpansions?: boolean[],
  argTemplateEscapedLiterals?: boolean[],
): string | null {
  // Check for pattern: tmux send-keys -t <target> [-c <client>] <text> C-m
  if (args.length > 0 && args[0] === "send-keys" && args[args.length - 1] === "C-m") {
    let target: string | null = null;
    let client: string | null = null;
    const textArgs: string[] = [];

    // Parse arguments (skip first "send-keys" and last "C-m")
    for (let i = 1; i < args.length - 1; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      if (arg === "-t" && nextArg) {
        target = formatArg(nextArg, argExpansions?.[i + 1], argTemplateEscapedLiterals?.[i + 1]);
        i++; // skip next arg
      } else if (arg === "-c" && nextArg) {
        client = formatArg(nextArg, argExpansions?.[i + 1], argTemplateEscapedLiterals?.[i + 1]);
        i++; // skip next arg
      } else if (arg) {
        textArgs.push(formatArg(arg, argExpansions?.[i], argTemplateEscapedLiterals?.[i]));
      }
    }

    if (target && textArgs.length > 0) {
      const text = textArgs.join(' + " " + ');
      if (client) {
        return `$.tmuxSubmit(${target}, ${text}, ${client})`;
      } else {
        return `$.tmuxSubmit(${target}, ${text})`;
      }
    }
  }
  return null;
}

/**
 * SSH-426: Handle timeout command
 * Parses "timeout DURATION COMMAND [ARG...]" and generates code with timeout option
 * @returns Transpiled command with timeout, or null if not a valid timeout command
 */
function handleTimeoutCommand(
  args: string[],
  ctx: VisitorContext,
  argExpansions?: boolean[],
  argTemplateEscapedLiterals?: boolean[],
): { code: string; async: boolean } | null {
  if (args.length < 2) return null;

  const duration = args[0];
  if (!duration) return null;

  // Parse duration: NUMBER, NUMBERs, NUMBERm, NUMBERh, NUMBERd
  let timeoutMs: number;
  const match = duration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
  if (!match) return null;

  const value = parseFloat(match[1] ?? "0");
  const unit = match[2] ?? "s"; // default to seconds

  switch (unit) {
    case "s":
      timeoutMs = value * 1000;
      break;
    case "m":
      timeoutMs = value * 60 * 1000;
      break;
    case "h":
      timeoutMs = value * 60 * 60 * 1000;
      break;
    case "d":
      timeoutMs = value * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }

  // Extract command and its arguments
  const cmdName = args[1];
  if (!cmdName) return null;
  const cmdArgs = args.slice(2);

  // Build the command with timeout option
  const argsArray = cmdArgs.length > 0
    ? cmdArgs.map((a, i) =>
      formatArg(a, argExpansions?.[i + 2], argTemplateEscapedLiterals?.[i + 2])
    )
      .join(", ")
    : "";
  const code = `$.cmd({ timeout: ${timeoutMs} }, ${
    formatArg(cmdName, argExpansions?.[1], argTemplateEscapedLiterals?.[1])
  }${argsArray ? `, ${argsArray}` : ""})`;

  return { code, async: true };
}

function handleSpecializedCommand(
  name: string,
  args: string[],
  hasMergeStreams: boolean,
  argExpansions?: boolean[],
  argTemplateEscapedLiterals?: boolean[],
): string {
  // Special handling for tmux send-keys
  if (name === "tmux") {
    const tmuxResult = handleTmuxSendKeys(args, argExpansions, argTemplateEscapedLiterals);
    if (tmuxResult) return tmuxResult;
  }

  const argsArray = args.length > 0
    ? args.map((a, i) => formatArg(a, argExpansions?.[i], argTemplateEscapedLiterals?.[i]))
      .join(", ")
    : "";
  if (hasMergeStreams) {
    return `$.${name}({ mergeStreams: true }${argsArray ? `, ${argsArray}` : ""})`;
  }
  return `$.${name}(${argsArray})`;
}

function handleStandardCommand(
  name: string,
  args: string[],
  hasAssignments: boolean,
  assignments: AST.VariableAssignment[],
  hasMergeStreams: boolean,
  ctx: VisitorContext,
  nameHasExpansion?: boolean,
  argExpansions?: boolean[],
  nameTemplateEscapedLiteral?: boolean,
  argTemplateEscapedLiterals?: boolean[],
): string {
  // SSH-484: Use formatArg for command name to support variable expansion
  const formattedName = formatArg(name, nameHasExpansion, nameTemplateEscapedLiteral);

  if (hasAssignments) {
    const envEntries = assignments
      .map((a) => {
        const value = ctx.visitWord(a.value as AST.Word);
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `${a.name}: "${escapedValue}"`;
      })
      .join(", ");
    const argsArray = args
      .map((a, i) => formatArg(a, argExpansions?.[i], argTemplateEscapedLiterals?.[i]))
      .join(", ");
    return `$.cmd({ env: { ${envEntries} } }, ${formattedName}${
      argsArray ? `, ${argsArray}` : ""
    })`;
  }

  const argsArray = args.length > 0
    ? args.map((a, i) => formatArg(a, argExpansions?.[i], argTemplateEscapedLiterals?.[i]))
      .join(", ")
    : "";
  if (hasMergeStreams) {
    return `$.cmd({ mergeStreams: true }, ${formattedName}${argsArray ? `, ${argsArray}` : ""})`;
  }
  return `$.cmd(${formattedName}${argsArray ? `, ${argsArray}` : ""})`;
}

// =============================================================================
// Command Handler - Phase-Based Decomposition
// =============================================================================

/**
 * Analysis result for a command
 */
interface CommandAnalysis {
  name: string;
  args: string[];
  hasAssignments: boolean;
  hasRedirects: boolean;
  hasMergeStreams: boolean;
  hasDynamicArgs: boolean;
  isVariableAssignmentOnly: boolean;
  /** SSH-532: Whether the command name contains real expansions */
  nameHasExpansion: boolean;
  /** SSH-532: Per-arg flags indicating real expansions */
  argExpansions: boolean[];
  nameTemplateEscapedLiteral: boolean;
  argTemplateEscapedLiterals: boolean[];
}

/**
 * Command strategy types
 */
type CommandStrategy =
  | { type: "variable-assignment"; assignments: AST.VariableAssignment[] }
  | { type: "user-function"; name: string }
  | { type: "shell-option" }
  | {
    type: "shell-builtin";
    name: string;
    args: string[];
    builtin: BuiltinConfig;
    argExpansions: boolean[];
    hasRedirects: boolean;
  }
  | {
    type: "timeout";
    args: string[];
    argExpansions: boolean[];
    argTemplateEscapedLiterals: boolean[];
  }
  | {
    type: "fluent";
    name: string;
    args: string[];
    nameHasExpansion: boolean;
    argExpansions: boolean[];
    nameTemplateEscapedLiteral: boolean;
    argTemplateEscapedLiterals: boolean[];
  }
  | {
    type: "specialized";
    name: string;
    args: string[];
    hasMergeStreams: boolean;
    argExpansions: boolean[];
    argTemplateEscapedLiterals: boolean[];
  }
  | {
    type: "standard";
    name: string;
    args: string[];
    hasAssignments: boolean;
    assignments: AST.VariableAssignment[];
    hasMergeStreams: boolean;
    nameHasExpansion: boolean;
    argExpansions: boolean[];
    nameTemplateEscapedLiteral: boolean;
    argTemplateEscapedLiterals: boolean[];
  };

type CommandExpressionResult = ExpressionResult & {
  isUserFunction?: boolean;
  isTransform?: boolean;
  isStream?: boolean;
  isShellBuiltin?: boolean;
  isSilentShellBuiltin?: boolean;
  formatsOutput?: boolean;
};

const SET_OPTION_NAMES = new Set([
  "allexport",
  "braceexpand",
  "emacs",
  "errexit",
  "errtrace",
  "functrace",
  "hashall",
  "histexpand",
  "history",
  "ignoreeof",
  "interactive-comments",
  "keyword",
  "monitor",
  "noclobber",
  "noexec",
  "noglob",
  "nolog",
  "notify",
  "nounset",
  "onecmd",
  "physical",
  "pipefail",
  "posix",
  "privileged",
  "verbose",
  "vi",
  "xtrace",
]);

function isShellOptionSetCommand(args: string[]): boolean {
  if (args.length === 0) return false;

  let expectsOptionName = false;
  for (const arg of args) {
    if (expectsOptionName) {
      if (!SET_OPTION_NAMES.has(arg)) return false;
      expectsOptionName = false;
      continue;
    }

    if (arg === "-o" || arg === "+o") {
      expectsOptionName = true;
      continue;
    }

    if (/^[+-][A-Za-z]+$/.test(arg)) {
      expectsOptionName = arg.slice(1).includes("o");
      continue;
    }

    if (!SET_OPTION_NAMES.has(arg)) return false;
  }

  return !expectsOptionName;
}

const LS_BUILTIN_FLAGS = new Set(["a", "A", "d", "l", "R", "h"]);

function canUseShellBuiltin(name: string, args: string[]): boolean {
  if (name !== "ls") return true;

  for (const arg of args) {
    if (!arg.startsWith("-") || arg === "-") continue;
    if (arg === "--" || arg.startsWith("--")) return false;
    for (const flag of arg.slice(1)) {
      if (!LS_BUILTIN_FLAGS.has(flag)) return false;
    }
  }

  return true;
}

function canUseBuiltinWithRedirects(redirects: AST.Redirection[]): boolean {
  return redirects.every((redirect) => {
    if (redirect.operator === ">" || redirect.operator === ">>" || redirect.operator === ">|") {
      const fd = redirect.fd ?? 1;
      return fd === 1 || fd === 2;
    }
    return redirect.operator === "&>" || redirect.operator === "&>>";
  });
}

/**
 * Phase 1: Analyze command structure
 * Parses and analyzes the command to extract relevant metadata
 */
function analyzeCommand(
  command: AST.Command,
  ctx: VisitorContext,
): CommandAnalysis {
  const hasNoCommand = command.name.type === "Word" && command.name.value === "";
  const isVariableAssignmentOnly = command.assignments.length > 0 && hasNoCommand;

  const name = ctx.visitWord(command.name);
  const args = command.args.map((arg) => ctx.visitWord(arg));

  const hasAssignments = command.assignments.length > 0;
  const hasRedirects = command.redirects.length > 0;
  const hasMergeStreams = command.redirects.some(
    (r) =>
      (r.operator === ">&" || r.operator === "<&") &&
      typeof r.target === "number" && r.target === 1 &&
      r.fd === 2,
  );
  // SSH-532: Compute expansion metadata from AST, not string heuristics
  const nameHasExpansion = wordHasExpansion(command.name);
  const argExpansions = command.args.map((arg) => wordHasExpansion(arg));
  const nameTemplateEscapedLiteral = wordIsTemplateEscapedLiteral(command.name);
  const argTemplateEscapedLiterals = command.args.map((arg) => wordIsTemplateEscapedLiteral(arg));
  const hasDynamicArgs = argExpansions.some(Boolean);

  return {
    name,
    args,
    hasAssignments,
    hasRedirects,
    hasMergeStreams,
    hasDynamicArgs,
    isVariableAssignmentOnly,
    nameHasExpansion,
    argExpansions,
    nameTemplateEscapedLiteral,
    argTemplateEscapedLiterals,
  };
}

/**
 * Phase 2: Select appropriate command strategy
 * Determines which strategy to use based on command analysis
 */
function selectCommandStrategy(
  command: AST.Command,
  analysis: CommandAnalysis,
  ctx: VisitorContext,
  options?: { inPipeline?: boolean },
): CommandStrategy {
  // Variable assignment only
  if (analysis.isVariableAssignmentOnly) {
    return { type: "variable-assignment", assignments: command.assignments };
  }

  // User function
  if (ctx.isFunction(analysis.name)) {
    return { type: "user-function", name: analysis.name };
  }

  if (
    analysis.name === "set" && !analysis.hasAssignments && !analysis.hasRedirects &&
    !options?.inPipeline && isShellOptionSetCommand(analysis.args)
  ) {
    return { type: "shell-option" };
  }

  // Shell builtin
  const builtin = SHELL_BUILTINS[analysis.name];
  if (
    builtin && !analysis.hasAssignments && !analysis.hasRedirects && !options?.inPipeline &&
    canUseShellBuiltin(analysis.name, analysis.args)
  ) {
    return {
      type: "shell-builtin",
      name: analysis.name,
      args: analysis.args,
      builtin,
      argExpansions: analysis.argExpansions,
      hasRedirects: false,
    };
  }

  if (
    builtin && !analysis.hasAssignments && analysis.hasRedirects && !options?.inPipeline &&
    canUseShellBuiltin(analysis.name, analysis.args) &&
    canUseBuiltinWithRedirects(command.redirects)
  ) {
    return {
      type: "shell-builtin",
      name: analysis.name,
      args: analysis.args,
      builtin,
      argExpansions: analysis.argExpansions,
      hasRedirects: true,
    };
  }

  // Timeout command
  if (analysis.name === "timeout") {
    return {
      type: "timeout",
      args: analysis.args,
      argExpansions: analysis.argExpansions,
      argTemplateEscapedLiterals: analysis.argTemplateEscapedLiterals,
    };
  }

  // Fluent command (with constraint checking)
  // $.cat(...) is a file stream helper, not a full cat command implementation.
  const catRequiresStandardCommand = analysis.name === "cat" &&
    (analysis.args.length !== 1 || (analysis.args[0]?.startsWith("-") ?? false));
  if (
    isFluentCommand(analysis.name) && !analysis.hasDynamicArgs && !analysis.hasAssignments &&
    !analysis.hasRedirects && !catRequiresStandardCommand
  ) {
    return {
      type: "fluent",
      name: analysis.name,
      args: analysis.args,
      nameHasExpansion: analysis.nameHasExpansion,
      argExpansions: analysis.argExpansions,
      nameTemplateEscapedLiteral: analysis.nameTemplateEscapedLiteral,
      argTemplateEscapedLiterals: analysis.argTemplateEscapedLiterals,
    };
  }

  // Specialized command
  if (!analysis.hasAssignments && SPECIALIZED_COMMANDS.has(analysis.name)) {
    return {
      type: "specialized",
      name: analysis.name,
      args: analysis.args,
      hasMergeStreams: analysis.hasMergeStreams,
      argExpansions: analysis.argExpansions,
      argTemplateEscapedLiterals: analysis.argTemplateEscapedLiterals,
    };
  }

  // Standard command
  return {
    type: "standard",
    name: analysis.name,
    args: analysis.args,
    hasAssignments: analysis.hasAssignments,
    assignments: command.assignments,
    hasMergeStreams: analysis.hasMergeStreams,
    nameHasExpansion: analysis.nameHasExpansion,
    argExpansions: analysis.argExpansions,
    nameTemplateEscapedLiteral: analysis.nameTemplateEscapedLiteral,
    argTemplateEscapedLiterals: analysis.argTemplateEscapedLiterals,
  };
}

/**
 * Phase 3: Execute the selected command strategy
 * Generates the transpiled code based on the strategy
 */
function executeCommandStrategy(
  strategy: CommandStrategy,
  ctx: VisitorContext,
  options?: { captureOutput?: boolean },
): CommandExpressionResult {
  switch (strategy.type) {
    case "variable-assignment": {
      const assignments = strategy.assignments
        .map((a) => buildVariableAssignment(a, ctx))
        .join(", ");
      return { code: assignments, async: false };
    }

    case "user-function": {
      const cmdExpr = handleUserFunction(strategy.name);
      return { code: cmdExpr, async: true, isUserFunction: true };
    }

    case "shell-option": {
      return { code: "void 0", async: false };
    }

    case "shell-builtin": {
      if (strategy.builtin.type === "prints") {
        const captureVar = ctx.getStdoutCapture();
        if (captureVar) {
          const formattedArgs = strategy.args.map((a, i) =>
            formatArg(a, strategy.argExpansions?.[i])
          );
          const captured = formattedArgs.length === 0
            ? '""'
            : formattedArgs.length === 1
            ? formattedArgs[0]!
            : `[${formattedArgs.join(", ")}].join(" ")`;
          return { code: `${captureVar}.push(${captured})`, async: false };
        }
      }
      const result = handleShellBuiltin(
        strategy.name,
        strategy.args,
        strategy.builtin,
        strategy.argExpansions,
        strategy.hasRedirects,
        options?.captureOutput ?? false,
      );
      return result;
    }

    case "timeout": {
      const timeoutResult = handleTimeoutCommand(
        strategy.args,
        ctx,
        strategy.argExpansions,
        strategy.argTemplateEscapedLiterals,
      );
      if (timeoutResult) {
        return { code: timeoutResult.code, async: timeoutResult.async };
      }
      // Invalid timeout syntax - fall through to standard command handling
      // Extract command name and args from timeout args
      const cmdName = strategy.args[1] ?? "";
      const cmdArgs = strategy.args.slice(2);
      const cmdExpr = handleStandardCommand(
        cmdName,
        cmdArgs,
        false,
        [],
        false,
        ctx,
        strategy.argExpansions[1],
        strategy.argExpansions.slice(2),
        strategy.argTemplateEscapedLiterals[1],
        strategy.argTemplateEscapedLiterals.slice(2),
      );
      return { code: cmdExpr, async: true };
    }

    case "fluent": {
      const fluentResult = buildFluentCommand(strategy.name, strategy.args, ctx);
      if (fluentResult !== null) {
        // SSH-424: Fluent commands return Command objects synchronously (no await needed)
        return {
          code: fluentResult.code,
          async: false,
          isTransform: fluentResult.isTransform,
          isStream: fluentResult.isStream,
        };
      }
      // Fallback to standard if fluent returns null
      const cmdExpr = handleStandardCommand(
        strategy.name,
        strategy.args,
        false,
        [],
        false,
        ctx,
        strategy.nameHasExpansion,
        strategy.argExpansions,
        strategy.nameTemplateEscapedLiteral,
        strategy.argTemplateEscapedLiterals,
      );
      return { code: cmdExpr, async: true };
    }

    case "specialized": {
      const cmdExpr = handleSpecializedCommand(
        strategy.name,
        strategy.args,
        strategy.hasMergeStreams,
        strategy.argExpansions,
        strategy.argTemplateEscapedLiterals,
      );
      return { code: cmdExpr, async: true };
    }

    case "standard": {
      const cmdExpr = handleStandardCommand(
        strategy.name,
        strategy.args,
        strategy.hasAssignments,
        strategy.assignments,
        strategy.hasMergeStreams,
        ctx,
        strategy.nameHasExpansion,
        strategy.argExpansions,
        strategy.nameTemplateEscapedLiteral,
        strategy.argTemplateEscapedLiterals,
      );
      return { code: cmdExpr, async: true };
    }
  }
}

/**
 * Phase 4: Apply command redirections
 * Applies redirection operators to the command expression
 */
function applyCommandRedirections(
  cmdExpr: string,
  redirects: AST.Redirection[],
  ctx: VisitorContext,
): string {
  let result = cmdExpr;

  // Apply redirections (except 2>&1 which is handled via mergeStreams option)
  for (const redirect of redirects) {
    if (
      (redirect.operator === ">&" || redirect.operator === "<&") &&
      typeof redirect.target === "number" && redirect.target === 1 &&
      redirect.fd === 2
    ) {
      continue;
    }
    result = applyRedirection(result, redirect, ctx);
  }

  return result;
}

function buildRedirectWrite(
  streamName: "__stdout" | "__stderr",
  target: string,
  append: boolean,
  index: number,
): string {
  const targetVar = `__target${index}`;
  const options = append ? "{ append: true }" : "{}";
  return `const ${targetVar} = ${target}; if (${targetVar} !== "/dev/null") Deno.writeTextFileSync(${targetVar}, ${streamName}, ${options}); ${streamName} = "";`;
}

function applyBuiltinRedirections(
  cmdExpr: string,
  redirects: AST.Redirection[],
  ctx: VisitorContext,
  options: { formatsOutput?: boolean } = {},
): string {
  const lines: string[] = [
    `let __result: any;`,
    `try { __result = await Promise.resolve(${cmdExpr}); } catch (__error) { __result = { stdout: "", stderr: __error instanceof Error ? __error.message : String(__error), code: 1 }; }`,
    `const __code = typeof __result === "boolean" ? (__result ? 0 : 1) : (__result ? (__result.code ?? 0) : 1);`,
    `let __stdout = Array.isArray(__result) ? __result.join("\\n") : ((typeof __result === "boolean" || __result == null) ? "" : (typeof __result.stdout === "string" ? __result.stdout : String(__result)));`,
    `let __stderr = (typeof __result?.stderr === "string") ? __result.stderr : "";`,
  ];

  if (options.formatsOutput) {
    lines.push(`if (__stdout) __stdout += "\\n";`);
  }

  for (let i = 0; i < redirects.length; i++) {
    const redirect = redirects[i]!;
    const target = formatRedirectionTarget(redirect, ctx);
    const append = redirect.operator === ">>" || redirect.operator === "&>>";

    if (redirect.operator === ">" || redirect.operator === ">>" || redirect.operator === ">|") {
      const fd = redirect.fd ?? 1;
      if (fd === 2) {
        lines.push(buildRedirectWrite("__stderr", target, append, i));
      } else {
        lines.push(buildRedirectWrite("__stdout", target, append, i));
      }
    } else if (redirect.operator === "&>" || redirect.operator === "&>>") {
      const targetVar = `__target${i}`;
      const optionsArg = append ? "{ append: true }" : "{}";
      lines.push(
        `const ${targetVar} = ${target}; if (${targetVar} !== "/dev/null") Deno.writeTextFileSync(${targetVar}, __stdout + __stderr, ${optionsArg}); __stdout = ""; __stderr = "";`,
      );
    }
  }

  lines.push(
    `return { stdout: __stdout, stderr: __stderr, code: __code, success: __code === 0 };`,
  );

  return `(async () => { ${lines.join(" ")} })()`;
}

/**
 * Build command - Main orchestrator
 * Coordinates the 4 phases to transpile a command
 */
export function buildCommand(
  command: AST.Command,
  ctx: VisitorContext,
  options?: { inPipeline?: boolean; captureOutput?: boolean },
): CommandExpressionResult {
  // Phase 1: Analyze command
  const analysis = analyzeCommand(command, ctx);

  // Phase 2: Select strategy
  const strategy = selectCommandStrategy(command, analysis, ctx, options);

  // Phase 3: Execute strategy
  const result = executeCommandStrategy(strategy, ctx, options);

  // Phase 4: Apply redirections
  if (result.isShellBuiltin && command.redirects.length > 0) {
    return {
      ...result,
      code: applyBuiltinRedirections(result.code, command.redirects, ctx, {
        formatsOutput: result.formatsOutput,
      }),
      async: true,
      isSilentShellBuiltin: false,
    };
  }

  const finalCode = applyCommandRedirections(result.code, command.redirects, ctx);

  return { ...result, code: finalCode };
}

/**
 * Result from building a fluent command
 */
interface FluentCommandResult {
  code: string;
  /** True if this is a transform function (like $.head, $.grep), false if it's a data source (like $.cat) */
  isTransform: boolean;
  /** True if this produces a stream (like $.cat), false if it's a Command */
  isStream: boolean;
}

/**
 * Configuration for building a simple fluent transform command
 */
interface SimpleFluentConfig {
  /** Parse arguments into options and files */
  parseArgs: (args: string[]) => { options?: string; files: string[] };
  /** Build the transform code (e.g., "$.head(10)") */
  buildTransform: (options?: string) => string;
}

/**
 * Registry of simple fluent commands that follow the pattern:
 * 1. Parse args into options and files
 * 2. If files present: $.cat(file).lines().pipe(transform)
 * 3. Otherwise: return transform
 */
const SIMPLE_FLUENT_COMMANDS: Record<string, SimpleFluentConfig> = {
  head: {
    parseArgs: (args) => {
      const { count, files } = parseCountArg(args);
      return { options: count.toString(), files };
    },
    buildTransform: (count) => `$.head(${count})`,
  },
  tail: {
    parseArgs: (args) => {
      const { count, files } = parseCountArg(args);
      return { options: count.toString(), files };
    },
    buildTransform: (count) => `$.tail(${count})`,
  },
  sort: {
    parseArgs: (args) => {
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-n": "numeric: true",
        "-r": "reverse: true",
        "-u": "unique: true",
      });
      return { options: options.length > 0 ? options.join(", ") : undefined, files };
    },
    buildTransform: (opts) => opts ? `$.sort({ ${opts} })` : "$.sort()",
  },
  uniq: {
    parseArgs: (args) => {
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-c": "count: true",
        "-i": "ignoreCase: true",
      });
      return { options: options.length > 0 ? options.join(", ") : undefined, files };
    },
    buildTransform: (opts) => opts ? `$.uniq({ ${opts} })` : "$.uniq()",
  },
  wc: {
    parseArgs: (args) => {
      const { options, files } = collectFlagOptionsAndFiles(args, {
        "-l": "lines: true",
        "-w": "words: true",
        "-c": "bytes: true",
        "-m": "chars: true",
      });
      return { options: options.length > 0 ? options.join(", ") : undefined, files };
    },
    buildTransform: (opts) => opts ? `$.wc({ ${opts} })` : "$.wc()",
  },
};

/**
 * Build a simple fluent command using the registry pattern
 */
function buildSimpleFluentCommand(name: string, args: string[]): FluentCommandResult {
  const config = SIMPLE_FLUENT_COMMANDS[name];
  if (!config) {
    throw new Error(`Unknown simple fluent command: ${name}`);
  }

  const { options, files } = config.parseArgs(args);
  const transformCode = config.buildTransform(options);

  if (files.length > 0) {
    const file = `"${escapeForQuotes(files[0] ?? "")}"`;
    return {
      code: `$.cat(${file}).lines().pipe(${transformCode})`,
      isTransform: false,
      isStream: true,
    };
  }

  return { code: transformCode, isTransform: true, isStream: false };
}

function hasGlobPattern(path: string): boolean {
  return /[*?[\]{}]/.test(path);
}

function formatFileArgs(files: string[]): string {
  return files.map((file) => `"${escapeForQuotes(file)}"`).join(", ");
}

function buildTextFileStream(files: string[]): string {
  if (files.length === 1 && !hasGlobPattern(files[0] ?? "")) {
    return `$.cat("${escapeForQuotes(files[0] ?? "")}").lines()`;
  }

  return `$.src(${formatFileArgs(files)})` +
    `.map((file) => typeof file.contents === "string" ? file.contents : new TextDecoder().decode(file.contents))` +
    `.lines()`;
}

/**
 * Build a fluent-style command (cat, grep, etc.)
 */
function buildFluentCommand(
  name: string,
  args: string[],
  _ctx: VisitorContext,
): FluentCommandResult | null {
  switch (name) {
    case "cat": {
      // $.cat(file) or $.cat(file1, file2, ...)
      // cat is a stream producer, not a transform
      if (args.length === 0) {
        return { code: '$.cat("-")', isTransform: false, isStream: true }; // Read from stdin
      }
      const files = args.map((a) => `"${escapeForQuotes(a)}"`).join(", ");
      return { code: `$.cat(${files})`, isTransform: false, isStream: true };
    }

    case "grep": {
      // $.grep(pattern) as transform or $.grep(pattern, file)
      // Parse grep options
      let pattern: string | undefined;
      let files: string[] = [];
      let invert = false;
      let ignoreCase = false;
      let lineNumber = false;
      let recursive = false;

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg?.startsWith("--")) {
          // Skip long options for now.
        } else if (arg?.startsWith("-") && arg.length > 1) {
          for (const flag of arg.slice(1)) {
            if (flag === "v") {
              invert = true;
            } else if (flag === "i") {
              ignoreCase = true;
            } else if (flag === "n") {
              lineNumber = true;
            } else if (flag === "r" || flag === "R") {
              recursive = true;
            } else if (flag === "A" || flag === "B" || flag === "C" || flag === "m") {
              // SSH-568: These flags take numeric arguments and aren't supported by fluent grep.
              // Fall back to $.cmd("grep", ...) for correctness.
              return null;
            }
          }
        } else if (pattern === undefined) {
          pattern = arg ?? "";
        } else {
          files.push(arg ?? "");
        }
      }

      // If recursive flag is present, fall back to $.cmd()
      // Fluent grep doesn't support directory recursion
      if (recursive) {
        return null;
      }

      // SSH-5: pattern comes from visitWord() which applies escapeForTemplate(), doubling
      // backslashes and escaping $. Embedding the template-escaped string directly in a
      // regex literal causes \\[ to open an unclosed character class.
      // templateEscapedToRegexSource() reverses the template escaping then applies
      // BRE→JS conversions so the result is safe inside /.../.
      const regexSource = templateEscapedToRegexSource(pattern ?? "");
      const flags = ignoreCase ? "i" : "";
      const regexPattern = regexSource === "" ? `/(?:)/${flags}` : `/${regexSource}/${flags}`;

      if (files.length > 0) {
        // grep pattern file -> $.cat(file).grep(pattern) - this is a stream chain
        const fileStream = buildTextFileStream(files);
        if (lineNumber) {
          const predicate = invert ? `!${regexPattern}.test(line)` : `${regexPattern}.test(line)`;
          const result = `${fileStream}.map((line, i) => ({ line, number: i + 1 }))` +
            `.filter(({ line }) => ${predicate})` +
            ".map(({ line, number }) => `${number}:${line}`)";
          return { code: result, isTransform: false, isStream: true };
        }
        if (invert) {
          // SSH-503: grep -v with file - skip .grep() since it filters FOR the pattern,
          // then .filter(x => !x.match) on the result would produce nothing.
          // Instead, read lines and filter out matches directly.
          const result = `${fileStream}.filter(line => !${regexPattern}.test(line))`;
          return { code: result, isTransform: false, isStream: true };
        }
        const result = `${fileStream}.grep(${regexPattern})`;
        return { code: result, isTransform: false, isStream: true };
      }

      // grep as a transform
      if (invert) {
        return {
          code: `$.filter((line) => !${regexPattern}.test(line))`,
          isTransform: true,
          isStream: false,
        };
      }
      return { code: `$.grep(${regexPattern})`, isTransform: true, isStream: false };
    }

    case "head":
    case "tail":
      // -c flag means byte count, incompatible with line-based $.head/$.tail transforms
      if (args.includes("-c")) return null;
      return buildSimpleFluentCommand(name, args);

    case "sort":
    case "uniq":
    case "wc":
      return buildSimpleFluentCommand(name, args);

    case "tee": {
      // $.tee(file) as transform
      const file = args[0] ?? "-";
      return { code: `$.tee("${escapeForQuotes(file)}")`, isTransform: true, isStream: false };
    }

    // tr, cut, sed, awk are not fluent commands - they fall through to default
    default: {
      const argsArray = args.length > 0
        ? args.map((a) => `"${escapeForQuotes(a)}"`).join(", ")
        : "";
      return {
        code: `$.cmd("${escapeForQuotes(name)}"${argsArray ? `, ${argsArray}` : ""})`,
        isTransform: false,
        isStream: false,
      };
    }
  }
}

/**
 * Apply a redirection to a command expression
 */
export function applyRedirection(
  cmdExpr: string,
  redirect: AST.Redirection,
  ctx: VisitorContext,
): string {
  const target = formatRedirectionTarget(redirect, ctx);

  switch (redirect.operator) {
    case "<":
      return `${cmdExpr}.stdin(${target})`;
    case ">":
      // SSH-308: Check fd field - if fd=2, redirect stderr instead of stdout
      if (redirect.fd === 2) {
        return `${cmdExpr}.stderr(${target})`;
      }
      return `${cmdExpr}.stdout(${target})`;
    case ">>":
      // SSH-308: Check fd field - if fd=2, redirect stderr instead of stdout
      if (redirect.fd === 2) {
        return `${cmdExpr}.stderr(${target}, { append: true })`;
      }
      return `${cmdExpr}.stdout(${target}, { append: true })`;
    case "<>":
      // SSH-299: Read-Write mode
      return `${cmdExpr}.stdin(${target}).stdout(${target})`;
    case ">|":
      // SSH-299: Force overwrite (clobber)
      if (redirect.fd === 2) {
        return `${cmdExpr}.stderr(${target}, { force: true })`;
      }
      return `${cmdExpr}.stdout(${target}, { force: true })`;
    case "<<":
      // SSH-299: Here-document
      return `${cmdExpr}.stdin(${target})`;
    case "<<-":
      // SSH-299: Here-document with tab stripping
      return `${cmdExpr}.stdin(${target}, { stripTabs: true })`;
    case ">&":
      if ((redirect.fd ?? 1) === 1 && redirect.target === 2) {
        return `${cmdExpr}.stdoutToStderr()`;
      }
      return `${cmdExpr}.stderr(${target})`;
    case "<&":
      return `${cmdExpr}.stderr(${target})`;
    case "&>":
      return `${cmdExpr}.stdout(${target}).stderr(${target})`;
    case "&>>":
      return `${cmdExpr}.stdout(${target}, { append: true }).stderr(${target}, { append: true })`;
    case "<<<":
      // Here-string
      return `${cmdExpr}.stdin(${target})`;
    default:
      return cmdExpr;
  }
}

/**
 * Visit a command as a statement
 */
export function visitCommand(
  command: AST.Command,
  ctx: VisitorContext,
): StatementResult {
  const result = buildCommand(command, ctx);
  const indent = ctx.getIndent();
  const captureVar = ctx.getStdoutCapture();

  // Wrap command execution with __printCmd to print output
  // This only applies to standalone commands (statements), not commands in pipelines/expressions
  // Don't wrap user-defined functions as they don't return CommandResult
  if (captureVar && result.async && !result.isUserFunction) {
    const resultVar = ctx.getTempVar("__cmd");
    const stdoutVar = ctx.getTempVar("__stdout");
    return {
      lines: [
        `${indent}const ${resultVar} = await ${result.code};`,
        `${indent}const ${stdoutVar} = ${resultVar}.output ?? ${resultVar}.stdout;`,
        `${indent}if (${stdoutVar}) ${captureVar}.push(...String(${stdoutVar}).split(/\\r?\\n/).filter((line, i, lines) => line.length > 0 || i < lines.length - 1));`,
        `${indent}if (${resultVar}.stderr) await Deno.stderr.write(new TextEncoder().encode(${resultVar}.stderr));`,
      ],
    };
  }
  if (captureVar && result.isStream) {
    const streamExpr = result.async ? `await ${result.code}` : result.code;
    const lineVar = ctx.getTempVar("__line");
    return {
      lines: [
        `${indent}for await (const ${lineVar} of ${streamExpr}) { ${captureVar}.push(String(${lineVar})); }`,
      ],
    };
  }
  if (result.isStream) {
    const streamExpr = result.async ? `await ${result.code}` : result.code;
    return {
      lines: [`${indent}for await (const __line of ${streamExpr}) { console.log(__line); }`],
    };
  }
  if (result.isSilentShellBuiltin) {
    const resultVar = ctx.getTempVar("__cmd");
    return {
      lines: [
        `${indent}const ${resultVar} = ${result.code};`,
        `${indent}if (${resultVar}?.stderr) await Deno.stderr.write(new TextEncoder().encode(${resultVar}.stderr + (${resultVar}.stderr.endsWith("\\n") ? "" : "\\n")));`,
      ],
    };
  }
  if (result.async && !result.isUserFunction) {
    return { lines: [`${indent}await __printCmd(${result.code});`] };
  } else if (result.async) {
    return { lines: [`${indent}await ${result.code};`] };
  }
  return { lines: [`${indent}${result.code};`] };
}

// =============================================================================
// Pipeline Handler
// =============================================================================

/**
 * Represents a part in a flattened pipeline with metadata
 */
interface PipelinePart {
  code: string;
  /** Whether this part produces command output that should be printed */
  isPrintable: boolean;
  /** Whether this part is a transform function (like $.head, $.grep) vs a command/stream */
  isTransform: boolean;
  /** Whether this part produces a stream (like $.cat) vs a Command */
  isStreamProducer: boolean;
  /** Whether this part needs await (true for $.cmd(), false for fluent commands) - SSH-424 */
  isAsync: boolean;
  /** Whether this part resolves to a command result object rather than a Command */
  isResultObject?: boolean;
}

interface ReadLoopConsumer {
  loop: AST.WhileStatement;
  variables: string[];
  ifs: string;
}

interface ReadCommandConsumer {
  variables: string[];
  ifs: string;
}

interface ReadGroupConsumer extends ReadCommandConsumer {
  body: AST.Statement[];
}

function isStderrDiscardRedirect(redirect: AST.Redirection): boolean {
  if (redirect.fd !== 2) return false;
  if (redirect.operator !== ">" && redirect.operator !== ">>" && redirect.operator !== ">|") {
    return false;
  }
  return typeof redirect.target !== "number" && getStaticWordValue(redirect.target) === "/dev/null";
}

function getStaticWordValue(
  word:
    | AST.Word
    | AST.ParameterExpansion
    | AST.CommandSubstitution
    | AST.ArithmeticExpansion
    | AST.ArrayLiteral,
): string | null {
  if (word.type !== "Word") return null;
  if (
    word.parts.some(
      (part) => part.type !== "LiteralPart" && part.type !== "GlobPattern",
    )
  ) {
    return null;
  }
  return word.value;
}

function getReadLoopTestCommand(
  test: AST.WhileStatement["test"],
): AST.Command | null {
  if (test.type === "Command") return test;
  if (test.type === "Pipeline" && test.commands.length === 1) {
    const [cmd] = test.commands;
    return cmd?.type === "Command" ? cmd : null;
  }
  return null;
}

function getSingleCommand(stmt: AST.Statement): AST.Command | null {
  if (stmt.type === "Command") return stmt;
  if (stmt.type === "Pipeline" && stmt.commands.length === 1) {
    const [cmd] = stmt.commands;
    return cmd?.type === "Command" ? cmd : null;
  }
  return null;
}

function extractReadCommandConsumer(command: AST.Command): ReadCommandConsumer | null {
  const commandName = getStaticWordValue(command.name);
  if (commandName !== "read") return null;

  let ifs = " \t";
  for (const assignment of command.assignments) {
    if (assignment.name !== "IFS") return null;
    const value = getStaticWordValue(assignment.value);
    if (value === null) return null;
    ifs = value;
  }

  const variables: string[] = [];
  let parsingVariables = false;

  for (const arg of command.args) {
    const value = getStaticWordValue(arg);
    if (value === null) return null;

    if (!parsingVariables) {
      if (value === "--") {
        parsingVariables = true;
        continue;
      }
      if (value.startsWith("-")) {
        if (value === "-r") continue;
        return null;
      }
      parsingVariables = true;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      return null;
    }
    variables.push(value);
  }

  if (variables.length === 0) {
    variables.push("REPLY");
  }

  return { variables, ifs };
}

function extractReadLoopConsumer(stmt: AST.Statement): ReadLoopConsumer | null {
  if (stmt.type !== "WhileStatement") return null;
  if ((stmt.redirects?.length ?? 0) > 0 && !stmt.redirects?.every(isStderrDiscardRedirect)) {
    return null;
  }

  const testCmd = getReadLoopTestCommand(stmt.test);
  if (!testCmd) return null;

  const readCommand = extractReadCommandConsumer(testCmd);
  if (!readCommand) return null;

  return {
    loop: stmt,
    ...readCommand,
  };
}

function extractReadGroupConsumer(stmt: AST.Statement): ReadGroupConsumer | null {
  if (stmt.type !== "Subshell" && stmt.type !== "BraceGroup") return null;
  if ((stmt.redirections?.length ?? 0) > 0) return null;

  const [first, ...body] = stmt.body;
  if (!first) return null;

  const readCommand = getSingleCommand(first);
  if (!readCommand) return null;

  const readConsumer = extractReadCommandConsumer(readCommand);
  if (!readConsumer) return null;

  return { ...readConsumer, body };
}

function buildReadAssignmentLines(
  readConsumer: ReadCommandConsumer,
  sourceVar: string,
  partsVar: string,
): string[] {
  const lines: string[] = [];

  if (readConsumer.variables.length === 1) {
    const jsName = sanitizeVarName(readConsumer.variables[0]!);
    lines.push(`let ${jsName} = ${sourceVar};`);
    return lines;
  }

  if (readConsumer.ifs === "") {
    lines.push(`const ${partsVar} = [${sourceVar}];`);
  } else {
    const splitRegex = readConsumer.ifs === " \t"
      ? "/[ \\t]+/"
      : `new RegExp("[${escapeRegex(readConsumer.ifs)}]+")`;
    lines.push(
      `const ${partsVar} = ${sourceVar} === "" ? [] : ${sourceVar}.split(${splitRegex});`,
    );
  }

  const joiner = formatArg(readConsumer.ifs[0] ?? "");
  const lastIndex = readConsumer.variables.length - 1;
  for (let i = 0; i < readConsumer.variables.length; i++) {
    const jsName = sanitizeVarName(readConsumer.variables[i]!);
    if (i === lastIndex) {
      lines.push(
        `let ${jsName} = ${partsVar}.length > ${i} ? ${partsVar}.slice(${i}).join(${joiner}) : "";`,
      );
    } else {
      lines.push(`let ${jsName} = ${partsVar}[${i}] ?? "";`);
    }
  }

  return lines;
}

function buildReadLoopConsumerExpression(
  pipeline: AST.Pipeline,
  readLoop: ReadLoopConsumer,
  ctx: VisitorContext,
): string {
  const upstreamPipeline: AST.Pipeline = {
    type: "Pipeline",
    commands: pipeline.commands.slice(0, -1),
    operator: "|",
    background: false,
    negated: false,
  };

  const upstream = buildPipeline(upstreamPipeline, ctx);
  const upstreamExpr = upstream.isStream
    ? (upstream.async ? `(await ${upstream.code})` : upstream.code)
    : upstream.code;
  const lineStreamExpr = upstream.isStream
    ? `${upstreamExpr}.lines()`
    : `${upstreamExpr}.stdout().lines()`;

  const lineVar = ctx.getTempVar("line");
  const sourceVar = ctx.getTempVar("read");
  const partsVar = ctx.getTempVar("parts");
  const bodyLines: string[] = [];

  const sourceExpr = readLoop.ifs === "" ? lineVar : `${lineVar}.trim()`;
  bodyLines.push(`const ${sourceVar} = ${sourceExpr};`);
  bodyLines.push(...buildReadAssignmentLines(readLoop, sourceVar, partsVar));

  for (const stmt of readLoop.loop.body) {
    const result = ctx.visitStatement(stmt);
    bodyLines.push(...result.lines.map((line) => line.trim()).filter(Boolean));
  }

  const inner = bodyLines.map((line) => `    ${line}`).join("\n");

  return `(async () => {
  for await (const ${lineVar} of ${lineStreamExpr}) {
${inner}
  }
  return { code: 0, stdout: '', stderr: '', success: true };
})()`;
}

function buildReadGroupConsumerExpression(
  pipeline: AST.Pipeline,
  readGroup: ReadGroupConsumer,
  ctx: VisitorContext,
): string {
  const upstreamPipeline: AST.Pipeline = {
    type: "Pipeline",
    commands: pipeline.commands.slice(0, -1),
    operator: "|",
    background: false,
    negated: false,
  };

  const upstream = buildPipeline(upstreamPipeline, ctx);
  const upstreamExpr = upstream.isStream
    ? (upstream.async ? `(await ${upstream.code})` : upstream.code)
    : upstream.code;
  const lineStreamExpr = upstream.isStream
    ? `${upstreamExpr}.lines()`
    : `${upstreamExpr}.stdout().lines()`;

  const lineVar = ctx.getTempVar("line");
  const sourceVar = ctx.getTempVar("read");
  const partsVar = ctx.getTempVar("parts");
  const bodyLines: string[] = [];

  bodyLines.push(`const ${lineVar} = (await ${lineStreamExpr}.first()) ?? "";`);
  const sourceExpr = readGroup.ifs === "" ? lineVar : `${lineVar}.trim()`;
  bodyLines.push(`const ${sourceVar} = ${sourceExpr};`);
  bodyLines.push(...buildReadAssignmentLines(readGroup, sourceVar, partsVar));

  for (const stmt of readGroup.body) {
    const result = ctx.visitStatement(stmt);
    bodyLines.push(...result.lines.map((line) => line.trim()).filter(Boolean));
  }

  const inner = bodyLines.map((line) => `  ${line}`).join("\n");

  return `(async () => {
${inner}
  return { code: 0, stdout: '', stderr: '', success: true };
})()`;
}

/**
 * Build the downstream pipeline with captured output injected as stdin into the first command.
 * Used when a while read loop is in the middle of a pipeline.
 */
function buildDownstreamWithStdin(
  downstreamCommands: AST.Statement[],
  captureVar: string,
  ctx: VisitorContext,
): string {
  if (downstreamCommands.length === 0) {
    return `Promise.resolve({ code: 0, stdout: ${captureVar}.join("\\n"), stderr: "", success: true })`;
  }

  const parts: PipelinePart[] = [];
  const operators: (string | null)[] = [];
  const synthPipeline: AST.Pipeline = {
    type: "Pipeline",
    commands: downstreamCommands,
    operator: "|",
    background: false,
    negated: false,
  };
  flattenPipeline(synthPipeline, parts, operators, ctx);

  if (parts.length === 0) {
    return `Promise.resolve({ code: 0, stdout: ${captureVar}.join("\\n"), stderr: "", success: true })`;
  }

  if (parts[0]!.isTransform) {
    // Downstream starts with a Transform (e.g. $.grep(), $.sort()) — use $.fromArray()
    // to feed the captured lines into the transform chain and collect results.
    let chain = `$.fromArray(${captureVar})`;
    for (const part of parts) {
      chain += `.pipe(${part.code})`;
    }
    chain += `.collect()`;
    return `(async () => {
    const __collected = await ${chain};
    return { code: 0, stdout: __collected.join("\\n"), stderr: "", success: true };
  })()`;
  }

  // Downstream starts with a Command — inject captured output as stdin.
  parts[0]!.code = `${parts[0]!.code}.stdin(${captureVar}.join("\\n"))`;

  const analysis = analyzePipelineStructure(operators);
  const assembled = assemblePipeline(parts, operators, analysis);

  return `${assembled.code}.exec()`;
}

function resultObjectToLineStream(expr: string): string {
  return `$.fromArray(((result: any) => String(result?.output ?? result?.stdout ?? "").split(/\\r?\\n/).filter((line, i, lines) => line.length > 0 || i < lines.length - 1))(${expr}))`;
}

function buildStatementAsCapturedExpression(stmt: AST.Statement, ctx: VisitorContext): string {
  const captureVar = ctx.getTempVar("__out");
  const previousCapture = ctx.getStdoutCapture();

  ctx.setStdoutCapture(captureVar);
  let result: StatementResult;
  try {
    result = ctx.visitStatement(stmt);
  } finally {
    ctx.setStdoutCapture(previousCapture);
  }

  const lines = result.lines.map((line) => line.trim()).filter((line) => line.length > 0);
  return `(async () => { const ${captureVar}: string[] = []; ${
    lines.join("; ")
  }; return { code: 0, stdout: ${captureVar}.join("\\n"), stderr: "", success: true }; })()`;
}

/**
 * Build a mid-pipeline while read loop expression.
 * Handles: upstream | while read x; do ...; done | downstream
 * Captures loop body stdout and feeds it to downstream via .stdin().
 */
function buildMidReadLoopExpression(
  pipeline: AST.Pipeline,
  readLoopIndex: number,
  readLoop: ReadLoopConsumer,
  ctx: VisitorContext,
): string {
  const upstreamPipeline: AST.Pipeline = {
    type: "Pipeline",
    commands: pipeline.commands.slice(0, readLoopIndex),
    operator: "|",
    background: false,
    negated: false,
  };
  const upstream = buildPipeline(upstreamPipeline, ctx);
  const upstreamExpr = upstream.isStream
    ? (upstream.async ? `(await ${upstream.code})` : upstream.code)
    : upstream.code;
  const lineStreamExpr = upstream.isStream
    ? `${upstreamExpr}.lines()`
    : `${upstreamExpr}.stdout().lines()`;

  const captureVar = ctx.getTempVar("__out");
  const lineVar = ctx.getTempVar("line");
  const sourceVar = ctx.getTempVar("read");
  const partsVar = ctx.getTempVar("parts");
  const bodyLines: string[] = [];

  const sourceExpr = readLoop.ifs === "" ? lineVar : `${lineVar}.trim()`;
  bodyLines.push(`const ${sourceVar} = ${sourceExpr};`);
  bodyLines.push(...buildReadAssignmentLines(readLoop, sourceVar, partsVar));

  // Visit loop body with stdout capture active so echo → captureVar.push(...)
  ctx.setStdoutCapture(captureVar);
  try {
    for (const stmt of readLoop.loop.body) {
      const result = ctx.visitStatement(stmt);
      bodyLines.push(...result.lines.map((line) => line.trim()).filter(Boolean));
    }
  } finally {
    ctx.setStdoutCapture(null);
  }

  const inner = bodyLines.map((line) => `    ${line}`).join("\n");
  const downstreamCode = buildDownstreamWithStdin(
    pipeline.commands.slice(readLoopIndex + 1),
    captureVar,
    ctx,
  );

  return `(async () => {
  const ${captureVar}: string[] = [];
  for await (const ${lineVar} of ${lineStreamExpr}) {
${inner}
  }
  return await ${downstreamCode};
})()`;
}

/**
 * Build a pipeline expression (without await/semicolon)
 */
export function buildPipeline(
  pipeline: AST.Pipeline,
  ctx: VisitorContext,
): ExpressionResult & { isStream?: boolean; isPrintable?: boolean; isResultObject?: boolean } {
  if (
    !pipeline.background &&
    !pipeline.negated &&
    pipeline.operator === "|" &&
    pipeline.commands.length >= 2
  ) {
    const readLoop = extractReadLoopConsumer(
      pipeline.commands[pipeline.commands.length - 1]!,
    );
    if (readLoop) {
      return {
        code: buildReadLoopConsumerExpression(pipeline, readLoop, ctx),
        async: true,
        isStream: false,
        isPrintable: false,
      };
    }

    const readGroup = extractReadGroupConsumer(
      pipeline.commands[pipeline.commands.length - 1]!,
    );
    if (readGroup) {
      return {
        code: buildReadGroupConsumerExpression(pipeline, readGroup, ctx),
        async: true,
        isStream: false,
        isPrintable: false,
      };
    }

    // Check for while read in middle positions (index 1 to length-2).
    // Start from 1 so upstream is never empty (reading from process stdin is not handled).
    for (let i = 1; i < pipeline.commands.length - 1; i++) {
      const midReadLoop = extractReadLoopConsumer(pipeline.commands[i]!);
      if (midReadLoop) {
        return {
          code: buildMidReadLoopExpression(pipeline, i, midReadLoop, ctx),
          async: true,
          isStream: false,
          isPrintable: true,
        };
      }
    }
  }

  // Single command, no pipeline
  if (pipeline.commands.length === 1 && !pipeline.background) {
    const cmd = pipeline.commands[0];
    if (!cmd) return { code: "", async: false };

    if (cmd.type === "Command") {
      return buildCommand(cmd, ctx);
    } else if (cmd.type === "Pipeline") {
      return buildPipeline(cmd, ctx);
    }
    // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
    return { code: buildStatementAsExpression(cmd, ctx), async: true };
  }

  // Build pipeline chain by flattening nested pipelines
  const parts: PipelinePart[] = [];
  const operators: (string | null)[] = [];

  // Flatten the pipeline tree into a list
  flattenPipeline(pipeline, parts, operators, ctx);

  // Build the chained expression
  if (parts.length === 0) return { code: "", async: false };

  // Analyze pipeline structure
  const analysis = analyzePipelineStructure(operators);

  // Assemble the pipeline
  const assembled = assemblePipeline(parts, operators, analysis, ctx.getStdoutCapture() !== null);

  // Handle negation (! operator)
  let result = assembled.code;
  if (pipeline.negated) {
    result = `${result}.negate()`;
  }

  // SSH-424: Preserve async=false for single fluent commands (even with background &)
  // If this is a single-command pipeline with no operators, preserve the original async value
  const isAsync = (parts.length === 1 && operators.length === 0)
    ? parts[0]!.isAsync // Use the isAsync field we now track
    : true; // Multi-command pipelines are always async

  return {
    code: result,
    async: isAsync,
    isStream: assembled.isStream,
    isPrintable: assembled.isPrintable,
    isResultObject: assembled.isResultObject,
  };
}

/**
 * Analysis of a pipeline's structure
 */
interface PipelineAnalysis {
  hasAndThenPipe: boolean;
}

/**
 * Analyze pipeline structure to inform code generation
 * Checks if any && operator is eventually followed by a pipe operator
 */
function analyzePipelineStructure(operators: (string | null)[]): PipelineAnalysis {
  let hasAndThenPipe = false;
  for (let i = 0; i < operators.length; i++) {
    if (operators[i] === "&&") {
      // Check if this && is eventually followed by a pipe before hitting ||, ;, or end
      for (let j = i + 1; j < operators.length; j++) {
        const laterOp = operators[j];
        if (laterOp === "|") {
          hasAndThenPipe = true;
          break;
        }
        if (laterOp === "||" || laterOp === ";") break;
      }
    }
    if (hasAndThenPipe) break;
  }
  return { hasAndThenPipe };
}

// =============================================================================
// Pipeline Assembler
// =============================================================================

/**
 * PipelineAssembler orchestrates pipeline code generation.
 * Each operator (&&, ||, |, ;) has its own focused handler method.
 *
 * Responsibilities:
 * - Maintain pipeline state (code, printable, promise, stream)
 * - Delegate to operator-specific handlers
 * - Return assembled pipeline result
 */
class PipelineAssembler {
  private code: string;
  private isPrintable: boolean;
  private isPromise: boolean;
  private isStream: boolean;
  private isLineStream: boolean;
  private isResultObject: boolean;
  private captureOutput: boolean;

  constructor(initialPart: PipelinePart, captureOutput: boolean) {
    this.code = initialPart.code;
    this.isPrintable = initialPart.isPrintable;
    this.isStream = initialPart.isStreamProducer;
    this.isPromise = (initialPart.isResultObject ?? false) && initialPart.isAsync;
    this.isLineStream = false;
    this.isResultObject = initialPart.isResultObject ?? false;
    this.captureOutput = captureOutput;
  }

  getResult() {
    return {
      code: this.code,
      isStream: this.isStream,
      isPrintable: this.isPrintable,
      isResultObject: this.isResultObject,
    };
  }

  /**
   * Handle && operator: execute second part if first succeeds.
   * SSH-361/362: Handle printable vs non-printable parts correctly.
   *
   * @param part - The pipeline part to append
   * @param followedByPipe - Whether this && is eventually followed by a pipe
   */
  appendAnd(part: PipelinePart): void {
    this.handleLogicalOp("&&", part);
  }

  /**
   * Handle || operator: execute second part if first fails.
   * SSH-361/362: Handle printable vs non-printable parts correctly.
   */
  appendOr(part: PipelinePart): void {
    this.handleLogicalOp("||", part);
  }

  /**
   * Handle | operator: pipe output from first to second.
   * SSH-364: Use appropriate method for transforms vs commands.
   */
  appendPipe(part: PipelinePart): void {
    this.resolvePromiseIfNeeded();

    if (part.isTransform) {
      this.handleTransformPipe(part);
    } else if (part.isStreamProducer) {
      this.handleStreamProducerPipe(part);
    } else {
      this.handleCommandPipe(part);
    }

    this.isPrintable = true;
    // SSH-409: isStream reflects whether result is actually a stream
    this.isStream = part.isStreamProducer || part.isTransform;
    this.isResultObject = false;
  }

  /**
   * Handle ; operator: execute parts sequentially.
   * SSH-362: Handle non-printable parts correctly.
   */
  appendSequential(part: PipelinePart): void {
    if (!this.isPrintable && !part.isPrintable) {
      this.code = `${this.code}; ${part.code}`;
      this.isPromise = false;
      this.updateStreamState(false, false);
    } else if (this.isPrintable) {
      // Use __printCmd inside IIFE for printable last part to enable streaming output.
      // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
      const returnExpr = (part.isPrintable && !part.isStreamProducer)
        ? `return await __printCmd(${part.code})`
        : `return ${part.code}`;
      this.wrapInAsyncIIFE(
        `await __printCmd(${this.isPromise ? `await ${this.code}` : this.code})`,
        returnExpr,
      );
      // SSH-474: Preserve stream status from the returning part
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    } else {
      // Use __printCmd inside IIFE for printable last part to enable streaming output.
      // SSH-494: Don't wrap stream producers in __printCmd - the for-await loop handles iteration
      const returnExpr = (part.isPrintable && !part.isStreamProducer)
        ? `return await __printCmd(${part.code})`
        : `return ${part.code}`;
      this.wrapInAsyncIIFE(this.code, returnExpr);
      // SSH-474: Preserve stream status from the returning part
      this.isStream = part.isStreamProducer;
      this.isLineStream = false;
    }

    // isPrintable set to false inside branches when __printCmd moved inside IIFE
    if (!part.isPrintable) this.isPrintable = false;
  }

  // ----- Private Helper Methods -----

  /**
   * SSH-514: Unified handler for logical operators (&& and ||).
   * Branches on printability of left/right parts and operator type.
   *
   * @param op - The operator: "&&" or "||"
   * @param part - The right-hand pipeline part
   * @param followedByPipe - (&&-only) Whether a pipe operator follows
   */
  private handleLogicalOp(
    op: "&&" | "||",
    part: PipelinePart,
  ): void {
    if (part.isStreamProducer && !this.captureOutput) {
      this.handleLogicalStreamOp(op, part);
      return;
    }

    const leftValue = this.isPromise ? `await ${this.code}` : this.code;
    const condition = op === "&&" ? "__code === 0" : "__code !== 0";

    this.code =
      `(async () => { const __left: any = await __captureCmd(${leftValue}); const __code = __left.code ?? 0; if (${condition}) { const __right: any = await __captureCmd(${part.code}); const __rightCode = __right.code ?? 0; return { code: __rightCode, stdout: (__left.stdout ?? "") + (__right.stdout ?? ""), stderr: (__left.stderr ?? "") + (__right.stderr ?? ""), success: __rightCode === 0, pipeStatus: __right.pipeStatus }; } return { code: __code, stdout: __left.stdout ?? "", stderr: __left.stderr ?? "", success: __code === 0, pipeStatus: __left.pipeStatus }; })()`;
    this.isPromise = true;
    this.isPrintable = true;
    this.isStream = false;
    this.isLineStream = false;
    this.isResultObject = true;
  }

  private handleLogicalStreamOp(
    op: "&&" | "||",
    part: PipelinePart,
  ): void {
    const leftValue = this.isPromise ? `await ${this.code}` : this.code;
    const leftSetup = this.isPrintable
      ? `const __code = await __printCmd(${leftValue});`
      : `const __left: any = await __captureCmd(${leftValue}); if (__left.stdout) await Deno.stdout.write(new TextEncoder().encode(__left.stdout)); if (__left.stderr) await Deno.stderr.write(new TextEncoder().encode(__left.stderr)); const __code = __left.code ?? 0;`;
    const condition = op === "&&" ? "__code === 0" : "__code !== 0";

    this.code =
      `(async () => { ${leftSetup} if (${condition}) { return ${part.code}; } __setPipeStatus(undefined, __code); return $.empty(); })()`;
    this.isPromise = true;
    this.isPrintable = false;
    this.isStream = true;
    this.isLineStream = false;
    this.isResultObject = false;
  }

  /**
   * Handle pipe to transform (like $.head, $.grep)
   */
  private handleTransformPipe(part: PipelinePart): void {
    if (this.isLineStream) {
      // SSH-408: Already a line stream, just pipe to the transform
      this.code = `${this.code}.pipe(${part.code})`;
      this.isLineStream = true;
    } else if (this.isStream) {
      // Stream producer (like $.cat) - need .lines() to split content into lines
      this.code = `${this.code}.lines().pipe(${part.code})`;
      this.isLineStream = true;
    } else if (this.isResultObject) {
      this.code = `${resultObjectToLineStream(this.code)}.pipe(${part.code})`;
      this.isLineStream = true;
    } else {
      // Command - convert to line stream first, then apply transform
      this.code = `${this.code}.stdout().lines().pipe(${part.code})`;
      this.isLineStream = true;
    }
  }

  /**
   * Handle pipe to stream producer (like $.cat)
   */
  private handleStreamProducerPipe(part: PipelinePart): void {
    this.code = `${this.code}.pipe(${part.code})`;
    this.isLineStream = false;
  }

  /**
   * Handle pipe to command
   */
  private handleCommandPipe(part: PipelinePart): void {
    if (this.isLineStream) {
      // SSH-408: Piping from a line stream to a command needs toCmdLines
      this.code = `${this.code}.pipe($.toCmdLines(${part.code}))`;
      this.isLineStream = true;
    } else if (this.isStream) {
      // When piping from a stream to a command, need to use toCmdLines transform
      this.code = `${this.code}.pipe($.toCmdLines(${part.code}))`;
      this.isLineStream = true;
    } else if (this.isResultObject) {
      this.code = `${resultObjectToLineStream(this.code)}.pipe($.toCmdLines(${part.code}))`;
      this.isLineStream = true;
    } else {
      // When piping from a command to a command, can pipe directly
      this.code = `${this.code}.pipe(${part.code})`;
      this.isLineStream = false;
    }
  }

  /**
   * Resolve promise state if needed (await if promise)
   */
  private resolvePromiseIfNeeded(): void {
    if (this.isPromise) {
      this.code = `(await ${this.code})`;
      this.isPromise = false;
    }
  }

  /**
   * Update stream state flags
   */
  private updateStreamState(isStream: boolean, isLineStream: boolean): void {
    this.isStream = isStream;
    this.isLineStream = isLineStream;
    this.isResultObject = false;
  }

  /**
   * Reset promise state and stream flags (used by || and ; operators)
   */
  private resetPromiseState(): void {
    this.isPromise = true;
    this.updateStreamState(false, false);
  }

  /**
   * Wrap code in async IIFE
   */
  private wrapInAsyncIIFE(expr: string, returnExpr: string): void {
    this.code = `(async () => { ${expr}; ${returnExpr}; })()`;
    this.isPromise = true;
    this.updateStreamState(false, false);
  }
}

/**
 * Assemble the full pipeline by processing all parts and operators
 */
function assemblePipeline(
  parts: PipelinePart[],
  operators: (string | null)[],
  analysis: PipelineAnalysis,
  captureOutput = false,
): { code: string; isStream: boolean; isPrintable: boolean; isResultObject: boolean } {
  if (parts.length === 0) {
    return { code: "", isStream: false, isPrintable: false, isResultObject: false };
  }

  const assembler = new PipelineAssembler(parts[0]!, captureOutput);

  for (let i = 1; i < parts.length; i++) {
    const op = operators[i - 1];
    const part = parts[i];
    if (!part) continue;

    if (op === "&&") {
      assembler.appendAnd(part);
    } else if (op === "||") {
      assembler.appendOr(part);
    } else if (op === "|") {
      assembler.appendPipe(part);
    } else if (op === ";") {
      assembler.appendSequential(part);
    } else {
      // Default: pipe
      assembler.appendPipe(part);
    }
  }

  return assembler.getResult();
}

/**
 * Flatten a nested pipeline tree into arrays of commands and operators.
 *
 * SSH-472: When the current operator is || or &&, and an operand is a | pipe chain,
 * build the pipe chain as a complete expression (don't flatten it).
 * But if the operand is another &&/|| chain or a single command, flatten it normally
 * to preserve variable scoping.
 *
 * Example: "cat file | jq || cat file | head" parses as:
 *   Pipeline(operator: ||)
 *     - Pipeline(operator: |) [cat | jq]
 *     - Pipeline(operator: |) [cat | head]
 *
 * We should NOT flatten this to [cat, jq, cat, head] with operators [|, ||, |].
 * Instead, we should build each side of || as a complete pipeline expression.
 *
 * But for "A=1 && B=2 && echo $A $B", we SHOULD flatten to preserve variable scope.
 */
function flattenPipeline(
  pipeline: AST.Pipeline,
  parts: PipelinePart[],
  operators: (string | null)[],
  ctx: VisitorContext,
  captureOutput = pipeline.commands.length > 1,
): void {
  // Check if this pipeline uses pipe operator (|) - only then we're in a "true" pipeline
  const hasPipeOperator = pipeline.operator === "|";
  const capturesCommandOutput = captureOutput || pipeline.commands.length > 1;

  // Helper to check if a nested pipeline should be built as a complete expression
  // Only | pipe chains should be complete expressions within ||/&& operators
  const shouldBuildAsExpression = (nested: AST.Pipeline): boolean => {
    // If current operator is || or &&, and nested pipeline is a | pipe chain, build as expression
    return (pipeline.operator === "||" || pipeline.operator === "&&") && nested.operator === "|";
  };

  // Process left side (first command)
  const left = pipeline.commands[0];
  if (left) {
    if (left.type === "Command") {
      const result = buildCommand(left, ctx, {
        inPipeline: hasPipeOperator,
        captureOutput: capturesCommandOutput,
      });
      // SSH-361: Track whether the command produces output that should be printed
      // SSH-424: For fluent commands, async=false but they still produce output
      // isPrintable should be true for all commands except variable assignments
      const isPrintable = result.async || (result.isStream ?? false) ||
        (result.isTransform ?? false);
      parts.push({
        code: result.code,
        isPrintable,
        isTransform: result.isTransform ?? false,
        isStreamProducer: result.isStream ?? false,
        isAsync: result.async,
      });
    } else if (left.type === "Pipeline") {
      // SSH-472: Only build as complete expression if it's a | pipe chain within ||/&&
      if (shouldBuildAsExpression(left)) {
        const result = buildPipeline(left, ctx);
        // Calculate isPrintable the same way as for commands
        const isPrintable = result.isPrintable ?? (result.async || (result.isStream ?? false));
        parts.push({
          code: result.code,
          isPrintable,
          isTransform: false,
          isStreamProducer: result.isStream ?? false,
          isAsync: result.async,
          isResultObject: result.isResultObject ?? false,
        });
      } else {
        // Flatten for &&/|| chains and single commands to preserve variable scope
        flattenPipeline(left, parts, operators, ctx, capturesCommandOutput);
      }
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      const capturesStdout = hasPipeOperator && pipeline.commands.length > 1;
      parts.push({
        code: capturesStdout
          ? buildStatementAsCapturedExpression(left, ctx)
          : buildStatementAsExpression(left, ctx),
        isPrintable: !capturesStdout,
        isTransform: false,
        isStreamProducer: false,
        isAsync: true,
        isResultObject: capturesStdout,
      });
    }
  }

  // For each subsequent command, add operator then command
  for (let i = 1; i < pipeline.commands.length; i++) {
    // Add the operator that connects to this command
    operators.push(pipeline.operator);

    const cmd = pipeline.commands[i];
    if (!cmd) continue;

    if (cmd.type === "Command") {
      const result = buildCommand(cmd, ctx, {
        inPipeline: hasPipeOperator,
        captureOutput: capturesCommandOutput,
      });
      // SSH-361: Track whether the command produces output that should be printed
      // SSH-424: For fluent commands, async=false but they still produce output
      const isPrintable = result.async || (result.isStream ?? false) ||
        (result.isTransform ?? false);
      parts.push({
        code: result.code,
        isPrintable,
        isTransform: result.isTransform ?? false,
        isStreamProducer: result.isStream ?? false,
        isAsync: result.async,
      });
    } else if (cmd.type === "Pipeline") {
      // SSH-472: Only build as complete expression if it's a | pipe chain within ||/&&
      if (shouldBuildAsExpression(cmd)) {
        const result = buildPipeline(cmd, ctx);
        // Calculate isPrintable the same way as for commands
        const isPrintable = result.isPrintable ?? (result.async || (result.isStream ?? false));
        parts.push({
          code: result.code,
          isPrintable,
          isTransform: false,
          isStreamProducer: result.isStream ?? false,
          isAsync: result.async,
          isResultObject: result.isResultObject ?? false,
        });
      } else {
        // Flatten for &&/|| chains and single commands to preserve variable scope
        flattenPipeline(cmd, parts, operators, ctx, capturesCommandOutput);
      }
    } else {
      // For other statement types (BraceGroup, Subshell, etc.), wrap in async IIFE
      const capturesStdout = hasPipeOperator && i < pipeline.commands.length - 1;
      parts.push({
        code: capturesStdout
          ? buildStatementAsCapturedExpression(cmd, ctx)
          : buildStatementAsExpression(cmd, ctx),
        isPrintable: !capturesStdout,
        isTransform: false,
        isStreamProducer: false,
        isAsync: true,
        isResultObject: capturesStdout,
      });
    }
  }
}

/**
 * Convert a statement (like BraceGroup, Subshell, etc.) into an expression that can be used in a pipeline
 * Wraps the statement in an async IIFE that returns a result object
 */
function buildStatementAsExpression(stmt: AST.Statement, ctx: VisitorContext): string {
  // Visit the statement to get its lines
  const result = ctx.visitStatement(stmt);
  const lines = result.lines.map((l) => l.trim()).filter((l) => l.length > 0);

  // Wrap in async IIFE that executes the statements and returns success
  return `(async () => { ${lines.join("; ")}; return { code: 0, stdout: '', stderr: '' }; })()`;
}

/**
 * Check if a command is a "safe" command for sequential execution in && chains.
 * Safe commands always succeed, so we can emit them sequentially without
 * breaking && semantics. This includes:
 * - Variable assignments (A=1)
 * - cd (changes directory, doesn't fail in typical use)
 *
 * Commands that might fail (test commands, regular commands) need proper
 * && handling with exit code checks.
 */
function isSafeAndOperand(cmd: AST.Statement): boolean {
  if (cmd.type === "Command") {
    // Variable-only assignment (no command name)
    if (cmd.assignments.length > 0 && cmd.name.type === "Word" && cmd.name.value === "") {
      return true;
    }
    // cd is a safe builtin that typically doesn't fail
    if (cmd.name.type === "Word" && cmd.name.value === "cd") {
      return true;
    }
    return false;
  }
  if (cmd.type === "Pipeline") {
    // Single-command pipeline - check the inner command
    if (cmd.commands.length === 1 && cmd.operator === null) {
      return isSafeAndOperand(cmd.commands[0]!);
    }
    // Nested && chain - all parts must be safe
    if (cmd.operator === "&&") {
      return cmd.commands.every((c) => isSafeAndOperand(c));
    }
    return false;
  }
  // TestCommand, ArithmeticCommand, etc. might fail
  return false;
}

/**
 * Check if a pipeline is a "safe" && chain that can be emitted as sequential
 * statements without breaking && semantics.
 *
 * A safe && chain has all non-final commands as "safe" (variable assignments, cd).
 * The final command can be anything since we don't need to check its exit code.
 */
function isSafeAndChain(pipeline: AST.Pipeline): boolean {
  if (pipeline.operator !== "&&") return false;

  // Check all commands - they should be either Commands or single-command Pipelines (no pipes)
  for (const cmd of pipeline.commands) {
    if (cmd.type === "Pipeline") {
      // If it's a nested pipeline with | or ||, not a safe && chain
      if (cmd.operator === "|" || cmd.operator === "||") return false;
      // If it's a nested && chain, check recursively
      if (cmd.operator === "&&") {
        if (!isSafeAndChain(cmd)) return false;
      }
      // operator === null is fine (single command wrapped in pipeline)
    }
  }

  // Now check that all non-final commands are "safe"
  const commands: AST.Statement[] = [];
  flattenAndChain(pipeline, commands);

  // All but the last command must be safe
  for (let i = 0; i < commands.length - 1; i++) {
    if (!isSafeAndOperand(commands[i]!)) {
      return false;
    }
  }

  return true;
}

/**
 * Flatten a pure && chain into an array of statements
 */
function flattenAndChain(
  pipeline: AST.Pipeline,
  statements: Array<AST.Statement>,
): void {
  for (const cmd of pipeline.commands) {
    if (cmd.type === "Pipeline") {
      if (cmd.operator === "&&") {
        // Recursively flatten nested && chains
        flattenAndChain(cmd, statements);
      } else {
        // Single-command pipeline (operator === null)
        const inner = cmd.commands[0];
        if (inner) {
          statements.push(inner);
        }
      }
    } else {
      // Command, TestCommand, ArithmeticCommand, BraceGroup, Subshell, etc.
      statements.push(cmd);
    }
  }
}

function isControlStatement(
  stmt: AST.Statement | undefined,
): stmt is AST.BreakStatement | AST.ContinueStatement | AST.ReturnStatement {
  return stmt?.type === "BreakStatement" ||
    stmt?.type === "ContinueStatement" ||
    stmt?.type === "ReturnStatement";
}

function containsControlStatement(stmt: AST.Statement): boolean {
  if (isControlStatement(stmt)) return true;

  if (stmt.type === "Pipeline") {
    return stmt.commands.some((cmd) => containsControlStatement(cmd));
  }

  if (stmt.type === "BraceGroup") {
    return stmt.body.some((bodyStmt) => containsControlStatement(bodyStmt));
  }

  if (stmt.type === "IfStatement") {
    const alternate = Array.isArray(stmt.alternate)
      ? stmt.alternate.some((bodyStmt) => containsControlStatement(bodyStmt))
      : stmt.alternate
      ? containsControlStatement(stmt.alternate)
      : false;

    return stmt.consequent.some((bodyStmt) => containsControlStatement(bodyStmt)) || alternate;
  }

  if (
    stmt.type === "ForStatement" ||
    stmt.type === "CStyleForStatement" ||
    stmt.type === "WhileStatement" ||
    stmt.type === "UntilStatement"
  ) {
    return stmt.body.some((bodyStmt) => containsControlStatement(bodyStmt));
  }

  if (stmt.type === "CaseStatement") {
    return stmt.cases.some((caseClause) =>
      caseClause.body.some((bodyStmt) => containsControlStatement(bodyStmt))
    );
  }

  return false;
}

function isLogicalControlTarget(stmt: AST.Statement | undefined): stmt is AST.Statement {
  return !!stmt && (isControlStatement(stmt) ||
    (stmt.type === "BraceGroup" && containsControlStatement(stmt)) ||
    (stmt.type === "Pipeline" &&
      stmt.operator === null &&
      stmt.commands.length === 1 &&
      isLogicalControlTarget(stmt.commands[0])));
}

function buildPrintableStatusLines(
  result: ExpressionResult & { isStream?: boolean; isPrintable?: boolean },
  statusVar: string,
  indent: string,
): string[] {
  if (result.isStream || result.isPrintable) {
    const expr = result.isStream && result.async ? `await ${result.code}` : result.code;
    return [`${indent}const ${statusVar} = await __printCmd(${expr});`];
  }

  if (result.async) {
    const leftVar = `${statusVar}Result`;
    return [
      `${indent}const ${leftVar} = await ${result.code};`,
      `${indent}if (${leftVar}?.stderr) await Deno.stderr.write(new TextEncoder().encode(${leftVar}.stderr + (${leftVar}.stderr.endsWith("\\n") ? "" : "\\n")));`,
      `${indent}const ${statusVar} = typeof ${leftVar} === "number" ? ${leftVar} : (${leftVar}?.code ?? 0);`,
    ];
  }

  const leftVar = `${statusVar}Result`;
  return [
    `${indent}const ${leftVar} = ${result.code};`,
    `${indent}if (${leftVar}?.stderr) await Deno.stderr.write(new TextEncoder().encode(${leftVar}.stderr + (${leftVar}.stderr.endsWith("\\n") ? "" : "\\n")));`,
    `${indent}const ${statusVar} = typeof ${leftVar} === "number" ? ${leftVar} : (${leftVar}?.code ?? 0);`,
  ];
}

function visitLogicalControlPipeline(
  pipeline: AST.Pipeline,
  ctx: VisitorContext,
): StatementResult | null {
  if (
    pipeline.background ||
    (pipeline.operator !== "&&" && pipeline.operator !== "||") ||
    pipeline.commands.length < 2
  ) {
    return null;
  }

  const control = pipeline.commands[pipeline.commands.length - 1];
  if (!isLogicalControlTarget(control)) return null;

  const leftPipeline: AST.Pipeline = {
    type: "Pipeline",
    commands: pipeline.commands.slice(0, -1),
    operator: pipeline.operator,
    background: false,
    negated: pipeline.negated,
  };
  const left = buildPipeline(leftPipeline, ctx);
  const indent = ctx.getIndent();
  const statusVar = ctx.getTempVar("__code");
  const lines = buildPrintableStatusLines(left, statusVar, indent);
  const condition = pipeline.operator === "&&" ? `${statusVar} === 0` : `${statusVar} !== 0`;

  lines.push(`${indent}if (${condition}) {`);
  ctx.indent();
  const controlResult = ctx.visitStatement(control);
  lines.push(...controlResult.lines);
  ctx.dedent();
  lines.push(`${indent}}`);

  return { lines };
}

/**
 * Visit a pipeline statement
 */
export function visitPipeline(
  pipeline: AST.Pipeline,
  ctx: VisitorContext,
): StatementResult {
  const indent = ctx.getIndent();

  // Single command, no pipeline
  if (pipeline.commands.length === 1 && !pipeline.background) {
    const cmd = pipeline.commands[0];
    if (!cmd) return { lines: [] };

    if (cmd.type === "Command") {
      return visitCommand(cmd, ctx);
    }
    return ctx.visitStatement(cmd);
  }

  const logicalControl = visitLogicalControlPipeline(pipeline, ctx);
  if (logicalControl) return logicalControl;

  // SSH-472: For && chains, we need to preserve variable scope.
  // First, check if this chain has any variable assignments that need hoisting.
  // If so, emit them as separate statements first, then emit the pipeline.
  if (pipeline.operator === "&&" && !pipeline.background) {
    const statements: Array<AST.Statement> = [];
    flattenAndChain(pipeline, statements);

    // Find variable assignments that need hoisting
    const hoistedVars: string[] = [];
    const nonVarStatements: AST.Statement[] = [];

    for (const stmt of statements) {
      if (
        stmt.type === "Command" &&
        stmt.assignments.length > 0 &&
        stmt.name.type === "Word" &&
        stmt.name.value === ""
      ) {
        // Pure variable assignment - hoist it
        const result = buildCommand(stmt, ctx);
        hoistedVars.push(result.code);
      } else {
        nonVarStatements.push(stmt);
      }
    }

    // If we have hoisted variables and remaining statements, emit them separately
    if (hoistedVars.length > 0) {
      const lines: string[] = [];

      // First emit all variable assignments
      for (const varCode of hoistedVars) {
        lines.push(`${indent}${varCode};`);
      }

      // If there are no remaining statements, we're done
      if (nonVarStatements.length === 0) {
        return { lines };
      }

      // If remaining statements are all safe (cd), emit them directly
      const allSafe = nonVarStatements.every((stmt) => {
        if (stmt.type === "Command" && stmt.name.type === "Word" && stmt.name.value === "cd") {
          return true;
        }
        return false;
      });

      if (allSafe) {
        for (const stmt of nonVarStatements) {
          if (stmt.type === "Command") {
            const result = buildCommand(stmt, ctx);
            lines.push(`${indent}${result.code};`);
          }
        }
        return { lines };
      }

      // Otherwise, build a new pipeline from remaining statements and emit it
      if (nonVarStatements.length === 1) {
        const stmt = nonVarStatements[0]!;
        if (stmt.type === "Command") {
          const result = buildCommand(stmt, ctx);
          const isPrintable = result.async || (result.isStream ?? false) ||
            (result.isTransform ?? false);
          if (isPrintable) {
            lines.push(`${indent}await __printCmd(${result.code});`);
          } else {
            lines.push(`${indent}${result.code};`);
          }
        } else {
          const stmtResult = ctx.visitStatement(stmt);
          lines.push(...stmtResult.lines);
        }
        return { lines };
      }

      // Multiple non-var statements: build as && chain
      // Create a synthetic pipeline from the remaining statements
      const syntheticPipeline: AST.Pipeline = {
        type: "Pipeline",
        commands: nonVarStatements.map((stmt) => ({
          type: "Pipeline" as const,
          commands: [stmt],
          operator: null,
          background: false,
          negated: false,
        })),
        operator: "&&",
        background: false,
        negated: false,
      };

      const result = buildPipeline(syntheticPipeline, ctx);
      if (result.isStream) {
        // SSH-476: If the result is async (wrapped in IIFE), await it first before iterating
        const streamExpr = result.async ? `await ${result.code}` : result.code;
        lines.push(`${indent}for await (const __line of ${streamExpr}) { console.log(__line); }`);
      } else if (!result.isPrintable) {
        const prefix = result.async ? "await " : "";
        lines.push(`${indent}${prefix}${result.code};`);
      } else {
        lines.push(`${indent}await __printCmd(${result.code});`);
      }
      return { lines };
    }
  }

  const result = buildPipeline(pipeline, ctx);

  if (pipeline.background) {
    // SSH-XXX: Spawn background job and track PID for $!
    // Convert the command to a spawned child process so we can get its PID
    // If the result is async (e.g., wrapped in IIFE for cd), await it first
    const bgCode = result.async
      ? `${indent}  const __bgCmd = await (async () => { return ${result.code}; })();` // SSH-572: Wrap in IIFE to avoid semicolon syntax error
      : `${indent}  const __bgCmd = ${result.code};`;

    return {
      lines: [
        `${indent}(async () => {`,
        bgCode,
        `${indent}  const __child = __bgCmd.spawnBackground();`,
        `${indent}  __LAST_BG_PID = __child.pid;`,
        `${indent}})(); // background`,
      ],
    };
  }

  const captureVar = ctx.getStdoutCapture();
  if (captureVar) {
    if (result.isStream) {
      const streamExpr = result.async ? `await ${result.code}` : result.code;
      const lineVar = ctx.getTempVar("__line");
      return {
        lines: [
          `${indent}for await (const ${lineVar} of ${streamExpr}) { ${captureVar}.push(String(${lineVar})); }`,
        ],
      };
    }

    if (result.isPrintable || result.isResultObject) {
      const resultVar = ctx.getTempVar("__cmd");
      const stdoutVar = ctx.getTempVar("__stdout");
      const resultExpr = result.async
        ? `await ${result.code}`
        : `await Promise.resolve(${result.code})`;
      return {
        lines: [
          `${indent}const ${resultVar} = ${resultExpr};`,
          `${indent}const ${stdoutVar} = ${resultVar}.output ?? ${resultVar}.stdout;`,
          `${indent}if (${stdoutVar}) ${captureVar}.push(...String(${stdoutVar}).split(/\\r?\\n/).filter((line, i, lines) => line.length > 0 || i < lines.length - 1));`,
          `${indent}if (${resultVar}.stderr) await Deno.stderr.write(new TextEncoder().encode(${resultVar}.stderr));`,
        ],
      };
    }

    const prefix = result.async ? "await " : "";
    return { lines: [`${indent}${prefix}${result.code};`] };
  }

  // SSH-364: Handle stream vs command output differently
  if (result.isStream) {
    // For streams (from .trans()), iterate and print each line
    // SSH-476: If the result is async (wrapped in IIFE), await it first before iterating
    const streamExpr = result.async ? `await ${result.code}` : result.code;
    return {
      lines: [`${indent}for await (const __line of ${streamExpr}) { console.log(__line); }`],
    };
  }

  // SSH-372: Don't wrap non-printable results (like shell builtins) in __printCmd
  // But still await async results (IIFEs that handle their own printing)
  if (!result.isPrintable) {
    const prefix = result.async ? "await " : "";
    return { lines: [`${indent}${prefix}${result.code};`] };
  }

  // Wrap pipeline execution with __printCmd to print output
  return { lines: [`${indent}await __printCmd(${result.code});`] };
}

// =============================================================================
// Variable Assignment Handler
// =============================================================================

/**
 * Build a variable assignment expression
 */
export function buildVariableAssignment(
  stmt: AST.VariableAssignment,
  ctx: VisitorContext,
): string {
  // SSH-489: Sanitize variable names that collide with JS reserved words
  const jsName = sanitizeVarName(stmt.name);

  let value: string;
  let isArray = false;

  // SSH-327: Handle array assignments
  if (stmt.value.type === "ArrayLiteral") {
    isArray = true;
    const elements = stmt.value.elements
      .map((el) => {
        const elementValue = ctx.visitWord(el as AST.Word);
        return formatArg(
          elementValue,
          wordHasExpansion(el as AST.Word | AST.ParameterExpansion | AST.CommandSubstitution),
        );
      })
      .join(", ");
    value = `[${elements}]`;
  } else if (stmt.value.type === "ArithmeticExpansion") {
    value = ctx.visitArithmetic(stmt.value.expression);
  } else {
    // SSH-330: Handle assignments with expansions
    // If the value contains expansions (like ${!ref}), we need to use template literals (backticks)
    // instead of regular strings (double quotes) so the expansions are evaluated
    const word = stmt.value as AST.Word;
    const wordValue = ctx.visitWord(word);

    // Check if the word has expansions (not just literal parts) and is not single-quoted
    // Single-quoted strings should remain literal
    const hasExpansions = wordHasExpansion(word);

    if (hasExpansions && !word.singleQuoted) {
      // Use template literal syntax (backticks) for expansion evaluation
      value = `\`${wordValue}\``;
    } else {
      // Use double quotes for literal values
      value = `"${escapeForQuotes(wordValue)}"`;
    }
  }

  // SSH-566: Check if the value references the variable being assigned.
  // If so, and it's a first declaration, we must split `let VAR; VAR = value;`
  // to avoid TDZ (Temporal Dead Zone) errors where `typeof VAR` throws because
  // `let` hasn't finished initializing.
  const selfReferences = !ctx.isDeclared(stmt.name) && value.includes(`typeof ${jsName} `);

  // SSH-306: Handle exported variables
  if (stmt.exported) {
    // Exported variables need to be set in both local scope and environment
    // Use original name for Deno.env.set (env var name), sanitized for JS identifier
    if (ctx.isDeclared(stmt.name)) {
      // Already declared, just update value and export
      return `${jsName} = ${value}; Deno.env.set("${stmt.name}", ${jsName})`;
    } else {
      // First assignment - declare, set value, and export
      ctx.declareVariable(stmt.name, "let");
      if (selfReferences) {
        return `let ${jsName}; ${jsName} = ${value}; Deno.env.set("${stmt.name}", ${jsName})`;
      }
      return `let ${jsName} = ${value}; Deno.env.set("${stmt.name}", ${jsName})`;
    }
  }

  // Check if variable is already declared
  if (ctx.isDeclared(stmt.name)) {
    // Reassignment - no declaration keyword needed
    return `${jsName} = ${value}`;
  } else {
    // First assignment - declare with let (bash variables are mutable)
    ctx.declareVariable(stmt.name, "let");
    if (selfReferences) {
      return `let ${jsName}; ${jsName} = ${value}`;
    }
    return `let ${jsName} = ${value}`;
  }
}

/**
 * Visit a variable assignment as a statement
 */
export function visitVariableAssignment(
  stmt: AST.VariableAssignment,
  ctx: VisitorContext,
): StatementResult {
  const indent = ctx.getIndent();
  return { lines: [`${indent}${buildVariableAssignment(stmt, ctx)};`] };
}
