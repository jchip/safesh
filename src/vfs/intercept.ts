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
   * Check if a path is within VFS
   */
  const isVfsPath = (path: string | URL): boolean => {
    const pathStr = path instanceof URL ? path.pathname : path.toString();
    return pathStr.startsWith(prefix);
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
            const data = vfs.read(pathStr);
            return new TextDecoder(options?.encoding).decode(data);
          }
          return await original.call(target, path, options);
        };
      }

      if (prop === "readFileSync") {
        return (path: string | URL): Uint8Array => {
          if (isVfsPath(path)) {
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();

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
            const pathStr = path.toString();

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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
            return vfs.stat(pathStr);
          }
          return await original.call(target, path);
        };
      }

      if (prop === "lstat") {
        return async (path: string | URL): Promise<Deno.FileInfo> => {
          if (isVfsPath(path)) {
            const pathStr = path.toString();
            return vfs.stat(pathStr); // No symlinks in VFS
          }
          return await original.call(target, path);
        };
      }

      if (prop === "statSync") {
        return (path: string | URL): Deno.FileInfo => {
          if (isVfsPath(path)) {
            const pathStr = path.toString();
            return vfs.stat(pathStr);
          }
          return original.call(target, path);
        };
      }

      if (prop === "lstatSync") {
        return (path: string | URL): Deno.FileInfo => {
          if (isVfsPath(path)) {
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
            const pathStr = path.toString();
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
