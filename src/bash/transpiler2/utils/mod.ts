/**
 * Utilities Module
 *
 * Re-exports all utility functions.
 */

export {
  escapeForTemplate,
  escapeForQuotes,
  escapeForSingleQuotes,
  escapeRegex,
  globToRegex,
  sanitizeVarName,
} from "./escape.ts";

export {
  parseCountArg,
  collectFlagOptions,
  collectFlagOptionsAndFiles,
} from "./command-args.ts";
