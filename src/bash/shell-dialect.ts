/**
 * Supported shell dialects.
 */
export enum Shell {
  /** Bourne Again Shell */
  Bash = "bash",
  /** POSIX shell */
  Sh = "sh",
  /** Debian Almquist Shell */
  Dash = "dash",
  /** Korn Shell */
  Ksh = "ksh",
  /** Z Shell */
  Zsh = "zsh",
}

/**
 * Feature capabilities for a shell dialect.
 */
export interface ShellCapabilities {
  /** Supports indexed arrays (arr[0]) */
  hasArrays: boolean;
  /** Supports associative arrays (declare -A) */
  hasAssociativeArrays: boolean;
  /** Supports extended glob patterns */
  hasExtendedGlob: boolean;
  /** Supports process substitution <() and >() */
  hasProcessSubstitution: boolean;
  /** Supports [[ ]] test command */
  hasDoubleSquareBracket: boolean;
  /** Supports coproc keyword */
  hasCoproc: boolean;
  /** Supports nameref (declare -n) */
  hasNameref: boolean;
  /** Supports $'' ANSI-C quoting */
  hasAnsiCQuoting: boolean;
  /** Supports $"" locale quoting */
  hasLocaleQuoting: boolean;
  /** Supports {fd}>file FD variable syntax */
  hasFdVariables: boolean;
  /** Supports |& pipe stderr shorthand */
  hasPipeStderr: boolean;
  /** Supports &>> append redirect shorthand */
  hasAppendStderrRedirect: boolean;
}

/**
 * Capability definitions for each shell.
 */
export const SHELL_CAPABILITIES: Readonly<Record<Shell, ShellCapabilities>> = {
  [Shell.Bash]: {
    hasArrays: true,
    hasAssociativeArrays: true,
    hasExtendedGlob: true,
    hasProcessSubstitution: true,
    hasDoubleSquareBracket: true,
    hasCoproc: true,
    hasNameref: true,
    hasAnsiCQuoting: true,
    hasLocaleQuoting: true,
    hasFdVariables: true,
    hasPipeStderr: true,
    hasAppendStderrRedirect: true,
  },
  [Shell.Sh]: {
    hasArrays: false,
    hasAssociativeArrays: false,
    hasExtendedGlob: false,
    hasProcessSubstitution: false,
    hasDoubleSquareBracket: false,
    hasCoproc: false,
    hasNameref: false,
    hasAnsiCQuoting: false,
    hasLocaleQuoting: false,
    hasFdVariables: false,
    hasPipeStderr: false,
    hasAppendStderrRedirect: false,
  },
  [Shell.Dash]: {
    hasArrays: false,
    hasAssociativeArrays: false,
    hasExtendedGlob: false,
    hasProcessSubstitution: false,
    hasDoubleSquareBracket: false,
    hasCoproc: false,
    hasNameref: false,
    hasAnsiCQuoting: true,  // dash supports $''
    hasLocaleQuoting: false,
    hasFdVariables: false,
    hasPipeStderr: false,
    hasAppendStderrRedirect: false,
  },
  [Shell.Ksh]: {
    hasArrays: true,
    hasAssociativeArrays: true,
    hasExtendedGlob: true,
    hasProcessSubstitution: true,
    hasDoubleSquareBracket: true,
    hasCoproc: true,
    hasNameref: true,
    hasAnsiCQuoting: true,
    hasLocaleQuoting: true,
    hasFdVariables: false,
    hasPipeStderr: false,
    hasAppendStderrRedirect: false,
  },
  [Shell.Zsh]: {
    hasArrays: true,
    hasAssociativeArrays: true,
    hasExtendedGlob: true,
    hasProcessSubstitution: true,
    hasDoubleSquareBracket: true,
    hasCoproc: true,
    hasNameref: false,  // zsh doesn't have nameref
    hasAnsiCQuoting: true,
    hasLocaleQuoting: true,
    hasFdVariables: true,
    hasPipeStderr: true,
    hasAppendStderrRedirect: true,
  },
};

/**
 * Get capabilities for a shell.
 */
export function getCapabilities(shell: Shell): ShellCapabilities {
  return SHELL_CAPABILITIES[shell];
}

/**
 * Check if a shell has a specific capability.
 */
export function hasCapability(
  shell: Shell,
  capability: keyof ShellCapabilities
): boolean {
  return SHELL_CAPABILITIES[shell][capability];
}

/**
 * Get default shell (Bash).
 */
export function getDefaultShell(): Shell {
  return Shell.Bash;
}

/**
 * Parse shell from string (e.g., from shebang).
 */
export function parseShell(name: string): Shell | null {
  // Extract basename if it looks like a path
  const basename = name.includes("/") ? name.split("/").pop() || "" : name;

  // Normalize: lowercase and keep only letters and numbers
  const normalized = basename.toLowerCase().replace(/[^a-z0-9]/g, "");

  switch (normalized) {
    case "bash":
      return Shell.Bash;
    case "sh":
      return Shell.Sh;
    case "dash":
      return Shell.Dash;
    case "ksh":
    case "ksh93":
    case "mksh":
      return Shell.Ksh;
    case "zsh":
      return Shell.Zsh;
    default:
      return null;
  }
}

/**
 * Detect shell from shebang line.
 * Handles formats:
 * - #!/bin/bash
 * - #!/usr/bin/env bash
 * - #!/usr/local/bin/bash
 */
export function detectShellFromShebang(line: string): Shell | null {
  // Must start with #!
  if (!line.startsWith("#!")) {
    return null;
  }

  const shebang = line.slice(2).trim();

  // Handle env invocation: #!/usr/bin/env bash
  if (shebang.includes("/env ") || shebang.includes("/env\t")) {
    const parts = shebang.split(/\s+/);
    const shellArg = parts[parts.length - 1];
    if (shellArg) {
      return parseShell(shellArg);
    }
  }

  // Direct path: #!/bin/bash or #!/usr/bin/bash
  const pathParts = shebang.split(/[\s\/]/);
  const shellName = pathParts[pathParts.length - 1];
  if (shellName) {
    return parseShell(shellName);
  }

  return null;
}

/**
 * Detect shell from directive comment.
 * Supports formats:
 * - # shelltype: bash
 * - # shell: bash
 * - # safesh-shell: bash
 */
export function detectShellFromDirective(line: string): Shell | null {
  const directivePattern = /^#\s*(?:shell(?:type)?|safesh-shell)\s*:\s*(\w+)/i;
  const match = line.match(directivePattern);
  if (match && match[1]) {
    return parseShell(match[1]);
  }
  return null;
}

/**
 * Detect shell from script content.
 * Checks shebang first, then looks for directives in first N lines.
 */
export function detectShell(content: string, maxLines = 10): Shell | null {
  const lines = content.split('\n');

  // Check shebang (first line)
  if (lines[0]) {
    const fromShebang = detectShellFromShebang(lines[0]);
    if (fromShebang) return fromShebang;
  }

  // Check for directive in first N lines
  const linesToCheck = Math.min(lines.length, maxLines);
  for (let i = 0; i < linesToCheck; i++) {
    const fromDirective = detectShellFromDirective(lines[i] || "");
    if (fromDirective) return fromDirective;
  }

  return null;
}
