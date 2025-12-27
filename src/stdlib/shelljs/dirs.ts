/**
 * Directory stack commands - cd, pwd, pushd, popd, dirs
 *
 * @module
 */

import { resolve } from "@std/path";
import { ShellString, ShellArray } from "./types.ts";
import { expandTilde } from "./common.ts";

/**
 * Directory stack state
 */
const dirStack: string[] = [];

/**
 * Get current working directory
 *
 * @returns ShellString with current directory
 *
 * @example
 * ```ts
 * console.log(pwd().toString()); // "/Users/john/projects"
 * ```
 */
export function pwd(): ShellString {
  return ShellString.ok(Deno.cwd() + "\n");
}

/**
 * Change current working directory
 *
 * @param dir - Directory to change to (default: HOME)
 * @returns ShellString indicating success or failure
 *
 * @example
 * ```ts
 * cd("/tmp");
 * cd("~");  // Go to home
 * cd();     // Go to home
 * cd("-");  // Go to previous directory
 * ```
 */
export function cd(dir?: string): ShellString {
  try {
    let target: string;

    if (!dir || dir === "") {
      // cd with no args goes to HOME
      target = Deno.env.get("HOME") ?? "/";
    } else if (dir === "-") {
      // cd - goes to previous directory
      const oldPwd = Deno.env.get("OLDPWD");
      if (!oldPwd) {
        return ShellString.error("cd: OLDPWD not set", 1);
      }
      target = oldPwd;
    } else {
      target = expandTilde(dir);
    }

    const resolvedTarget = resolve(target);
    const oldDir = Deno.cwd();

    Deno.chdir(resolvedTarget);

    // Set OLDPWD for cd -
    Deno.env.set("OLDPWD", oldDir);

    return ShellString.ok("");
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return ShellString.error(`cd: ${dir}: No such file or directory`, 1);
    }
    if (e instanceof Deno.errors.PermissionDenied) {
      return ShellString.error(`cd: ${dir}: Permission denied`, 1);
    }
    return ShellString.error(`cd: ${dir}: ${e}`, 1);
  }
}

/**
 * Options for pushd command
 */
export interface PushdOptions {
  /** Don't change directory, only manipulate stack */
  noChange?: boolean;
  /** Suppress output */
  quiet?: boolean;
}

/**
 * Push directory onto stack and cd to it
 *
 * @param dir - Directory to push
 * @param options - Pushd options
 * @returns Array of directories in stack
 *
 * @example
 * ```ts
 * pushd("/tmp");       // Push /tmp and cd to it
 * pushd("+1");         // Rotate stack
 * pushd("-n", "/var"); // Push without changing directory
 * ```
 */
export function pushd(
  dir?: string,
  options: PushdOptions = {},
): ShellArray<string> {
  try {
    const cwd = Deno.cwd();

    // Handle rotation (+N or -N)
    if (dir && (dir.match(/^\+\d+$/) || dir.match(/^-\d+$/))) {
      return rotateStack(dir, options);
    }

    // Push current directory onto stack
    dirStack.push(cwd);

    // Determine target directory
    let target = dir ? expandTilde(dir) : undefined;

    if (!target) {
      // No arg: swap top two entries
      if (dirStack.length < 2) {
        return ShellArray.error("pushd: no other directory", 1);
      }
      const top = dirStack.pop()!;
      target = dirStack.pop()!;
      dirStack.push(target);
      dirStack.push(top);
    }

    // Change to target unless -n
    if (!options.noChange) {
      const resolved = resolve(target);
      Deno.chdir(resolved);
    }

    const stack = getFullStack();

    if (!options.quiet) {
      return new ShellArray(stack, "", 0);
    }

    return new ShellArray(stack, "", 0);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return ShellArray.error(`pushd: ${dir}: No such file or directory`, 1);
    }
    return ShellArray.error(`pushd: ${e}`, 1);
  }
}

/**
 * Options for popd command
 */
export interface PopdOptions {
  /** Don't change directory, only manipulate stack */
  noChange?: boolean;
  /** Suppress output */
  quiet?: boolean;
}

/**
 * Pop directory from stack and cd to it
 *
 * @param options - Popd options
 * @returns Array of directories in stack
 *
 * @example
 * ```ts
 * popd();     // Pop and cd to top of stack
 * popd("+1"); // Remove specific entry
 * popd("-n"); // Pop without changing directory
 * ```
 */
export function popd(
  arg?: string,
  options: PopdOptions = {},
): ShellArray<string> {
  try {
    if (dirStack.length === 0) {
      return ShellArray.error("popd: directory stack empty", 1);
    }

    // Handle index (+N or -N)
    if (arg && (arg.match(/^\+\d+$/) || arg.match(/^-\d+$/))) {
      return removeFromStack(arg, options);
    }

    const target = dirStack.pop()!;

    // Change to target unless -n
    if (!options.noChange) {
      Deno.chdir(target);
    }

    const stack = getFullStack();

    if (!options.quiet) {
      return new ShellArray(stack, "", 0);
    }

    return new ShellArray(stack, "", 0);
  } catch (e) {
    return ShellArray.error(`popd: ${e}`, 1);
  }
}

/**
 * Options for dirs command
 */
export interface DirsOptions {
  /** Clear the directory stack */
  clear?: boolean;
  /** Suppress output */
  quiet?: boolean;
}

/**
 * Display or manipulate the directory stack
 *
 * @param options - Dirs options
 * @returns Array of directories in stack
 *
 * @example
 * ```ts
 * dirs();        // Show stack
 * dirs("-c");    // Clear stack
 * dirs("+1");    // Show specific entry
 * ```
 */
export function dirs(
  arg?: string,
  options: DirsOptions = {},
): ShellArray<string> {
  // Handle -c (clear)
  if (options.clear) {
    dirStack.length = 0;
    return new ShellArray([], "", 0);
  }

  const stack = getFullStack();

  // Handle +N or -N (get specific entry)
  if (arg && (arg.match(/^\+\d+$/) || arg.match(/^-\d+$/))) {
    const index = getStackIndex(arg, stack.length);
    if (index < 0 || index >= stack.length) {
      return ShellArray.error(`dirs: ${arg}: directory stack index out of range`, 1);
    }
    return new ShellArray([stack[index]!], "", 0);
  }

  return new ShellArray(stack, "", 0);
}

/**
 * Get full stack including current directory
 */
function getFullStack(): string[] {
  return [Deno.cwd(), ...dirStack.slice().reverse()];
}

/**
 * Convert +N/-N to stack index
 */
function getStackIndex(arg: string, stackLength: number): number {
  const n = parseInt(arg.slice(1), 10);
  if (arg.startsWith("+")) {
    return n;
  } else {
    return stackLength - 1 - n;
  }
}

/**
 * Rotate stack
 */
function rotateStack(arg: string, options: PushdOptions): ShellArray<string> {
  const stack = getFullStack();
  const index = getStackIndex(arg, stack.length);

  if (index < 0 || index >= stack.length) {
    return ShellArray.error(`pushd: ${arg}: directory stack index out of range`, 1);
  }

  // Rotate stack to bring index to front
  const rotated = [...stack.slice(index), ...stack.slice(0, index)];

  // Update internal stack (excluding current directory)
  dirStack.length = 0;
  for (let i = rotated.length - 1; i > 0; i--) {
    dirStack.push(rotated[i]!);
  }

  // Change to new top unless -n
  if (!options.noChange && rotated[0]) {
    Deno.chdir(rotated[0]);
  }

  return new ShellArray(getFullStack(), "", 0);
}

/**
 * Remove entry from stack
 */
function removeFromStack(arg: string, options: PopdOptions): ShellArray<string> {
  const stack = getFullStack();
  const index = getStackIndex(arg, stack.length);

  if (index < 0 || index >= stack.length) {
    return ShellArray.error(`popd: ${arg}: directory stack index out of range`, 1);
  }

  if (index === 0) {
    // Remove current directory (same as regular popd)
    return popd(undefined, options);
  }

  // Remove from internal stack (adjusting for reversed order)
  const internalIndex = dirStack.length - index;
  dirStack.splice(internalIndex, 1);

  return new ShellArray(getFullStack(), "", 0);
}

/**
 * Get temp directory path
 *
 * @returns Path to system temp directory
 */
export function tempdir(): string {
  // Deno doesn't have direct tempdir access, but we can check common locations
  const tmp = Deno.env.get("TMPDIR") ||
    Deno.env.get("TMP") ||
    Deno.env.get("TEMP") ||
    "/tmp";

  return tmp;
}
