/**
 * File system utilities
 *
 * All functions respect the sandbox and throw SafeShellError on violations.
 *
 * @module
 */

import { resolve, dirname, basename, join } from "@std/path";
import { copy as stdCopy } from "@std/fs/copy";
import { ensureDir as stdEnsureDir } from "@std/fs/ensure-dir";
import { walk as stdWalk, type WalkOptions as StdWalkOptions } from "@std/fs/walk";
import { validatePath, expandPath, isPathAllowed } from "../core/permissions.ts";
import { pathViolation, executionError } from "../core/errors.ts";
import type { SafeShellConfig } from "../core/types.ts";
import { getDefaultConfig } from "../core/utils.ts";
import { glob, globArray, globPaths, type GlobOptions, type GlobEntry } from "./glob.ts";

// Re-export glob utilities
export { glob, globArray, globPaths, type GlobOptions, type GlobEntry };

/**
 * Options for file operations that need sandbox validation
 */
export interface SandboxOptions {
  /** SafeShell config for sandbox validation */
  config?: SafeShellConfig;
  /** Current working directory */
  cwd?: string;
}

// Re-export getDefaultConfig from core/utils for backwards compatibility
export { getDefaultConfig } from "../core/utils.ts";

/**
 * Helper to ensure directory exists, silently ignoring errors if it already exists
 */
async function ensureDirSafe(path: string): Promise<void> {
  try {
    await ensureDir(path);
  } catch {
    // Directory already exists or parent path issue - safe to ignore
  }
}

/**
 * Validate read access to a path
 */
async function validateRead(
  path: string,
  options: SandboxOptions = {},
): Promise<string> {
  const cwd = options.cwd ?? Deno.cwd();
  const config = options.config ?? getDefaultConfig(cwd);
  return await validatePath(path, config, cwd, "read");
}

/**
 * Validate write access to a path
 */
async function validateWrite(
  path: string,
  options: SandboxOptions = {},
): Promise<string> {
  const cwd = options.cwd ?? Deno.cwd();
  const config = options.config ?? getDefaultConfig(cwd);
  return await validatePath(path, config, cwd, "write");
}

/**
 * Read file contents as string
 *
 * @param path - Path to file
 * @param options - Sandbox options
 * @returns File contents
 *
 * @example
 * ```ts
 * const content = await read("config.json");
 * const data = JSON.parse(content);
 * ```
 */
export async function read(
  path: string,
  options: SandboxOptions = {},
): Promise<string> {
  const validPath = await validateRead(path, options);
  return await Deno.readTextFile(validPath);
}

/**
 * Read file contents as bytes
 *
 * @param path - Path to file
 * @param options - Sandbox options
 * @returns File contents as Uint8Array
 */
export async function readBytes(
  path: string,
  options: SandboxOptions = {},
): Promise<Uint8Array> {
  const validPath = await validateRead(path, options);
  return await Deno.readFile(validPath);
}

/**
 * Read and parse JSON file
 *
 * @param path - Path to JSON file
 * @param options - Sandbox options
 * @returns Parsed JSON data
 *
 * @example
 * ```ts
 * const pkg = await readJson<{ version: string }>("package.json");
 * console.log(pkg.version);
 * ```
 */
export async function readJson<T = unknown>(
  path: string,
  options: SandboxOptions = {},
): Promise<T> {
  const content = await read(path, options);
  try {
    return JSON.parse(content) as T;
  } catch (e) {
    throw executionError(`Failed to parse JSON from '${path}': ${e}`, { path });
  }
}

/**
 * Write string contents to file
 *
 * @param path - Path to file
 * @param content - Content to write
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await write("output.txt", "Hello, World!");
 * ```
 */
export async function write(
  path: string,
  content: string,
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  const dir = dirname(validPath);

  // Ensure parent directory exists
  await ensureDirSafe(dir);

  await Deno.writeTextFile(validPath, content);
}

/**
 * Write bytes to file
 *
 * @param path - Path to file
 * @param data - Bytes to write
 * @param options - Sandbox options
 */
export async function writeBytes(
  path: string,
  data: Uint8Array,
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  const dir = dirname(validPath);

  await ensureDirSafe(dir);

  await Deno.writeFile(validPath, data);
}

/**
 * Write JSON to file (pretty-printed)
 *
 * @param path - Path to JSON file
 * @param data - Data to serialize
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await writeJson("config.json", { name: "safesh", version: "1.0.0" });
 * ```
 */
export async function writeJson(
  path: string,
  data: unknown,
  options: SandboxOptions = {},
): Promise<void> {
  const content = JSON.stringify(data, null, 2) + "\n";
  await write(path, content, options);
}

/**
 * Append content to file
 *
 * @param path - Path to file
 * @param content - Content to append
 * @param options - Sandbox options
 */
export async function append(
  path: string,
  content: string,
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  const dir = dirname(validPath);

  await ensureDirSafe(dir);

  await Deno.writeTextFile(validPath, content, { append: true });
}

/**
 * Check if path exists
 *
 * @param path - Path to check
 * @param options - Sandbox options
 * @returns True if path exists
 *
 * @example
 * ```ts
 * if (await exists("config.json")) {
 *   const config = await readJson("config.json");
 * }
 * ```
 */
export async function exists(
  path: string,
  options: SandboxOptions = {},
): Promise<boolean> {
  try {
    await validateRead(path, options);
    await Deno.stat(path);
    return true;
  } catch {
    // Path doesn't exist or access denied - both mean "not accessible"
    return false;
  }
}

/**
 * Get file/directory stats
 *
 * @param path - Path to stat
 * @param options - Sandbox options
 * @returns File info
 */
export async function stat(
  path: string,
  options: SandboxOptions = {},
): Promise<Deno.FileInfo> {
  const validPath = await validateRead(path, options);
  return await Deno.stat(validPath);
}

/**
 * Remove file or directory
 *
 * @param path - Path to remove
 * @param removeOptions - Deno.remove options
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await remove("temp.txt");
 * await remove("dist", { recursive: true });
 * ```
 */
export async function remove(
  path: string,
  removeOptions?: { recursive?: boolean },
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  await Deno.remove(validPath, removeOptions);
}

/**
 * Create directory
 *
 * @param path - Path to create
 * @param mkdirOptions - Deno.mkdir options
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await mkdir("src/components", { recursive: true });
 * ```
 */
export async function mkdir(
  path: string,
  mkdirOptions?: { recursive?: boolean },
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  await Deno.mkdir(validPath, mkdirOptions);
}

/**
 * Ensure directory exists, creating parent directories as needed
 *
 * @param path - Directory path to ensure
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await ensureDir("path/to/nested/dir");
 * ```
 */
export async function ensureDir(
  path: string,
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  await stdEnsureDir(validPath);
}

/**
 * Copy file or directory
 *
 * @param src - Source path
 * @param dest - Destination path
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await copy("template.txt", "output.txt");
 * await copy("src", "backup/src");
 * ```
 */
export async function copy(
  src: string,
  dest: string,
  options: SandboxOptions = {},
): Promise<void> {
  await validateRead(src, options);
  await validateWrite(dest, options);

  await stdCopy(src, dest, { overwrite: true });
}

/**
 * Move/rename file or directory
 *
 * @param src - Source path
 * @param dest - Destination path
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await move("old.txt", "new.txt");
 * ```
 */
export async function move(
  src: string,
  dest: string,
  options: SandboxOptions = {},
): Promise<void> {
  await validateRead(src, options);
  await validateWrite(dest, options);

  const destDir = dirname(dest);
  await ensureDirSafe(destDir);

  await Deno.rename(src, dest);
}

/**
 * Create empty file (touch)
 *
 * @param path - Path to file
 * @param options - Sandbox options
 *
 * @example
 * ```ts
 * await touch("marker.txt");
 * ```
 */
export async function touch(
  path: string,
  options: SandboxOptions = {},
): Promise<void> {
  const validPath = await validateWrite(path, options);
  const dir = dirname(validPath);

  await ensureDirSafe(dir);

  try {
    // Try to update mtime if file exists
    const now = new Date();
    await Deno.utime(validPath, now, now);
  } catch {
    // File doesn't exist or utime failed, create empty file
    await Deno.writeTextFile(validPath, "");
  }
}

/**
 * Create symlink
 *
 * @param target - Target path (what the link points to)
 * @param link - Link path (where to create the symlink)
 * @param options - Sandbox options
 */
export async function symlink(
  target: string,
  link: string,
  options: SandboxOptions = {},
): Promise<void> {
  await validateRead(target, options);
  await validateWrite(link, options);
  await Deno.symlink(target, link);
}

/**
 * Read directory contents
 *
 * @param path - Directory path
 * @param options - Sandbox options
 * @returns Array of directory entries
 *
 * @example
 * ```ts
 * const entries = await readDir("src");
 * for (const entry of entries) {
 *   console.log(entry.name, entry.isFile ? "file" : "dir");
 * }
 * ```
 */
export async function readDir(
  path: string,
  options: SandboxOptions = {},
): Promise<Deno.DirEntry[]> {
  const validPath = await validateRead(path, options);
  const entries: Deno.DirEntry[] = [];

  for await (const entry of Deno.readDir(validPath)) {
    entries.push(entry);
  }

  return entries;
}

/** Alias for readDir (unix/node.js convention) */
export const readdir = readDir;

/**
 * Options for walk operation
 */
export interface WalkOptions {
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number;
  /** Include directories in results */
  includeDirs?: boolean;
  /** Include files in results (default: true) */
  includeFiles?: boolean;
  /** Follow symlinks (default: false for security) */
  followSymlinks?: boolean;
  /** Skip patterns (regex or glob) */
  skip?: RegExp[];
  /** Only include matching patterns */
  match?: RegExp[];
  /** File extensions to include */
  exts?: string[];
}

/**
 * Walk directory entry
 */
export interface WalkEntry {
  /** Absolute path */
  path: string;
  /** Entry name */
  name: string;
  /** Is directory */
  isDirectory: boolean;
  /** Is file */
  isFile: boolean;
  /** Is symlink */
  isSymlink: boolean;
}

/**
 * Walk directory tree
 *
 * @param path - Root directory
 * @param walkOptions - Walk options
 * @param sandboxOptions - Sandbox options
 * @yields WalkEntry for each file/directory
 *
 * @example
 * ```ts
 * for await (const entry of walk("src", { exts: [".ts"] })) {
 *   console.log(entry.path);
 * }
 * ```
 */
export async function* walk(
  path: string,
  walkOptions: WalkOptions = {},
  sandboxOptions: SandboxOptions = {},
): AsyncGenerator<WalkEntry> {
  const validPath = await validateRead(path, sandboxOptions);

  const stdOptions: StdWalkOptions = {
    maxDepth: walkOptions.maxDepth,
    includeDirs: walkOptions.includeDirs ?? false,
    includeFiles: walkOptions.includeFiles ?? true,
    followSymlinks: walkOptions.followSymlinks ?? false,
    skip: walkOptions.skip,
    match: walkOptions.match,
    exts: walkOptions.exts,
  };

  for await (const entry of stdWalk(validPath, stdOptions)) {
    yield {
      path: entry.path,
      name: entry.name,
      isDirectory: entry.isDirectory,
      isFile: entry.isFile,
      isSymlink: entry.isSymlink,
    };
  }
}

/**
 * Find files matching a predicate
 *
 * @param path - Root directory
 * @param predicate - Filter function
 * @param walkOptions - Walk options
 * @param sandboxOptions - Sandbox options
 * @returns Array of matching entries
 *
 * @example
 * ```ts
 * const largeFiles = await find(".", async (entry) => {
 *   const info = await Deno.stat(entry.path);
 *   return info.size > 1000000;
 * });
 * ```
 */
export async function find(
  path: string,
  predicate: (entry: WalkEntry) => boolean | Promise<boolean>,
  walkOptions: WalkOptions = {},
  sandboxOptions: SandboxOptions = {},
): Promise<WalkEntry[]> {
  const results: WalkEntry[] = [];

  for await (const entry of walk(path, walkOptions, sandboxOptions)) {
    if (await predicate(entry)) {
      results.push(entry);
    }
  }

  return results;
}
