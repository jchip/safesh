/**
 * jq - JSON Query Command
 *
 * Command-line JSON processor for querying and manipulating JSON data.
 *
 * @module
 */

// Export main command interface
export {
  jq,
  jqExec,
  jqTransform,
  jqLines,
  type JqOptions,
  type JqResult,
} from "./jq.ts";

// Export query engine
export {
  executeQuery,
  parseQuery,
  type JsonValue,
  type QueryResult,
} from "./query-engine.ts";

// Default export
export { default } from "./jq.ts";
