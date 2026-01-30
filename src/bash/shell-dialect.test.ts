import { assertEquals, assertExists } from "@std/assert";
import {
  detectShell,
  detectShellFromDirective,
  detectShellFromShebang,
  getCapabilities,
  getDefaultShell,
  hasCapability,
  parseShell,
  Shell,
  SHELL_CAPABILITIES,
  type ShellCapabilities,
} from "./shell-dialect.ts";

Deno.test("Shell enum contains all expected shells", () => {
  assertEquals(Shell.Bash, "bash");
  assertEquals(Shell.Sh, "sh");
  assertEquals(Shell.Dash, "dash");
  assertEquals(Shell.Ksh, "ksh");
  assertEquals(Shell.Zsh, "zsh");
});

Deno.test("All shells have capability entries", () => {
  const shells = Object.values(Shell);
  for (const shell of shells) {
    assertExists(SHELL_CAPABILITIES[shell]);
    const caps = SHELL_CAPABILITIES[shell];

    // Verify all capability properties exist
    assertEquals(typeof caps.hasArrays, "boolean");
    assertEquals(typeof caps.hasAssociativeArrays, "boolean");
    assertEquals(typeof caps.hasExtendedGlob, "boolean");
    assertEquals(typeof caps.hasProcessSubstitution, "boolean");
    assertEquals(typeof caps.hasDoubleSquareBracket, "boolean");
    assertEquals(typeof caps.hasCoproc, "boolean");
    assertEquals(typeof caps.hasNameref, "boolean");
    assertEquals(typeof caps.hasAnsiCQuoting, "boolean");
    assertEquals(typeof caps.hasLocaleQuoting, "boolean");
    assertEquals(typeof caps.hasFdVariables, "boolean");
    assertEquals(typeof caps.hasPipeStderr, "boolean");
    assertEquals(typeof caps.hasAppendStderrRedirect, "boolean");
  }
});

Deno.test("getCapabilities returns correct values for Bash", () => {
  const caps = getCapabilities(Shell.Bash);
  assertEquals(caps.hasArrays, true);
  assertEquals(caps.hasAssociativeArrays, true);
  assertEquals(caps.hasExtendedGlob, true);
  assertEquals(caps.hasProcessSubstitution, true);
  assertEquals(caps.hasDoubleSquareBracket, true);
  assertEquals(caps.hasCoproc, true);
  assertEquals(caps.hasNameref, true);
  assertEquals(caps.hasAnsiCQuoting, true);
  assertEquals(caps.hasLocaleQuoting, true);
  assertEquals(caps.hasFdVariables, true);
  assertEquals(caps.hasPipeStderr, true);
  assertEquals(caps.hasAppendStderrRedirect, true);
});

Deno.test("getCapabilities returns correct values for Sh", () => {
  const caps = getCapabilities(Shell.Sh);
  assertEquals(caps.hasArrays, false);
  assertEquals(caps.hasAssociativeArrays, false);
  assertEquals(caps.hasExtendedGlob, false);
  assertEquals(caps.hasProcessSubstitution, false);
  assertEquals(caps.hasDoubleSquareBracket, false);
  assertEquals(caps.hasCoproc, false);
  assertEquals(caps.hasNameref, false);
  assertEquals(caps.hasAnsiCQuoting, false);
  assertEquals(caps.hasLocaleQuoting, false);
  assertEquals(caps.hasFdVariables, false);
  assertEquals(caps.hasPipeStderr, false);
  assertEquals(caps.hasAppendStderrRedirect, false);
});

Deno.test("getCapabilities returns correct values for Dash", () => {
  const caps = getCapabilities(Shell.Dash);
  assertEquals(caps.hasArrays, false);
  assertEquals(caps.hasAssociativeArrays, false);
  assertEquals(caps.hasExtendedGlob, false);
  assertEquals(caps.hasProcessSubstitution, false);
  assertEquals(caps.hasDoubleSquareBracket, false);
  assertEquals(caps.hasCoproc, false);
  assertEquals(caps.hasNameref, false);
  assertEquals(caps.hasAnsiCQuoting, true);  // dash supports ANSI-C quoting
  assertEquals(caps.hasLocaleQuoting, false);
  assertEquals(caps.hasFdVariables, false);
  assertEquals(caps.hasPipeStderr, false);
  assertEquals(caps.hasAppendStderrRedirect, false);
});

Deno.test("getCapabilities returns correct values for Ksh", () => {
  const caps = getCapabilities(Shell.Ksh);
  assertEquals(caps.hasArrays, true);
  assertEquals(caps.hasAssociativeArrays, true);
  assertEquals(caps.hasExtendedGlob, true);
  assertEquals(caps.hasProcessSubstitution, true);
  assertEquals(caps.hasDoubleSquareBracket, true);
  assertEquals(caps.hasCoproc, true);
  assertEquals(caps.hasNameref, true);
  assertEquals(caps.hasAnsiCQuoting, true);
  assertEquals(caps.hasLocaleQuoting, true);
  assertEquals(caps.hasFdVariables, false);
  assertEquals(caps.hasPipeStderr, false);
  assertEquals(caps.hasAppendStderrRedirect, false);
});

Deno.test("getCapabilities returns correct values for Zsh", () => {
  const caps = getCapabilities(Shell.Zsh);
  assertEquals(caps.hasArrays, true);
  assertEquals(caps.hasAssociativeArrays, true);
  assertEquals(caps.hasExtendedGlob, true);
  assertEquals(caps.hasProcessSubstitution, true);
  assertEquals(caps.hasDoubleSquareBracket, true);
  assertEquals(caps.hasCoproc, true);
  assertEquals(caps.hasNameref, false);  // zsh doesn't have nameref
  assertEquals(caps.hasAnsiCQuoting, true);
  assertEquals(caps.hasLocaleQuoting, true);
  assertEquals(caps.hasFdVariables, true);
  assertEquals(caps.hasPipeStderr, true);
  assertEquals(caps.hasAppendStderrRedirect, true);
});

Deno.test("hasCapability works for each capability", () => {
  // Test Bash capabilities
  assertEquals(hasCapability(Shell.Bash, "hasArrays"), true);
  assertEquals(hasCapability(Shell.Bash, "hasAssociativeArrays"), true);
  assertEquals(hasCapability(Shell.Bash, "hasExtendedGlob"), true);
  assertEquals(hasCapability(Shell.Bash, "hasProcessSubstitution"), true);
  assertEquals(hasCapability(Shell.Bash, "hasDoubleSquareBracket"), true);
  assertEquals(hasCapability(Shell.Bash, "hasCoproc"), true);
  assertEquals(hasCapability(Shell.Bash, "hasNameref"), true);
  assertEquals(hasCapability(Shell.Bash, "hasAnsiCQuoting"), true);
  assertEquals(hasCapability(Shell.Bash, "hasLocaleQuoting"), true);
  assertEquals(hasCapability(Shell.Bash, "hasFdVariables"), true);
  assertEquals(hasCapability(Shell.Bash, "hasPipeStderr"), true);
  assertEquals(hasCapability(Shell.Bash, "hasAppendStderrRedirect"), true);

  // Test Sh capabilities (should all be false)
  assertEquals(hasCapability(Shell.Sh, "hasArrays"), false);
  assertEquals(hasCapability(Shell.Sh, "hasAssociativeArrays"), false);
  assertEquals(hasCapability(Shell.Sh, "hasExtendedGlob"), false);
  assertEquals(hasCapability(Shell.Sh, "hasProcessSubstitution"), false);
  assertEquals(hasCapability(Shell.Sh, "hasDoubleSquareBracket"), false);
  assertEquals(hasCapability(Shell.Sh, "hasCoproc"), false);
  assertEquals(hasCapability(Shell.Sh, "hasNameref"), false);
  assertEquals(hasCapability(Shell.Sh, "hasAnsiCQuoting"), false);
  assertEquals(hasCapability(Shell.Sh, "hasLocaleQuoting"), false);
  assertEquals(hasCapability(Shell.Sh, "hasFdVariables"), false);
  assertEquals(hasCapability(Shell.Sh, "hasPipeStderr"), false);
  assertEquals(hasCapability(Shell.Sh, "hasAppendStderrRedirect"), false);
});

Deno.test("parseShell handles various inputs", () => {
  // Standard names
  assertEquals(parseShell("bash"), Shell.Bash);
  assertEquals(parseShell("sh"), Shell.Sh);
  assertEquals(parseShell("dash"), Shell.Dash);
  assertEquals(parseShell("ksh"), Shell.Ksh);
  assertEquals(parseShell("zsh"), Shell.Zsh);

  // Case insensitive
  assertEquals(parseShell("BASH"), Shell.Bash);
  assertEquals(parseShell("Bash"), Shell.Bash);
  assertEquals(parseShell("SH"), Shell.Sh);

  // From shebang paths
  assertEquals(parseShell("/bin/bash"), Shell.Bash);
  assertEquals(parseShell("/usr/bin/bash"), Shell.Bash);
  assertEquals(parseShell("/bin/sh"), Shell.Sh);
  assertEquals(parseShell("/bin/dash"), Shell.Dash);
  assertEquals(parseShell("/usr/bin/ksh"), Shell.Ksh);
  assertEquals(parseShell("/bin/zsh"), Shell.Zsh);

  // Ksh variants
  assertEquals(parseShell("ksh93"), Shell.Ksh);
  assertEquals(parseShell("mksh"), Shell.Ksh);

  // Unknown shells
  assertEquals(parseShell("fish"), null);
  assertEquals(parseShell("tcsh"), null);
  assertEquals(parseShell("csh"), null);
  assertEquals(parseShell("unknown"), null);
  assertEquals(parseShell(""), null);
});

Deno.test("Bash has most capabilities", () => {
  const bashCaps = getCapabilities(Shell.Bash);
  const capCount = Object.values(bashCaps).filter((v) => v === true).length;

  // All capabilities should be true for Bash
  assertEquals(capCount, Object.keys(bashCaps).length);
});

Deno.test("Sh has fewest capabilities", () => {
  const shCaps = getCapabilities(Shell.Sh);
  const capCount = Object.values(shCaps).filter((v) => v === true).length;

  // All capabilities should be false for POSIX sh
  assertEquals(capCount, 0);
});

Deno.test("getDefaultShell returns Bash", () => {
  assertEquals(getDefaultShell(), Shell.Bash);
});

Deno.test("Capability consistency checks", () => {
  // If a shell has associative arrays, it should also have arrays
  for (const shell of Object.values(Shell)) {
    const caps = getCapabilities(shell);
    if (caps.hasAssociativeArrays) {
      assertEquals(caps.hasArrays, true,
        `${shell} has associative arrays but not arrays`);
    }
  }
});

Deno.test("Shell-specific capability validation", () => {
  // Zsh should not have nameref (uses typeset differently)
  assertEquals(hasCapability(Shell.Zsh, "hasNameref"), false);

  // Dash should have ANSI-C quoting but not locale quoting
  assertEquals(hasCapability(Shell.Dash, "hasAnsiCQuoting"), true);
  assertEquals(hasCapability(Shell.Dash, "hasLocaleQuoting"), false);

  // Ksh should not have FD variables (Bash 4.1+ feature)
  assertEquals(hasCapability(Shell.Ksh, "hasFdVariables"), false);
});

// Shebang detection tests
Deno.test("detectShellFromShebang - direct path shebangs", () => {
  assertEquals(detectShellFromShebang("#!/bin/bash"), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/usr/bin/bash"), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/usr/local/bin/bash"), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/bin/sh"), Shell.Sh);
  assertEquals(detectShellFromShebang("#!/bin/dash"), Shell.Dash);
  assertEquals(detectShellFromShebang("#!/bin/ksh"), Shell.Ksh);
  assertEquals(detectShellFromShebang("#!/usr/bin/zsh"), Shell.Zsh);
});

Deno.test("detectShellFromShebang - env shebangs", () => {
  assertEquals(detectShellFromShebang("#!/usr/bin/env bash"), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/usr/bin/env sh"), Shell.Sh);
  assertEquals(detectShellFromShebang("#!/usr/bin/env dash"), Shell.Dash);
  assertEquals(detectShellFromShebang("#!/usr/bin/env ksh"), Shell.Ksh);
  assertEquals(detectShellFromShebang("#!/usr/bin/env zsh"), Shell.Zsh);
  assertEquals(detectShellFromShebang("#!/bin/env bash"), Shell.Bash);
});

Deno.test("detectShellFromShebang - env with flags", () => {
  // env can have flags before the shell name
  assertEquals(detectShellFromShebang("#!/usr/bin/env -S bash"), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/usr/bin/env -i bash"), Shell.Bash);
});

Deno.test("detectShellFromShebang - ksh variants", () => {
  assertEquals(detectShellFromShebang("#!/bin/ksh93"), Shell.Ksh);
  assertEquals(detectShellFromShebang("#!/usr/bin/mksh"), Shell.Ksh);
  assertEquals(detectShellFromShebang("#!/usr/bin/env ksh93"), Shell.Ksh);
});

Deno.test("detectShellFromShebang - invalid or missing shebangs", () => {
  assertEquals(detectShellFromShebang("# not a shebang"), null);
  assertEquals(detectShellFromShebang(""), null);
  assertEquals(detectShellFromShebang("#!/bin/fish"), null);
  assertEquals(detectShellFromShebang("#!/usr/bin/env fish"), null);
  assertEquals(detectShellFromShebang("no shebang"), null);
  assertEquals(detectShellFromShebang("#!"), null);
  assertEquals(detectShellFromShebang("#!/bin/"), null);
});

Deno.test("detectShellFromShebang - whitespace handling", () => {
  assertEquals(detectShellFromShebang("#!/bin/bash "), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/usr/bin/env  bash"), Shell.Bash);
  assertEquals(detectShellFromShebang("#!/usr/bin/env\tbash"), Shell.Bash);
});

// Directive detection tests
Deno.test("detectShellFromDirective - shelltype format", () => {
  assertEquals(detectShellFromDirective("# shelltype: bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("# shelltype: sh"), Shell.Sh);
  assertEquals(detectShellFromDirective("# shelltype: dash"), Shell.Dash);
  assertEquals(detectShellFromDirective("# shelltype: ksh"), Shell.Ksh);
  assertEquals(detectShellFromDirective("# shelltype: zsh"), Shell.Zsh);
});

Deno.test("detectShellFromDirective - shell format", () => {
  assertEquals(detectShellFromDirective("# shell: bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("# shell: sh"), Shell.Sh);
  assertEquals(detectShellFromDirective("# shell: zsh"), Shell.Zsh);
});

Deno.test("detectShellFromDirective - safesh-shell format", () => {
  assertEquals(detectShellFromDirective("# safesh-shell: bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("# safesh-shell: zsh"), Shell.Zsh);
});

Deno.test("detectShellFromDirective - case insensitive", () => {
  assertEquals(detectShellFromDirective("# ShellType: bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("# SHELL: BASH"), Shell.Bash);
  assertEquals(detectShellFromDirective("# safesh-SHELL: zsh"), Shell.Zsh);
});

Deno.test("detectShellFromDirective - whitespace variations", () => {
  assertEquals(detectShellFromDirective("#shelltype: bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("#  shelltype: bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("# shelltype:bash"), Shell.Bash);
  assertEquals(detectShellFromDirective("# shelltype:  bash"), Shell.Bash);
});

Deno.test("detectShellFromDirective - invalid directives", () => {
  assertEquals(detectShellFromDirective("# not a directive"), null);
  assertEquals(detectShellFromDirective(""), null);
  assertEquals(detectShellFromDirective("# shelltype: fish"), null);
  assertEquals(detectShellFromDirective("shelltype: bash"), null); // missing #
  assertEquals(detectShellFromDirective("## shelltype: bash"), null); // double ##
});

// Full script detection tests
Deno.test("detectShell - detects from shebang", () => {
  const script = `#!/bin/bash
echo "Hello World"`;
  assertEquals(detectShell(script), Shell.Bash);
});

Deno.test("detectShell - detects from env shebang", () => {
  const script = `#!/usr/bin/env zsh
echo "Hello from Zsh"`;
  assertEquals(detectShell(script), Shell.Zsh);
});

Deno.test("detectShell - detects from directive when no shebang", () => {
  const script = `# This is a script
# shell: dash
echo "Hello"`;
  assertEquals(detectShell(script), Shell.Dash);
});

Deno.test("detectShell - prefers shebang over directive", () => {
  const script = `#!/bin/bash
# shell: zsh
echo "Bash wins"`;
  assertEquals(detectShell(script), Shell.Bash);
});

Deno.test("detectShell - finds directive within maxLines", () => {
  const script = `# Line 1
# Line 2
# Line 3
# shell: ksh
echo "Found it"`;
  assertEquals(detectShell(script, 10), Shell.Ksh);
});

Deno.test("detectShell - stops searching after maxLines", () => {
  const script = `# Line 1
# Line 2
# Line 3
# Line 4
# Line 5
# Line 6
# Line 7
# Line 8
# Line 9
# Line 10
# Line 11
# shell: bash
echo "Too far"`;
  assertEquals(detectShell(script, 10), null);
});

Deno.test("detectShell - returns null when no shell found", () => {
  const script = `# Just a regular comment
echo "No shell specified"`;
  assertEquals(detectShell(script), null);
});

Deno.test("detectShell - handles empty content", () => {
  assertEquals(detectShell(""), null);
});

Deno.test("detectShell - handles single line scripts", () => {
  assertEquals(detectShell("#!/bin/sh"), Shell.Sh);
  assertEquals(detectShell("# shell: bash"), Shell.Bash);
});

Deno.test("detectShell - real-world bash script", () => {
  const script = `#!/bin/bash
set -euo pipefail

# Script to deploy application
deploy() {
  echo "Deploying..."
}

deploy`;
  assertEquals(detectShell(script), Shell.Bash);
});

Deno.test("detectShell - real-world zsh script with directive", () => {
  const script = `# safesh-shell: zsh
# This script requires zsh features

setopt extended_glob
echo *.txt~README.txt`;
  assertEquals(detectShell(script), Shell.Zsh);
});
