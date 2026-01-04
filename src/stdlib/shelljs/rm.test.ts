/**
 * Tests for rm command
 */
import { assertEquals } from "@std/assert";
import { rm } from "./rm.ts";
import { join } from "@std/path";

const TEST_DIR = ".temp/rm-test";

Deno.test("rm - removes file", async () => {
  const file = join(TEST_DIR, "test-file.txt");
  await Deno.mkdir(TEST_DIR, { recursive: true });
  await Deno.writeTextFile(file, "test");

  const result = await rm(file);
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");

  // Verify file is gone
  let exists = true;
  try {
    await Deno.lstat(file);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) exists = false;
  }
  assertEquals(exists, false);

  // Cleanup
  await Deno.remove(TEST_DIR, { recursive: true });
});

Deno.test("rm - removes directory with object options as second arg", async () => {
  const dir = join(TEST_DIR, "test-dir");
  const file = join(dir, "file.txt");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(file, "test");

  // Test the pattern: rm(path, { recursive: true })
  const result = await rm(dir, { recursive: true });
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");

  // Verify directory is gone
  let exists = true;
  try {
    await Deno.lstat(dir);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) exists = false;
  }
  assertEquals(exists, false);

  // Cleanup
  await Deno.remove(TEST_DIR, { recursive: true }).catch(() => {});
});

Deno.test("rm - removes directory with object options first", async () => {
  const dir = join(TEST_DIR, "test-dir-2");
  const file = join(dir, "file.txt");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(file, "test");

  // Test the pattern: rm({ recursive: true }, path)
  const result = await rm({ recursive: true }, dir);
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");

  // Verify directory is gone
  let exists = true;
  try {
    await Deno.lstat(dir);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) exists = false;
  }
  assertEquals(exists, false);

  // Cleanup
  await Deno.remove(TEST_DIR, { recursive: true }).catch(() => {});
});

Deno.test("rm - removes directory with string options", async () => {
  const dir = join(TEST_DIR, "test-dir-3");
  const file = join(dir, "file.txt");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(file, "test");

  // Test the pattern: rm("-rf", path)
  const result = await rm("-rf", dir);
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");

  // Verify directory is gone
  let exists = true;
  try {
    await Deno.lstat(dir);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) exists = false;
  }
  assertEquals(exists, false);

  // Cleanup
  await Deno.remove(TEST_DIR, { recursive: true }).catch(() => {});
});

Deno.test("rm - fails on directory without recursive option", async () => {
  const dir = join(TEST_DIR, "test-dir-4");
  await Deno.mkdir(dir, { recursive: true });

  const result = await rm(dir);
  assertEquals(result.code, 1);
  assertEquals(result.stderr.includes("is a directory"), true);

  // Cleanup
  await Deno.remove(TEST_DIR, { recursive: true }).catch(() => {});
});
