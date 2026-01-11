/**
 * Virtual File System Implementation
 *
 * In-memory filesystem for sandboxed script execution.
 * Provides Deno-compatible file operations without touching real filesystem.
 */

import type {
  VFSConfig,
  VFSDirectoryEntry,
  VFSEntry,
  VFSFile,
  VFSFileEntry,
  VFSOptions,
  VFSStats,
  VFSSymlinkEntry,
} from "./types.ts";
import {
  O_APPEND,
  O_CREAT,
  O_EXCL,
  O_RDONLY,
  O_RDWR,
  O_TRUNC,
  O_WRONLY,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_PREFIX = "/@vfs/";
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_MAX_FILES = 10000;

// =============================================================================
// VirtualFileSystem Class
// =============================================================================

export class VirtualFileSystem {
  private entries = new Map<string, VFSEntry>();
  private options: VFSOptions;
  private currentSize = 0;

  // File Descriptor Management
  private fds = new Map<number, VFSFile>();
  private nextFd = 3; // Start after stdin(0), stdout(1), stderr(2)
  private releasedFds: number[] = [];
  private readonly maxOpenFiles = 1024;

  constructor(config: VFSConfig = {}) {
    this.options = {
      prefix: config.prefix ?? DEFAULT_PREFIX,
      maxSize: config.maxSize ?? DEFAULT_MAX_SIZE,
      maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
    };

    // Ensure prefix ends with /
    if (!this.options.prefix.endsWith("/")) {
      this.options.prefix += "/";
    }

    // Create root directory
    this.entries.set(this.normalizePath("/"), this.createDirectory());
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Get VFS path prefix
   */
  get prefix(): string {
    return this.options.prefix;
  }

  /**
   * Get VFS statistics
   */
  stats(): VFSStats {
    let fileCount = 0;
    let dirCount = 0;

    for (const entry of this.entries.values()) {
      if (entry.type === "file") {
        fileCount++;
      } else {
        dirCount++;
      }
    }

    return {
      fileCount,
      dirCount,
      totalSize: this.currentSize,
      maxSize: this.options.maxSize,
      maxFiles: this.options.maxFiles,
    };
  }

  // ===========================================================================
  // Path Utilities
  // ===========================================================================

  /**
   * Normalize a path (resolve .., ., and // sequences)
   */
  private normalizePath(path: string): string {
    // Remove prefix if present
    if (path.startsWith(this.options.prefix)) {
      path = path.substring(this.options.prefix.length);
    }

    // Ensure absolute path
    if (!path.startsWith("/")) {
      path = "/" + path;
    }

    // Split and resolve
    const parts = path.split("/").filter((p) => p && p !== ".");
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === "..") {
        if (resolved.length > 0) {
          resolved.pop();
        }
      } else {
        resolved.push(part);
      }
    }

    return "/" + resolved.join("/");
  }

  /**
   * Get parent directory path
   */
  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path);
    if (normalized === "/") {
      return "/";
    }

    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === 0 ? "/" : normalized.substring(0, lastSlash);
  }

  /**
   * Get basename of path
   */
  private getBasename(path: string): string {
    const normalized = this.normalizePath(path);
    const lastSlash = normalized.lastIndexOf("/");
    return normalized.substring(lastSlash + 1);
  }

  /**
   * Check if path is within VFS bounds (prevent traversal attacks)
   */
  private validatePath(path: string): void {
    const normalized = this.normalizePath(path);
    if (!normalized.startsWith("/")) {
      throw new Error(`Path traversal detected: ${path}`);
    }
  }

  // ===========================================================================
  // File Descriptor Management
  // ===========================================================================

  /**
   * Allocate a new file descriptor
   */
  private allocateFd(): number {
    // Check limit
    if (this.fds.size >= this.maxOpenFiles) {
      throw new Error(
        `Too many open files: ${this.fds.size} >= ${this.maxOpenFiles}`,
      );
    }

    // Reuse released FD if available
    const reused = this.releasedFds.pop();
    if (reused !== undefined) {
      return reused;
    }

    // Allocate new FD
    return this.nextFd++;
  }

  /**
   * Release a file descriptor for reuse
   */
  private releaseFd(fd: number): void {
    this.releasedFds.push(fd);
  }

  /**
   * Get file handle by FD
   */
  private getFile(fd: number): VFSFile {
    const file = this.fds.get(fd);
    if (!file) {
      throw new Error(`Bad file descriptor: ${fd}`);
    }
    return file;
  }

  /**
   * Check if FD has read permission
   */
  private canRead(flags: number): boolean {
    const accessMode = flags & 0o3;
    return accessMode === O_RDONLY || accessMode === O_RDWR;
  }

  /**
   * Check if FD has write permission
   */
  private canWrite(flags: number): boolean {
    const accessMode = flags & 0o3;
    return accessMode === O_WRONLY || accessMode === O_RDWR;
  }

  // ===========================================================================
  // Entry Creation
  // ===========================================================================

  private createFile(data: Uint8Array): VFSFileEntry {
    const now = new Date();
    // Start with reasonable initial capacity (at least 64 bytes, or data length)
    const initialCapacity = Math.max(64, data.length);
    const buffer = new Uint8Array(initialCapacity);
    buffer.set(data);

    return {
      type: "file",
      buffer,
      size: data.length,
      capacity: initialCapacity,
      created: now,
      modified: now,
      accessed: now,
      mode: 0o644,
    };
  }

  private createDirectory(): VFSDirectoryEntry {
    const now = new Date();
    return {
      type: "directory",
      created: now,
      modified: now,
      accessed: now,
      mode: 0o755,
    };
  }

  private createSymlink(target: string): VFSSymlinkEntry {
    const now = new Date();
    return {
      type: "symlink",
      target,
      created: now,
      modified: now,
      accessed: now,
      mode: 0o777,
    };
  }

  // ===========================================================================
  // Path Resolution with Symlink Support
  // ===========================================================================

  /**
   * Resolve a path, following symlinks with cycle detection
   * @param path Path to resolve
   * @param visited Set of paths already visited (for cycle detection)
   * @returns Resolved path
   */
  private resolvePath(path: string, visited = new Set<string>()): string {
    const normalized = this.normalizePath(path);

    // Check for symlink cycles
    if (visited.has(normalized)) {
      throw new Error(`Symlink cycle detected: ${path}`);
    }

    const entry = this.entries.get(normalized);

    // If not a symlink, return as-is
    if (!entry || entry.type !== "symlink") {
      return normalized;
    }

    // Follow symlink
    visited.add(normalized);
    entry.accessed = new Date();

    // Resolve target (may be relative or absolute)
    let target = entry.target;
    if (!target.startsWith("/")) {
      // Relative path - resolve from symlink's parent directory
      const parent = this.getParentPath(normalized);
      target = parent === "/" ? "/" + target : parent + "/" + target;
    }

    // Recursively resolve (target might also be a symlink)
    return this.resolvePath(target, visited);
  }

  /**
   * Get entry, resolving symlinks
   */
  private getEntryFollowSymlinks(path: string): VFSEntry | undefined {
    const resolved = this.resolvePath(path);
    return this.entries.get(resolved);
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Write data to a file (creates parent directories if needed)
   */
  write(path: string, data: Uint8Array): void {
    this.validatePath(path);
    const normalized = this.normalizePath(path);

    const existing = this.entries.get(normalized);

    if (existing && existing.type === "file") {
      // Existing file - check if we need to grow the buffer
      const oldSize = existing.size;
      const newSize = data.length;

      // Check size limits
      const totalSize = this.currentSize - oldSize + newSize;
      if (totalSize > this.options.maxSize) {
        throw new Error(
          `VFS size limit exceeded: ${totalSize} > ${this.options.maxSize}`,
        );
      }

      // Grow buffer if needed using capacity doubling
      if (newSize > existing.capacity) {
        let newCapacity = existing.capacity;
        while (newCapacity < newSize) {
          newCapacity *= 2;
        }

        // Allocate new buffer and copy data
        const newBuffer = new Uint8Array(newCapacity);
        newBuffer.set(data);
        existing.buffer = newBuffer;
        existing.capacity = newCapacity;
      } else {
        // Buffer is large enough, just update data
        existing.buffer.set(data);
      }

      // Update metadata
      existing.size = newSize;
      existing.modified = new Date();
      existing.accessed = new Date();
      this.currentSize = totalSize;
    } else {
      // New file
      const newSize = this.currentSize + data.length;

      if (newSize > this.options.maxSize) {
        throw new Error(
          `VFS size limit exceeded: ${newSize} > ${this.options.maxSize}`,
        );
      }

      // Check file count limit
      if (this.entries.size >= this.options.maxFiles) {
        throw new Error(
          `VFS file limit exceeded: ${this.entries.size} >= ${this.options.maxFiles}`,
        );
      }

      // Create parent directories
      this.mkdirRecursive(this.getParentPath(normalized));

      // Create new file
      this.entries.set(normalized, this.createFile(data));
      this.currentSize = newSize;
    }
  }

  /**
   * Read data from a file (follows symlinks)
   */
  read(path: string): Uint8Array {
    this.validatePath(path);
    const resolved = this.resolvePath(path);
    const entry = this.entries.get(resolved);

    if (!entry) {
      throw new Deno.errors.NotFound(`File not found: ${path}`);
    }

    if (entry.type !== "file") {
      throw new Error(`Not a file: ${path}`);
    }

    // Update access time
    entry.accessed = new Date();

    // Return only the used portion of the buffer
    return entry.buffer.subarray(0, entry.size);
  }

  /**
   * Check if path exists
   */
  exists(path: string): boolean {
    this.validatePath(path);
    const normalized = this.normalizePath(path);
    return this.entries.has(normalized);
  }

  /**
   * Remove a file or empty directory
   */
  remove(path: string, options?: { recursive?: boolean }): void {
    this.validatePath(path);
    const normalized = this.normalizePath(path);

    if (normalized === "/") {
      throw new Error("Cannot remove root directory");
    }

    const entry = this.entries.get(normalized);
    if (!entry) {
      throw new Deno.errors.NotFound(`Path not found: ${path}`);
    }

    if (entry.type === "directory") {
      // Check if directory is empty (unless recursive)
      if (!options?.recursive) {
        const hasChildren = Array.from(this.entries.keys()).some(
          (key) =>
            key !== normalized &&
            key.startsWith(normalized + "/") &&
            key.split("/").length === normalized.split("/").length + 1,
        );

        if (hasChildren) {
          throw new Error(`Directory not empty: ${path}`);
        }
      } else {
        // Remove all children recursively
        const toRemove: string[] = [];
        for (const key of this.entries.keys()) {
          if (key.startsWith(normalized + "/") || key === normalized) {
            toRemove.push(key);
          }
        }

        for (const key of toRemove) {
          const childEntry = this.entries.get(key);
          if (childEntry?.type === "file") {
            this.currentSize -= childEntry.size;
          }
          this.entries.delete(key);
        }
        return;
      }
    }

    // Remove file
    if (entry.type === "file") {
      this.currentSize -= entry.size;
    }
    this.entries.delete(normalized);
  }

  /**
   * Get file/directory info
   */
  stat(path: string): Deno.FileInfo {
    this.validatePath(path);
    const normalized = this.normalizePath(path);
    const entry = this.entries.get(normalized);

    if (!entry) {
      throw new Deno.errors.NotFound(`Path not found: ${path}`);
    }

    // Update access time
    entry.accessed = new Date();

    const size = entry.type === "file" ? entry.size : 0;

    return {
      isFile: entry.type === "file",
      isDirectory: entry.type === "directory",
      isSymlink: false,
      size,
      mtime: entry.modified,
      atime: entry.accessed,
      birthtime: entry.created,
      ctime: entry.modified,
      dev: 0,
      ino: 0,
      mode: entry.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      blksize: 4096,
      blocks: Math.ceil(size / 512),
      isBlockDevice: false,
      isCharDevice: false,
      isFifo: false,
      isSocket: false,
    };
  }

  // ===========================================================================
  // File Descriptor Operations
  // ===========================================================================

  /**
   * Open a file and return a file descriptor
   */
  open(path: string, flags: number): number {
    this.validatePath(path);
    const normalized = this.normalizePath(path);

    let entry = this.entries.get(normalized);

    // Handle O_CREAT flag
    if (!entry && (flags & O_CREAT)) {
      // Create new file
      if (this.entries.size >= this.options.maxFiles) {
        throw new Error(
          `VFS file limit exceeded: ${this.entries.size} >= ${this.options.maxFiles}`,
        );
      }

      // Create parent directories
      this.mkdirRecursive(this.getParentPath(normalized));

      // Create empty file
      entry = this.createFile(new Uint8Array(0));
      this.entries.set(normalized, entry);
    }

    if (!entry) {
      throw new Deno.errors.NotFound(`File not found: ${path}`);
    }

    if (entry.type !== "file") {
      throw new Error(`Not a file: ${path}`);
    }

    // Handle O_EXCL flag (fail if file exists)
    if ((flags & O_EXCL) && (flags & O_CREAT)) {
      throw new Error(`File exists: ${path}`);
    }

    // Handle O_TRUNC flag (truncate to zero length)
    if (flags & O_TRUNC) {
      if (this.canWrite(flags)) {
        entry.size = 0;
        entry.modified = new Date();
      }
    }

    // Allocate file descriptor
    const fd = this.allocateFd();

    // Determine initial position
    const position = (flags & O_APPEND) ? entry.size : 0;

    // Create file handle
    const file: VFSFile = {
      fd,
      path: normalized,
      flags,
      position,
      entry,
    };

    this.fds.set(fd, file);

    return fd;
  }

  /**
   * Close a file descriptor
   */
  close(fd: number): void {
    const file = this.getFile(fd);
    this.fds.delete(fd);
    this.releaseFd(fd);
  }

  /**
   * Read from a file descriptor into a buffer
   */
  readFd(fd: number, buffer: Uint8Array): number {
    const file = this.getFile(fd);

    if (!this.canRead(file.flags)) {
      throw new Error(`File not open for reading: ${fd}`);
    }

    // Update access time
    file.entry.accessed = new Date();

    // Calculate how much to read
    const available = file.entry.size - file.position;
    const toRead = Math.min(buffer.length, available);

    if (toRead <= 0) {
      return 0; // EOF
    }

    // Copy data from file to buffer
    const source = file.entry.buffer.subarray(
      file.position,
      file.position + toRead,
    );
    buffer.set(source);

    // Advance position
    file.position += toRead;

    return toRead;
  }

  /**
   * Write from a buffer to a file descriptor
   */
  writeFd(fd: number, data: Uint8Array): number {
    const file = this.getFile(fd);

    if (!this.canWrite(file.flags)) {
      throw new Error(`File not open for writing: ${fd}`);
    }

    // Handle O_APPEND flag
    if (file.flags & O_APPEND) {
      file.position = file.entry.size;
    }

    const writePos = file.position;
    const newSize = Math.max(file.entry.size, writePos + data.length);

    // Check size limits
    const sizeIncrease = newSize - file.entry.size;
    if (this.currentSize + sizeIncrease > this.options.maxSize) {
      throw new Error(
        `VFS size limit exceeded: ${this.currentSize + sizeIncrease} > ${this.options.maxSize}`,
      );
    }

    // Grow buffer if needed using capacity doubling
    if (newSize > file.entry.capacity) {
      let newCapacity = file.entry.capacity;
      while (newCapacity < newSize) {
        newCapacity *= 2;
      }

      // Allocate new buffer and copy existing data
      const newBuffer = new Uint8Array(newCapacity);
      newBuffer.set(file.entry.buffer.subarray(0, file.entry.size));
      file.entry.buffer = newBuffer;
      file.entry.capacity = newCapacity;
    }

    // Write data
    file.entry.buffer.set(data, writePos);

    // Update size and timestamps
    const oldSize = file.entry.size;
    file.entry.size = newSize;
    file.entry.modified = new Date();
    file.entry.accessed = new Date();

    // Update total size
    this.currentSize += (newSize - oldSize);

    // Advance position
    file.position += data.length;

    return data.length;
  }

  /**
   * Seek to a position in a file
   */
  seek(fd: number, offset: number, whence: Deno.SeekMode): number {
    const file = this.getFile(fd);

    let newPosition: number;

    switch (whence) {
      case Deno.SeekMode.Start:
        newPosition = offset;
        break;
      case Deno.SeekMode.Current:
        newPosition = file.position + offset;
        break;
      case Deno.SeekMode.End:
        newPosition = file.entry.size + offset;
        break;
      default:
        throw new Error(`Invalid seek mode: ${whence}`);
    }

    if (newPosition < 0) {
      throw new Error(`Invalid seek position: ${newPosition}`);
    }

    file.position = newPosition;
    return newPosition;
  }

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  /**
   * Create a directory
   */
  mkdir(path: string, options?: { recursive?: boolean }): void {
    this.validatePath(path);
    const normalized = this.normalizePath(path);

    if (normalized === "/") {
      return; // Root always exists
    }

    if (this.entries.has(normalized)) {
      throw new Error(`Path already exists: ${path}`);
    }

    // Check file count limit
    if (this.entries.size >= this.options.maxFiles) {
      throw new Error(
        `VFS file limit exceeded: ${this.entries.size} >= ${this.options.maxFiles}`,
      );
    }

    const parent = this.getParentPath(normalized);

    if (options?.recursive) {
      this.mkdirRecursive(parent);
    } else if (!this.entries.has(parent)) {
      throw new Deno.errors.NotFound(`Parent directory not found: ${parent}`);
    }

    this.entries.set(normalized, this.createDirectory());
  }

  /**
   * Create directory recursively (internal helper)
   */
  private mkdirRecursive(path: string): void {
    const normalized = this.normalizePath(path);
    if (normalized === "/" || this.entries.has(normalized)) {
      return;
    }

    const parent = this.getParentPath(normalized);
    this.mkdirRecursive(parent);

    if (!this.entries.has(normalized)) {
      this.entries.set(normalized, this.createDirectory());
    }
  }

  /**
   * List directory contents
   */
  readDir(path: string): Deno.DirEntry[] {
    this.validatePath(path);
    const normalized = this.normalizePath(path);
    const entry = this.entries.get(normalized);

    if (!entry) {
      throw new Deno.errors.NotFound(`Directory not found: ${path}`);
    }

    if (entry.type !== "directory") {
      throw new Error(`Not a directory: ${path}`);
    }

    // Update access time
    entry.accessed = new Date();

    const prefix = normalized === "/" ? "/" : normalized + "/";
    const entries: Deno.DirEntry[] = [];
    const seen = new Set<string>();

    for (const key of this.entries.keys()) {
      if (key === normalized) continue;

      if (key.startsWith(prefix)) {
        const relative = key.substring(prefix.length);
        const parts = relative.split("/");

        if (parts.length > 0 && parts[0] && !seen.has(parts[0])) {
          seen.add(parts[0]);

          const childPath = prefix + parts[0];
          const childEntry = this.entries.get(childPath);

          if (childEntry) {
            entries.push({
              name: parts[0],
              isFile: childEntry.type === "file",
              isDirectory: childEntry.type === "directory",
              isSymlink: false,
            });
          }
        }
      }
    }

    return entries;
  }

  // ===========================================================================
  // Symlink Operations
  // ===========================================================================

  /**
   * Create a symbolic link
   */
  symlink(target: string, linkPath: string): void {
    this.validatePath(linkPath);
    const normalized = this.normalizePath(linkPath);

    // Check if link already exists
    if (this.entries.has(normalized)) {
      throw new Error(`File exists: ${linkPath}`);
    }

    // Check file count limit
    if (this.entries.size >= this.options.maxFiles) {
      throw new Error(
        `VFS file limit exceeded: ${this.entries.size} >= ${this.options.maxFiles}`,
      );
    }

    // Create parent directories
    this.mkdirRecursive(this.getParentPath(normalized));

    // Create symlink (don't validate target - it may not exist yet)
    this.entries.set(normalized, this.createSymlink(target));
  }

  /**
   * Read the target of a symbolic link
   */
  readlink(path: string): string {
    this.validatePath(path);
    const normalized = this.normalizePath(path);
    const entry = this.entries.get(normalized);

    if (!entry) {
      throw new Deno.errors.NotFound(`Symlink not found: ${path}`);
    }

    if (entry.type !== "symlink") {
      throw new Error(`Not a symlink: ${path}`);
    }

    entry.accessed = new Date();
    return entry.target;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clear all VFS contents (including root)
   */
  clear(): void {
    // Close all open file descriptors
    for (const fd of this.fds.keys()) {
      this.fds.delete(fd);
    }
    this.releasedFds = [];
    this.nextFd = 3;

    // Overwrite file data with zeros before clearing (security)
    for (const entry of this.entries.values()) {
      if (entry.type === "file") {
        // Zero out the used portion of the buffer
        entry.buffer.fill(0, 0, entry.size);
      }
    }

    this.entries.clear();
    this.currentSize = 0;

    // Recreate root
    this.entries.set("/", this.createDirectory());
  }
}
