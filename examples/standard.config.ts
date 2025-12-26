/**
 * Standard SafeShell Configuration
 *
 * This configuration uses the "standard" preset as a base and demonstrates
 * how to extend it with custom settings for a typical project.
 *
 * The standard preset provides:
 * - Read/write access to current directory and /tmp
 * - No network access by default
 * - No external commands by default
 * - Blocks risky imports (npm, http, https)
 * - Masks sensitive environment variables
 *
 * Good for: Most projects with controlled external command access
 */

import type { SafeShellConfig } from "../src/core/types.ts";

const config: SafeShellConfig = {
  // Start from the standard security preset
  preset: "standard",

  // Extend permissions from the preset
  permissions: {
    // Additional allowed commands beyond the preset
    // Note: These merge with preset permissions (union)
    run: ["git", "deno"],
  },

  // Configure external command behavior
  external: {
    // Git with safety restrictions
    git: {
      allow: true, // Allow all git subcommands

      // Deny dangerous flags that could cause data loss
      denyFlags: ["--force", "-f", "--hard"],

      // Validate path arguments to prevent access outside sandbox
      pathArgs: {
        autoDetect: true, // Automatically detect path-like arguments
        validateSandbox: true, // Ensure paths are within allowed directories
      },
    },

    // Deno with specific allowed subcommands
    deno: {
      allow: ["test", "fmt", "lint", "check", "task"], // Only these subcommands
      denyFlags: ["--allow-all", "-A"], // Deny overly permissive flags
    },
  },

  // Environment variable configuration
  env: {
    // Allow these environment variables to be accessed
    allow: [
      "HOME",
      "PATH",
      "TERM",
      "EDITOR",
      "SHELL",
      "USER",
      "LANG",
      "DENO_DIR", // Project-specific variables
    ],

    // Mask sensitive variables (never expose these)
    mask: [
      "*_KEY",
      "*_SECRET",
      "*_TOKEN",
      "*_PASSWORD",
      "AWS_*",
      "GITHUB_TOKEN",
    ],
  },

  // Import policy
  imports: {
    // Trusted imports (always allowed)
    trusted: ["jsr:@std/*", "safesh:*"],

    // Allow JSR imports (more permissive than preset default)
    allowed: ["jsr:*"],

    // Still block risky imports
    blocked: ["npm:*", "http:*", "https:*"],
  },

  // Define project tasks
  tasks: {
    // Simple command task
    test: {
      cmd: 'await $("deno", ["test", "--allow-all"])',
    },

    // Format code
    fmt: {
      cmd: 'await $("deno", ["fmt"])',
    },

    // Lint code
    lint: {
      cmd: 'await $("deno", ["lint"])',
    },

    // Run all checks in parallel
    check: {
      parallel: ["fmt", "lint", "test"],
    },

    // Example of task reference (alias)
    ci: "check",
  },

  // Timeout for operations (milliseconds)
  timeout: 30000, // 30 seconds
};

export default config;
