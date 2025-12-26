/**
 * Import map generation for import security policy
 *
 * Generates a Deno import map that enforces the three-tier import policy:
 * 1. Trusted imports (jsr:@std/*, safesh:*) - always allowed
 * 2. Allowed imports (user whitelist) - explicitly permitted
 * 3. Blocked imports (npm:*, http:*, https:*) - denied
 *
 * Blocked imports are redirected to a special blocking module that throws
 * an error with an AI-friendly message.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { ImportPolicy } from "./types.ts";
import { importError } from "./errors.ts";

const TEMP_DIR = "/tmp/safesh/import-policy";

/**
 * Deno import map structure
 */
interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

/**
 * Convert a glob-style pattern to a regex pattern
 * Examples:
 *   "npm:*" -> "^npm:.*"
 *   "jsr:@std/*" -> "^jsr:@std/.*"
 *   "https:*" -> "^https:.*"
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*"); // Convert * to .*
  return new RegExp(`^${escaped}`);
}

/**
 * Check if an import specifier matches any pattern in the list
 */
function matchesAnyPattern(specifier: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const regex = patternToRegex(pattern);
    return regex.test(specifier);
  });
}

/**
 * Generate import map from import policy
 *
 * Note: Import maps are primarily used for mapping safesh:* imports to actual paths.
 * Blocking is handled by validateImports() before execution, not via import maps.
 */
export async function generateImportMap(
  policy: ImportPolicy,
): Promise<string> {
  // Ensure temp directory exists
  await ensureDir(TEMP_DIR);

  const importMap: ImportMap = {
    imports: {},
  };

  // Future: Add mappings for safesh:* imports here
  // Example:
  // importMap.imports!["safesh:fs"] = "file:///path/to/safesh/src/stdlib/fs.ts";

  const importMapPath = join(TEMP_DIR, "import-map.json");
  await Deno.writeTextFile(
    importMapPath,
    JSON.stringify(importMap, null, 2),
  );

  return importMapPath;
}


/**
 * Validate code for blocked imports before execution
 *
 * This performs static analysis to catch blocked imports using regex matching.
 * This is the primary mechanism for enforcing import security policy.
 */
export function validateImports(code: string, policy: ImportPolicy): void {
  const trusted = policy.trusted ?? [];
  const allowed = policy.allowed ?? [];
  const blocked = policy.blocked ?? [];

  // Simple regex to find import statements
  // Matches: import ... from "specifier" or import("specifier")
  const importRegex = /(?:import\s+.*?\s+from\s+|import\()\s*["']([^"']+)["']/g;

  const violations: string[] = [];
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const specifier = match[1];
    if (!specifier) continue; // Skip if capture group didn't match

    // Check if blocked
    if (matchesAnyPattern(specifier, blocked)) {
      // Check if it's trusted or explicitly allowed (overrides blocked)
      if (
        !matchesAnyPattern(specifier, trusted) &&
        !matchesAnyPattern(specifier, allowed)
      ) {
        violations.push(specifier);
      }
    }
  }

  if (violations.length > 0) {
    throw importError(violations[0]!, blocked, [...trusted, ...allowed]);
  }
}

/**
 * Check if an import specifier is allowed by the policy
 */
export function isImportAllowed(
  specifier: string,
  policy: ImportPolicy,
): boolean {
  const trusted = policy.trusted ?? [];
  const allowed = policy.allowed ?? [];
  const blocked = policy.blocked ?? [];

  // If it matches blocked, it must also match trusted or allowed
  if (matchesAnyPattern(specifier, blocked)) {
    return (
      matchesAnyPattern(specifier, trusted) ||
      matchesAnyPattern(specifier, allowed)
    );
  }

  // Not blocked, allowed by default
  return true;
}
