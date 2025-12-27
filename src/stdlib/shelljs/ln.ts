/**
 * ln command - make links between files
 *
 * @module
 */

import { resolve, dirname } from "@std/path";
import { ShellString } from "./types.ts";
import { parseOptions, expand } from "./common.ts";
import type { SandboxOptions } from "../fs.ts";

/**
 * Options for ln command
 */
export interface LnOptions extends SandboxOptions {
  /** Create symbolic link (default: true) */
  symbolic?: boolean;
  /** Force - remove existing destination files */
  force?: boolean;
}

/**
 * Create links between files
 *
 * @param source - Source file path
 * @param dest - Destination link path
 * @param options - Ln options
 * @returns ShellString indicating success or failure
 *
 * @example
 * ```ts
 * // Create symbolic link (default)
 * await ln("target.txt", "link.txt");
 *
 * // Force overwrite existing link
 * await ln("target.txt", "link.txt", { force: true });
 *
 * // Create hard link
 * await ln("target.txt", "link.txt", { symbolic: false });
 * ```
 */
export async function ln(
  source: string,
  dest: string,
  options: LnOptions = {},
): Promise<ShellString> {
  // Default to symbolic link
  const symbolic = options.symbolic !== false;

  try {
    const resolvedSource = resolve(source);
    const resolvedDest = resolve(dest);

    // Check if source exists (for hard links, must exist)
    if (!symbolic) {
      try {
        await Deno.stat(resolvedSource);
      } catch {
        return ShellString.error(
          `ln: failed to access '${source}': No such file or directory`,
          1,
          options,
        );
      }
    }

    // Handle force option - remove existing destination
    if (options.force) {
      try {
        await Deno.remove(resolvedDest);
      } catch {
        // Ignore if doesn't exist
      }
    }

    // Create the link
    if (symbolic) {
      await Deno.symlink(resolvedSource, resolvedDest);
    } else {
      await Deno.link(resolvedSource, resolvedDest);
    }

    return ShellString.ok("", options);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      return ShellString.error(
        `ln: failed to create ${symbolic ? "symbolic" : "hard"} link '${dest}': File exists`,
        1,
        options,
      );
    }
    if (e instanceof Deno.errors.NotFound) {
      return ShellString.error(
        `ln: failed to create ${symbolic ? "symbolic" : "hard"} link '${dest}': No such file or directory`,
        1,
        options,
      );
    }
    if (e instanceof Deno.errors.PermissionDenied) {
      return ShellString.error(
        `ln: failed to create ${symbolic ? "symbolic" : "hard"} link '${dest}': Permission denied`,
        1,
        options,
      );
    }
    return ShellString.error(`ln: ${e}`, 1, options);
  }
}

/**
 * Parse ln options from command-line style
 */
export function parseLnOptions(
  opts: string | Record<string, unknown>,
): LnOptions {
  const parsed = parseOptions(opts, {
    s: "symbolic",
    f: "force",
  });

  return {
    symbolic: parsed.symbolic as boolean,
    force: parsed.force as boolean,
  };
}
