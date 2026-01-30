import type { Shell, ShellCapabilities } from "./shell-dialect.ts";
import { getCapabilities } from "./shell-dialect.ts";
import type { DiagnosticCodeType } from "./diagnostics.ts";
import { DiagnosticCode } from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";
import type { DiagnosticCollector } from "./diagnostic-collector.ts";

/**
 * Feature names for capability checks.
 */
export type FeatureName =
  | "arrays"
  | "associative-arrays"
  | "extended-glob"
  | "process-substitution"
  | "double-bracket-test"
  | "coproc"
  | "nameref"
  | "ansi-c-quoting"
  | "locale-quoting"
  | "fd-variables"
  | "pipe-stderr"
  | "append-stderr-redirect";

/**
 * Map feature names to capability keys.
 */
const FEATURE_TO_CAPABILITY: Record<FeatureName, keyof ShellCapabilities> = {
  "arrays": "hasArrays",
  "associative-arrays": "hasAssociativeArrays",
  "extended-glob": "hasExtendedGlob",
  "process-substitution": "hasProcessSubstitution",
  "double-bracket-test": "hasDoubleSquareBracket",
  "coproc": "hasCoproc",
  "nameref": "hasNameref",
  "ansi-c-quoting": "hasAnsiCQuoting",
  "locale-quoting": "hasLocaleQuoting",
  "fd-variables": "hasFdVariables",
  "pipe-stderr": "hasPipeStderr",
  "append-stderr-redirect": "hasAppendStderrRedirect",
};

/**
 * Human-readable feature descriptions.
 */
const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  "arrays": "indexed arrays",
  "associative-arrays": "associative arrays (declare -A)",
  "extended-glob": "extended glob patterns",
  "process-substitution": "process substitution <() and >()",
  "double-bracket-test": "[[ ]] test command",
  "coproc": "coproc keyword",
  "nameref": "nameref variables (declare -n)",
  "ansi-c-quoting": "$'' ANSI-C quoting",
  "locale-quoting": '$"" locale quoting',
  "fd-variables": "{fd}>file FD variable syntax",
  "pipe-stderr": "|& pipe stderr shorthand",
  "append-stderr-redirect": "&>> append redirect",
};

/**
 * Check if a shell supports a feature.
 */
export function supportsFeature(shell: Shell, feature: FeatureName): boolean {
  const capKey = FEATURE_TO_CAPABILITY[feature];
  const caps = getCapabilities(shell);
  return caps[capKey];
}

/**
 * Check feature and optionally emit warning.
 * Returns true if feature is supported.
 */
export function checkFeature(
  shell: Shell,
  feature: FeatureName,
  loc: SourceLocation,
  collector?: DiagnosticCollector
): boolean {
  if (supportsFeature(shell, feature)) {
    return true;
  }

  if (collector) {
    const desc = FEATURE_DESCRIPTIONS[feature];
    collector.warning(
      DiagnosticCode.BASH_ONLY_FEATURE,
      `${desc} is not supported in ${shell}`,
      loc,
      {
        fixHint: `Consider using POSIX-compatible alternatives or targeting a different shell`,
      }
    );
  }

  return false;
}

/**
 * Require a feature, throwing if not supported.
 */
export function requireFeature(
  shell: Shell,
  feature: FeatureName,
  loc: SourceLocation
): void {
  if (!supportsFeature(shell, feature)) {
    const desc = FEATURE_DESCRIPTIONS[feature];
    throw new Error(
      `${desc} is not supported in ${shell} at ${loc.start.line}:${loc.start.column}`
    );
  }
}

/**
 * Create a capability guard that can be used in parsing.
 * Returns a function that checks the capability and optionally warns.
 */
export function createCapabilityGuard(
  shell: Shell,
  collector?: DiagnosticCollector
): (feature: FeatureName, loc: SourceLocation) => boolean {
  return (feature, loc) => checkFeature(shell, feature, loc, collector);
}

/**
 * Get all features not supported by a shell.
 */
export function getUnsupportedFeatures(shell: Shell): FeatureName[] {
  const result: FeatureName[] = [];
  for (const [feature, capKey] of Object.entries(FEATURE_TO_CAPABILITY)) {
    const caps = getCapabilities(shell);
    if (!caps[capKey as keyof ShellCapabilities]) {
      result.push(feature as FeatureName);
    }
  }
  return result;
}

/**
 * Get feature description.
 */
export function getFeatureDescription(feature: FeatureName): string {
  return FEATURE_DESCRIPTIONS[feature];
}
