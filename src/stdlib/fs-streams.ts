/**
 * File System Streams - Gulp-inspired streaming file operations
 *
 * Provides a streaming API for file system operations that integrates
 * with the Stream API from stream.ts. All operations respect sandbox
 * boundaries and validate paths before performing file operations.
 *
 * @module
 */

import { createStream, type Stream } from "./stream.ts";
import { FluentStream } from "./fluent-stream.ts";
import { validatePath } from "../core/permissions.ts";
import type { SafeShellConfig } from "../core/types.ts";
import { expandGlob, type ExpandGlobOptions } from "@std/fs/expand-glob";
import { resolve, dirname, relative, join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { getRealPath, getDefaultConfig } from "../core/utils.ts";

/**
 * File object - represents a file with metadata (like Vinyl from Gulp)
 *
 * Contains file path, base directory for relative path calculation,
 * contents (string or binary), and optional file stats.
 */
export interface File {
  /** Absolute path to the file */
  path: string;

  /** Base directory for calculating relative paths */
  base: string;

  /** File contents - string for text files, Uint8Array for binary */
  contents: string | Uint8Array;

  /** Optional file stats from Deno.stat() */
  stat?: Deno.FileInfo;
}

/**
 * Options for glob operations
 */
export interface GlobOptions {
  /** Current working directory (default: Deno.cwd()) */
  cwd?: string;

  /** Base directory for relative paths (default: cwd) */
  base?: string;

  /** Follow symlinks (default: false for security) */
  followSymlinks?: boolean;

  /** Include directories in results (default: false) */
  includeDirs?: boolean;

  /** Exclude patterns (gitignore style) */
  exclude?: string[];

  /** Case insensitive matching (default: false) */
  caseInsensitive?: boolean;

  /** SafeShell config for sandbox validation */
  config?: SafeShellConfig;
}

/**
 * Get base directory from a glob pattern
 * Used to determine the base for relative path calculation
 */
function getGlobBase(pattern: string, cwd: string): string {
  // Find the first segment without wildcards
  const segments = pattern.split("/");
  const baseSegments: string[] = [];

  for (const segment of segments) {
    if (
      segment.includes("*") || segment.includes("?") || segment.includes("[")
    ) {
      break;
    }
    baseSegments.push(segment);
  }

  const base = baseSegments.join("/") || ".";
  return resolve(cwd, base);
}

/**
 * Create stream of File objects from a glob pattern
 *
 * Uses Deno.expandGlob to find matching files and wraps them in File objects.
 * All paths are validated against sandbox rules.
 *
 * @param pattern - Glob pattern (e.g., "src/**\/*.ts", "*.json")
 * @param options - Glob options including sandbox config
 * @returns Stream of File objects
 *
 * @example
 * ```ts
 * // Find all TypeScript files with fluent API
 * await glob("src/**\/*.ts")
 *   .filter(f => !f.path.includes(".test."))
 *   .map(f => f.path)
 *   .collect()
 *
 * // Read all JSON files
 * const configs = await glob("**\/*.json")
 *   .map(f => JSON.parse(f.contents as string))
 *   .collect()
 * ```
 */
export function glob(pattern: string, options: GlobOptions = {}): FluentStream<File> {
  const cwd = options.cwd ?? Deno.cwd();
  const config = options.config ?? getDefaultConfig(cwd);
  const base = options.base ?? getGlobBase(pattern, cwd);

  const iterable = (async function* () {
    // Build expand_glob options
    const expandOptions: ExpandGlobOptions = {
      root: cwd,
      includeDirs: options.includeDirs ?? false,
      followSymlinks: options.followSymlinks ?? false,
      caseInsensitive: options.caseInsensitive ?? false,
      exclude: options.exclude,
    };

    // Expand the glob pattern
    for await (const entry of expandGlob(pattern, expandOptions)) {
      // Skip directories unless explicitly requested
      if (entry.isDirectory && !options.includeDirs) {
        continue;
      }

      try {
        // Validate path is within sandbox
        const validPath = await validatePath(entry.path, config, cwd, "read");

        // Read file contents
        let contents: string | Uint8Array;
        let stat: Deno.FileInfo | undefined;

        if (entry.isFile) {
          // Read as binary first
          const bytes = await Deno.readFile(validPath);

          // Try to decode as UTF-8 text, otherwise keep as binary
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(
              bytes,
            );
            contents = text;
          } catch {
            // Not valid UTF-8, keep as binary
            contents = bytes;
          }

          // Get file stats
          try {
            stat = await Deno.stat(validPath);
          } catch {
            // Stat might fail for some files
            stat = undefined;
          }
        } else {
          // Directory or symlink - no contents
          contents = "";
          stat = undefined;
        }

        yield {
          path: validPath,
          base,
          contents,
          stat,
        };
      } catch {
        // Skip files outside sandbox or that can't be read
        continue;
      }
    }
  })();

  return new FluentStream(createStream(iterable));
}

/**
 * Create stream of File objects from multiple glob patterns
 *
 * Equivalent to gulp.src() - accepts multiple patterns and combines results.
 *
 * @param patterns - One or more glob patterns
 * @param options - Glob options
 * @returns FluentStream of File objects
 *
 * @example
 * ```ts
 * // Process multiple file types with fluent API
 * await src("src/**\/*.ts", "src/**\/*.js")
 *   .filter(f => !f.path.includes('.test.'))
 *   .map(f => f.path)
 *   .collect()
 *
 * // With exclude patterns
 * await src("src/**\/*", { exclude: ["**\/*.test.*"] })
 *   .filter(f => f.path.endsWith('.ts'))
 *   .collect()
 * ```
 */
export function src(
  ...patterns: string[]
): FluentStream<File>;
export function src(
  options: GlobOptions,
  ...patterns: string[]
): FluentStream<File>;
export function src(
  ...args: [GlobOptions, ...string[]] | string[]
): FluentStream<File> {
  // Parse arguments - options object is optional first arg
  let options: GlobOptions = {};
  let patterns: string[];

  if (typeof args[0] === "object" && !Array.isArray(args[0])) {
    options = args[0] as GlobOptions;
    patterns = args.slice(1) as string[];
  } else {
    patterns = args as string[];
  }

  if (patterns.length === 0) {
    throw new Error("src() requires at least one pattern");
  }

  // Create stream that combines all patterns
  const iterable = (async function* () {
    for (const pattern of patterns) {
      for await (const file of glob(pattern, options)) {
        yield file;
      }
    }
  })();

  return new FluentStream(createStream(iterable));
}

/**
 * Read a file as a stream of strings
 *
 * Yields the entire file contents as a single string.
 * Useful for piping into text transforms like lines() or grep().
 *
 * @param path - Path to file
 * @param options - Glob options for sandbox validation
 * @returns Stream of string (single item containing file contents)
 *
 * @example
 * ```ts
 * // Read and process log file
 * await cat("app.log")
 *   .pipe(lines())
 *   .pipe(grep(/ERROR/))
 *   .pipe(stdout())
 *   .forEach(() => {})
 *
 * // Count lines
 * const lineCount = await cat("data.txt")
 *   .pipe(lines())
 *   .count()
 * ```
 */
export function cat(path: string, options: GlobOptions = {}): Stream<string> {
  const cwd = options.cwd ?? Deno.cwd();
  const config = options.config ?? getDefaultConfig(cwd);

  const iterable = (async function* () {
    try {
      // Validate path is within sandbox
      const validPath = await validatePath(path, config, cwd, "read");

      // Read file contents
      const contents = await Deno.readTextFile(validPath);

      yield contents;
    } catch (error) {
      // Propagate the error
      throw error;
    }
  })();

  return createStream(iterable);
}

/**
 * Write files to a destination directory
 *
 * Transform that writes File objects to disk, preserving directory
 * structure relative to the file's base property. Creates directories
 * as needed.
 *
 * @param outDir - Output directory
 * @param options - Glob options for sandbox validation
 * @returns Transform that writes files and passes them through
 *
 * @example
 * ```ts
 * // Copy files to dist
 * await src("src/**\/*.ts")
 *   .pipe(dest("dist/"))
 *
 * // Transform and write
 * await src("src/**\/*.ts")
 *   .pipe(map(async (file) => {
 *     file.contents = await transform(file.contents)
 *     return file
 *   }))
 *   .pipe(dest("dist/"))
 *
 * // Custom base directory
 * await glob("src/app/**\/*.ts", { base: "src/app" })
 *   .pipe(dest("dist/"))  // src/app/foo.ts -> dist/foo.ts
 * ```
 */
export function dest(
  outDir: string,
  options: GlobOptions = {},
): (stream: AsyncIterable<File>) => AsyncIterable<File> {
  return async function* (stream: AsyncIterable<File>) {
    const cwd = options.cwd ?? Deno.cwd();
    const config = options.config ?? getDefaultConfig(cwd);
    const absoluteOutDir = resolve(cwd, outDir);

    for await (const file of stream) {
      // Calculate relative path from base
      const relativePath = relative(file.base, file.path);

      // Determine output path
      const outputPath = join(absoluteOutDir, relativePath);

      // Validate output path is within sandbox
      await validatePath(outputPath, config, cwd, "write");

      // Ensure directory exists
      const outputDir = dirname(outputPath);
      await ensureDir(outputDir);

      // Write file contents
      if (typeof file.contents === "string") {
        await Deno.writeTextFile(outputPath, file.contents);
      } else {
        await Deno.writeFile(outputPath, file.contents);
      }

      // Update file path to output location
      const updatedFile: File = {
        ...file,
        path: outputPath,
      };

      yield updatedFile;
    }
  };
}
