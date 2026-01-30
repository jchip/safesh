import { assertEquals, assertThrows } from "@std/assert";
import {
  supportsFeature,
  checkFeature,
  requireFeature,
  createCapabilityGuard,
  getUnsupportedFeatures,
  getFeatureDescription,
  type FeatureName,
} from "./capability-checks.ts";
import { Shell } from "./shell-dialect.ts";
import { DiagnosticCollector } from "./diagnostic-collector.ts";
import { DiagnosticCode } from "./diagnostics.ts";
import type { SourceLocation } from "./ast.ts";

// Helper to create a dummy source location
function loc(line = 1, column = 1): SourceLocation {
  return {
    start: { line, column, offset: 0 },
    end: { line, column, offset: 0 },
  };
}

Deno.test("supportsFeature returns true for supported features", () => {
  assertEquals(supportsFeature(Shell.Bash, "arrays"), true);
  assertEquals(supportsFeature(Shell.Bash, "associative-arrays"), true);
  assertEquals(supportsFeature(Shell.Bash, "process-substitution"), true);
  assertEquals(supportsFeature(Shell.Ksh, "arrays"), true);
  assertEquals(supportsFeature(Shell.Zsh, "double-bracket-test"), true);
  assertEquals(supportsFeature(Shell.Dash, "ansi-c-quoting"), true);
});

Deno.test("supportsFeature returns false for unsupported features", () => {
  assertEquals(supportsFeature(Shell.Sh, "arrays"), false);
  assertEquals(supportsFeature(Shell.Sh, "associative-arrays"), false);
  assertEquals(supportsFeature(Shell.Sh, "process-substitution"), false);
  assertEquals(supportsFeature(Shell.Dash, "arrays"), false);
  assertEquals(supportsFeature(Shell.Dash, "double-bracket-test"), false);
  assertEquals(supportsFeature(Shell.Zsh, "nameref"), false);
  assertEquals(supportsFeature(Shell.Ksh, "fd-variables"), false);
});

Deno.test("checkFeature returns true without collector when supported", () => {
  const result = checkFeature(Shell.Bash, "arrays", loc());
  assertEquals(result, true);
});

Deno.test("checkFeature returns false without collector when unsupported", () => {
  const result = checkFeature(Shell.Sh, "arrays", loc());
  assertEquals(result, false);
});

Deno.test("checkFeature returns true for supported features with collector", () => {
  const collector = new DiagnosticCollector();
  const result = checkFeature(Shell.Bash, "arrays", loc(), collector);
  assertEquals(result, true);
  assertEquals(collector.hasWarnings(), false);
  assertEquals(collector.warnings.length, 0);
});

Deno.test("checkFeature returns false and warns for unsupported features", () => {
  const collector = new DiagnosticCollector();
  const result = checkFeature(Shell.Sh, "arrays", loc(10, 5), collector);

  assertEquals(result, false);
  assertEquals(collector.hasWarnings(), true);
  assertEquals(collector.warnings.length, 1);

  const warning = collector.warnings[0]!;
  assertEquals(warning.code, DiagnosticCode.BASH_ONLY_FEATURE);
  assertEquals(warning.message, "indexed arrays is not supported in sh");
  assertEquals(warning.loc.start.line, 10);
  assertEquals(warning.loc.start.column, 5);
  assertEquals(warning.fixHint, "Consider using POSIX-compatible alternatives or targeting a different shell");
});

Deno.test("checkFeature warns for multiple unsupported features", () => {
  const collector = new DiagnosticCollector();

  checkFeature(Shell.Sh, "arrays", loc(1, 1), collector);
  checkFeature(Shell.Sh, "process-substitution", loc(2, 1), collector);
  checkFeature(Shell.Sh, "double-bracket-test", loc(3, 1), collector);

  assertEquals(collector.warnings.length, 3);
  assertEquals(collector.warnings[0]!.message, "indexed arrays is not supported in sh");
  assertEquals(collector.warnings[1]!.message, "process substitution <() and >() is not supported in sh");
  assertEquals(collector.warnings[2]!.message, "[[ ]] test command is not supported in sh");
});

Deno.test("requireFeature succeeds for supported features", () => {
  // Should not throw
  requireFeature(Shell.Bash, "arrays", loc());
  requireFeature(Shell.Bash, "associative-arrays", loc());
  requireFeature(Shell.Ksh, "nameref", loc());
  requireFeature(Shell.Zsh, "fd-variables", loc());
});

Deno.test("requireFeature throws for unsupported features", () => {
  assertThrows(
    () => requireFeature(Shell.Sh, "arrays", loc(5, 10)),
    Error,
    "indexed arrays is not supported in sh at 5:10"
  );

  assertThrows(
    () => requireFeature(Shell.Dash, "process-substitution", loc(12, 3)),
    Error,
    "process substitution <() and >() is not supported in dash at 12:3"
  );

  assertThrows(
    () => requireFeature(Shell.Zsh, "nameref", loc(8, 1)),
    Error,
    "nameref variables (declare -n) is not supported in zsh at 8:1"
  );
});

Deno.test("createCapabilityGuard creates working guard", () => {
  const collector = new DiagnosticCollector();
  const guard = createCapabilityGuard(Shell.Sh, collector);

  // Should return false and warn for unsupported feature
  assertEquals(guard("arrays", loc(5, 5)), false);
  assertEquals(collector.warnings.length, 1);

  // Clear for next test
  collector.clear();

  // Should return true and not warn for supported feature (none in sh)
  const bashGuard = createCapabilityGuard(Shell.Bash, collector);
  assertEquals(bashGuard("arrays", loc(1, 1)), true);
  assertEquals(collector.warnings.length, 0);
});

Deno.test("createCapabilityGuard works without collector", () => {
  const guard = createCapabilityGuard(Shell.Sh);

  // Should return false but not crash
  assertEquals(guard("arrays", loc()), false);

  // Test with bash
  const bashGuard = createCapabilityGuard(Shell.Bash);
  assertEquals(bashGuard("arrays", loc()), true);
});

Deno.test("getUnsupportedFeatures returns correct list for Sh", () => {
  const unsupported = getUnsupportedFeatures(Shell.Sh);

  // Sh supports no features
  assertEquals(unsupported.length, 12);
  assertEquals(unsupported.includes("arrays"), true);
  assertEquals(unsupported.includes("associative-arrays"), true);
  assertEquals(unsupported.includes("extended-glob"), true);
  assertEquals(unsupported.includes("process-substitution"), true);
  assertEquals(unsupported.includes("double-bracket-test"), true);
  assertEquals(unsupported.includes("coproc"), true);
  assertEquals(unsupported.includes("nameref"), true);
  assertEquals(unsupported.includes("ansi-c-quoting"), true);
  assertEquals(unsupported.includes("locale-quoting"), true);
  assertEquals(unsupported.includes("fd-variables"), true);
  assertEquals(unsupported.includes("pipe-stderr"), true);
  assertEquals(unsupported.includes("append-stderr-redirect"), true);
});

Deno.test("getUnsupportedFeatures returns empty for Bash", () => {
  const unsupported = getUnsupportedFeatures(Shell.Bash);

  // Bash supports all features
  assertEquals(unsupported.length, 0);
});

Deno.test("getUnsupportedFeatures returns correct list for Dash", () => {
  const unsupported = getUnsupportedFeatures(Shell.Dash);

  // Dash supports only ansi-c-quoting
  assertEquals(unsupported.length, 11);
  assertEquals(unsupported.includes("ansi-c-quoting"), false);
  assertEquals(unsupported.includes("arrays"), true);
  assertEquals(unsupported.includes("process-substitution"), true);
});

Deno.test("getUnsupportedFeatures returns correct list for Zsh", () => {
  const unsupported = getUnsupportedFeatures(Shell.Zsh);

  // Zsh doesn't support nameref
  assertEquals(unsupported.length, 1);
  assertEquals(unsupported.includes("nameref"), true);
});

Deno.test("getUnsupportedFeatures returns correct list for Ksh", () => {
  const unsupported = getUnsupportedFeatures(Shell.Ksh);

  // Ksh doesn't support fd-variables, pipe-stderr, append-stderr-redirect
  assertEquals(unsupported.length, 3);
  assertEquals(unsupported.includes("fd-variables"), true);
  assertEquals(unsupported.includes("pipe-stderr"), true);
  assertEquals(unsupported.includes("append-stderr-redirect"), true);
});

Deno.test("getFeatureDescription returns descriptions", () => {
  assertEquals(getFeatureDescription("arrays"), "indexed arrays");
  assertEquals(getFeatureDescription("associative-arrays"), "associative arrays (declare -A)");
  assertEquals(getFeatureDescription("extended-glob"), "extended glob patterns");
  assertEquals(getFeatureDescription("process-substitution"), "process substitution <() and >()");
  assertEquals(getFeatureDescription("double-bracket-test"), "[[ ]] test command");
  assertEquals(getFeatureDescription("coproc"), "coproc keyword");
  assertEquals(getFeatureDescription("nameref"), "nameref variables (declare -n)");
  assertEquals(getFeatureDescription("ansi-c-quoting"), "$'' ANSI-C quoting");
  assertEquals(getFeatureDescription("locale-quoting"), '$"" locale quoting');
  assertEquals(getFeatureDescription("fd-variables"), "{fd}>file FD variable syntax");
  assertEquals(getFeatureDescription("pipe-stderr"), "|& pipe stderr shorthand");
  assertEquals(getFeatureDescription("append-stderr-redirect"), "&>> append redirect");
});

Deno.test("checkFeature handles all feature types correctly", () => {
  const collector = new DiagnosticCollector();
  const features: FeatureName[] = [
    "arrays",
    "associative-arrays",
    "extended-glob",
    "process-substitution",
    "double-bracket-test",
    "coproc",
    "nameref",
    "ansi-c-quoting",
    "locale-quoting",
    "fd-variables",
    "pipe-stderr",
    "append-stderr-redirect",
  ];

  // Check all features with sh (none supported)
  for (const feature of features) {
    checkFeature(Shell.Sh, feature, loc(), collector);
  }

  assertEquals(collector.warnings.length, 12);

  collector.clear();

  // Check all features with bash (all supported)
  for (const feature of features) {
    checkFeature(Shell.Bash, feature, loc(), collector);
  }

  assertEquals(collector.warnings.length, 0);
});
