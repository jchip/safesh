/**
 * Project Root Discovery Module
 *
 * Provides unified logic for finding project roots across SafeShell.
 * Eliminates ~60 lines of duplication between bash-prehook.ts and desh.ts.
 */

import { ensureDirSync } from "./io-utils.ts";

/**
 * Project root markers - only truly reliable ones
 * Other markers like package.json can exist in subdirectories
 */
export const PROJECT_MARKERS = [
  ".claude",        // Claude Code project config (most reliable)
  ".git",           // Git repository root
  ".config/safesh", // SafeShell project config
] as const;

export interface FindProjectRootOptions {
  /**
   * If true, creates .config/safesh/config.local.json in cwd when no marker found.
   * If false, just returns cwd without creating config.
   * @default true
   */
  createConfig?: boolean;

  /**
   * If true, stops at HOME directory and won't treat it as project root.
   * If false, can return HOME directory as project root.
   * @default true
   */
  stopAtHome?: boolean;
}

/**
 * Find the project root directory by walking up from cwd looking for markers.
 *
 * Priority order:
 * 1. CLAUDE_PROJECT_DIR environment variable (highest priority)
 * 2. Directory containing .claude marker
 * 3. Directory containing .git marker
 * 4. Directory containing .config/safesh marker
 * 5. Creates .config/safesh in cwd and returns cwd (if createConfig=true)
 *
 * @param cwd - Current working directory to start search from
 * @param options - Options for controlling search behavior
 * @returns Project root directory path
 */
export function findProjectRoot(
  cwd: string,
  options: FindProjectRootOptions = {},
): string {
  const { createConfig = true, stopAtHome = true } = options;

  // Check env var first - highest priority
  const envProjectDir = Deno.env.get("CLAUDE_PROJECT_DIR");
  if (envProjectDir) {
    return envProjectDir;
  }

  const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");

  // Walk up directory tree looking for markers
  let dir = cwd;
  while (true) {
    // Stop at home directory - don't treat home as project root
    if (stopAtHome && homeDir && dir === homeDir) {
      break;
    }

    // Check for project markers
    for (const marker of PROJECT_MARKERS) {
      try {
        const markerPath = `${dir}/${marker}`;
        Deno.statSync(markerPath);
        return dir;
      } catch {
        // Marker not found, continue
      }
    }

    // Move up one directory
    const parent = dir.replace(/\/[^/]+$/, "");
    if (parent === dir || parent === "") {
      // Reached filesystem root
      break;
    }
    dir = parent;
  }

  // No project marker found
  if (createConfig) {
    // Create .config/safesh as fallback marker
    try {
      const configDir = `${cwd}/.config/safesh`;
      ensureDirSync(configDir);
      const configFile = `${configDir}/config.local.json`;

      // Only create config file if doesn't exist
      try {
        Deno.statSync(configFile);
      } catch {
        Deno.writeTextFileSync(configFile, "{}\n");
      }
    } catch {
      // Silently ignore errors - maybe no write permissions
    }
  }

  return cwd;
}
