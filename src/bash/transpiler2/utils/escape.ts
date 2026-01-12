/**
 * String Escaping Utilities
 *
 * Functions for safely escaping strings in generated TypeScript code.
 */

/**
 * Escape a string for safe inclusion in template literals.
 * Prevents injection attacks by escaping backticks, backslashes, and ${
 */
export function escapeForTemplate(str: string): string {
  return str
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/`/g, "\\`") // Escape backticks
    .replace(/\$\{/g, "\\${") // Escape template literal interpolation
    .replace(/\$/g, "\\$"); // Escape dollar signs
}

/**
 * Escape a string for safe inclusion in double-quoted strings.
 * Used for redirect targets and variable values.
 */
export function escapeForQuotes(str: string): string {
  return str
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\r/g, "\\r") // Escape carriage returns
    .replace(/\t/g, "\\t"); // Escape tabs
}

/**
 * Escape a string for use in a regular expression.
 * Makes special regex characters literal.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape a string for safe inclusion in single-quoted strings.
 * Used when generating string literals.
 */
export function escapeForSingleQuotes(str: string): string {
  return str
    .replace(/\\/g, "\\\\") // Escape backslashes first
    .replace(/'/g, "\\'"); // Escape single quotes
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
