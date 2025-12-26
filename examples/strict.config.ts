/**
 * Strict SafeShell Configuration
 *
 * This configuration uses the "strict" preset for maximum security.
 * Use this when executing untrusted code or in production environments.
 *
 * The strict preset provides:
 * - Read access to current directory and /tmp
 * - Write access ONLY to /tmp (not current directory!)
 * - No network access
 * - No external commands
 * - Blocks all risky imports including file:*
 * - Masks all sensitive environment variables
 *
 * Good for: Running untrusted code, AI agent execution, production environments
 */

import type { SafeShellConfig } from "../src/core/types.ts";

const config: SafeShellConfig = {
  // Start from the strict security preset
  preset: "strict",

  // Strict permissions - minimal access
  // Note: In strict mode, even extending permissions should be done carefully
  permissions: {
    // Can only read from current directory and /tmp
    // (already set by preset, shown here for clarity)
    read: ["${CWD}", "/tmp"],

    // Can ONLY write to /tmp (not even current directory)
    write: ["/tmp"],

    // No network access whatsoever
    net: [],

    // No external commands allowed
    run: [],

    // Minimal environment variables
    env: ["HOME", "PATH", "TERM"],
  },

  // No external commands configured
  // In strict mode, you should avoid external commands entirely
  external: {},

  // Strict environment handling
  env: {
    // Only essential environment variables
    allow: ["HOME", "PATH", "TERM"],

    // Aggressively mask anything that could be sensitive
    mask: [
      "*_KEY",
      "*_SECRET",
      "*_TOKEN",
      "*_PASSWORD",
      "*_API*",
      "*_PRIVATE*",
      "AWS_*",
      "GITHUB_*",
      "GCP_*",
      "AZURE_*",
    ],
  },

  // Very strict import policy
  imports: {
    // Only trust Deno standard library and safesh
    trusted: ["jsr:@std/*", "safesh:*"],

    // No additional imports allowed
    allowed: [],

    // Block everything risky
    blocked: [
      "npm:*", // No npm packages
      "http:*", // No HTTP imports
      "https:*", // No HTTPS imports
      "file:*", // No arbitrary file imports
    ],
  },

  // Minimal tasks for basic operations
  tasks: {
    // Simple read-only operations
    "list-files": {
      cmd: 'console.log((await fs.readDir(".")));',
    },

    // File processing (safe, no external commands)
    "process-data": {
      cmd: `
        const data = await fs.readJson("./data.json");
        const processed = data.map(item => ({ ...item, processed: true }));
        await fs.writeJson("/tmp/output.json", processed);
      `,
    },
  },

  // Short timeout for safety
  timeout: 10000, // 10 seconds - fail fast
};

export default config;
