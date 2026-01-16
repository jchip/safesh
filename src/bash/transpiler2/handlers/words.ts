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

/**
 * Detect and expand brace patterns like {a,b,c} or {1..10}
 * Returns array of expanded strings or null if not a brace pattern
 */
function expandBraces(s: string): string[] | null {
  // Check for simple comma-separated braces: {a,b,c}
  const commaMatch = s.match(/^\{([^{}]+(?:,[^{}]+)+)\}$/);
  if (commaMatch && commaMatch[1]) {
    return commaMatch[1].split(',');
  }

  // Check for range braces: {start..end} or {start..end..step}
  const rangeMatch = s.match(/^\{(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?\}$/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const start = parseInt(rangeMatch[1]);
    const end = parseInt(rangeMatch[2]);
    // Auto-detect direction if step not provided
    const step = rangeMatch[3] ? parseInt(rangeMatch[3]) : (start <= end ? 1 : -1);

    if (step === 0) return null; // Invalid step

    const result: string[] = [];
    if (step > 0) {
      for (let i = start; i <= end; i += step) {
        result.push(i.toString());
      }
    } else {
      for (let i = start; i >= end; i += step) {
        result.push(i.toString());
      }
    }
    return result;
  }

  // Check for character range: {a..z}
  const charRangeMatch = s.match(/^\{([a-zA-Z])\.\.([a-zA-Z])\}$/);
  if (charRangeMatch && charRangeMatch[1] && charRangeMatch[2]) {
    const start = charRangeMatch[1].charCodeAt(0);
    const end = charRangeMatch[2].charCodeAt(0);
    const result: string[] = [];

    if (start <= end) {
      for (let i = start; i <= end; i++) {
        result.push(String.fromCharCode(i));
      }
    } else {
      for (let i = start; i >= end; i--) {
        result.push(String.fromCharCode(i));
      }
    }
    return result;
  }

  return null;
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
      return visitLiteralPart(part, ctx);
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
// Literal Part Handler (with Tilde and Brace Expansion)
// =============================================================================

/**
 * Visit a LiteralPart node with support for tilde and brace expansion
 */
export function visitLiteralPart(part: AST.LiteralPart, ctx: VisitorContext): string {
  let value = part.value;

  // SSH-301: Tilde Expansion
  // Handle ~ or ~/path at the start of the literal
  if (value === "~" || value.startsWith("~/")) {
    const rest = value.slice(1); // Remove the ~
    return `\${Deno.env.get("HOME") || "~"}${escapeForTemplate(rest)}`;
  }

  // Handle ~user form (basic support - just pass through for now)
  // Full ~user expansion would require runtime user lookup
  if (value.startsWith("~") && value.length > 1 && value[1] !== "/") {
    // For now, we don't expand ~user - would need getpwnam() equivalent
    return escapeForTemplate(value);
  }

  // SSH-302: Brace Expansion
  // Check if the entire literal is a brace pattern
  const braceExpansion = expandBraces(value);
  if (braceExpansion) {
    // Static expansion at transpile time
    return braceExpansion.map(s => escapeForTemplate(s)).join(" ");
  }

  // Check for braces embedded in the string (e.g., "file{1,2,3}.txt")
  const braceMatch = value.match(/^([^{]*)\{([^{}]+)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, braceContent, suffix] = braceMatch;
    const expanded = expandBraces(`{${braceContent}}`);
    if (expanded) {
      // Expand and concatenate with prefix/suffix
      return expanded
        .map(s => escapeForTemplate(prefix + s + suffix))
        .join(" ");
    }
  }

  // No special expansion needed
  return escapeForTemplate(value);
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
  const subscript = expansion.subscript;
  const indirection = expansion.indirection;

  // SSH-330: Handle indirect variable reference ${!ref}
  // The parser prefixes the parameter name with '!' for indirection
  // BUT: Special variable $! (last background PID) should be treated as-is
  if (param.startsWith("!") && param !== "!") {
    const refVar = param.slice(1); // Remove the '!' prefix

    // SSH-303: Handle array indirection ${!arr[@]} for array indices
    if (subscript) {
      if (subscript === "@" || subscript === "*") {
        // ${!arr[@]} - get array indices/keys
        return `\${Object.keys(${refVar}).join(" ")}`;
      }
    }

    // Simple indirect reference: ${!ref}
    // Evaluate the reference variable, then use its value as a variable name
    // We use eval() because variables are in function scope, not globalThis
    return `\${eval(${refVar})}`;
  }

  // SSH-303: Handle array indirection ${!arr[@]} for array indices (legacy check)
  if (indirection && subscript) {
    if (subscript === "@" || subscript === "*") {
      // ${!arr[@]} - get array indices/keys
      return `\${Object.keys(${param}).join(" ")}`;
    }
  }

  // SSH-303: Handle array subscripts
  if (subscript !== undefined) {
    if (subscript === "@" || subscript === "*") {
      // ${arr[@]} or ${arr[*]} - all elements
      // In bash, @ and * differ in quoting behavior, but we'll treat them similarly
      // Array should be joined with space
      return `\${Array.isArray(${param}) ? ${param}.join(" ") : ${param}}`;
    } else {
      // ${arr[0]} - specific index
      return `\${${param}[${subscript}]}`;
    }
  }

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
      // SSH-303: Handle array length ${#arr[@]}
      if (subscript === "@" || subscript === "*") {
        return `\${Array.isArray(${param}) ? ${param}.length : 0}`;
      }
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
      // Unknown modifier, emit warning and use simple expansion
      ctx.addDiagnostic({ level: 'warning', message: `Unsupported parameter modifier: ${modifier}` });
      return `\${${param}}`;
  }
}

// =============================================================================
// Command Substitution Handler
// =============================================================================

/**
 * Visit a CommandSubstitution node
 *
 * Command substitution $(...) captures stdout from inner commands.
 * SSH-360: Uses __cmdSubText helper (defined in preamble) to handle multiple result types:
 * - Command objects with .text() method
 * - FluentStream/FluentShell with .collect() method
 * - undefined/null from variable assignments
 * - String results
 */
export function visitCommandSubstitution(
  cs: AST.CommandSubstitution,
  ctx: VisitorContext,
): string {
  // For command substitution, we need the raw command expression (not wrapped in __printCmd)
  // Build the inner command expression directly
  const innerExprs: string[] = [];

  for (const stmt of cs.command) {
    // For simple commands/pipelines, get the expression directly
    // For other statements, fall back to visitStatement
    if (stmt.type === "Command" || stmt.type === "Pipeline") {
      const expr = ctx.buildCommandExpression(stmt);
      innerExprs.push(expr.code);
    } else {
      // For complex statements (if, for, etc.), use visitStatement
      const result = ctx.visitStatement(stmt);
      for (const line of result.lines) {
        innerExprs.push(line.trim());
      }
    }
  }

  // Build inline command substitution that captures stdout
  const innerCode = innerExprs.join("; ").replace(/^await /, "").replace(/;$/, "");

  // Use __cmdSubText helper (defined in preamble) to extract text from result
  return `\${await __cmdSubText(${innerCode})}`;
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
