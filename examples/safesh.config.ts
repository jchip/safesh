/**
 * Example SafeShell configuration
 *
 * Copy this to your project root as safesh.config.ts
 */

import { defineConfig } from "../src/mod.ts";

export default defineConfig({
  // Deno permissions - what the sandbox can access
  permissions: {
    read: ["${CWD}", "/tmp", "${HOME}/.config"],
    write: ["${CWD}", "/tmp"],
    net: ["github.com", "api.github.com", "registry.npmjs.org"],
    run: ["git", "docker", "deno"],
    env: ["HOME", "PATH", "NODE_ENV", "EDITOR"],
  },

  // Fine-grained external command control
  external: {
    git: {
      allow: true, // All subcommands
      denyFlags: ["--force", "-f", "--hard"],
      pathArgs: { autoDetect: true, validateSandbox: true },
    },
    docker: {
      allow: ["ps", "logs", "build", "images"],
      denyFlags: ["--privileged", "-v", "--volume"],
    },
    deno: {
      allow: ["run", "check", "test", "fmt", "lint"],
    },
  },

  // Environment variable handling
  env: {
    allow: ["HOME", "PATH", "NODE_ENV", "EDITOR", "TERM"],
    mask: ["*_KEY", "*_SECRET", "*_TOKEN", "AWS_*", "GITHUB_TOKEN"],
  },

  // Import security
  imports: {
    trusted: ["jsr:@std/*", "safesh:*"],
    allowed: [],
    blocked: ["npm:*", "http:*", "https:*"],
  },

  // Task definitions
  tasks: {
    build: "deno task build",
    test: "deno test --allow-read",
    lint: "deno lint",
    dev: {
      parallel: ["watch", "serve"],
    },
    ci: {
      serial: ["lint", "test", "build"],
    },
  },

  // Default timeout (30 seconds)
  timeout: 30000,
});
