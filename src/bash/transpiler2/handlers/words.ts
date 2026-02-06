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
  sanitizeVarName,
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
    // Single-quoted strings are completely literal - no escaping needed
    // They will be wrapped in double quotes by formatArg(), so we just need
    // to escape for double-quote context
    if (word.singleQuoted) {
      return escapeForQuotes(word.value);
    }

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

  // SSH-489: Sanitize variable names that collide with JS reserved words
  // Use sanitized name for JS identifiers, original param for $.ENV/$.VARS lookups
  const jsParam = sanitizeVarName(param);

  // Handle bash special variables first
  if (param === "!") {
    // $! - PID of last background process
    // Background commands spawn child processes and store their PID in __LAST_BG_PID
    return `\${__LAST_BG_PID || ""}`;
  }
  if (param === "?") {
    // $? - Exit status of last command
    // SafeShell uses exceptions instead of exit codes
    return "0"; // Default to success
  }
  if (param === "$") {
    // $$ - Current shell PID
    return `\${Deno.pid}`;
  }
  if (param === "0") {
    // $0 - Script name
    return `\${__SCRIPT_NAME__ || "safesh"}`;
  }
  if (param === "#") {
    // $# - Number of positional parameters
    return `\${__POSITIONAL_PARAMS__?.length || 0}`;
  }
  if (param === "@" || param === "*") {
    // $@ or $* - All positional parameters
    return `\${__POSITIONAL_PARAMS__?.join(" ") || ""}`;
  }
  if (/^\d+$/.test(param)) {
    // $1, $2, etc - Positional parameters
    return `\${__POSITIONAL_PARAMS__?.[${parseInt(param) - 1}] || ""}`;
  }

  // SSH-330: Handle indirect variable reference ${!ref}
  // The parser prefixes the parameter name with '!' for indirection
  if (param.startsWith("!")) {
    let refVar = param.slice(1); // Remove the '!' prefix

    // SSH-303: Handle array indirection ${!arr[@]} for array indices
    // The parser may embed the subscript in the parameter name (e.g., "!arr[@]")
    // so we need to check both the separate subscript field and the embedded form
    let effectiveSubscript = subscript;
    const bracketIdx = refVar.indexOf("[");
    if (bracketIdx !== -1) {
      effectiveSubscript = refVar.slice(bracketIdx + 1, -1); // extract e.g. "@" from "arr[@]"
      refVar = refVar.slice(0, bracketIdx); // extract e.g. "arr" from "arr[@]"
    }

    if (effectiveSubscript === "@" || effectiveSubscript === "*") {
      // ${!arr[@]} - get array indices/keys
      return `\${Object.keys(${refVar}).join(" ")}`;
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
    // SSH-484: Variable lookup order: local JS var > $.ENV (env vars) > $.VARS (shell vars)
    // SSH-489: Use sanitized name for JS identifiers, original for ENV/VARS property access
    return `\${typeof ${jsParam} !== "undefined" ? ${jsParam} : ($.ENV.${param} ?? $.VARS?.${param} ?? "")}`;
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
        return `\${Array.isArray(${jsParam}) ? ${jsParam}.length : 0}`;
      }
      return `\${${jsParam}.length}`;

    case ":-":
      // ${VAR:-default} - use default if unset OR empty
      return `\${(${jsParam} === undefined || ${jsParam} === "") ? "${escapeForQuotes(modifierArg)}" : ${jsParam}}`;

    case "-":
      // ${VAR-default} - use default only if unset
      return `\${${jsParam} !== undefined ? ${jsParam} : "${escapeForQuotes(modifierArg)}"}`;

    case ":=":
    case "=":
      // ${VAR:=default} - assign default if unset
      return `\${${jsParam} ??= "${escapeForQuotes(modifierArg)}"}`;

    case ":?":
    case "?":
      // ${VAR:?error} - error if unset
      return `\${${jsParam} ?? (() => { throw new Error("${escapeForQuotes(modifierArg)}"); })()}`;

    case ":+":
    case "+":
      // ${VAR:+alternate} - use alternate if set
      return `\${${jsParam} ? "${escapeForQuotes(modifierArg)}" : ""}`;

    case "#":
      // ${VAR#pattern} - remove shortest prefix
      return `\${${jsParam}.replace(/^${escapeRegex(modifierArg)}/, "")}`;

    case "##":
      // ${VAR##pattern} - remove longest prefix
      return `\${${jsParam}.replace(/^${escapeRegex(modifierArg)}.*?/, "")}`;

    case "%":
      // ${VAR%pattern} - remove shortest suffix
      return `\${${jsParam}.replace(/${escapeRegex(modifierArg)}$/, "")}`;

    case "%%":
      // ${VAR%%pattern} - remove longest suffix
      return `\${${jsParam}.replace(/.*?${escapeRegex(modifierArg)}$/, "")}`;

    case "^":
      // ${VAR^} - uppercase first char
      return `\${${jsParam}.charAt(0).toUpperCase() + ${jsParam}.slice(1)}`;

    case "^^":
      // ${VAR^^} - uppercase all
      return `\${${jsParam}.toUpperCase()}`;

    case ",":
      // ${VAR,} - lowercase first char
      return `\${${jsParam}.charAt(0).toLowerCase() + ${jsParam}.slice(1)}`;

    case ",,":
      // ${VAR,,} - lowercase all
      return `\${${jsParam}.toLowerCase()}`;

    case "/": {
      // ${VAR/pattern/replacement} - replace first
      // Find first unescaped / to split pattern from replacement
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${jsParam}.replace("${escapeForQuotes(pattern)}", "${escapeForQuotes(replacement)}")}`;
    }

    case "//": {
      // ${VAR//pattern/replacement} - replace all
      // Find first unescaped / to split pattern from replacement
      const idx = findFirstUnescapedSlash(modifierArg);
      const pat = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const rep = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${jsParam}.replaceAll("${escapeForQuotes(pat)}", "${escapeForQuotes(rep)}")}`;
    }

    case "substring": {
      // ${VAR:offset} or ${VAR:offset:length}
      // modifierArg contains "offset" or "offset:length"
      const colonIdx = modifierArg.indexOf(":");
      const offset = colonIdx >= 0 ? modifierArg.slice(0, colonIdx).trim() : modifierArg.trim();
      const length = colonIdx >= 0 ? modifierArg.slice(colonIdx + 1).trim() : undefined;
      // SSH-489: Use jsParam for local var, original param for ENV/VARS
      const varExpr = `(typeof ${jsParam} !== "undefined" ? String(${jsParam}) : ($.ENV.${param} ?? $.VARS?.${param} ?? ""))`;
      if (length !== undefined) {
        // Negative length means "remove last N chars" in bash
        if (length.startsWith("-")) {
          return `\${${varExpr}.slice(${offset}, ${length})}`;
        }
        return `\${${varExpr}.slice(${offset}, Number(${offset}) + Number(${length}))}`;
      }
      return `\${${varExpr}.slice(${offset})}`;
    }

    case "/#": {
      // ${VAR/#pattern/replacement} - replace pattern only at start
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${jsParam}.replace(/^${escapeRegex(pattern)}/, "${escapeForQuotes(replacement)}")}`;
    }

    case "/%": {
      // ${VAR/%pattern/replacement} - replace pattern only at end
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${jsParam}.replace(/${escapeRegex(pattern)}$/, "${escapeForQuotes(replacement)}")}`;
    }

    default:
      // Unknown modifier, emit warning and use simple expansion
      ctx.addDiagnostic({ level: 'warning', message: `Unsupported parameter modifier: ${modifier}` });
      return `\${${jsParam}}`;
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
