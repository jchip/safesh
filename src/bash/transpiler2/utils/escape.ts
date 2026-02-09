/**
 * String Escaping Utilities
 *
 * Functions for safely escaping strings in generated TypeScript code.
 */

/**
 * Options for escaping strings
 */
export interface EscapeOptions {
  /** Quote style to escape for: 'single', 'double', or 'template' */
  quotes?: "single" | "double" | "template";
  /** Whether to escape newlines (default: false) */
  escapeNewlines?: boolean;
  /** Whether to escape backslashes (default: true) */
  escapeBackslashes?: boolean;
}

/**
 * Base string escape function with configurable options.
 *
 * This function provides a flexible way to escape strings for various contexts
 * in generated TypeScript code. All specialized escape functions use this
 * internally for consistency.
 *
 * @param str - The string to escape
 * @param options - Escape options
 * @returns The escaped string
 */
export function escapeString(
  str: string,
  options: EscapeOptions = {},
): string {
  let result = str;

  // Escape backslashes first (most common case)
  if (options.escapeBackslashes !== false) {
    result = result.replace(/\\/g, "\\\\");
  }

  // Escape quotes based on style
  switch (options.quotes) {
    case "single":
      result = result.replace(/'/g, "\\'");
      break;
    case "double":
      result = result.replace(/"/g, '\\"');
      break;
    case "template":
      // Single-pass: match ${ (template interpolation), ` (backtick), or lone $ in one regex.
      // Avoids multi-pass interaction where earlier replacements could affect later ones.
      result = result.replace(/\$\{|`|\$/g, (match) => {
        if (match === "${") return "\\\\${";
        if (match === "`") return "\\`";
        return "\\$"; // lone $
      });
      break;
  }

  // Escape newlines and special whitespace if requested
  if (options.escapeNewlines) {
    result = result
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  return result;
}

/**
 * Escape a string for safe inclusion in template literals.
 * Prevents injection attacks by escaping backticks, backslashes, and ${
 */
export function escapeForTemplate(str: string): string {
  return escapeString(str, { quotes: "template" });
}

/**
 * Escape a string for safe inclusion in double-quoted strings.
 * Used for redirect targets and variable values.
 */
export function escapeForQuotes(str: string): string {
  return escapeString(str, { quotes: "double", escapeNewlines: true });
}

/**
 * Escape a string for safe inclusion in single-quoted strings.
 * Used when generating string literals.
 */
export function escapeForSingleQuotes(str: string): string {
  return escapeString(str, { quotes: "single" });
}

/**
 * Escape a string for use in a regular expression.
 * Makes special regex characters literal.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * SSH-489: JavaScript reserved words that cannot be used as variable names.
 * When a bash variable name collides with one of these, prefix with __ to avoid syntax errors.
 */
const JS_RESERVED_WORDS = new Set([
  // ECMAScript reserved words
  "break", "case", "catch", "continue", "debugger", "default", "delete",
  "do", "else", "finally", "for", "function", "if", "in", "instanceof",
  "new", "return", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with",
  // Strict mode reserved words
  "class", "const", "enum", "export", "extends", "import", "super",
  // Future reserved in strict mode
  "implements", "interface", "let", "package", "private", "protected",
  "public", "static", "yield",
  // Contextual keywords that cause issues
  "await", "async",
]);

/**
 * SSH-489: Sanitize a bash variable name for use as a JavaScript identifier.
 * Prefixes JS reserved words with __ to prevent syntax errors.
 */
export function sanitizeVarName(name: string): string {
  if (JS_RESERVED_WORDS.has(name)) {
    return `__${name}`;
  }
  return name;
}

/**
 * Convert a glob pattern to a JavaScript regex pattern.
 * Handles *, ?, and character classes.
 */
export function globToRegex(pattern: string): string {
  let regex = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    switch (char) {
      case "*":
        // ** matches anything including /
        if (pattern[i + 1] === "*") {
          regex += ".*";
          i += 2;
        } else {
          // * matches anything except /
          regex += "[^/]*";
          i++;
        }
        break;

      case "?":
        regex += "[^/]";
        i++;
        break;

      case "[":
        // Character class - find the closing ]
        const start = i;
        i++;
        if (pattern[i] === "!" || pattern[i] === "^") {
          i++;
        }
        while (i < pattern.length && pattern[i] !== "]") {
          i++;
        }
        regex += pattern.slice(start, i + 1).replace("!", "^");
        i++;
        break;

      case "\\":
        // Escape sequence
        regex += "\\";
        i++;
        if (i < pattern.length) {
          regex += pattern[i];
          i++;
        }
        break;

      // Regex special characters that need escaping
      case ".":
      case "+":
      case "^":
      case "$":
      case "{":
      case "}":
      case "(":
      case ")":
      case "|":
        regex += "\\" + char;
        i++;
        break;

      default:
        regex += char;
        i++;
    }
  }

  return regex;
}
