/**
 * Word and Expansion Handlers
 *
 * Transpiles Word, ParameterExpansion, CommandSubstitution,
 * ArithmeticExpansion, and ProcessSubstitution nodes.
 */

import type * as AST from "../../ast.ts";
import type { VisitorContext } from "../types.ts";
import {
  escapeForQuotes,
  escapeForTemplate,
  escapeRegex,
} from "../utils/escape.ts";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find the first unescaped slash in a string.
 * Returns the index of the first unescaped '/', or -1 if not found.
 */
function findFirstUnescapedSlash(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      i++; // Skip escaped char
    } else if (s[i] === '/') {
      return i;
    }
  }
  return -1;
}

// =============================================================================
// Word Handler
// =============================================================================

/**
 * Visit a Word node and return the transpiled string
 */
export function visitWord(
  word: AST.Word | AST.ParameterExpansion | AST.CommandSubstitution,
  ctx: VisitorContext,
): string {
  if (word.type === "Word") {
    // Build from parts if they contain expansions
    if (word.parts.length > 0) {
      return word.parts.map((part) => visitWordPart(part, ctx)).join("");
    }
    // Fallback to escaped value
    return escapeForTemplate(word.value);
  } else if (word.type === "ParameterExpansion") {
    return visitParameterExpansion(word, ctx);
  } else if (word.type === "CommandSubstitution") {
    return visitCommandSubstitution(word, ctx);
  }

  // This should never be reached
  return "";
}

/**
 * Visit a WordPart node
 */
export function visitWordPart(part: AST.WordPart, ctx: VisitorContext): string {
  switch (part.type) {
    case "LiteralPart":
      return escapeForTemplate(part.value);
    case "ParameterExpansion":
      return visitParameterExpansion(part, ctx);
    case "CommandSubstitution":
      return visitCommandSubstitution(part, ctx);
    case "ArithmeticExpansion":
      return visitArithmeticExpansion(part, ctx);
    case "ProcessSubstitution":
      return visitProcessSubstitution(part, ctx);
    case "GlobPattern":
      // Expand glob patterns at runtime
      return `\${(await $.fs.glob("${escapeForQuotes(part.pattern)}")).join(" ")}`;
    default: {
      const _exhaustive: never = part;
      return "";
    }
  }
}

// =============================================================================
// Parameter Expansion Handler
// =============================================================================

/**
 * Visit a ParameterExpansion node
 */
export function visitParameterExpansion(
  expansion: AST.ParameterExpansion,
  ctx: VisitorContext,
): string {
  const param = expansion.parameter;
  const modifier = expansion.modifier;

  if (!modifier) {
    // Simple expansion: ${VAR} or $VAR
    return `\${${param}}`;
  }

  // Handle modifiers
  const modifierArg = expansion.modifierArg
    ? visitWord(expansion.modifierArg as AST.Word, ctx)
    : "";

  switch (modifier) {
    case "length":
      // ${#VAR} - length of variable
      return `\${${param}.length}`;

    case ":-":
      // ${VAR:-default} - use default if unset OR empty
      return `\${(${param} === undefined || ${param} === "") ? "${escapeForQuotes(modifierArg)}" : ${param}}`;

    case "-":
      // ${VAR-default} - use default only if unset
      return `\${${param} !== undefined ? ${param} : "${escapeForQuotes(modifierArg)}"}`;

    case ":=":
    case "=":
      // ${VAR:=default} - assign default if unset
      return `\${${param} ??= "${escapeForQuotes(modifierArg)}"}`;

    case ":?":
    case "?":
      // ${VAR:?error} - error if unset
      return `\${${param} ?? (() => { throw new Error("${escapeForQuotes(modifierArg)}"); })()}`;

    case ":+":
    case "+":
      // ${VAR:+alternate} - use alternate if set
      return `\${${param} ? "${escapeForQuotes(modifierArg)}" : ""}`;

    case "#":
      // ${VAR#pattern} - remove shortest prefix
      return `\${${param}.replace(/^${escapeRegex(modifierArg)}/, "")}`;

    case "##":
      // ${VAR##pattern} - remove longest prefix
      return `\${${param}.replace(/^${escapeRegex(modifierArg)}.*?/, "")}`;

    case "%":
      // ${VAR%pattern} - remove shortest suffix
      return `\${${param}.replace(/${escapeRegex(modifierArg)}$/, "")}`;

    case "%%":
      // ${VAR%%pattern} - remove longest suffix
      return `\${${param}.replace(/.*?${escapeRegex(modifierArg)}$/, "")}`;

    case "^":
      // ${VAR^} - uppercase first char
      return `\${${param}.charAt(0).toUpperCase() + ${param}.slice(1)}`;

    case "^^":
      // ${VAR^^} - uppercase all
      return `\${${param}.toUpperCase()}`;

    case ",":
      // ${VAR,} - lowercase first char
      return `\${${param}.charAt(0).toLowerCase() + ${param}.slice(1)}`;

    case ",,":
      // ${VAR,,} - lowercase all
      return `\${${param}.toLowerCase()}`;

    case "/": {
      // ${VAR/pattern/replacement} - replace first
      // Find first unescaped / to split pattern from replacement
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${param}.replace("${escapeForQuotes(pattern)}", "${escapeForQuotes(replacement)}")}`;
    }

    case "//": {
      // ${VAR//pattern/replacement} - replace all
      // Find first unescaped / to split pattern from replacement
      const idx = findFirstUnescapedSlash(modifierArg);
      const pat = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const rep = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${param}.replaceAll("${escapeForQuotes(pat)}", "${escapeForQuotes(rep)}")}`;
    }

    case "/#": {
      // ${VAR/#pattern/replacement} - replace pattern only at start
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${param}.replace(/^${escapeRegex(pattern)}/, "${escapeForQuotes(replacement)}")}`;
    }

    case "/%": {
      // ${VAR/%pattern/replacement} - replace pattern only at end
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${param}.replace(/${escapeRegex(pattern)}$/, "${escapeForQuotes(replacement)}")}`;
    }

    default:
      // Unknown modifier, just use simple expansion
      return `\${${param}}`;
  }
}

// =============================================================================
// Command Substitution Handler
// =============================================================================

/**
 * Visit a CommandSubstitution node
 */
export function visitCommandSubstitution(
  cs: AST.CommandSubstitution,
  ctx: VisitorContext,
): string {
  // Collect inner statements
  const innerLines: string[] = [];

  for (const stmt of cs.command) {
    const result = ctx.visitStatement(stmt);
    // Strip indent from inner lines for inline use
    for (const line of result.lines) {
      innerLines.push(line.trim());
    }
  }

  // Build inline command substitution that captures stdout
  const innerCode = innerLines.join(" ").replace(/^await /, "").replace(/;$/, "");

  // Only strip trailing newlines, not all whitespace (Bash behavior)
  return `\${await (async () => { const __result = ${innerCode}; return (await __result.text()).replace(/\\n+$/, ""); })()}`;
}

// =============================================================================
// Arithmetic Expansion Handler
// =============================================================================

/**
 * Visit an ArithmeticExpansion node
 */
export function visitArithmeticExpansion(
  arith: AST.ArithmeticExpansion,
  ctx: VisitorContext,
): string {
  return `\${${ctx.visitArithmetic(arith.expression)}}`;
}

// =============================================================================
// Process Substitution Handler
// =============================================================================

/**
 * Visit a ProcessSubstitution node
 */
export function visitProcessSubstitution(
  ps: AST.ProcessSubstitution,
  ctx: VisitorContext,
): string {
  // Collect inner statements
  const innerLines: string[] = [];

  for (const stmt of ps.command) {
    const result = ctx.visitStatement(stmt);
    for (const line of result.lines) {
      innerLines.push(line.trim());
    }
  }

  const innerCode = innerLines.join(" ").replace(/^await /, "").replace(/;$/, "");

  if (ps.operator === "<(") {
    // Input process substitution: command writes to temp file, return path
    return `\${await (async () => { const __tmpFile = await Deno.makeTempFile(); const __cmd = ${innerCode}; await Deno.writeTextFile(__tmpFile, await __cmd.text()); return __tmpFile; })()}`;
  } else {
    // Output process substitution >(cmd) - starts background process
    return `\${await (async () => {
      const __tmpFile = await Deno.makeTempFile();
      // Background: read from tmpFile and pipe to command
      (async () => {
        await new Promise(r => setTimeout(r, 100));  // Let parent write first
        const __content = await Deno.readTextFile(__tmpFile);
        ${innerCode}.stdin(__content);
      })();
      return __tmpFile;
    })()}`;
  }
}
