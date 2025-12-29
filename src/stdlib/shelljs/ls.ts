/**
 * ShellJS-style ls command
 *
 * Lists directory contents using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { join, basename } from "@std/path";
import { ShellArray } from "./types.ts";
import { parseOptions, flattenArgs, isGlob, expand } from "./common.ts";
import type { OptionsMap } from "./types.ts";

/** Options for ls command */
export interface LsOptions {
  /** Show hidden files (starting with .) */
  all?: boolean;
  /** List directories themselves, not their contents */
  directory?: boolean;
  /** Long format with details */
  long?: boolean;
  /** Recursive listing */
  recursive?: boolean;
}

const OPTIONS_MAP: OptionsMap = {
  a: "all",
  A: "all",
  d: "directory",
  l: "long",
  R: "recursive",
};

/**
 * Parse ls options from string
 */
export function parseLsOptions(optStr: string): LsOptions {
  return parseOptions(optStr, OPTIONS_MAP) as LsOptions;
}

/** Entry information for long format */
interface LsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  mode: number | null;
}

/**
 * Format mode as permission string (e.g., drwxr-xr-x)
 */
function formatMode(mode: number | null, isDir: boolean, isSymlink: boolean): string {
  if (mode === null) return "----------";

  const type = isSymlink ? "l" : isDir ? "d" : "-";
  const perms = [
    (mode & 0o400) ? "r" : "-",
    (mode & 0o200) ? "w" : "-",
    (mode & 0o100) ? "x" : "-",
    (mode & 0o040) ? "r" : "-",
    (mode & 0o020) ? "w" : "-",
    (mode & 0o010) ? "x" : "-",
    (mode & 0o004) ? "r" : "-",
    (mode & 0o002) ? "w" : "-",
    (mode & 0o001) ? "x" : "-",
  ].join("");

  return type + perms;
}

/**
 * Format size for display
 */
function formatSize(size: number): string {
  return size.toString().padStart(8);
}

/**
 * Format date for display
 */
function formatDate(date: Date | null): string {
  if (!date) return "            ";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2);
  const hours = date.getHours().toString().padStart(2, "0");
  const mins = date.getMinutes().toString().padStart(2, "0");
  return `${month} ${day} ${hours}:${mins}`;
}

/**
 * List directory contents
 *
 * @param options - Options string (e.g., "-la") or LsOptions object
 * @param paths - Directories/files to list (defaults to current directory)
 * @returns ShellArray with file names
 *
 * @example
 * ```ts
 * // List current directory
 * const files = await ls();
 *
 * // List with hidden files
 * const all = await ls("-a");
 *
 * // Long format
 * const details = await ls("-l", "src/");
 *
 * // Recursive
 * const tree = await ls("-R", ".");
 *
 * // Multiple paths
 * const multi = await ls("dir1", "dir2");
 * ```
 */
export async function ls(
  optionsOrPath?: string | LsOptions,
  ...paths: (string | string[])[]
): Promise<ShellArray<string>> {
  let options: LsOptions = {};
  let allPaths: string[];

  // Parse arguments
  if (optionsOrPath === undefined) {
    allPaths = ["."];
  } else if (typeof optionsOrPath === "string" && optionsOrPath.startsWith("-")) {
    options = parseLsOptions(optionsOrPath);
    allPaths = flattenArgs(...paths);
    if (allPaths.length === 0) allPaths = ["."];
  } else if (typeof optionsOrPath === "object" && !Array.isArray(optionsOrPath)) {
    options = optionsOrPath;
    allPaths = flattenArgs(...paths);
    if (allPaths.length === 0) allPaths = ["."];
  } else {
    allPaths = flattenArgs(optionsOrPath as string, ...paths);
  }

  const results: string[] = [];
  const entries: LsEntry[] = [];

  async function listPath(path: string, prefix = ""): Promise<void> {
    // Expand globs
    const expandedPaths = isGlob(path) ? await expand([path]) : [path];

    for (const expandedPath of expandedPaths) {
      try {
        const stat = await Deno.lstat(expandedPath);

        if (stat.isDirectory && !options.directory) {
          // List directory contents
          for await (const entry of Deno.readDir(expandedPath)) {
            // Skip hidden files unless -a
            if (!options.all && entry.name.startsWith(".")) {
              continue;
            }

            const fullPath = join(expandedPath, entry.name);
            const entryStat = await Deno.lstat(fullPath);

            if (options.long) {
              entries.push({
                name: prefix ? join(prefix, entry.name) : entry.name,
                path: fullPath,
                isDirectory: entry.isDirectory,
                isSymlink: entry.isSymlink,
                size: entryStat.size,
                mtime: entryStat.mtime,
                mode: entryStat.mode,
              });
            } else {
              results.push(prefix ? join(prefix, entry.name) : entry.name);
            }

            // Recurse into subdirectories
            if (options.recursive && entry.isDirectory) {
              await listPath(fullPath, prefix ? join(prefix, entry.name) : entry.name);
            }
          }
        } else {
          // It's a file or -d was specified
          if (options.long) {
            entries.push({
              name: prefix ? join(prefix, basename(expandedPath)) : basename(expandedPath),
              path: expandedPath,
              isDirectory: stat.isDirectory,
              isSymlink: stat.isSymlink,
              size: stat.size,
              mtime: stat.mtime,
              mode: stat.mode,
            });
          } else {
            results.push(prefix ? join(prefix, basename(expandedPath)) : basename(expandedPath));
          }
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          // Skip non-existent files in glob expansion
          if (!isGlob(path)) {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }
  }

  try {
    for (const path of allPaths) {
      await listPath(path);
    }

    if (options.long) {
      // Format long output
      for (const entry of entries) {
        const mode = formatMode(entry.mode, entry.isDirectory, entry.isSymlink);
        const size = formatSize(entry.size);
        const date = formatDate(entry.mtime);
        results.push(`${mode} ${size} ${date} ${entry.name}`);
      }
    }

    return new ShellArray(results);
  } catch (error) {
    const errMsg = error instanceof Deno.errors.NotFound
      ? "No such file or directory"
      : error instanceof Deno.errors.PermissionDenied
        ? "Permission denied"
        : (error instanceof Error ? error.message : String(error));
    return new ShellArray([], `ls: ${errMsg}`, 1);
  }
}
