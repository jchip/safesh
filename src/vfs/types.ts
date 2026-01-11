/**
 * Virtual File System (VFS) Types
 */

// =============================================================================
// File Flags (Deno-compatible)
// =============================================================================

/** Open file for reading */
export const O_RDONLY = 0o0;
/** Open file for writing */
export const O_WRONLY = 0o1;
/** Open file for reading and writing */
export const O_RDWR = 0o2;
/** Create file if it doesn't exist */
export const O_CREAT = 0o100;
/** Fail if file exists (used with O_CREAT) */
export const O_EXCL = 0o200;
/** Truncate file to zero length */
export const O_TRUNC = 0o1000;
/** Append mode - writes always go to end */
export const O_APPEND = 0o2000;

// =============================================================================
// File Descriptor Types
// =============================================================================

export interface VFSFile {
  /** File descriptor number */
  fd: number;
  /** Normalized path to the file */
  path: string;
  /** Open flags */
  flags: number;
  /** Current read/write position */
  position: number;
  /** Reference to the file entry */
  entry: VFSFileEntry;
}

// =============================================================================
// Configuration
// =============================================================================

export interface VFSConfig {
  /**
   * Path prefix for VFS paths (default: "/@vfs/")
   * Paths starting with this prefix will be routed to VFS
   */
  prefix?: string;

  /**
   * Maximum total size of VFS in bytes (default: 100MB)
   * Prevents memory exhaustion from unbounded file writes
   */
  maxSize?: number;

  /**
   * Maximum number of files (default: 10000)
   * Prevents excessive file creation
   */
  maxFiles?: number;
}

export interface VFSOptions {
  /**
   * Path prefix for VFS (default: "/@vfs/")
   */
  prefix: string;

  /**
   * Maximum total size in bytes (default: 100MB)
   */
  maxSize: number;

  /**
   * Maximum number of files (default: 10000)
   */
  maxFiles: number;
}

// =============================================================================
// File System Entry Types
// =============================================================================

export interface VFSFileEntry {
  type: "file";
  buffer: Uint8Array;     // Allocated buffer
  size: number;           // Actual data size
  capacity: number;       // Buffer capacity
  created: Date;
  modified: Date;
  accessed: Date;
  mode: number;
}

export interface VFSDirectoryEntry {
  type: "directory";
  created: Date;
  modified: Date;
  accessed: Date;
  mode: number;
}

export interface VFSSymlinkEntry {
  type: "symlink";
  target: string; // Path to the target (can be relative or absolute)
  created: Date;
  modified: Date;
  accessed: Date;
  mode: number;
}

export type VFSEntry = VFSFileEntry | VFSDirectoryEntry | VFSSymlinkEntry;

// =============================================================================
// Statistics
// =============================================================================

export interface VFSStats {
  /** Total number of files */
  fileCount: number;
  /** Total number of directories */
  dirCount: number;
  /** Total size in bytes */
  totalSize: number;
  /** Maximum size allowed */
  maxSize: number;
  /** Maximum files allowed */
  maxFiles: number;
}
