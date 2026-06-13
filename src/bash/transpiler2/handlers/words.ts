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
    if (s[i] === "\\" && i + 1 < s.length) {
      i++; // Skip escaped char
    } else if (s[i] === "/") {
      return i;
    }
  }
  return -1;
}

function shellVarProperty(param: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param) ? `.${param}` : `[${JSON.stringify(param)}]`;
}

function shellVarOptionalProperty(param: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param) ? `?.${param}` : `?.[${JSON.stringify(param)}]`;
}

function shellVarValueExpression(param: string, jsParam: string): string {
  const prop = shellVarProperty(param);
  return `(typeof ${jsParam} !== "undefined" ? ${jsParam} : ($.ENV${prop} ?? $.VARS${
    shellVarOptionalProperty(param)
  } ?? ""))`;
}

/**
 * SSH-624: Translate a bash glob pattern (as used by ${v#pat}, ${v##pat},
 * ${v%pat}, ${v%%pat} and the pattern side of ${v/pat/repl}, ${v//pat/repl})
 * into a JS regex source. Unlike escapeRegex (which makes EVERYTHING literal,
 * turning the glob `*` into `\*`), this keeps glob metacharacters meaningful:
 *   - `*`  -> `.*`  (greedy for longest-match ##/%%) or `.*?` (non-greedy for #/%)
 *   - `?`  -> `.`
 *   - `[...]` -> regex char class; `[!...]` -> `[^...]`
 *   - genuine regex metachars that are NOT glob metachars are escaped
 *     (`.` `(` `)` `+` `{` `}` `|` `^` `$` `\`)
 * Plain characters (letters, spaces, `-`, etc.) pass through verbatim so that
 * non-glob literal patterns transpile to the same regex as before. Embedded
 * `${...}` template-interpolation sequences (produced when the pattern itself
 * contains a variable expansion) are copied through untouched.
 */
function globToParamRegex(pattern: string, greedyStar: boolean): string {
  const star = greedyStar ? ".*" : ".*?";
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];

    // Preserve embedded ${...} template interpolation verbatim — it is runtime
    // JS (a nested variable expansion), not part of the glob to translate.
    if (ch === "$" && pattern[i + 1] === "{") {
      let depth = 0;
      const start = i;
      while (i < pattern.length) {
        if (pattern[i] === "{") depth++;
        else if (pattern[i] === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      out += pattern.slice(start, i);
      continue;
    }

    switch (ch) {
      case "*":
        out += star;
        i++;
        break;
      case "?":
        out += ".";
        i++;
        break;
      case "[": {
        // Bracket expression -> regex char class. `[!...]` negates as `[^...]`.
        const start = i;
        i++;
        let neg = false;
        if (pattern[i] === "!" || pattern[i] === "^") {
          neg = true;
          i++;
        }
        // A `]` immediately after the (optional) negation is a literal member.
        if (pattern[i] === "]") i++;
        while (i < pattern.length && pattern[i] !== "]") i++;
        if (i >= pattern.length) {
          // Unterminated `[` — treat the bracket as a literal character.
          out += "\\[";
          i = start + 1;
        } else {
          const body = pattern.slice(start + 1 + (neg ? 1 : 0), i);
          out += "[" + (neg ? "^" : "") + body + "]";
          i++; // consume the closing `]`
        }
        break;
      }
      case "\\": {
        // Backslash escapes the next glob char; emit it as a literal, adding a
        // regex escape when that char needs one inside a /.../ literal (regex
        // metacharacter or the `/` delimiter).
        i++;
        const next = pattern[i];
        if (next !== undefined) {
          out += /[.*+?^${}()|[\]\\/]/.test(next) ? "\\" + next : next;
          i++;
        } else {
          out += "\\\\";
        }
        break;
      }
      // Regex metacharacters that are NOT glob metacharacters -> escape. `/` is
      // also escaped because the regex is emitted as a /.../ literal and a bare
      // slash would terminate it early.
      case ".":
      case "(":
      case ")":
      case "+":
      case "{":
      case "}":
      case "|":
      case "^":
      case "$":
      case "/":
        out += "\\" + ch;
        i++;
        break;
      default:
        out += ch;
        i++;
    }
  }
  return out;
}

function shellVarDefinedExpression(param: string, jsParam: string): string {
  const prop = shellVarProperty(param);
  return `(typeof ${jsParam} !== "undefined" || $.ENV${prop} !== undefined || $.VARS${
    shellVarOptionalProperty(param)
  } !== undefined)`;
}

/**
 * Assignment sink for ${VAR:=default} / ${VAR=default} (SSH-610): assign the
 * local JS var when one exists, otherwise persist via $.VARS so later reads
 * and the state trailer observe it. A bare-identifier assignment (`VAR ??=`)
 * throws for undeclared names under the preamble's "use strict".
 */
function shellVarAssignExpression(
  param: string,
  jsParam: string,
  valueExpr: string,
): string {
  const prop = shellVarProperty(param);
  return `(typeof ${jsParam} !== "undefined" ? (${jsParam} = ${valueExpr}) : ($.VARS ??= {}, $.VARS${prop} = ${valueExpr}))`;
}

function buildCapturableInnerCode(
  statements: AST.Statement[],
  ctx: VisitorContext,
): string {
  const innerExprs: string[] = [];

  for (const stmt of statements) {
    if (stmt.type === "Command") {
      const expr = ctx.buildCommand(stmt, { captureOutput: true });
      innerExprs.push(expr.code);
    } else if (
      stmt.type === "Pipeline" &&
      stmt.commands.length === 1 &&
      stmt.commands[0]?.type === "Command" &&
      !stmt.background &&
      // SSH-604: `$(! cmd)` — unwrapping to buildCommand drops the negation;
      // fall through to buildCommandExpression → buildPipeline, which applies
      // the exit-status flip (SSH-594).
      !stmt.negated
    ) {
      const expr = ctx.buildCommand(stmt.commands[0], { captureOutput: true });
      innerExprs.push(expr.code);
    } else if (stmt.type === "Pipeline") {
      const expr = ctx.buildCommandExpression(stmt);
      innerExprs.push(expr.code);
    } else {
      const result = ctx.visitStatement(stmt);
      for (const line of result.lines) {
        innerExprs.push(line.trim());
      }
    }
  }

  return innerExprs.join("; ").replace(/^await /, "").replace(/;$/, "");
}

/**
 * Detect and expand brace patterns like {a,b,c} or {1..10}
 * Returns array of expanded strings or null if not a brace pattern
 */
function expandBraces(s: string): string[] | null {
  // Check for simple comma-separated braces: {a,b,c}
  const commaMatch = s.match(/^\{([^{}]+(?:,[^{}]+)+)\}$/);
  if (commaMatch && commaMatch[1]) {
    return commaMatch[1].split(",");
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

function removeShellQuoteSyntax(value: string): string {
  let result = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        result += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    result += char;
  }

  return escaped ? `${result}\\` : result;
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
    // Single-quoted strings are completely literal. Return the raw value so
    // downstream emitters can escape once for their target context.
    if (word.singleQuoted) {
      return word.value;
    }

    // Build from parts if they contain expansions
    if (word.parts.length > 0) {
      return word.parts.map((part) => visitWordPart(part, ctx, word.quoted)).join("");
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
export function visitWordPart(
  part: AST.WordPart,
  ctx: VisitorContext,
  quoted = false,
): string {
  switch (part.type) {
    case "LiteralPart":
      return visitLiteralPart(part, ctx, quoted);
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
export function visitLiteralPart(
  part: AST.LiteralPart,
  ctx: VisitorContext,
  quoted = false,
): string {
  let value = part.value;

  if (quoted) {
    return escapeForTemplate(value);
  }

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
    return braceExpansion.map((s) => escapeForTemplate(s)).join(" ");
  }

  // Check for braces embedded in the string (e.g., "file{1,2,3}.txt")
  const braceMatch = value.match(/^([^{]*)\{([^{}]+)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, braceContent, suffix] = braceMatch;
    const expanded = expandBraces(`{${braceContent}}`);
    if (expanded) {
      // Expand and concatenate with prefix/suffix
      return expanded
        .map((s) => escapeForTemplate(prefix + s + suffix))
        .join(" ");
    }
  }

  // No special expansion needed
  return escapeForTemplate(removeShellQuoteSyntax(value));
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
    // $? - exit status of the last command, recorded as Deno.exitCode (SSH-581)
    return `\${Deno.exitCode}`;
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
  const embeddedSubscript = param.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/);
  if (embeddedSubscript && !modifier) {
    const arrayName = embeddedSubscript[1]!;
    const arrayIndex = embeddedSubscript[2]!;
    if (arrayName !== "PIPESTATUS") {
      return `\${typeof ${param} !== "undefined" ? ${param} : ($.ENV.${param} ?? $.VARS?.${param} ?? "")}`;
    }
    const jsArrayName = sanitizeVarName(arrayName);
    if (arrayIndex === "@" || arrayIndex === "*") {
      return `\${Array.isArray(${jsArrayName}) ? ${jsArrayName}.join(" ") : ($.VARS?.${arrayName} ?? []).join?.(" ") ?? ""}`;
    }
    return `\${(typeof ${jsArrayName} !== "undefined" ? ${jsArrayName}?.[${arrayIndex}] : $.VARS?.${arrayName}?.[${arrayIndex}]) ?? ""}`;
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
  const varExpr = shellVarValueExpression(param, jsParam);
  const varDefinedExpr = shellVarDefinedExpression(param, jsParam);

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
      return `\${${varExpr} === "" ? "${escapeForQuotes(modifierArg)}" : ${varExpr}}`;

    case "-":
      // ${VAR-default} - use default only if unset
      return `\${${varDefinedExpr} ? ${varExpr} : "${escapeForQuotes(modifierArg)}"}`;

    case ":=":
      // ${VAR:=default} - assign default if unset OR empty (bash :=
      // semantics), then expand to the resulting value (SSH-610)
      return `\${${varExpr} === "" ? ${
        shellVarAssignExpression(param, jsParam, `"${escapeForQuotes(modifierArg)}"`)
      } : ${varExpr}}`;

    case "=":
      // ${VAR=default} - assign default only if unset (SSH-610)
      return `\${${varDefinedExpr} ? ${varExpr} : ${
        shellVarAssignExpression(param, jsParam, `"${escapeForQuotes(modifierArg)}"`)
      }}`;

    case ":?":
    case "?":
      // ${VAR:?error} - error when unset OR empty (bash :? semantics). SSH-625:
      // consult ENV/VARS via the guarded accessor instead of referencing the
      // bare (possibly-undeclared) binding, which throws ReferenceError under
      // the preamble's "use strict".
      return `\${${varExpr} === "" ? (() => { throw new Error("${
        escapeForQuotes(modifierArg)
      }"); })() : ${varExpr}}`;

    case ":+":
    case "+":
      // ${VAR:+alternate} - use alternate if set. SSH-625: guard the reference
      // through varExpr so an unset variable yields "" instead of throwing a
      // ReferenceError for the undeclared binding.
      return `\${${varExpr} ? "${escapeForQuotes(modifierArg)}" : ""}`;

    case "#":
      // ${VAR#pattern} - remove shortest matching prefix. SSH-624: translate the
      // bash glob to a regex (a glob `*` becomes the non-greedy `.*?` so the
      // shortest prefix is stripped); SSH-625: read via the guarded accessor.
      return `\${${varExpr}.replace(/^${globToParamRegex(modifierArg, false)}/, "")}`;

    case "##":
      // ${VAR##pattern} - remove longest matching prefix. SSH-624: a glob `*`
      // becomes the greedy `.*` so the longest prefix is stripped. (No blanket
      // trailing `.*` is appended — that over-matched literal patterns, e.g.
      // ${v##prefix} would have wiped the whole string.)
      return `\${${varExpr}.replace(/^${globToParamRegex(modifierArg, true)}/, "")}`;

    case "%":
      // ${VAR%pattern} - remove shortest matching suffix. SSH-624: the pattern
      // is anchored at end via a leading greedy capture `(.*)` so the SHORTEST
      // (right-most) suffix is removed; String.replace alone is left-most, which
      // would over-strip (e.g. ${f%.*} on a.tar.gz must yield a.tar, not a).
      return `\${${varExpr}.replace(/(.*)${globToParamRegex(modifierArg, false)}$/, "$1")}`;

    case "%%":
      // ${VAR%%pattern} - remove longest matching suffix. SSH-624: a leading
      // non-greedy capture `(.*?)` makes the LONGEST suffix match (the kept
      // prefix is as short as possible).
      return `\${${varExpr}.replace(/(.*?)${globToParamRegex(modifierArg, true)}$/, "$1")}`;

    case "^":
      // ${VAR^} - uppercase first char. SSH-625: guarded accessor so an unset
      // variable yields "" rather than a ReferenceError on the bare binding.
      return `\${(${varExpr}).charAt(0).toUpperCase() + (${varExpr}).slice(1)}`;

    case "^^":
      // ${VAR^^} - uppercase all
      return `\${(${varExpr}).toUpperCase()}`;

    case ",":
      // ${VAR,} - lowercase first char
      return `\${(${varExpr}).charAt(0).toLowerCase() + (${varExpr}).slice(1)}`;

    case ",,":
      // ${VAR,,} - lowercase all
      return `\${(${varExpr}).toLowerCase()}`;

    case "/": {
      // ${VAR/pattern/replacement} - replace first match. SSH-624: the pattern
      // is a glob, so translate it to a regex (bash matches greedily here, e.g.
      // ${s/l*/L} on "hello" yields "heL"); SSH-625: read via guarded accessor.
      // Find first unescaped / to split pattern from replacement.
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${varExpr}.replace(/${globToParamRegex(pattern, true)}/, "${
        escapeForQuotes(replacement)
      }")}`;
    }

    case "//": {
      // ${VAR//pattern/replacement} - replace all matches (global regex).
      // SSH-624: glob pattern -> regex; SSH-625: guarded accessor.
      // Find first unescaped / to split pattern from replacement.
      const idx = findFirstUnescapedSlash(modifierArg);
      const pat = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const rep = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${varExpr}.replace(/${globToParamRegex(pat, true)}/g, "${
        escapeForQuotes(rep)
      }")}`;
    }

    case "substring": {
      // ${VAR:offset} or ${VAR:offset:length}
      // modifierArg contains "offset" or "offset:length"
      const colonIdx = modifierArg.indexOf(":");
      const offset = colonIdx >= 0 ? modifierArg.slice(0, colonIdx).trim() : modifierArg.trim();
      const length = colonIdx >= 0 ? modifierArg.slice(colonIdx + 1).trim() : undefined;
      // SSH-489: Use jsParam for local var, original param for ENV/VARS
      const varExpr =
        `(typeof ${jsParam} !== "undefined" ? String(${jsParam}) : ($.ENV.${param} ?? $.VARS?.${param} ?? ""))`;
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
      return `\${${jsParam}.replace(/^${escapeRegex(pattern)}/, "${
        escapeForQuotes(replacement)
      }")}`;
    }

    case "/%": {
      // ${VAR/%pattern/replacement} - replace pattern only at end
      const idx = findFirstUnescapedSlash(modifierArg);
      const pattern = idx >= 0 ? modifierArg.slice(0, idx) : modifierArg;
      const replacement = idx >= 0 ? modifierArg.slice(idx + 1) : "";
      return `\${${jsParam}.replace(/${escapeRegex(pattern)}$/, "${
        escapeForQuotes(replacement)
      }")}`;
    }

    default:
      // Unknown modifier, emit warning and use simple expansion
      ctx.addDiagnostic({
        level: "warning",
        message: `Unsupported parameter modifier: ${modifier}`,
      });
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
  // SSH-613: a $(...) runs in a subshell, so `exit N` inside it must only end
  // the substitution (with $? = N), not Deno.exit the whole script. Enter
  // subshell scope so `exit` lowers to the SSH-584 sentinel throw rather than
  // Deno.exit (isInSubshell() is read only by the exit lowering).
  ctx.enterSubshell();
  const innerCode = buildCapturableInnerCode(cs.command, ctx);
  ctx.exitSubshell();

  // Only when the body can actually throw the sentinel do we wrap the boundary
  // to convert it into the substitution's status ($? = N) and the text captured
  // before the exit — keeping the common no-exit case byte-identical.
  if (innerCode.includes("__sshSubshellExit")) {
    return `\${await (async () => { try { return await __cmdSubText(${innerCode}); } ` +
      `catch (__e) { if (__e && typeof __e === "object" && "__sshSubshellExit" in __e) ` +
      `{ __recStatus((__e as { __sshSubshellExit: number }).__sshSubshellExit); return ""; } throw __e; } })()}`;
  }

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
  const innerCode = buildCapturableInnerCode(ps.command, ctx);

  if (ps.operator === "<(") {
    // Input process substitution: command writes to temp file, return path
    return `\${await (async () => { const __tmpFile = await Deno.makeTempFile({ dir: $.tempdir() }); const __result = await __captureCmd(${innerCode}); await Deno.writeTextFile(__tmpFile, __result.stdout ?? ""); return __tmpFile; })()}`;
  } else {
    // Output process substitution >(cmd) - starts background process
    // Uses Deno.watchFs to reliably wait for the parent to write the file
    // instead of an arbitrary setTimeout which is a race condition
    return `\${await (async () => {
      const __tmpFile = await Deno.makeTempFile({ dir: $.tempdir() });
      // Background: watch for file modification, then read and pipe to command
      (async () => {
        const __watcher = Deno.watchFs(__tmpFile);
        for await (const __evt of __watcher) {
          if (__evt.kind === "modify") { __watcher.close(); break; }
        }
        const __content = await Deno.readTextFile(__tmpFile);
        ${innerCode}.stdin(__content);
      })();
      return __tmpFile;
    })()}`;
  }
}
