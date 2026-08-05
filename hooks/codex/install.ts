#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/** Install SafeShell's Codex hooks into the user-level Codex config. */

import { dirname, fromFileUrl, join, resolve } from "@std/path";

export const BEGIN_MARKER = "# BEGIN SAFESH CODEX HOOKS";
export const END_MARKER = "# END SAFESH CODEX HOOKS";

const BASH_PREHOOK_PLACEHOLDER = '"__SAFESH_CODEX_BASH_PREHOOK__"';
const PERMISSION_HOOK_PLACEHOLDER = '"__SAFESH_CODEX_PERMISSION_HOOK__"';
const DEFAULT_TEMPLATE_PATH = fromFileUrl(new URL("./config.toml", import.meta.url));
const DEFAULT_HOOK_DIR = dirname(DEFAULT_TEMPLATE_PATH);
const SAFESH_HOOK_PATH_PATTERN = /hooks[\\/]codex[\\/](?:bash-prehook|safesh-permission-hook)\.ts/;

export interface InstallCodexHooksOptions {
  configPath?: string;
  hookDir?: string;
  templatePath?: string;
}

export interface InstallCodexHooksResult {
  changed: boolean;
  configPath: string;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function replaceExactlyOnce(source: string, placeholder: string, replacement: string): string {
  const count = countOccurrences(source, placeholder);
  if (count !== 1) {
    throw new Error(`Expected exactly one ${placeholder} placeholder, found ${count}`);
  }
  return source.replace(placeholder, replacement);
}

function defaultConfigPath(): string {
  const codexHome = Deno.env.get("CODEX_HOME");
  if (codexHome) return join(codexHome, "config.toml");

  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME or CODEX_HOME is required to locate Codex config.toml");
  return join(home, ".codex", "config.toml");
}

export function renderCodexHookConfig(template: string, hookDir: string): string {
  const absoluteHookDir = resolve(hookDir);
  const bashPrehook = JSON.stringify(shellQuote(join(absoluteHookDir, "bash-prehook.ts")));
  const permissionHook = JSON.stringify(
    shellQuote(join(absoluteHookDir, "safesh-permission-hook.ts")),
  );

  let rendered = replaceExactlyOnce(template, BASH_PREHOOK_PLACEHOLDER, bashPrehook);
  rendered = replaceExactlyOnce(rendered, PERMISSION_HOOK_PLACEHOLDER, permissionHook);

  if (
    countOccurrences(rendered, BEGIN_MARKER) !== 1 ||
    countOccurrences(rendered, END_MARKER) !== 1 ||
    !rendered.startsWith(BEGIN_MARKER) ||
    !rendered.trimEnd().endsWith(END_MARKER)
  ) {
    throw new Error(`Codex hook template must be bounded by ${BEGIN_MARKER} and ${END_MARKER}`);
  }
  return rendered.trimEnd();
}

export function mergeCodexHookConfig(existing: string, managedBlock: string): string {
  const beginCount = countOccurrences(existing, BEGIN_MARKER);
  const endCount = countOccurrences(existing, END_MARKER);
  if (beginCount !== endCount || beginCount > 1) {
    throw new Error(
      `Malformed SafeShell Codex hook block in user config: found ${beginCount} begin and ${endCount} end markers`,
    );
  }

  if (beginCount === 1) {
    const start = existing.indexOf(BEGIN_MARKER);
    const endStart = existing.indexOf(END_MARKER, start);
    if (endStart < start) {
      throw new Error("Malformed SafeShell Codex hook block: end marker precedes begin marker");
    }
    const end = endStart + END_MARKER.length;
    return `${existing.slice(0, start)}${managedBlock}${existing.slice(end)}`;
  }

  if (SAFESH_HOOK_PATH_PATTERN.test(existing)) {
    throw new Error(
      "Existing unmarked SafeShell Codex hooks found in user config; remove those hook tables before installing the managed block",
    );
  }

  const prefix = existing.trimEnd();
  return prefix ? `${prefix}\n\n${managedBlock}\n` : `${managedBlock}\n`;
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
      // Best effort on platforms without POSIX modes.
    }
  } catch (error) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

export async function installCodexHooks(
  options: InstallCodexHooksOptions = {},
): Promise<InstallCodexHooksResult> {
  const configPath = resolve(options.configPath ?? defaultConfigPath());
  const templatePath = resolve(options.templatePath ?? DEFAULT_TEMPLATE_PATH);
  const hookDir = resolve(options.hookDir ?? DEFAULT_HOOK_DIR);
  const [existing, template] = await Promise.all([
    readIfPresent(configPath),
    Deno.readTextFile(templatePath),
  ]);
  const managedBlock = renderCodexHookConfig(template, hookDir);
  const merged = mergeCodexHookConfig(existing, managedBlock);

  if (merged === existing) return { changed: false, configPath };
  await writeConfigAtomically(configPath, merged);
  return { changed: true, configPath };
}

function parseConfigPath(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--config") return args[1];
  throw new Error("Usage: hooks/codex/install.ts [--config /path/to/config.toml]");
}

if (import.meta.main) {
  const result = await installCodexHooks({ configPath: parseConfigPath(Deno.args) });
  console.log(
    `${
      result.changed ? "Installed" : "Already installed"
    } SafeShell Codex hooks in ${result.configPath}`,
  );
}
