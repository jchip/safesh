/**
 * Deno API Interception for Virtual File System
 *
 * Wraps Deno's filesystem APIs with a Proxy to intercept VFS paths
 * and route them to the virtual filesystem instead of the real one.
 */

import type { VirtualFileSystem } from "./filesystem.ts";

// =============================================================================
// Setup Function
// =============================================================================

/**
 * Setup VFS interception by wrapping Deno namespace with a Proxy
 *
 * @param vfs VirtualFileSystem instance
 * @returns Restore function to remove interception
 */
export function setupVFS(vfs: VirtualFileSystem): () => void {
  const originalDeno = globalThis.Deno;
  const prefix = vfs.prefix;

  /**
   * Extract path string consistently from string or URL
   */
  const extractPath = (path: string | URL): string => {
    return path instanceof URL ? path.pathname : path.toString();
  };

  /**
   * Check if a path is within VFS
   */
  const isVfsPath = (path: string | URL): boolean => {
    return extractPath(path).startsWith(prefix);
  };

  /**
   * Intercept Deno namespace
   */
  const proxiedDeno = new Proxy(originalDeno, {
    get(target, prop) {
      const original = Reflect.get(target, prop);

      // ========================================================================
      // readFile / readTextFile
      // ========================================================================

      if (prop === "readFile") {
        return async (path: string | URL): Promise<Uint8Array> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.read(pathStr);
          }
          return await original.call(target, path);
        };
      }

      if (prop === "readTextFile") {
        return async (
          path: string | URL,
          options?: { encoding?: string },
        ): Promise<string> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            const data = vfs.read(pathStr);
            return new TextDecoder(options?.encoding).decode(data);
          }
          return await original.call(target, path, options);
        };
      }

      if (prop === "readFileSync") {
        return (path: string | URL): Uint8Array => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.read(pathStr);
          }
          return original.call(target, path);
        };
      }

      if (prop === "readTextFileSync") {
        return (
          path: string | URL,
          options?: { encoding?: string },
        ): string => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            const data = vfs.read(pathStr);
            return new TextDecoder(options?.encoding).decode(data);
          }
          return original.call(target, path, options);
        };
      }

      // ========================================================================
      // writeFile / writeTextFile
      // ========================================================================

      if (prop === "writeFile") {
        return async (
          path: string | URL,
          data: Uint8Array | ReadableStream<Uint8Array>,
          options?: Deno.WriteFileOptions,
        ): Promise<void> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);

            // Handle ReadableStream
            if (data instanceof ReadableStream) {
              const chunks: Uint8Array[] = [];
              const reader = data.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                }
              } finally {
                reader.releaseLock();
              }

              // Concatenate chunks
              const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
              const combined = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
              }
              data = combined;
            }

            vfs.write(pathStr, data as Uint8Array);
            return;
          }
          return await original.call(target, path, data, options);
        };
      }

      if (prop === "writeTextFile") {
        return async (
          path: string | URL,
          data: string | ReadableStream<string>,
          options?: Deno.WriteFileOptions,
        ): Promise<void> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);

            // Handle ReadableStream
            if (data instanceof ReadableStream) {
              const chunks: string[] = [];
              const reader = data.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  chunks.push(value);
                }
              } finally {
                reader.releaseLock();
              }
              data = chunks.join("");
            }

            const encoded = new TextEncoder().encode(data as string);
            vfs.write(pathStr, encoded);
            return;
          }
          return await original.call(target, path, data, options);
        };
      }

      if (prop === "writeFileSync") {
        return (
          path: string | URL,
          data: Uint8Array,
          options?: Deno.WriteFileOptions,
        ): void => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            vfs.write(pathStr, data);
            return;
          }
          return original.call(target, path, data, options);
        };
      }

      if (prop === "writeTextFileSync") {
        return (
          path: string | URL,
          data: string,
          options?: Deno.WriteFileOptions,
        ): void => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            const encoded = new TextEncoder().encode(data);
            vfs.write(pathStr, encoded);
            return;
          }
          return original.call(target, path, data, options);
        };
      }

      // ========================================================================
      // stat / lstat
      // ========================================================================

      if (prop === "stat") {
        return async (path: string | URL): Promise<Deno.FileInfo> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.stat(pathStr);
          }
          return await original.call(target, path);
        };
      }

      if (prop === "lstat") {
        return async (path: string | URL): Promise<Deno.FileInfo> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.stat(pathStr); // No symlinks in VFS
          }
          return await original.call(target, path);
        };
      }

      if (prop === "statSync") {
        return (path: string | URL): Deno.FileInfo => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.stat(pathStr);
          }
          return original.call(target, path);
        };
      }

      if (prop === "lstatSync") {
        return (path: string | URL): Deno.FileInfo => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.stat(pathStr); // No symlinks in VFS
          }
          return original.call(target, path);
        };
      }

      // ========================================================================
      // remove
      // ========================================================================

      if (prop === "remove") {
        return async (
          path: string | URL,
          options?: { recursive?: boolean },
        ): Promise<void> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            vfs.remove(pathStr, options);
            return;
          }
          return await original.call(target, path, options);
        };
      }

      if (prop === "removeSync") {
        return (
          path: string | URL,
          options?: { recursive?: boolean },
        ): void => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            vfs.remove(pathStr, options);
            return;
          }
          return original.call(target, path, options);
        };
      }

      // ========================================================================
      // mkdir
      // ========================================================================

      if (prop === "mkdir") {
        return async (
          path: string | URL,
          options?: { recursive?: boolean; mode?: number },
        ): Promise<void> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            vfs.mkdir(pathStr, { recursive: options?.recursive });
            return;
          }
          return await original.call(target, path, options);
        };
      }

      if (prop === "mkdirSync") {
        return (
          path: string | URL,
          options?: { recursive?: boolean; mode?: number },
        ): void => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            vfs.mkdir(pathStr, { recursive: options?.recursive });
            return;
          }
          return original.call(target, path, options);
        };
      }

      // ========================================================================
      // readDir
      // ========================================================================

      if (prop === "readDir") {
        return (path: string | URL): AsyncIterable<Deno.DirEntry> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            const entries = vfs.readDir(pathStr);

            // Return async iterator
            return {
              async *[Symbol.asyncIterator]() {
                for (const entry of entries) {
                  yield entry;
                }
              },
            };
          }
          return original.call(target, path);
        };
      }

      if (prop === "readDirSync") {
        return (path: string | URL): Iterable<Deno.DirEntry> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            const entries = vfs.readDir(pathStr);

            // Return iterator
            return {
              *[Symbol.iterator]() {
                for (const entry of entries) {
                  yield entry;
                }
              },
            };
          }
          return original.call(target, path);
        };
      }

      // ========================================================================
      // rename
      // ========================================================================

      if (prop === "rename") {
        return async (
          oldpath: string | URL,
          newpath: string | URL,
        ): Promise<void> => {
          const oldIsVfs = isVfsPath(oldpath);
          const newIsVfs = isVfsPath(newpath);

          if (oldIsVfs && newIsVfs) {
            const oldStr = extractPath(oldpath);
            const newStr = extractPath(newpath);
            const data = vfs.read(oldStr);
            vfs.write(newStr, data);
            vfs.remove(oldStr);
            return;
          }

          if (oldIsVfs || newIsVfs) {
            throw new Error("Cannot rename between VFS and real filesystem");
          }

          return await original.call(target, oldpath, newpath);
        };
      }

      if (prop === "renameSync") {
        return (
          oldpath: string | URL,
          newpath: string | URL,
        ): void => {
          const oldIsVfs = isVfsPath(oldpath);
          const newIsVfs = isVfsPath(newpath);

          if (oldIsVfs && newIsVfs) {
            const oldStr = extractPath(oldpath);
            const newStr = extractPath(newpath);
            const data = vfs.read(oldStr);
            vfs.write(newStr, data);
            vfs.remove(oldStr);
            return;
          }

          if (oldIsVfs || newIsVfs) {
            throw new Error("Cannot rename between VFS and real filesystem");
          }

          return original.call(target, oldpath, newpath);
        };
      }

      // ========================================================================
      // copyFile
      // ========================================================================

      if (prop === "copyFile") {
        return async (
          fromPath: string | URL,
          toPath: string | URL,
        ): Promise<void> => {
          const fromIsVfs = isVfsPath(fromPath);
          const toIsVfs = isVfsPath(toPath);

          if (fromIsVfs && toIsVfs) {
            const fromStr = extractPath(fromPath);
            const toStr = extractPath(toPath);
            const data = vfs.read(fromStr);
            vfs.write(toStr, new Uint8Array(data));
            return;
          }

          if (fromIsVfs || toIsVfs) {
            throw new Error("Cannot copy between VFS and real filesystem");
          }

          return await original.call(target, fromPath, toPath);
        };
      }

      if (prop === "copyFileSync") {
        return (
          fromPath: string | URL,
          toPath: string | URL,
        ): void => {
          const fromIsVfs = isVfsPath(fromPath);
          const toIsVfs = isVfsPath(toPath);

          if (fromIsVfs && toIsVfs) {
            const fromStr = extractPath(fromPath);
            const toStr = extractPath(toPath);
            const data = vfs.read(fromStr);
            vfs.write(toStr, new Uint8Array(data));
            return;
          }

          if (fromIsVfs || toIsVfs) {
            throw new Error("Cannot copy between VFS and real filesystem");
          }

          return original.call(target, fromPath, toPath);
        };
      }

      // ========================================================================
      // open
      // ========================================================================

      if (prop === "open") {
        return async (
          path: string | URL,
          options?: Deno.OpenOptions,
        ): Promise<Deno.FsFile> => {
          if (isVfsPath(path)) {
            throw new Error(
              `Deno.open() is not supported for VFS paths: ${extractPath(path)}. ` +
                "Use Deno.readFile/writeFile instead.",
            );
          }
          return await original.call(target, path, options);
        };
      }

      if (prop === "openSync") {
        return (
          path: string | URL,
          options?: Deno.OpenOptions,
        ): Deno.FsFile => {
          if (isVfsPath(path)) {
            throw new Error(
              `Deno.openSync() is not supported for VFS paths: ${extractPath(path)}. ` +
                "Use Deno.readFileSync/writeFileSync instead.",
            );
          }
          return original.call(target, path, options);
        };
      }

      // ========================================================================
      // symlink
      // ========================================================================

      if (prop === "symlink") {
        return async (
          oldpath: string | URL,
          newpath: string | URL,
        ): Promise<void> => {
          if (isVfsPath(newpath)) {
            const targetStr = extractPath(oldpath);
            const linkStr = extractPath(newpath);
            vfs.symlink(targetStr, linkStr);
            return;
          }
          return await original.call(target, oldpath, newpath);
        };
      }

      if (prop === "symlinkSync") {
        return (
          oldpath: string | URL,
          newpath: string | URL,
        ): void => {
          if (isVfsPath(newpath)) {
            const targetStr = extractPath(oldpath);
            const linkStr = extractPath(newpath);
            vfs.symlink(targetStr, linkStr);
            return;
          }
          return original.call(target, oldpath, newpath);
        };
      }

      // ========================================================================
      // readLink
      // ========================================================================

      if (prop === "readLink") {
        return async (path: string | URL): Promise<string> => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.readlink(pathStr);
          }
          return await original.call(target, path);
        };
      }

      if (prop === "readLinkSync") {
        return (path: string | URL): string => {
          if (isVfsPath(path)) {
            const pathStr = extractPath(path);
            return vfs.readlink(pathStr);
          }
          return original.call(target, path);
        };
      }

      // Return original for all other properties
      return original;
    },
  }) as typeof Deno;

  // Replace globalThis.Deno with proxied version
  Object.defineProperty(globalThis, "Deno", {
    value: proxiedDeno,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  // Return restore function
  return () => {
    Object.defineProperty(globalThis, "Deno", {
      value: originalDeno,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
}
