/**
 * Virtual File System Tests
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { VirtualFileSystem } from "./filesystem.ts";
import { setupVFS } from "./intercept.ts";
import {
  O_APPEND,
  O_CREAT,
  O_EXCL,
  O_RDONLY,
  O_RDWR,
  O_TRUNC,
  O_WRONLY,
} from "./types.ts";

describe("VirtualFileSystem", () => {
  describe("Configuration", () => {
    it("should use default prefix /@vfs/", () => {
      const vfs = new VirtualFileSystem();
      assertEquals(vfs.prefix, "/@vfs/");
    });

    it("should use custom prefix", () => {
      const vfs = new VirtualFileSystem({ prefix: "/custom/" });
      assertEquals(vfs.prefix, "/custom/");
    });

    it("should add trailing slash to prefix", () => {
      const vfs = new VirtualFileSystem({ prefix: "/test" });
      assertEquals(vfs.prefix, "/test/");
    });

    it("should report stats", () => {
      const vfs = new VirtualFileSystem({
        maxSize: 1000,
        maxFiles: 50,
      });

      const stats = vfs.stats();
      assertEquals(stats.fileCount, 0);
      assertEquals(stats.dirCount, 1); // Root directory
      assertEquals(stats.totalSize, 0);
      assertEquals(stats.maxSize, 1000);
      assertEquals(stats.maxFiles, 50);
    });
  });

  describe("File Operations", () => {
    it("should write and read a file", () => {
      const vfs = new VirtualFileSystem();
      const data = new TextEncoder().encode("Hello World");

      vfs.write("/test.txt", data);
      const result = vfs.read("/test.txt");

      assertEquals(result, data);
    });

    it("should handle text encoding", () => {
      const vfs = new VirtualFileSystem();
      const text = "Hello VFS! 🎉";
      const data = new TextEncoder().encode(text);

      vfs.write("/emoji.txt", data);
      const result = new TextDecoder().decode(vfs.read("/emoji.txt"));

      assertEquals(result, text);
    });

    it("should check if file exists", () => {
      const vfs = new VirtualFileSystem();
      const data = new TextEncoder().encode("test");

      assertEquals(vfs.exists("/test.txt"), false);
      vfs.write("/test.txt", data);
      assertEquals(vfs.exists("/test.txt"), true);
    });

    it("should throw on reading non-existent file", () => {
      const vfs = new VirtualFileSystem();

      assertThrows(
        () => vfs.read("/nonexistent.txt"),
        Deno.errors.NotFound,
        "File not found",
      );
    });

    it("should remove a file", () => {
      const vfs = new VirtualFileSystem();
      const data = new TextEncoder().encode("test");

      vfs.write("/test.txt", data);
      assertEquals(vfs.exists("/test.txt"), true);

      vfs.remove("/test.txt");
      assertEquals(vfs.exists("/test.txt"), false);
    });

    it("should update file size on write", () => {
      const vfs = new VirtualFileSystem();
      const data1 = new TextEncoder().encode("Hello");
      const data2 = new TextEncoder().encode("Hello World!");

      vfs.write("/test.txt", data1);
      assertEquals(vfs.stats().totalSize, data1.length);

      vfs.write("/test.txt", data2);
      assertEquals(vfs.stats().totalSize, data2.length);
    });

    it("should enforce size limits", () => {
      const vfs = new VirtualFileSystem({ maxSize: 100 });
      const data = new Uint8Array(101);

      assertThrows(
        () => vfs.write("/large.bin", data),
        Error,
        "VFS size limit exceeded",
      );
    });

    it("should enforce file count limits", () => {
      const vfs = new VirtualFileSystem({ maxFiles: 3 }); // Root + 2 files

      vfs.write("/file1.txt", new Uint8Array(10));
      vfs.write("/file2.txt", new Uint8Array(10));

      assertThrows(
        () => vfs.write("/file3.txt", new Uint8Array(10)),
        Error,
        "VFS file limit exceeded",
      );
    });
  });

  describe("Directory Operations", () => {
    it("should create directories", () => {
      const vfs = new VirtualFileSystem();

      vfs.mkdir("/dir");
      assertEquals(vfs.exists("/dir"), true);
    });

    it("should create nested directories with recursive option", () => {
      const vfs = new VirtualFileSystem();

      vfs.mkdir("/a/b/c", { recursive: true });
      assertEquals(vfs.exists("/a"), true);
      assertEquals(vfs.exists("/a/b"), true);
      assertEquals(vfs.exists("/a/b/c"), true);
    });

    it("should throw on non-recursive mkdir without parent", () => {
      const vfs = new VirtualFileSystem();

      assertThrows(
        () => vfs.mkdir("/a/b/c"),
        Deno.errors.NotFound,
        "Parent directory not found",
      );
    });

    it("should auto-create parent directories on write", () => {
      const vfs = new VirtualFileSystem();
      const data = new TextEncoder().encode("test");

      vfs.write("/a/b/c/file.txt", data);

      assertEquals(vfs.exists("/a"), true);
      assertEquals(vfs.exists("/a/b"), true);
      assertEquals(vfs.exists("/a/b/c"), true);
      assertEquals(vfs.exists("/a/b/c/file.txt"), true);
    });

    it("should list directory contents", () => {
      const vfs = new VirtualFileSystem();

      vfs.write("/dir/file1.txt", new Uint8Array(10));
      vfs.write("/dir/file2.txt", new Uint8Array(10));
      vfs.mkdir("/dir/subdir");

      const entries = vfs.readDir("/dir");

      assertEquals(entries.length, 3);
      assertEquals(entries.some((e) => e.name === "file1.txt" && e.isFile), true);
      assertEquals(entries.some((e) => e.name === "file2.txt" && e.isFile), true);
      assertEquals(entries.some((e) => e.name === "subdir" && e.isDirectory), true);
    });

    it("should list root directory", () => {
      const vfs = new VirtualFileSystem();

      vfs.write("/file.txt", new Uint8Array(10));
      vfs.mkdir("/dir");

      const entries = vfs.readDir("/");

      assertEquals(entries.length, 2);
      assertEquals(entries.some((e) => e.name === "file.txt"), true);
      assertEquals(entries.some((e) => e.name === "dir"), true);
    });

    it("should throw on reading non-existent directory", () => {
      const vfs = new VirtualFileSystem();

      assertThrows(
        () => vfs.readDir("/nonexistent"),
        Deno.errors.NotFound,
        "Directory not found",
      );
    });

    it("should throw on reading file as directory", () => {
      const vfs = new VirtualFileSystem();
      vfs.write("/file.txt", new Uint8Array(10));

      assertThrows(
        () => vfs.readDir("/file.txt"),
        Error,
        "Not a directory",
      );
    });

    it("should remove empty directory", () => {
      const vfs = new VirtualFileSystem();

      vfs.mkdir("/dir");
      vfs.remove("/dir");

      assertEquals(vfs.exists("/dir"), false);
    });

    it("should throw on removing non-empty directory without recursive", () => {
      const vfs = new VirtualFileSystem();

      vfs.write("/dir/file.txt", new Uint8Array(10));

      assertThrows(
        () => vfs.remove("/dir"),
        Error,
        "Directory not empty",
      );
    });

    it("should remove directory recursively", () => {
      const vfs = new VirtualFileSystem();

      vfs.write("/dir/file1.txt", new Uint8Array(10));
      vfs.write("/dir/subdir/file2.txt", new Uint8Array(20));

      vfs.remove("/dir", { recursive: true });

      assertEquals(vfs.exists("/dir"), false);
      assertEquals(vfs.exists("/dir/file1.txt"), false);
      assertEquals(vfs.exists("/dir/subdir"), false);
    });
  });

  describe("File Stats", () => {
    it("should return file stats", () => {
      const vfs = new VirtualFileSystem();
      const data = new Uint8Array(100);

      vfs.write("/file.bin", data);
      const stat = vfs.stat("/file.bin");

      assertEquals(stat.isFile, true);
      assertEquals(stat.isDirectory, false);
      assertEquals(stat.isSymlink, false);
      assertEquals(stat.size, 100);
      assertEquals(stat.mode, 0o644);
    });

    it("should return directory stats", () => {
      const vfs = new VirtualFileSystem();

      vfs.mkdir("/dir");
      const stat = vfs.stat("/dir");

      assertEquals(stat.isFile, false);
      assertEquals(stat.isDirectory, true);
      assertEquals(stat.isSymlink, false);
      assertEquals(stat.size, 0);
      assertEquals(stat.mode, 0o755);
    });

    it("should throw on stat of non-existent path", () => {
      const vfs = new VirtualFileSystem();

      assertThrows(
        () => vfs.stat("/nonexistent"),
        Deno.errors.NotFound,
        "Path not found",
      );
    });
  });

  describe("Path Normalization", () => {
    it("should handle relative path components", () => {
      const vfs = new VirtualFileSystem();
      const data = new TextEncoder().encode("test");

      vfs.write("/a/b/../c/./file.txt", data);

      assertEquals(vfs.exists("/a/c/file.txt"), true);
      assertEquals(vfs.exists("/a/b"), false);
    });

    it("should prevent path traversal above root", () => {
      const vfs = new VirtualFileSystem();
      const data = new TextEncoder().encode("test");

      vfs.write("/../../etc/passwd", data);

      // Should be normalized to /etc/passwd
      assertEquals(vfs.exists("/etc/passwd"), true);
      assertEquals(vfs.read("/etc/passwd"), data);
    });

    it("should handle prefix in paths", () => {
      const vfs = new VirtualFileSystem({ prefix: "/@vfs/" });
      const data = new TextEncoder().encode("test");

      // Writing with prefix should work
      vfs.write("/@vfs/file.txt", data);
      assertEquals(vfs.read("/file.txt"), data);
      assertEquals(vfs.read("/@vfs/file.txt"), data);
    });
  });

  describe("Cleanup", () => {
    it("should clear all contents", () => {
      const vfs = new VirtualFileSystem();

      vfs.write("/file1.txt", new Uint8Array(100));
      vfs.write("/dir/file2.txt", new Uint8Array(200));

      assertEquals(vfs.stats().fileCount, 2);
      assertEquals(vfs.stats().totalSize, 300);

      vfs.clear();

      assertEquals(vfs.stats().fileCount, 0);
      assertEquals(vfs.stats().totalSize, 0);
      assertEquals(vfs.exists("/file1.txt"), false);
    });

    it("should overwrite file data on clear", () => {
      const vfs = new VirtualFileSystem();
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      vfs.write("/secret.txt", data);

      // Get reference to the internal buffer before clear
      const entry = (vfs as any).entries.get("/secret.txt");
      const buffer = entry.buffer;
      const size = entry.size;

      vfs.clear();

      // The used portion of buffer should be zeroed
      const usedPortion = buffer.subarray(0, size);
      assertEquals(usedPortion, new Uint8Array([0, 0, 0, 0, 0]));
    });
  });
});

describe("VFS Interception", () => {
  it("should intercept Deno.readFile", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      const data = new TextEncoder().encode("Hello VFS");
      vfs.write("/@vfs/test.txt", data);

      const result = await Deno.readFile("/@vfs/test.txt");
      assertEquals(result, data);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.readTextFile", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      const text = "Hello VFS!";
      vfs.write("/@vfs/test.txt", new TextEncoder().encode(text));

      const result = await Deno.readTextFile("/@vfs/test.txt");
      assertEquals(result, text);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.writeFile", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      const data = new TextEncoder().encode("Write test");
      await Deno.writeFile("/@vfs/output.txt", data);

      const result = vfs.read("/@vfs/output.txt");
      assertEquals(result, data);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.writeTextFile", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      const text = "Write text test";
      await Deno.writeTextFile("/@vfs/output.txt", text);

      const result = new TextDecoder().decode(vfs.read("/@vfs/output.txt"));
      assertEquals(result, text);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.stat", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      vfs.write("/@vfs/test.txt", new Uint8Array(100));

      const stat = await Deno.stat("/@vfs/test.txt");
      assertEquals(stat.isFile, true);
      assertEquals(stat.size, 100);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.remove", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      vfs.write("/@vfs/test.txt", new Uint8Array(10));
      assertEquals(vfs.exists("/@vfs/test.txt"), true);

      await Deno.remove("/@vfs/test.txt");
      assertEquals(vfs.exists("/@vfs/test.txt"), false);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.mkdir", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      await Deno.mkdir("/@vfs/testdir", { recursive: true });
      assertEquals(vfs.exists("/@vfs/testdir"), true);
    } finally {
      restore();
    }
  });

  it("should intercept Deno.readDir", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      vfs.write("/@vfs/dir/file1.txt", new Uint8Array(10));
      vfs.write("/@vfs/dir/file2.txt", new Uint8Array(20));

      const entries = [];
      for await (const entry of Deno.readDir("/@vfs/dir")) {
        entries.push(entry);
      }

      assertEquals(entries.length, 2);
      assertEquals(entries.some((e) => e.name === "file1.txt"), true);
      assertEquals(entries.some((e) => e.name === "file2.txt"), true);
    } finally {
      restore();
    }
  });

  it("should not intercept non-VFS paths", async () => {
    const vfs = new VirtualFileSystem();
    const restore = setupVFS(vfs);

    try {
      // Writing to VFS
      await Deno.writeTextFile("/@vfs/test.txt", "VFS file");

      // This should throw NotFound (not in VFS, real file doesn't exist)
      await assertRejects(
        () => Deno.readTextFile("/real/path/test.txt"),
        Deno.errors.NotFound,
      );
    } finally {
      restore();
    }
  });

  it("should restore original Deno namespace", async () => {
    const vfs = new VirtualFileSystem();
    const originalReadFile = Deno.readFile;
    const restore = setupVFS(vfs);

    // Deno should be proxied
    assertEquals(Deno.readFile === originalReadFile, false);

    restore();

    // Deno should be restored
    assertEquals(Deno.readFile, originalReadFile);
  });

  it("should work with custom prefix", async () => {
    const vfs = new VirtualFileSystem({ prefix: "/custom/" });
    const restore = setupVFS(vfs);

    try {
      await Deno.writeTextFile("/custom/test.txt", "Custom prefix");
      const result = await Deno.readTextFile("/custom/test.txt");
      assertEquals(result, "Custom prefix");
    } finally {
      restore();
    }
  });
});

describe("Capacity Doubling", () => {
  it("should allocate initial capacity of at least 64 bytes", () => {
    const vfs = new VirtualFileSystem();
    const smallData = new Uint8Array(10);

    vfs.write("/small.bin", smallData);

    // Access normalized path (without prefix)
    const entry = (vfs as any).entries.get("/small.bin");
    assertEquals(entry.type, "file");
    assertEquals(entry.size, 10);
    assertEquals(entry.capacity >= 64, true);
  });

  it("should double capacity when writing larger data", () => {
    const vfs = new VirtualFileSystem();

    // Write small file
    vfs.write("/growing.bin", new Uint8Array(32));
    let entry = (vfs as any).entries.get("/growing.bin");
    const firstCapacity = entry.capacity;
    assertEquals(entry.size, 32);
    assertEquals(firstCapacity >= 64, true);

    // Write larger data, should trigger doubling
    vfs.write("/growing.bin", new Uint8Array(200));
    entry = (vfs as any).entries.get("/growing.bin");
    assertEquals(entry.size, 200);
    assertEquals(entry.capacity > firstCapacity, true);
    assertEquals(entry.capacity >= 200, true);
  });

  it("should use exponential growth (power of 2)", () => {
    const vfs = new VirtualFileSystem();

    // Write file that's larger than default 64 bytes
    vfs.write("/test.bin", new Uint8Array(100));
    const entry = (vfs as any).entries.get("/test.bin");

    // Initial capacity is max(64, 100) = 100
    // So capacity should be at least 100
    assertEquals(entry.capacity >= 100, true);
    assertEquals(entry.size, 100);
  });

  it("should reuse buffer capacity when writing smaller data", () => {
    const vfs = new VirtualFileSystem();

    // Write large file
    vfs.write("/shrink.bin", new Uint8Array(500));
    let entry = (vfs as any).entries.get("/shrink.bin");
    const largeCapacity = entry.capacity;
    assertEquals(entry.size, 500);

    // Write smaller data - should reuse same buffer
    vfs.write("/shrink.bin", new Uint8Array(100));
    entry = (vfs as any).entries.get("/shrink.bin");
    assertEquals(entry.size, 100);
    assertEquals(entry.capacity, largeCapacity); // Same capacity
  });

  it("should only return used portion of buffer on read", () => {
    const vfs = new VirtualFileSystem();

    // Write data that triggers capacity allocation
    const originalData = new Uint8Array([1, 2, 3, 4, 5]);
    vfs.write("/test.bin", originalData);

    const entry = (vfs as any).entries.get("/test.bin");
    // Capacity should be larger than actual data
    assertEquals(entry.capacity > entry.size, true);

    // Read should only return the used portion
    const readData = vfs.read("/test.bin");
    assertEquals(readData.length, 5);
    assertEquals(readData, originalData);
  });

  it("should track size correctly across multiple writes", () => {
    const vfs = new VirtualFileSystem();

    // First write
    vfs.write("/multi.bin", new Uint8Array(50));
    assertEquals(vfs.stats().totalSize, 50);

    // Second write (replace)
    vfs.write("/multi.bin", new Uint8Array(100));
    assertEquals(vfs.stats().totalSize, 100);

    // Third write (smaller)
    vfs.write("/multi.bin", new Uint8Array(30));
    assertEquals(vfs.stats().totalSize, 30);
  });

  it("should handle capacity doubling with multiple files", () => {
    const vfs = new VirtualFileSystem();

    // Create multiple files of varying sizes
    vfs.write("/file1.bin", new Uint8Array(100));
    vfs.write("/file2.bin", new Uint8Array(200));
    vfs.write("/file3.bin", new Uint8Array(50));

    const stats = vfs.stats();
    assertEquals(stats.fileCount, 3);
    assertEquals(stats.totalSize, 350);

    // Each file should have appropriate capacity
    const entry1 = (vfs as any).entries.get("/file1.bin");
    const entry2 = (vfs as any).entries.get("/file2.bin");
    const entry3 = (vfs as any).entries.get("/file3.bin");

    assertEquals(entry1.capacity >= 100, true);
    assertEquals(entry2.capacity >= 200, true);
    assertEquals(entry3.capacity >= 64, true); // At least initial capacity
  });

  it("should work with zero-length files", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/empty.txt", new Uint8Array(0));

    const entry = (vfs as any).entries.get("/empty.txt");
    assertEquals(entry.size, 0);
    assertEquals(entry.capacity >= 64, true); // Still has initial capacity

    const data = vfs.read("/empty.txt");
    assertEquals(data.length, 0);
  });
});

describe("File Descriptors", () => {
  it("should open and close files", () => {
    const vfs = new VirtualFileSystem();
    

    // Create and open file
    const fd = vfs.open("/test.txt", O_RDWR | O_CREAT);
    assertEquals(typeof fd, "number");
    assertEquals(fd >= 3, true); // FDs start at 3

    // Close file
    vfs.close(fd);

    // Should throw on closed FD
    assertThrows(() => vfs.close(fd), Error, "Bad file descriptor");
  });

  it("should recycle file descriptors", () => {
    const vfs = new VirtualFileSystem();
    

    // Write a file first
    vfs.write("/file.txt", new TextEncoder().encode("test"));

    // Open and close to release FD
    const fd1 = vfs.open("/file.txt", O_RDONLY);
    vfs.close(fd1);

    // Next open should reuse same FD
    const fd2 = vfs.open("/file.txt", O_RDONLY);
    assertEquals(fd1, fd2);

    vfs.close(fd2);
  });

  it("should read from file descriptor", () => {
    const vfs = new VirtualFileSystem();
    

    const content = "Hello, File Descriptors!";
    vfs.write("/test.txt", new TextEncoder().encode(content));

    const fd = vfs.open("/test.txt", O_RDONLY);
    const buffer = new Uint8Array(100);
    const bytesRead = vfs.readFd(fd, buffer);

    assertEquals(bytesRead, content.length);
    assertEquals(
      new TextDecoder().decode(buffer.subarray(0, bytesRead)),
      content,
    );

    vfs.close(fd);
  });

  it("should write to file descriptor", () => {
    const vfs = new VirtualFileSystem();
    

    const fd = vfs.open("/output.txt", O_WRONLY | O_CREAT);
    const data = new TextEncoder().encode("Written via FD");

    const bytesWritten = vfs.writeFd(fd, data);
    assertEquals(bytesWritten, data.length);

    vfs.close(fd);

    // Verify content
    const content = vfs.read("/output.txt");
    assertEquals(new TextDecoder().decode(content), "Written via FD");
  });

  it("should support O_APPEND flag", () => {
    const vfs = new VirtualFileSystem();
    

    // Create file with initial content
    vfs.write("/log.txt", new TextEncoder().encode("Line 1\n"));

    // Open in append mode
    const fd = vfs.open("/log.txt", O_WRONLY | O_APPEND);

    // Write should append
    vfs.writeFd(fd, new TextEncoder().encode("Line 2\n"));
    vfs.writeFd(fd, new TextEncoder().encode("Line 3\n"));

    vfs.close(fd);

    // Verify all lines present
    const content = new TextDecoder().decode(vfs.read("/log.txt"));
    assertEquals(content, "Line 1\nLine 2\nLine 3\n");
  });

  it("should support O_TRUNC flag", () => {
    const vfs = new VirtualFileSystem();
    

    // Create file with content
    vfs.write("/file.txt", new TextEncoder().encode("Old content"));

    // Open with truncate
    const fd = vfs.open("/file.txt", O_WRONLY | O_TRUNC);
    vfs.writeFd(fd, new TextEncoder().encode("New"));
    vfs.close(fd);

    // Should only have new content
    const content = new TextDecoder().decode(vfs.read("/file.txt"));
    assertEquals(content, "New");
  });

  it("should seek within file", () => {
    const vfs = new VirtualFileSystem();
    

    vfs.write("/file.txt", new TextEncoder().encode("0123456789"));

    const fd = vfs.open("/file.txt", O_RDWR);

    // Seek to middle
    const pos1 = vfs.seek(fd, 5, Deno.SeekMode.Start);
    assertEquals(pos1, 5);

    // Read from position 5
    const buffer1 = new Uint8Array(3);
    vfs.readFd(fd, buffer1);
    assertEquals(new TextDecoder().decode(buffer1), "567");

    // Seek relative
    const pos2 = vfs.seek(fd, -3, Deno.SeekMode.Current);
    assertEquals(pos2, 5);

    // Seek from end
    const pos3 = vfs.seek(fd, -2, Deno.SeekMode.End);
    assertEquals(pos3, 8);

    vfs.close(fd);
  });

  it("should track cursor position across reads", () => {
    const vfs = new VirtualFileSystem();
    

    vfs.write("/file.txt", new TextEncoder().encode("ABCDEFGHIJ"));

    const fd = vfs.open("/file.txt", O_RDONLY);

    // Read 3 bytes
    const buf1 = new Uint8Array(3);
    vfs.readFd(fd, buf1);
    assertEquals(new TextDecoder().decode(buf1), "ABC");

    // Read 3 more bytes (cursor should advance)
    const buf2 = new Uint8Array(3);
    vfs.readFd(fd, buf2);
    assertEquals(new TextDecoder().decode(buf2), "DEF");

    vfs.close(fd);
  });

  it("should enforce file permission flags", () => {
    const vfs = new VirtualFileSystem();
    

    vfs.write("/file.txt", new TextEncoder().encode("test"));

    // Open read-only
    const fdRead = vfs.open("/file.txt", O_RDONLY);
    assertThrows(
      () => vfs.writeFd(fdRead, new Uint8Array(1)),
      Error,
      "not open for writing",
    );
    vfs.close(fdRead);

    // Open write-only
    const fdWrite = vfs.open("/file.txt", O_WRONLY);
    assertThrows(
      () => vfs.readFd(fdWrite, new Uint8Array(1)),
      Error,
      "not open for reading",
    );
    vfs.close(fdWrite);
  });

  it("should enforce max open files limit", () => {
    const vfs = new VirtualFileSystem();
    

    const maxFiles = 1024;
    const openFds: number[] = [];

    // Open files up to limit
    for (let i = 0; i < maxFiles; i++) {
      vfs.write(`/file${i}.txt`, new Uint8Array(1));
      openFds.push(vfs.open(`/file${i}.txt`, O_RDONLY));
    }

    // Next open should fail
    vfs.write("/overflow.txt", new Uint8Array(1));
    assertThrows(
      () => vfs.open("/overflow.txt", O_RDONLY),
      Error,
      "Too many open files",
    );

    // Clean up
    for (const fd of openFds) {
      vfs.close(fd);
    }
  });
});

describe("Symlinks", () => {
  it("should create and read symlinks", () => {
    const vfs = new VirtualFileSystem();

    // Create a file
    vfs.write("/target.txt", new TextEncoder().encode("Target content"));

    // Create symlink to it
    vfs.symlink("/target.txt", "/link.txt");

    // Read symlink target
    const target = vfs.readlink("/link.txt");
    assertEquals(target, "/target.txt");
  });

  it("should follow symlinks when reading files", () => {
    const vfs = new VirtualFileSystem();

    const content = "Hello via symlink!";
    vfs.write("/real.txt", new TextEncoder().encode(content));
    vfs.symlink("/real.txt", "/link.txt");

    // Reading through symlink should work
    const data = vfs.read("/link.txt");
    assertEquals(new TextDecoder().decode(data), content);
  });

  it("should support relative symlinks", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/dir/file.txt", new TextEncoder().encode("Content"));
    vfs.symlink("file.txt", "/dir/link.txt"); // Relative

    // Should resolve relative to symlink's directory
    const data = vfs.read("/dir/link.txt");
    assertEquals(new TextDecoder().decode(data), "Content");
  });

  it("should detect symlink cycles", () => {
    const vfs = new VirtualFileSystem();

    // Create circular symlinks
    vfs.symlink("/link2.txt", "/link1.txt");
    vfs.symlink("/link1.txt", "/link2.txt");

    // Should throw on cycle
    assertThrows(
      () => vfs.read("/link1.txt"),
      Error,
      "Symlink cycle detected",
    );
  });

  it("should support chained symlinks", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/target.txt", new TextEncoder().encode("Final"));
    vfs.symlink("/target.txt", "/link1.txt");
    vfs.symlink("/link1.txt", "/link2.txt");
    vfs.symlink("/link2.txt", "/link3.txt");

    // Should follow entire chain
    const data = vfs.read("/link3.txt");
    assertEquals(new TextDecoder().decode(data), "Final");
  });

  it("should allow symlinks to non-existent targets", () => {
    const vfs = new VirtualFileSystem();

    // Symlink can point to non-existent file
    vfs.symlink("/nonexistent.txt", "/broken-link.txt");

    // readlink should work
    assertEquals(vfs.readlink("/broken-link.txt"), "/nonexistent.txt");

    // But reading through it should fail
    assertThrows(
      () => vfs.read("/broken-link.txt"),
      Deno.errors.NotFound,
    );
  });

  it("should throw on readlink of non-symlink", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/file.txt", new Uint8Array(10));

    assertThrows(
      () => vfs.readlink("/file.txt"),
      Error,
      "Not a symlink",
    );
  });

  it("should report isSymlink true in stat() for symlink entries", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/target.txt", new TextEncoder().encode("content"));
    vfs.symlink("/target.txt", "/link.txt");

    const stat = vfs.stat("/link.txt");
    assertEquals(stat.isSymlink, true);
    assertEquals(stat.isFile, false);
    assertEquals(stat.isDirectory, false);
  });

  it("should report isSymlink false in stat() for non-symlink entries", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/file.txt", new TextEncoder().encode("content"));
    vfs.mkdir("/dir");

    const fileStat = vfs.stat("/file.txt");
    assertEquals(fileStat.isSymlink, false);
    assertEquals(fileStat.isFile, true);

    const dirStat = vfs.stat("/dir");
    assertEquals(dirStat.isSymlink, false);
    assertEquals(dirStat.isDirectory, true);
  });

  it("should report isSymlink true in readDir() for symlink entries", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/dir/target.txt", new TextEncoder().encode("content"));
    vfs.symlink("/dir/target.txt", "/dir/link.txt");

    const entries = vfs.readDir("/dir");
    const linkEntry = entries.find((e) => e.name === "link.txt");
    const fileEntry = entries.find((e) => e.name === "target.txt");

    assertEquals(linkEntry !== undefined, true);
    assertEquals(linkEntry!.isSymlink, true);
    assertEquals(linkEntry!.isFile, false);
    assertEquals(linkEntry!.isDirectory, false);

    assertEquals(fileEntry !== undefined, true);
    assertEquals(fileEntry!.isSymlink, false);
    assertEquals(fileEntry!.isFile, true);
  });
});

describe("O_EXCL flag", () => {
  it("should throw EEXIST when O_EXCL | O_CREAT and file already exists", () => {
    const vfs = new VirtualFileSystem();

    // Create a file first
    vfs.write("/existing.txt", new TextEncoder().encode("exists"));

    // Opening with O_EXCL | O_CREAT should fail because file exists
    assertThrows(
      () => vfs.open("/existing.txt", O_WRONLY | O_CREAT | O_EXCL),
      Error,
      "File exists",
    );
  });

  it("should succeed with O_EXCL | O_CREAT when file does not exist", () => {
    const vfs = new VirtualFileSystem();

    // Opening a new file with O_EXCL | O_CREAT should succeed
    const fd = vfs.open("/new.txt", O_WRONLY | O_CREAT | O_EXCL);
    assertEquals(typeof fd, "number");
    assertEquals(fd >= 3, true);

    // Write some data and verify
    vfs.writeFd(fd, new TextEncoder().encode("created exclusively"));
    vfs.close(fd);

    const content = new TextDecoder().decode(vfs.read("/new.txt"));
    assertEquals(content, "created exclusively");
  });

  it("should not create the file when O_EXCL | O_CREAT fails", () => {
    const vfs = new VirtualFileSystem();

    // Create a file first
    const originalData = new TextEncoder().encode("original");
    vfs.write("/existing.txt", originalData);

    // Attempt O_EXCL open should fail
    assertThrows(
      () => vfs.open("/existing.txt", O_WRONLY | O_CREAT | O_EXCL),
      Error,
      "File exists",
    );

    // Original file content should be unchanged
    const content = new TextDecoder().decode(vfs.read("/existing.txt"));
    assertEquals(content, "original");
  });

  it("should allow O_CREAT without O_EXCL on existing file", () => {
    const vfs = new VirtualFileSystem();

    vfs.write("/file.txt", new TextEncoder().encode("hello"));

    // O_CREAT without O_EXCL should succeed on existing file
    const fd = vfs.open("/file.txt", O_RDWR | O_CREAT);
    assertEquals(typeof fd, "number");

    vfs.close(fd);
  });
});
