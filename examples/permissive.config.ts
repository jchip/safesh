/**
 * Permissive SafeShell Configuration
 *
 * This configuration uses the "permissive" preset for maximum flexibility
 * during development. Use this for local development with trusted code.
 *
 * The permissive preset provides:
 * - Read access to current directory, /tmp, and home directory
 * - Write access to current directory and /tmp
 * - Unrestricted network access
 * - Common dev tools allowed (git, deno, node, npm, docker, etc.)
 * - JSR imports allowed
 * - Still blocks HTTP/HTTPS remote imports for safety
 *
 * Good for: Local development, prototyping, trusted code execution
 * WARNING: Do NOT use for untrusted code or production!
 */

import type { SafeShellConfig } from "../src/core/types.ts";

const config: SafeShellConfig = {
  // Start from the permissive preset
  preset: "permissive",

  // Broad permissions for development
  permissions: {
    // Read from project, home, and temp
    read: ["${CWD}", "/tmp", "${HOME}"],

    // Write to project and temp
    write: ["${CWD}", "/tmp"],

    // Unrestricted network access (needed for package managers, API calls, etc.)
    net: true,

    // Common development tools
    run: [
      "git",
      "deno",
      "node",
      "npm",
      "pnpm",
      "yarn",
      "docker",
      "make",
      "curl", // Added for API testing
      "jq", // Added for JSON processing
    ],

    // All common environment variables
    env: [
      "HOME",
      "PATH",
      "TERM",
      "USER",
      "LANG",
      "EDITOR",
      "SHELL",
      "DENO_*",
      "NODE_*",
    ],
  },

  // Configure common development tools
  external: {
    // Git with minimal restrictions
    git: {
      allow: true,
      // Still deny the most dangerous operations
      denyFlags: ["--force-with-lease"],
      pathArgs: { autoDetect: true, validateSandbox: true },
    },

    // Deno unrestricted
    deno: {
      allow: true,
    },

    // Node unrestricted
    node: {
      allow: true,
    },

    // Package managers unrestricted
    npm: { allow: true },
    pnpm: { allow: true },
    yarn: { allow: true },

    // Docker with path validation (important!)
    docker: {
      allow: true,
      pathArgs: {
        autoDetect: true,
        validateSandbox: true, // Prevent mounting sensitive directories
      },
    },

    // Make unrestricted
    make: { allow: true },

    // Curl for API testing
    curl: {
      allow: true,
      // Prevent file operations that could leak data
      denyFlags: ["--upload-file", "-T", "--output", "-o"],
    },

    // jq for JSON processing
    jq: { allow: true },
  },

  // Permissive environment handling
  env: {
    // Allow most environment variables
    allow: [
      "HOME",
      "PATH",
      "TERM",
      "EDITOR",
      "SHELL",
      "USER",
      "LANG",
      "LC_*",
      "DENO_*",
      "NODE_*",
      "NPM_*",
      "CI", // For CI/CD environments
    ],

    // Still mask sensitive credentials
    mask: [
      "*_KEY",
      "*_SECRET",
      "*_TOKEN",
      "*_PASSWORD",
      "*_PRIVATE*",
      "AWS_SECRET*",
      "GITHUB_TOKEN",
    ],
  },

  // Relaxed import policy
  imports: {
    // Trust standard libraries
    trusted: ["jsr:@std/*", "safesh:*"],

    // Allow all JSR imports
    allowed: ["jsr:*"],

    // Still block remote HTTP imports (security risk)
    blocked: ["http:*", "https:*"],
  },

  // Example development tasks
  tasks: {
    // Development server
    dev: {
      cmd: 'await $("deno", ["task", "dev"])',
    },

    // Run tests
    test: {
      cmd: 'await $("deno", ["test", "--allow-all"])',
    },

    // Build project
    build: {
      cmd: 'await $("deno", ["task", "build"])',
    },

    // Format and lint
    fmt: {
      cmd: 'await $("deno", ["fmt"])',
    },

    lint: {
      cmd: 'await $("deno", ["lint"])',
    },

    // Git operations
    "git-status": {
      cmd: 'await $("git", ["status"])',
    },

    "git-diff": {
      cmd: 'await $("git", ["diff"])',
    },

    // Docker operations
    "docker-ps": {
      cmd: 'await $("docker", ["ps"])',
    },

    // Composite tasks
    "pre-commit": {
      serial: ["fmt", "lint", "test"], // Run in order
    },

    "check-all": {
      parallel: ["fmt", "lint", "test"], // Run concurrently
    },

    // Task references
    ci: "check-all",
    verify: "pre-commit",
  },

  // Longer timeout for development tasks
  timeout: 60000, // 60 seconds
};

export default config;
