/**
 * SSH-193: Comprehensive tests for ShellJS-like utilities
 *
 * Tests cd, pwd, ls, mkdir, touch, rm, cp, mv, chmod, ln, which, test, tempdir, pushd, popd, dirs, echo
 */
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  cd,
  pwd,
  ls,
  mkdir,
  touch,
  rm,
  cp,
  mv,
  chmod,
  ln,
  which,
  test as shTest,
  tempdir,
  pushd,
  popd,
  dirs,
  echo,
} from "./mod.ts";

const TEST_DIR = ".temp/shelljs-test";

// Helper to ensure test directory exists
async function setupTestDir(): Promise<void> {
  await Deno.mkdir(TEST_DIR, { recursive: true });
}

// Helper to clean up test directory
async function cleanupTestDir(): Promise<void> {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// pwd() tests
// ============================================================================

Deno.test("SSH-193 - pwd returns current directory", () => {
  const result = pwd();
  assertExists(result);
  assertEquals(typeof result.toString(), "string");
  assertEquals(result.toString().length > 0, true);
});

// ============================================================================
// cd() tests
// ============================================================================

Deno.test("SSH-193 - cd changes directory", async () => {
  await setupTestDir();
  const originalDir = pwd().toString();

  cd(TEST_DIR);
  const newDir = pwd().toString();
  assertStringIncludes(newDir, "shelljs-test");

  // Change back
  cd(originalDir);
  assertEquals(pwd().toString(), originalDir);

  await cleanupTestDir();
});

Deno.test("SSH-193 - cd to home with ~", () => {
  const originalDir = pwd().toString();
  const home = Deno.env.get("HOME") || "/tmp";

  cd("~");
  assertEquals(pwd().toString(), home);

  cd(originalDir);
});

// ============================================================================
// mkdir() tests
// ============================================================================

Deno.test("SSH-193 - mkdir creates directory", async () => {
  await setupTestDir();
  const dir = join(TEST_DIR, "new-dir");

  const result = await mkdir(dir);
  assertEquals(result.code, 0);

  const stat = await Deno.stat(dir);
  assertEquals(stat.isDirectory, true);

  await cleanupTestDir();
});

Deno.test("SSH-193 - mkdir creates nested directories with -p", async () => {
  await setupTestDir();
  const dir = join(TEST_DIR, "a/b/c/d");

  const result = await mkdir("-p", dir);
  assertEquals(result.code, 0);

  const stat = await Deno.stat(dir);
  assertEquals(stat.isDirectory, true);

  await cleanupTestDir();
});

// ============================================================================
// touch() tests
// ============================================================================

Deno.test("SSH-193 - touch creates new file", async () => {
  await setupTestDir();
  const file = join(TEST_DIR, "touched.txt");

  const result = await touch(file);
  assertEquals(result.code, 0);

  const stat = await Deno.stat(file);
  assertEquals(stat.isFile, true);

  await cleanupTestDir();
});

Deno.test("SSH-193 - touch updates existing file timestamp", async () => {
  await setupTestDir();
  const file = join(TEST_DIR, "existing.txt");
  await Deno.writeTextFile(file, "test");

  const statBefore = await Deno.stat(file);
  await new Promise((r) => setTimeout(r, 10)); // Small delay

  const result = await touch(file);
  assertEquals(result.code, 0);

  const statAfter = await Deno.stat(file);
  assertEquals(statAfter.mtime!.getTime() >= statBefore.mtime!.getTime(), true);

  await cleanupTestDir();
});

// ============================================================================
// ls() tests
// ============================================================================

Deno.test("SSH-193 - ls lists directory contents", async () => {
  await setupTestDir();
  await Deno.writeTextFile(join(TEST_DIR, "file1.txt"), "a");
  await Deno.writeTextFile(join(TEST_DIR, "file2.txt"), "b");

  const result = await ls(TEST_DIR);
  assertEquals(Array.isArray(result), true);
  assertEquals(result.includes("file1.txt"), true);
  assertEquals(result.includes("file2.txt"), true);

  await cleanupTestDir();
});

Deno.test("SSH-193 - ls -a shows hidden files", async () => {
  await setupTestDir();
  await Deno.writeTextFile(join(TEST_DIR, ".hidden"), "secret");
  await Deno.writeTextFile(join(TEST_DIR, "visible.txt"), "public");

  const result = await ls("-a", TEST_DIR);
  assertEquals(Array.isArray(result), true);
  assertEquals(result.includes(".hidden"), true);
  assertEquals(result.includes("visible.txt"), true);

  await cleanupTestDir();
});

// ============================================================================
// cp() tests
// ============================================================================

Deno.test("SSH-193 - cp copies file", async () => {
  await setupTestDir();
  const src = join(TEST_DIR, "source.txt");
  const dest = join(TEST_DIR, "copy.txt");
  await Deno.writeTextFile(src, "original content");

  const result = await cp(src, dest);
  assertEquals(result.code, 0);

  const content = await Deno.readTextFile(dest);
  assertEquals(content, "original content");

  await cleanupTestDir();
});

Deno.test("SSH-193 - cp -r copies directory recursively", async () => {
  await setupTestDir();
  const srcDir = join(TEST_DIR, "src-dir");
  const destDir = join(TEST_DIR, "dest-dir");
  await Deno.mkdir(srcDir, { recursive: true });
  await Deno.writeTextFile(join(srcDir, "file.txt"), "data");

  const result = await cp("-r", srcDir, destDir);
  assertEquals(result.code, 0);

  const content = await Deno.readTextFile(join(destDir, "file.txt"));
  assertEquals(content, "data");

  await cleanupTestDir();
});

// ============================================================================
// mv() tests
// ============================================================================

Deno.test("SSH-193 - mv moves file", async () => {
  await setupTestDir();
  const src = join(TEST_DIR, "old-name.txt");
  const dest = join(TEST_DIR, "new-name.txt");
  await Deno.writeTextFile(src, "content");

  const result = await mv(src, dest);
  assertEquals(result.code, 0);

  // Source should not exist
  let srcExists = true;
  try {
    await Deno.stat(src);
  } catch {
    srcExists = false;
  }
  assertEquals(srcExists, false);

  // Dest should exist with content
  const content = await Deno.readTextFile(dest);
  assertEquals(content, "content");

  await cleanupTestDir();
});

// ============================================================================
// rm() tests (extending existing tests)
// ============================================================================

Deno.test("SSH-193 - rm removes multiple files", async () => {
  await setupTestDir();
  const file1 = join(TEST_DIR, "a.txt");
  const file2 = join(TEST_DIR, "b.txt");
  await Deno.writeTextFile(file1, "a");
  await Deno.writeTextFile(file2, "b");

  const result = await rm(file1, file2);
  assertEquals(result.code, 0);

  // Both should be gone
  let count = 0;
  try { await Deno.stat(file1); count++; } catch { /* expected */ }
  try { await Deno.stat(file2); count++; } catch { /* expected */ }
  assertEquals(count, 0);

  await cleanupTestDir();
});

// ============================================================================
// chmod() tests
// ============================================================================

Deno.test("SSH-193 - chmod changes file permissions", async () => {
  await setupTestDir();
  const file = join(TEST_DIR, "script.sh");
  await Deno.writeTextFile(file, "#!/bin/bash\necho hello");

  const result = await chmod(755, file);
  assertEquals(result.code, 0);

  const stat = await Deno.stat(file);
  // Check executable bit is set (on Unix)
  if (Deno.build.os !== "windows") {
    assertEquals((stat.mode! & 0o111) !== 0, true);
  }

  await cleanupTestDir();
});

Deno.test("SSH-193 - chmod with symbolic mode", async () => {
  await setupTestDir();
  const file = join(TEST_DIR, "file.txt");
  await Deno.writeTextFile(file, "test");

  const result = await chmod("u+x", file);
  assertEquals(result.code, 0);

  await cleanupTestDir();
});

// ============================================================================
// ln() tests
// ============================================================================

Deno.test("SSH-193 - ln creates symbolic link", async () => {
  await setupTestDir();
  const target = join(TEST_DIR, "target.txt");
  const link = join(TEST_DIR, "link.txt");
  await Deno.writeTextFile(target, "target content");

  const result = await ln(target, link, {});
  assertEquals(result.code, 0);

  const stat = await Deno.lstat(link);
  assertEquals(stat.isSymlink, true);

  const content = await Deno.readTextFile(link);
  assertEquals(content, "target content");

  await cleanupTestDir();
});

// ============================================================================
// which() tests
// ============================================================================

Deno.test("SSH-193 - which finds command", async () => {
  // 'ls' should exist on Unix systems
  if (Deno.build.os !== "windows") {
    const result = await which("ls");
    assertExists(result);
    assertEquals(result !== null, true);
    assertStringIncludes(result!.toString(), "/");
  }
});

Deno.test("SSH-193 - which returns null for non-existent command", async () => {
  const result = await which("definitely-not-a-real-command-12345");
  assertEquals(result, null);
});

// ============================================================================
// test() tests (file type testing)
// ============================================================================

Deno.test("SSH-193 - test -d detects directory", async () => {
  await setupTestDir();
  const result = await shTest("-d", TEST_DIR);
  assertEquals(result, true);
  await cleanupTestDir();
});

Deno.test("SSH-193 - test -f detects file", async () => {
  await setupTestDir();
  const file = join(TEST_DIR, "file.txt");
  await Deno.writeTextFile(file, "test");

  assertEquals(await shTest("-f", file), true);
  assertEquals(await shTest("-f", TEST_DIR), false);

  await cleanupTestDir();
});

Deno.test("SSH-193 - test -e checks existence", async () => {
  await setupTestDir();
  assertEquals(await shTest("-e", TEST_DIR), true);
  assertEquals(await shTest("-e", join(TEST_DIR, "nonexistent")), false);
  await cleanupTestDir();
});

Deno.test("SSH-193 - test -L detects symlink", async () => {
  await setupTestDir();
  const target = join(TEST_DIR, "target.txt");
  const link = join(TEST_DIR, "link.txt");
  await Deno.writeTextFile(target, "data");
  await ln(target, link, {});

  assertEquals(await shTest("-L", link), true);
  assertEquals(await shTest("-L", target), false);

  await cleanupTestDir();
});

// ============================================================================
// tempdir() tests
// ============================================================================

Deno.test("SSH-193 - tempdir returns temp directory path", () => {
  const result = tempdir();
  assertExists(result);
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true);
});

// ============================================================================
// pushd/popd/dirs tests
// ============================================================================

Deno.test("SSH-193 - pushd/popd/dirs work correctly", async () => {
  await setupTestDir();
  const originalDir = pwd().toString();

  // Push to TEST_DIR
  const pushResult = pushd(TEST_DIR);
  assertEquals(Array.isArray(pushResult), true);
  assertStringIncludes(pwd().toString(), "shelljs-test");

  // Check dirs shows both directories
  const dirsResult = dirs();
  assertEquals(dirsResult.length >= 2, true);

  // Pop back
  const popResult = popd();
  assertEquals(Array.isArray(popResult), true);
  assertEquals(pwd().toString(), originalDir);

  await cleanupTestDir();
});

Deno.test("SSH-193 - dirs clear option clears stack", async () => {
  await setupTestDir();
  const originalDir = pwd().toString();

  pushd(TEST_DIR);
  dirs(undefined, { clear: true });

  const afterClear = dirs();
  assertEquals(afterClear.length, 1); // Only current dir

  cd(originalDir);
  await cleanupTestDir();
});

// ============================================================================
// echo() tests
// ============================================================================

Deno.test("SSH-193 - echo returns ShellString", () => {
  const result = echo("hello", "world");
  assertStringIncludes(result.toString(), "hello world");
});

Deno.test("SSH-193 - echo with noNewline option", () => {
  const result = echo({ noNewline: true }, "no newline");
  assertEquals(result.toString(), "no newline");
});

Deno.test("SSH-193 - echo with escapes option interprets escapes", () => {
  const result = echo({ escapes: true }, "line1\\nline2");
  assertStringIncludes(result.toString(), "\n");
});
