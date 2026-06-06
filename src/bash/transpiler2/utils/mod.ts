/**
 * Utilities Module
 *
 * Re-exports all utility functions.
 */

export {
  escapeForQuotes,
  escapeForSingleQuotes,
  escapeForTemplate,
  escapeRegex,
  globToRegex,
  sanitizeVarName,
  templateEscapedToLiteral,
  templateEscapedToRegexSource,
} from "./escape.ts";

export {
  collectFlagOptions,
  collectFlagOptionsAndFiles,
  parseCountArg,
  parseTailCountArg,
} from "./command-args.ts";
