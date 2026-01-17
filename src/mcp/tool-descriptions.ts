/**
 * Tool descriptions for MCP server - minimized for token efficiency
 */

import { getApiDoc } from "../core/api-doc.ts";

/**
 * Creates the description for the 'run' tool.
 */
export function createRunToolDescription(_permSummary?: string): string {
  return `Execute JS/TS in sandboxed Deno - MCPU usage: infoc

Execution modes (use ONE):
- code: code string
- file: file content as code string
- module: import as .ts module

${getApiDoc()}`;
}

export const START_SHELL_DESCRIPTION = "";

export const UPDATE_SHELL_DESCRIPTION = "";

export const END_SHELL_DESCRIPTION = "Also stops background jobs";

export const LIST_SHELLS_DESCRIPTION = "";

export const LIST_SCRIPTS_DESCRIPTION = "";

export const GET_SCRIPT_OUTPUT_DESCRIPTION = "Incremental via 'since' offset";

export const KILL_SCRIPT_DESCRIPTION = "SIGTERM default, SIGKILL with force";

export const WAIT_SCRIPT_DESCRIPTION = "";

export const LIST_JOBS_DESCRIPTION = "";
