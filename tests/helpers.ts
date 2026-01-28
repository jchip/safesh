/**
 * Test Helpers
 *
 * Common utilities for SafeShell tests to reduce boilerplate and ensure
 * consistent test environment setup and teardown.
 */

/** Resolved /tmp path for consistent test temp directories (handles macOS /tmp -> /private/tmp symlink) */
export const REAL_TMP = Deno.realPathSync("/tmp");

/**
 * Create a unique test directory under REAL_TMP
 *
 * Creates a uniquely named directory suitable for test isolation.
 * The directory is not automatically cleaned up - use cleanupTestDir() or withTestDir().
 *
 * @param prefix - Prefix for the directory name (e.g., "mytest")
 * @returns Absolute path to the created directory
 *
 * @example
 * ```typescript
 * const testDir = createTestDir("permissions");
 * // testDir = "/private/tmp/permissions-550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function createTestDir(prefix: string): string {
  const uuid = crypto.randomUUID();
  return `${REAL_TMP}/${prefix}-${uuid}`;
}

/**
 * Remove a test directory recursively
 *
 * Safely removes a directory and all its contents. Ignores errors (best-effort cleanup).
 * Validates that the path is within REAL_TMP for safety.
 *
 * @param path - Absolute path to the directory to remove
 *
 * @example
 * ```typescript
 * const testDir = createTestDir("mytest");
 * // ... use testDir ...
 * cleanupTestDir(testDir);
 * ```
 */
export function cleanupTestDir(path: string): void {
  // Safety check: ensure path is within REAL_TMP
  if (!path.startsWith(REAL_TMP)) {
    console.warn(`Refusing to cleanup directory outside REAL_TMP: ${path}`);
    return;
  }

  try {
    Deno.removeSync(path, { recursive: true });
  } catch {
    // Ignore errors - best-effort cleanup
  }
}

/**
 * Run a function with a temporary test directory, ensuring cleanup
 *
 * Higher-order function for test isolation. Creates a temp directory,
 * runs the provided function, and ensures cleanup even if the function throws.
 *
 * @param prefix - Prefix for the directory name
 * @param fn - Function to run with the temp directory
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * await withTestDir("mytest", async (dir) => {
 *   await Deno.writeTextFile(`${dir}/test.txt`, "content");
 *   // Test code here...
 *   // Directory is automatically cleaned up
 * });
 * ```
 */
export async function withTestDir<T>(
  prefix: string,
  fn: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = createTestDir(prefix);
  await Deno.mkdir(dir, { recursive: true });

  try {
    return await fn(dir);
  } finally {
    cleanupTestDir(dir);
  }
}
