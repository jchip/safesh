/**
 * Virtual File System Module
 *
 * Provides in-memory filesystem for sandboxed script execution.
 *
 * @example
 * ```typescript
 * import { VirtualFileSystem, setupVFS } from "./vfs/mod.ts";
 *
 * // Create VFS with custom config
 * const vfs = new VirtualFileSystem({
 *   prefix: "/@vfs/",
 *   maxSize: 50 * 1024 * 1024, // 50MB
 * });
 *
 * // Setup interception
 * const restore = setupVFS(vfs);
 *
 * // Now all Deno.* operations on /@vfs/* use VFS
 * await Deno.writeTextFile("/@vfs/config.json", '{"key":"value"}');
 * const data = await Deno.readTextFile("/@vfs/config.json");
 *
 * // Restore original Deno APIs
 * restore();
 * ```
 */

export { VirtualFileSystem } from "./filesystem.ts";
export { setupVFS } from "./intercept.ts";
export type {
  VFSConfig,
  VFSDirectoryEntry,
  VFSEntry,
  VFSFile,
  VFSFileEntry,
  VFSOptions,
  VFSStats,
  VFSSymlinkEntry,
} from "./types.ts";
export {
  O_APPEND,
  O_CREAT,
  O_EXCL,
  O_RDONLY,
  O_RDWR,
  O_TRUNC,
  O_WRONLY,
} from "./types.ts";
