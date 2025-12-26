/**
 * Minimal SafeShell Configuration
 *
 * This is the absolute bare minimum configuration.
 * It provides basic permissions for executing code in the current directory.
 *
 * Use this as a starting point and add only what you need.
 */

import type { SafeShellConfig } from "../src/core/types.ts";

const config: SafeShellConfig = {
  // Basic file system permissions
  permissions: {
    // Allow reading from current directory and /tmp
    read: ["${CWD}", "/tmp"],

    // Allow writing to /tmp only
    write: ["/tmp"],

    // No network access by default
    net: [],

    // No external commands allowed
    run: [],

    // Only essential environment variables
    env: ["HOME", "PATH"],
  },

  // No external commands configured
  external: {},

  // Environment variable handling
  env: {
    // Only allow these specific environment variables
    allow: ["HOME", "PATH"],

    // Mask sensitive environment variables (never expose these)
    mask: ["*_KEY", "*_SECRET", "*_TOKEN", "*_PASSWORD"],
  },

  // Import security - block risky imports
  imports: {
    // These imports are always allowed
    trusted: ["jsr:@std/*", "safesh:*"],

    // No additional imports allowed
    allowed: [],

    // Block potentially dangerous imports
    blocked: ["npm:*", "http:*", "https:*"],
  },

  // No tasks defined
  tasks: {},

  // Default timeout: 30 seconds
  timeout: 30000,
};

export default config;
