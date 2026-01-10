/**
 * AWK Interpreter Module
 *
 * Re-exports the public API for the AWK interpreter.
 */

export {
  type AwkRuntimeContext,
  type CreateContextOptions,
  createRuntimeContext,
} from "./context.ts";
export { AwkInterpreter } from "./interpreter.ts";
export type { AwkFileSystem, AwkValue } from "./types.ts";
export { ExecutionLimitError } from "./expressions.ts";
