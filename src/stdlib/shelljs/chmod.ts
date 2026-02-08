/**
 * chmod command - change file mode bits
 *
 * @module
 */

import { resolve } from "@std/path";
import { ShellString } from "./types.ts";
import { parseOptions, expand, PERMS } from "./common.ts";
import * as fs from "../fs.ts";
import type { SandboxOptions } from "../fs.ts";
import { validatePath } from "../../core/permissions.ts";
import { getDefaultConfig } from "../../core/utils.ts";

/**
 * Options for chmod command
 */
export interface ChmodOptions extends SandboxOptions {
  /** Verbose - output diagnostic for every file */
  verbose?: boolean;
  /** Changes - like verbose but only report when change made */
  changes?: boolean;
  /** Recursive - change files and directories recursively */
  recursive?: boolean;
}

/**
 * Change file mode bits
 *
 * @param mode - Permission mode (octal number, octal string, or symbolic)
 * @param files - File path(s) to modify
 * @param options - Chmod options
 * @returns ShellString indicating success or failure
 *
 * @example
 * ```ts
 * // Octal mode
 * await chmod(755, "script.sh");
 * await chmod("644", "config.txt");
 *
 * // Symbolic mode
 * await chmod("u+x", "script.sh");
 * await chmod("go-w", "config.txt");
 * await chmod("a+r", "public/*");
 *
 * // Recursive
 * await chmod("755", "dist", { recursive: true });
 * ```
 */
export async function chmod(
  mode: number | string,
  files: string | string[],
  options: ChmodOptions = {},
): Promise<ShellString> {
  const fileList = Array.isArray(files) ? files : [files];

  if (fileList.length === 0) {
    return ShellString.error("chmod: missing operand", 1, options);
  }

  // Expand globs
  let expandedFiles = await expand(fileList, options);

  // If recursive, add all nested files
  if (options.recursive) {
    expandedFiles = await expandRecursive(expandedFiles);
  }

  const errors: string[] = [];
  const output: string[] = [];

  const cwd = Deno.cwd();
  const config = getDefaultConfig(cwd);
  for (const file of expandedFiles) {
    try {
      const resolvedPath = resolve(file);
      await validatePath(resolvedPath, config, cwd, "write");
      const stat = await Deno.stat(resolvedPath);

      // Skip symlinks in recursive mode
      if (options.recursive) {
        const lstat = await Deno.lstat(resolvedPath);
        if (lstat.isSymlink) continue;
      }

      const oldMode = stat.mode ?? 0;
      const newMode = calculateMode(mode, oldMode, stat.isDirectory);

      if (oldMode !== newMode) {
        await Deno.chmod(resolvedPath, newMode);

        if (options.verbose || options.changes) {
          output.push(
            `mode of '${file}' changed from ${formatMode(oldMode)} to ${formatMode(newMode)}`,
          );
        }
      } else if (options.verbose) {
        output.push(`mode of '${file}' retained as ${formatMode(oldMode)}`);
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        errors.push(`chmod: cannot access '${file}': No such file or directory`);
      } else if (e instanceof Deno.errors.PermissionDenied) {
        errors.push(`chmod: changing permissions of '${file}': Operation not permitted`);
      } else {
        errors.push(`chmod: ${file}: ${e}`);
      }
    }
  }

  const stdout = output.join("\n") + (output.length > 0 ? "\n" : "");
  const stderr = errors.join("\n");
  const code = errors.length > 0 ? 1 : 0;

  return new ShellString(stdout, stderr, code, options);
}

/**
 * Expand file list recursively
 */
async function expandRecursive(files: string[]): Promise<string[]> {
  const result: string[] = [];

  async function addFile(path: string) {
    const stat = await Deno.lstat(path);

    if (stat.isSymlink) return;

    result.push(path);

    if (stat.isDirectory) {
      for await (const entry of Deno.readDir(path)) {
        await addFile(`${path}/${entry.name}`);
      }
    }
  }

  for (const file of files) {
    await addFile(file);
  }

  return result;
}

/**
 * Calculate new mode from mode specification
 */
function calculateMode(
  mode: number | string,
  currentMode: number,
  isDir: boolean,
): number {
  const typeMask = currentMode & PERMS.TYPE_MASK;

  // If mode is a number, treat the digits as octal (like shelljs)
  // e.g., chmod(755, file) means chmod 0o755, not chmod 755 decimal
  if (typeof mode === "number") {
    const octalMode = parseInt(String(mode), 8);
    return typeMask | (octalMode & 0o7777);
  }

  // If mode is an octal string
  const octalMatch = mode.match(/^[0-7]{1,4}$/);
  if (octalMatch) {
    return typeMask | parseInt(mode, 8);
  }

  // Parse symbolic mode
  let newMode = currentMode & 0o7777; // Start with current permissions

  const parts = mode.split(",");
  for (const part of parts) {
    const match = part.match(/^([ugoa]*)([=+-])([rwxXst]*)$/);
    if (!match) {
      throw new Error(`chmod: invalid mode: '${part}'`);
    }

    const who = match[1] ?? "";
    const op = match[2] ?? "";
    const perms = match[3] ?? "";

    // Determine which bits to affect
    const applyOwner = who === "" || who.includes("u") || who.includes("a");
    const applyGroup = who === "" || who.includes("g") || who.includes("a");
    const applyOther = who === "" || who.includes("o") || who.includes("a");

    // Calculate permission mask
    let mask = 0;

    const hasRead = perms.includes("r");
    const hasWrite = perms.includes("w");
    const hasExec = perms.includes("x");
    const hasDirExec = perms.includes("X");
    const hasSticky = perms.includes("t");
    const hasSetuid = perms.includes("s");

    // X means execute only if directory or already has execute
    const addExec = hasExec || (hasDirExec && (isDir || (currentMode & 0o111) !== 0));

    if (applyOwner) {
      if (hasRead) mask |= PERMS.OWNER_READ;
      if (hasWrite) mask |= PERMS.OWNER_WRITE;
      if (addExec) mask |= PERMS.OWNER_EXEC;
      if (hasSetuid) mask |= PERMS.SETUID;
    }
    if (applyGroup) {
      if (hasRead) mask |= PERMS.GROUP_READ;
      if (hasWrite) mask |= PERMS.GROUP_WRITE;
      if (addExec) mask |= PERMS.GROUP_EXEC;
      if (hasSetuid) mask |= PERMS.SETGID;
    }
    if (applyOther) {
      if (hasRead) mask |= PERMS.OTHER_READ;
      if (hasWrite) mask |= PERMS.OTHER_WRITE;
      if (addExec) mask |= PERMS.OTHER_EXEC;
    }
    if (hasSticky) {
      mask |= PERMS.STICKY;
    }

    // Apply operation
    switch (op) {
      case "+":
        newMode |= mask;
        break;
      case "-":
        newMode &= ~mask;
        break;
      case "=":
        // Clear affected bits first
        let clearMask = 0;
        if (applyOwner) clearMask |= 0o700;
        if (applyGroup) clearMask |= 0o070;
        if (applyOther) clearMask |= 0o007;
        newMode = (newMode & ~clearMask) | mask;
        break;
    }
  }

  return typeMask | newMode;
}

/**
 * Format mode as octal string
 */
function formatMode(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

/**
 * Parse chmod options from command-line style
 */
export function parseChmodOptions(
  opts: string | Record<string, unknown>,
): ChmodOptions {
  const parsed = parseOptions(opts, {
    v: "verbose",
    c: "changes",
    R: "recursive",
  });

  return {
    verbose: parsed.verbose as boolean,
    changes: parsed.changes as boolean,
    recursive: parsed.recursive as boolean,
  };
}
