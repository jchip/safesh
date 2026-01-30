/**
 * I/O Utilities
 *
 * Provides utilities for input/output operations.
 */

/**
 * Read stdin completely and return as string
 *
 * Reads all chunks from stdin and combines them into a single string.
 * Handles binary data properly by accumulating chunks before decoding.
 *
 * @returns Promise resolving to the complete stdin content as a string
 */
export async function readStdinFully(): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
}

/**
 * Read and parse a JSON file
 *
 * Reads a file and parses it as JSON. Throws descriptive errors if the file
 * doesn't exist or if the JSON is invalid.
 *
 * @param path - Path to the JSON file
 * @returns Promise resolving to the parsed JSON data
 * @throws {Deno.errors.NotFound} If the file doesn't exist
 * @throws {SyntaxError} If the file contains invalid JSON
 */
export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  try {
    const content = await Deno.readTextFile(path);
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Deno.errors.NotFound(`JSON file not found: ${path}`);
    }
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid JSON in file ${path}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Read and parse a JSON file synchronously
 *
 * Reads a file and parses it as JSON. Throws descriptive errors if the file
 * doesn't exist or if the JSON is invalid.
 *
 * @param path - Path to the JSON file
 * @returns Parsed JSON data
 * @throws {Deno.errors.NotFound} If the file doesn't exist
 * @throws {SyntaxError} If the file contains invalid JSON
 */
export function readJsonFileSync<T = unknown>(path: string): T {
  try {
    const content = Deno.readTextFileSync(path);
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Deno.errors.NotFound(`JSON file not found: ${path}`);
    }
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid JSON in file ${path}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Write data to a JSON file with formatting
 *
 * Serializes data to JSON and writes it to a file with proper formatting.
 * Creates parent directories if needed. Uses atomic write (write to temp, then rename).
 *
 * @param path - Path to write the JSON file
 * @param data - Data to serialize to JSON
 * @throws {Deno.errors.PermissionDenied} If write permission is denied
 */
export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2) + "\n";

  // Ensure parent directory exists
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) {
    await ensureDir(dir);
  }

  // Atomic write: write to temp file then rename
  const tempPath = `${path}.tmp.${Date.now()}`;
  try {
    await Deno.writeTextFile(tempPath, content);
    await Deno.rename(tempPath, path);
  } catch (error) {
    // Clean up temp file on error
    try {
      await Deno.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new Deno.errors.PermissionDenied(
        `Permission denied writing JSON file: ${path}`
      );
    }
    throw error;
  }
}

/**
 * Write data to a JSON file with formatting synchronously
 *
 * Serializes data to JSON and writes it to a file with proper formatting.
 * Creates parent directories if needed. Uses atomic write (write to temp, then rename).
 *
 * @param path - Path to write the JSON file
 * @param data - Data to serialize to JSON
 * @throws {Deno.errors.PermissionDenied} If write permission is denied
 */
export function writeJsonFileSync(path: string, data: unknown): void {
  const content = JSON.stringify(data, null, 2) + "\n";

  // Ensure parent directory exists
  const dir = path.substring(0, path.lastIndexOf("/"));
  if (dir) {
    ensureDirSync(dir);
  }

  // Atomic write: write to temp file then rename
  const tempPath = `${path}.tmp.${Date.now()}`;
  try {
    Deno.writeTextFileSync(tempPath, content);
    Deno.renameSync(tempPath, path);
  } catch (error) {
    // Clean up temp file on error
    try {
      Deno.removeSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new Deno.errors.PermissionDenied(
        `Permission denied writing JSON file: ${path}`
      );
    }
    throw error;
  }
}

/**
 * Ensure directory exists, creating it if necessary
 *
 * Creates a directory and all necessary parent directories.
 * Silently succeeds if the directory already exists.
 * Equivalent to `mkdir -p` in bash.
 *
 * @param path - Directory path to ensure exists
 * @throws {Deno.errors.PermissionDenied} If permission is denied
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      // Directory already exists, this is fine
      return;
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new Deno.errors.PermissionDenied(
        `Permission denied creating directory: ${path}`
      );
    }
    throw error;
  }
}

/**
 * Synchronous version of ensureDir
 *
 * Creates a directory and all necessary parent directories synchronously.
 * Silently succeeds if the directory already exists.
 *
 * @param path - Directory path to ensure exists
 * @throws {Deno.errors.PermissionDenied} If permission is denied
 */
export function ensureDirSync(path: string): void {
  try {
    Deno.mkdirSync(path, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      // Directory already exists, this is fine
      return;
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      throw new Deno.errors.PermissionDenied(
        `Permission denied creating directory: ${path}`
      );
    }
    throw error;
  }
}
