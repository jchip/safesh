/**
 * File system utilities
 *
 * All functions respect the sandbox and throw SafeShellError on violations.
 *
 * @module
 */

import { resolve as stdResolve, dirname as stdDirname, basename as stdBasename, join as stdJoin, extname as stdExtname, relative as stdRelative, normalize as stdNormalize, isAbsolute as stdIsAbsolute, parse as stdParse, format as stdFormat, toFileUrl as stdToFileUrl, fromFileUrl as stdFromFileUrl } from "@std/path";
import { copy as stdCopy } from "@std/fs/copy";

// Re-export for internal use
export const resolve = stdResolve;
export const dirname = stdDirname;
export const basename = stdBasename;
export const join = stdJoin;

/**
 * Coerce a value to string - handles ShellString and other string-like objects
 */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof (value as { toString?: () => string }).toString === "function") {
    return String(value);
  }
  return String(value);
}

/**
 * Path utilities re-exported from @std/path
 * All functions accept ShellString or any string-like value
 */
export const path = {
  resolve: (...paths: unknown[]): string => stdResolve(...(paths.map(str) as [string, ...string[]])),
  dirname: (p: unknown): string => stdDirname(str(p)),
  basename: (p: unknown, suffix?: string): string => stdBasename(str(p), suffix),
  join: (...paths: unknown[]): string => stdJoin(...(paths.map(str) as [string, ...string[]])),
  extname: (p: unknown): string => stdExtname(str(p)),
  relative: (from: unknown, to: unknown): string => stdRelative(str(from), str(to)),
  normalize: (p: unknown): string => stdNormalize(str(p)),
  isAbsolute: (p: unknown): boolean => stdIsAbsolute(str(p)),
  parse: (p: unknown): ReturnType<typeof stdParse> => stdParse(str(p)),
  format: stdFormat,
  toFileUrl: (p: unknown): URL => stdToFileUrl(str(p)),
  fromFileUrl: stdFromFileUrl,
};
import { ensureDir as stdEnsureDir } from "@std/fs/ensure-dir";
import { walk as stdWalk, type WalkOptions as StdWalkOptions } from "@std/fs/walk";
import { expandPath, validatePath } from "../core/permissions.ts";
import { executionError } from "../core/errors.ts";
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
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

/**
 * Resolve and validate path against sandbox
 * All path operations go through core/permissions.ts for consistent security checks
 */
async function resolveAndValidatePath(
  path: string,
  operation: "read" | "write",
  options: SandboxOptions = {},
): Promise<string> {
  const cwd = options.cwd ?? Deno.cwd();
  const config = options.config ?? getDefaultConfig(cwd);

  // Always use validatePath from core/permissions.ts for consistent security
  return await validatePath(path, config, cwd, operation);
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
  const resolvedPath = await resolveAndValidatePath(path, "read", options);
  return await Deno.readTextFile(resolvedPath);
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
  const resolvedPath = await resolveAndValidatePath(path, "read", options);
  return await Deno.readFile(resolvedPath);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  const dir = dirname(resolvedPath);

  // Ensure parent directory exists
  await ensureDirSafe(dir);

  await Deno.writeTextFile(resolvedPath, content);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  const dir = dirname(resolvedPath);

  await ensureDirSafe(dir);

  await Deno.writeFile(resolvedPath, data);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  const dir = dirname(resolvedPath);

  await ensureDirSafe(dir);

  await Deno.writeTextFile(resolvedPath, content, { append: true });
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
    const resolvedPath = await resolveAndValidatePath(path, "read", options);
    await Deno.stat(resolvedPath);
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
  const resolvedPath = await resolveAndValidatePath(path, "read", options);
  return await Deno.stat(resolvedPath);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  await Deno.remove(resolvedPath, removeOptions);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  await Deno.mkdir(resolvedPath, mkdirOptions);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  await stdEnsureDir(resolvedPath);
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
  const resolvedSrc = await resolveAndValidatePath(src, "read", options);
  const resolvedDest = await resolveAndValidatePath(dest, "write", options);

  await stdCopy(resolvedSrc, resolvedDest, { overwrite: true });
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
  const resolvedSrc = await resolveAndValidatePath(src, "write", options);
  const resolvedDest = await resolveAndValidatePath(dest, "write", options);

  const destDir = dirname(resolvedDest);
  await ensureDirSafe(destDir);

  await Deno.rename(resolvedSrc, resolvedDest);
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
  const resolvedPath = await resolveAndValidatePath(path, "write", options);
  const dir = dirname(resolvedPath);

  await ensureDirSafe(dir);

  try {
    // Try to update mtime if file exists
    const now = new Date();
    await Deno.utime(resolvedPath, now, now);
  } catch {
    // File doesn't exist or utime failed, create empty file
    await Deno.writeTextFile(resolvedPath, "");
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
  const resolvedTarget = await resolveAndValidatePath(target, "read", options);
  const resolvedLink = await resolveAndValidatePath(link, "write", options);
  await Deno.symlink(resolvedTarget, resolvedLink);
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
  const resolvedPath = await resolveAndValidatePath(path, "read", options);
  const entries: Deno.DirEntry[] = [];

  for await (const entry of Deno.readDir(resolvedPath)) {
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
  const resolvedPath = await resolveAndValidatePath(path, "read", sandboxOptions);

  const stdOptions: StdWalkOptions = {
    maxDepth: walkOptions.maxDepth,
    includeDirs: walkOptions.includeDirs ?? false,
    includeFiles: walkOptions.includeFiles ?? true,
    followSymlinks: walkOptions.followSymlinks ?? false,
    skip: walkOptions.skip,
    match: walkOptions.match,
    exts: walkOptions.exts,
  };

  for await (const entry of stdWalk(resolvedPath, stdOptions)) {
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

/**
 * Options for tree operation
 */
export interface TreeOptions {
  /** Maximum depth to traverse (default: Infinity) */
  maxDepth?: number;
  /** Show only directories (default: false) */
  dirsOnly?: boolean;
  /** Show hidden files (starting with .) (default: false) */
  showHidden?: boolean;
  /** Pattern to match files (regex) */
  pattern?: RegExp;
  /** Follow symlinks (default: false) */
  followSymlinks?: boolean;
}

/**
 * Tree entry with formatting info
 */
export interface TreeEntry {
  /** Entry name */
  name: string;
  /** Absolute path */
  path: string;
  /** Is directory */
  isDirectory: boolean;
  /** Depth level (0 = root) */
  depth: number;
  /** Formatted line with ASCII art prefix */
  line: string;
}

/**
 * Display directory tree structure
 *
 * @param rootPath - Root directory to display
 * @param treeOptions - Tree display options
 * @param sandboxOptions - Sandbox options
 * @returns AsyncGenerator yielding TreeEntry for each item
 *
 * @example
 * ```ts
 * // Print tree to console
 * for await (const entry of tree("src")) {
 *   console.log(entry.line);
 * }
 *
 * // Get tree as array of lines
 * const lines = [];
 * for await (const entry of tree(".", { maxDepth: 2 })) {
 *   lines.push(entry.line);
 * }
 *
 * // Show only directories
 * for await (const entry of tree(".", { dirsOnly: true })) {
 *   console.log(entry.line);
 * }
 * ```
 */
export async function* tree(
  rootPath: string,
  treeOptions: TreeOptions = {},
  sandboxOptions: SandboxOptions = {},
): AsyncGenerator<TreeEntry> {
  const resolvedPath = await resolveAndValidatePath(rootPath, "read", sandboxOptions);
  const maxDepth = treeOptions.maxDepth ?? Infinity;
  const dirsOnly = treeOptions.dirsOnly ?? false;
  const showHidden = treeOptions.showHidden ?? false;
  const pattern = treeOptions.pattern;
  const followSymlinks = treeOptions.followSymlinks ?? false;

  // Yield the root directory first
  const rootName = basename(resolvedPath) || resolvedPath;
  yield {
    name: rootName,
    path: resolvedPath,
    isDirectory: true,
    depth: 0,
    line: rootName,
  };

  // Recursive helper to build tree
  async function* walkTree(
    dirPath: string,
    depth: number,
    prefix: string,
  ): AsyncGenerator<TreeEntry> {
    if (depth > maxDepth) return;

    // Read directory entries
    const entries: Deno.DirEntry[] = [];
    try {
      for await (const entry of Deno.readDir(dirPath)) {
        // Skip hidden files unless showHidden
        if (!showHidden && entry.name.startsWith(".")) continue;

        // Skip files if dirsOnly
        if (dirsOnly && !entry.isDirectory) continue;

        // Apply pattern filter
        if (pattern && !entry.isDirectory && !pattern.test(entry.name)) continue;

        entries.push(entry);
      }
    } catch {
      // Permission denied or not a directory
      return;
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Process each entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const isLast = i === entries.length - 1;
      const entryPath = join(dirPath, entry.name);

      // ASCII tree characters
      const connector = isLast ? "└── " : "├── ";
      const line = prefix + connector + entry.name;

      yield {
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory,
        depth,
        line,
      };

      // Recurse into directories
      if (entry.isDirectory) {
        const newPrefix = prefix + (isLast ? "    " : "│   ");

        // Handle symlinks
        if (entry.isSymlink && !followSymlinks) continue;

        yield* walkTree(entryPath, depth + 1, newPrefix);
      }
    }
  }

  yield* walkTree(resolvedPath, 1, "");
}

/**
 * Get tree output as an array of formatted lines
 *
 * @param rootPath - Root directory
 * @param options - Tree options
 * @param sandboxOptions - Sandbox options
 * @returns Array of formatted tree lines
 *
 * @example
 * ```ts
 * const lines = await treeLines("src", { maxDepth: 2 });
 * console.log(lines.join("\n"));
 * ```
 */
export async function treeLines(
  rootPath: string,
  options: TreeOptions = {},
  sandboxOptions: SandboxOptions = {},
): Promise<string[]> {
  const lines: string[] = [];
  for await (const entry of tree(rootPath, options, sandboxOptions)) {
    lines.push(entry.line);
  }
  return lines;
}

/**
 * Print tree to console and return summary
 *
 * @param rootPath - Root directory
 * @param options - Tree options
 * @param sandboxOptions - Sandbox options
 * @returns Summary with directory and file counts
 *
 * @example
 * ```ts
 * const summary = await printTree("src");
 * // Output:
 * // src
 * // ├── index.ts
 * // ├── lib
 * // │   ├── utils.ts
 * // │   └── helpers.ts
 * // └── types.ts
 * //
 * // 1 directory, 3 files
 * console.log(`${summary.directories} directories, ${summary.files} files`);
 * ```
 */
export async function printTree(
  rootPath: string,
  options: TreeOptions = {},
  sandboxOptions: SandboxOptions = {},
): Promise<{ directories: number; files: number }> {
  let directories = 0;
  let files = 0;

  for await (const entry of tree(rootPath, options, sandboxOptions)) {
    console.log(entry.line);
    if (entry.depth > 0) {
      if (entry.isDirectory) {
        directories++;
      } else {
        files++;
      }
    }
  }

  // Print summary
  const dirWord = directories === 1 ? "directory" : "directories";
  const fileWord = files === 1 ? "file" : "files";
  console.log("");
  console.log(`${directories} ${dirWord}, ${files} ${fileWord}`);

  return { directories, files };
}
