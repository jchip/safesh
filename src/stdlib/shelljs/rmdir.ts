/**
 * ShellJS-style rmdir command
 *
 * Removes empty directories using Deno's sandboxed filesystem APIs.
 *
 * @module
 */

import { ShellString } from "./types.ts";
import { flattenArgs, expandTilde } from "./common.ts";
import { validatePath } from "../../core/permissions.ts";
import { getDefaultConfig } from "../../core/utils.ts";

/**
 * Remove empty directories
 *
 * @param paths - Empty directories to remove
 * @returns ShellString with empty string on success, error message on failure
 *
 * @example
 * ```ts
 * // Remove an empty directory
 * await rmdir("empty-dir");
 *
 * // Remove multiple empty directories
 * await rmdir("dir1", "dir2", "dir3");
 *
 * // Remove using array
 * await rmdir(["dir1", "dir2"]);
 * ```
 */
export async function rmdir(
  ...paths: (string | string[])[]
): Promise<ShellString> {
  const allPaths = flattenArgs(...paths);

  if (allPaths.length === 0) {
    return new ShellString("", "rmdir: no paths given", 1);
  }

  const errors: string[] = [];
  const cwd = Deno.cwd();
  const config = getDefaultConfig(cwd);

  for (const path of allPaths) {
    const expandedPath = expandTilde(path);
    try {
      await validatePath(expandedPath, config, cwd, "write");
      const stat = await Deno.lstat(expandedPath);

      if (!stat.isDirectory) {
        errors.push(`rmdir: ${path}: Not a directory`);
        continue;
      }

      // Try to remove - will fail if not empty
      await Deno.remove(expandedPath, { recursive: false });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        errors.push(`rmdir: ${path}: No such file or directory`);
      } else if (error instanceof Deno.errors.PermissionDenied) {
        errors.push(`rmdir: ${path}: Permission denied`);
      } else {
        // Most likely "Directory not empty" or similar
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`rmdir: ${path}: ${message}`);
      }
    }
  }

  if (errors.length > 0) {
    return new ShellString("", errors.join("\n"), 1);
  }

  return new ShellString("");
}
