/**
 * test command - check file types and compare values
 *
 * @module
 */

import type { SandboxOptions } from "../fs.ts";

/**
 * Test file type or attribute
 *
 * @param expression - Test expression (-d, -f, -e, etc.)
 * @param path - Path to test
 * @param options - Sandbox options
 * @returns True if test passes
 *
 * @example
 * ```ts
 * if (await test("-d", "src")) {
 *   console.log("src is a directory");
 * }
 *
 * if (await test("-f", "package.json")) {
 *   console.log("package.json exists and is a file");
 * }
 *
 * // Check if executable
 * if (await test("-x", "/usr/bin/node")) {
 *   console.log("node is executable");
 * }
 * ```
 */
export async function test(
  expression: string,
  path: string,
  _options?: SandboxOptions,
): Promise<boolean> {
  try {
    switch (expression) {
      case "-b": // block device
        return await isBlockDevice(path);

      case "-c": // character device
        return await isCharacterDevice(path);

      case "-d": // directory
        return await isDirectory(path);

      case "-e": // exists
        return await exists(path);

      case "-f": // regular file
        return await isFile(path);

      case "-L": // symbolic link
        return await isSymlink(path);

      case "-p": // named pipe (FIFO)
        return await isFifo(path);

      case "-S": // socket
        return await isSocket(path);

      case "-r": // readable
        return await isReadable(path);

      case "-w": // writable
        return await isWritable(path);

      case "-x": // executable
        return await isExecutable(path);

      case "-s": // size > 0
        return await hasSize(path);

      default:
        throw new Error(`test: unknown expression: ${expression}`);
    }
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    const stat = await Deno.lstat(path);
    return stat.isSymlink;
  } catch {
    return false;
  }
}

async function isBlockDevice(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isBlockDevice ?? false;
  } catch {
    return false;
  }
}

async function isCharacterDevice(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isCharDevice ?? false;
  } catch {
    return false;
  }
}

async function isFifo(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFifo ?? false;
  } catch {
    return false;
  }
}

async function isSocket(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isSocket ?? false;
  } catch {
    return false;
  }
}

async function isReadable(path: string): Promise<boolean> {
  try {
    // Try to open file for reading
    const file = await Deno.open(path, { read: true });
    file.close();
    return true;
  } catch {
    return false;
  }
}

async function isWritable(path: string): Promise<boolean> {
  try {
    // Try to open file for writing (without truncating)
    const file = await Deno.open(path, { write: true });
    file.close();
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) return false;

    // On Unix, check executable bit
    if (Deno.build.os !== "windows") {
      return stat.mode !== null && (stat.mode & 0o111) !== 0;
    }

    // On Windows, check file extension
    const ext = path.toLowerCase().split(".").pop() || "";
    const execExts = ["exe", "bat", "cmd", "com", "vbs", "js"];
    return execExts.includes(ext);
  } catch {
    return false;
  }
}

async function hasSize(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.size > 0;
  } catch {
    return false;
  }
}
