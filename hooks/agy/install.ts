#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/** Install SafeShell's Antigravity CLI (agy) hooks into the user or workspace config. */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

export const MANAGED_HOOK_NAME = "safesh";

const BASH_PREHOOK_PLACEHOLDER = "__SAFESH_AGY_BASH_PREHOOK__";
const DEFAULT_TEMPLATE_PATH = fromFileUrl(new URL("./hooks.json", import.meta.url));
const DEFAULT_HOOK_DIR = dirname(DEFAULT_TEMPLATE_PATH);

export interface InstallAgyHooksOptions {
  configPath?: string;
  hookDir?: string;
  templatePath?: string;
  scope?: "global" | "workspace";
  workspaceDir?: string;
  uninstall?: boolean;
}

export interface InstallAgyHooksResult {
  changed: boolean;
  configPath: string;
  uninstalled?: boolean;
}

export function defaultConfigPath(
  scope: "global" | "workspace" = "global",
  workspaceDir?: string,
): string {
  if (scope === "workspace") {
    const base = workspaceDir ?? Deno.cwd();
    return join(base, ".agents", "hooks.json");
  }

  const geminiConfigDir = Deno.env.get("GEMINI_CONFIG_DIR");
  if (geminiConfigDir) return join(geminiConfigDir, "hooks.json");

  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME or GEMINI_CONFIG_DIR is required to locate hooks.json");
  return join(home, ".gemini", "config", "hooks.json");
}

export function renderAgyHookConfig(
  template: string,
  hookDir: string,
): Record<string, unknown> {
  const absoluteHookDir = resolve(hookDir);
  const hookScriptPath = join(absoluteHookDir, "bash-prehook.ts");

  if (!template.includes(BASH_PREHOOK_PLACEHOLDER)) {
    throw new Error(`Expected ${BASH_PREHOOK_PLACEHOLDER} placeholder in template`);
  }

  const renderedJson = template.replaceAll(
    BASH_PREHOOK_PLACEHOLDER,
    hookScriptPath,
  );

  try {
    return JSON.parse(renderedJson);
  } catch (error) {
    throw new Error(`Failed to parse rendered hook template as JSON: ${error}`);
  }
}

export function mergeAgyHookConfig(
  existing: string,
  renderedHookConfig: Record<string, unknown>,
): string {
  const trimmed = existing.trim();
  let existingObj: Record<string, unknown> = {};

  if (trimmed) {
    try {
      existingObj = JSON.parse(trimmed);
      if (typeof existingObj !== "object" || existingObj === null || Array.isArray(existingObj)) {
        throw new Error("Top-level JSON must be an object");
      }
    } catch (error) {
      throw new Error(`Existing hooks.json is not valid JSON: ${error}`);
    }
  }

  const managedHook = renderedHookConfig[MANAGED_HOOK_NAME];
  if (!managedHook) {
    throw new Error(`Rendered template missing ${MANAGED_HOOK_NAME} key`);
  }

  existingObj[MANAGED_HOOK_NAME] = managedHook;
  return JSON.stringify(existingObj, null, 2) + "\n";
}

export function uninstallAgyHookConfig(
  existing: string,
): { content: string; changed: boolean } {
  const trimmed = existing.trim();
  if (!trimmed) {
    return { content: "", changed: false };
  }

  let existingObj: Record<string, unknown>;
  try {
    existingObj = JSON.parse(trimmed);
    if (typeof existingObj !== "object" || existingObj === null || Array.isArray(existingObj)) {
      throw new Error("Top-level JSON must be an object");
    }
  } catch (error) {
    throw new Error(`Existing hooks.json is not valid JSON: ${error}`);
  }

  if (!(MANAGED_HOOK_NAME in existingObj)) {
    return { content: existing, changed: false };
  }

  delete existingObj[MANAGED_HOOK_NAME];
  return {
    content: JSON.stringify(existingObj, null, 2) + "\n",
    changed: true,
  };
}

async function readIfPresent(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "";
    throw error;
  }
}

async function writeConfigAtomically(path: string, content: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.safesh-${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(tempPath, content, { mode: 0o600 });
    await Deno.rename(tempPath, path);
    try {
      await Deno.chmod(path, 0o600);
    } catch {
      // Best effort on non-POSIX platforms
    }
  } catch (error) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // Temporary file may not have been created
    }
    throw error;
  }
}

export async function installAgyHooks(
  options: InstallAgyHooksOptions = {},
): Promise<InstallAgyHooksResult> {
  const configPath = resolve(
    options.configPath ?? defaultConfigPath(options.scope, options.workspaceDir),
  );
  const existing = await readIfPresent(configPath);

  if (options.uninstall) {
    const { content, changed } = uninstallAgyHookConfig(existing);
    if (!changed) return { changed: false, configPath, uninstalled: true };
    await writeConfigAtomically(configPath, content);
    return { changed: true, configPath, uninstalled: true };
  }

  const templatePath = resolve(options.templatePath ?? DEFAULT_TEMPLATE_PATH);
  const hookDir = resolve(options.hookDir ?? DEFAULT_HOOK_DIR);
  const template = await Deno.readTextFile(templatePath);

  const rendered = renderAgyHookConfig(template, hookDir);
  const merged = mergeAgyHookConfig(existing, rendered);

  if (merged === existing) return { changed: false, configPath };
  await writeConfigAtomically(configPath, merged);
  return { changed: true, configPath };
}

export function parseCliArgs(args: string[]): InstallAgyHooksOptions & { verify?: boolean } {
  const options: InstallAgyHooksOptions & { verify?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--config" && i + 1 < args.length) {
      options.configPath = args[++i];
    } else if (arg === "--workspace") {
      options.scope = "workspace";
      if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        options.workspaceDir = args[++i];
      }
    } else if (arg === "--global") {
      options.scope = "global";
    } else if (arg === "--uninstall") {
      options.uninstall = true;
    } else if (arg === "--verify" || arg === "--check") {
      options.verify = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`SafeShell Antigravity CLI Hook Installer

Usage:
  deno task install:agy-hooks [options]

Options:
  --global            Install to user configuration (~/.gemini/config/hooks.json) [default]
  --workspace [dir]   Install to project workspace (.agents/hooks.json)
  --config <path>     Explicit path to hooks.json
  --uninstall         Remove SafeShell hooks from the configuration
  --verify, --check   Verify if SafeShell hooks are installed and valid
  --help, -h          Show this help message
`);
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  return options;
}

if (import.meta.main) {
  try {
    const opts = parseCliArgs(Deno.args);

    if (opts.verify) {
      const configPath = resolve(opts.configPath ?? defaultConfigPath(opts.scope, opts.workspaceDir));
      const content = await readIfPresent(configPath);
      if (!content) {
        console.error(`Error: hooks config file not found at ${configPath}`);
        Deno.exit(1);
      }
      try {
        const parsed = JSON.parse(content);
        if (parsed[MANAGED_HOOK_NAME]?.enabled) {
          console.log(`Verified: SafeShell hooks active in ${configPath}`);
          Deno.exit(0);
        } else {
          console.error(`Error: SafeShell hook not found or disabled in ${configPath}`);
          Deno.exit(1);
        }
      } catch (e) {
        console.error(`Error: invalid JSON in ${configPath}: ${e}`);
        Deno.exit(1);
      }
    }

    const result = await installAgyHooks(opts);
    if (result.uninstalled) {
      console.log(
        `${result.changed ? "Uninstalled" : "Already uninstalled"} SafeShell agy hooks from ${result.configPath}`,
      );
    } else {
      console.log(
        `${result.changed ? "Installed" : "Already installed"} SafeShell agy hooks in ${result.configPath}`,
      );
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}
