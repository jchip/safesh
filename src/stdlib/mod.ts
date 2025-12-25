/**
 * SafeShell standard library
 *
 * Provides shell-like utilities in a safe, sandboxed environment.
 *
 * @module
 */

// Re-export namespaced modules
export * as fs from "./fs.ts";
export * as text from "./text.ts";

// Re-export fluent shell API
export { default as $ } from "./shell.ts";
