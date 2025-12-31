/**
 * Tests for shelljs-like commands
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  ShellString,
  cat,
  chmod,
  which,
  test,
  echo,
  cd,
  pwd,
  pushd,
  popd,
  dirs,
  tempdir,
  env,
  getEnv,
  setEnv,
  ln,
  parseOptions,
  expandTilde,
  isGlob,
} from "../src/stdlib/shelljs/mod.ts";

const testDir = ".temp/shelljs-test";

// Setup test directory
async function setup() {
  await Deno.mkdir(testDir, { recursive: true });
  await Deno.writeTextFile(join(testDir, "file1.txt"), "line1\nline2\nline3\n");
  await Deno.writeTextFile(join(testDir, "file2.txt"), "hello\nworld\n");
  await Deno.writeTextFile(join(testDir, "script.sh"), "#!/bin/bash\necho hello\n");
}

// Cleanup test directory
async function cleanup() {
  try {
    await Deno.remove(testDir, { recursive: true });
  } catch {
    // Ignore
  }
}

// ShellString tests
Deno.test("ShellString - basic properties", () => {
  const str = new ShellString("output", "error", 0);
  assertEquals(str.stdout, "output");
  assertEquals(str.stderr, "error");
  assertEquals(str.code, 0);
  assertEquals(str.ok, true);
  assertEquals(str.failed, false);
  assertEquals(str.toString(), "output");
});

Deno.test("ShellString - error result", () => {
  const str = ShellString.error("failed", 1);
  assertEquals(str.stdout, "");
  assertEquals(str.stderr, "failed");
  assertEquals(str.code, 1);
  assertEquals(str.ok, false);
  assertEquals(str.failed, true);
});

Deno.test("ShellString - lines", () => {
  const str = ShellString.ok("line1\nline2\nline3");
  assertEquals(str.lines(), ["line1", "line2", "line3"]);
});

// parseOptions tests
Deno.test("parseOptions - string options", () => {
  const opts = parseOptions("-rf", { r: "recursive", f: "force" });
  assertEquals(opts.recursive, true);
  assertEquals(opts.force, true);
});

Deno.test("parseOptions - object options", () => {
  const opts = parseOptions({ "-n": 5 }, { n: "number" });
  assertEquals(opts.number, 5);
});

Deno.test("parseOptions - empty string", () => {
  const opts = parseOptions("", { r: "recursive" });
  assertEquals(opts.recursive, false);
});

// expandTilde tests
Deno.test("expandTilde - expands home", () => {
  const home = Deno.env.get("HOME")!;
  assertEquals(expandTilde("~"), home);
  assertEquals(expandTilde("~/Documents"), `${home}/Documents`);
  assertEquals(expandTilde("/tmp"), "/tmp");
});

// isGlob tests
Deno.test("isGlob - detects glob patterns", () => {
  assertEquals(isGlob("*.ts"), true);
  assertEquals(isGlob("src/**/*.js"), true);
  assertEquals(isGlob("file.txt"), false);
  assertEquals(isGlob("src/file.ts"), false);
});

// cat tests
Deno.test("cat - read single file", async () => {
  await setup();
  try {
    const result = await cat(join(testDir, "file1.txt"));
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "line1");
    assertStringIncludes(result.stdout, "line2");
  } finally {
    await cleanup();
  }
});

Deno.test("cat - read multiple files", async () => {
  await setup();
  try {
    const result = await cat([
      join(testDir, "file1.txt"),
      join(testDir, "file2.txt"),
    ]);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "line1");
    assertStringIncludes(result.stdout, "hello");
  } finally {
    await cleanup();
  }
});

Deno.test("cat - with line numbers", async () => {
  await setup();
  try {
    const result = await cat(join(testDir, "file1.txt"), { number: true });
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "1\t");
    assertStringIncludes(result.stdout, "2\t");
  } finally {
    await cleanup();
  }
});

Deno.test("cat - file not found", async () => {
  const result = await cat("/nonexistent/file.txt");
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "No such file");
});

// chmod tests (Unix only)
if (Deno.build.os !== "windows") {
  Deno.test("chmod - octal mode", async () => {
    await setup();
    try {
      const file = join(testDir, "script.sh");
      await chmod(755, file);
      const stat = await Deno.stat(file);
      assertEquals((stat.mode! & 0o777), 0o755);
    } finally {
      await cleanup();
    }
  });

  Deno.test("chmod - symbolic mode u+x", async () => {
    await setup();
    try {
      const file = join(testDir, "script.sh");
      await chmod(644, file); // Start with 644
      await chmod("u+x", file);
      const stat = await Deno.stat(file);
      assertEquals((stat.mode! & 0o777), 0o744);
    } finally {
      await cleanup();
    }
  });

  Deno.test("chmod - symbolic mode go-w", async () => {
    await setup();
    try {
      const file = join(testDir, "script.sh");
      await chmod(666, file); // Start with 666
      await chmod("go-w", file);
      const stat = await Deno.stat(file);
      assertEquals((stat.mode! & 0o777), 0o644);
    } finally {
      await cleanup();
    }
  });
}

// which tests
Deno.test("which - find deno", async () => {
  const result = await which("deno");
  assertExists(result);
  assertEquals(result!.code, 0);
  assertStringIncludes(result!.stdout, "deno");
});

Deno.test("which - command not found", async () => {
  const result = await which("nonexistent-command-xyz123");
  assertEquals(result, null);
});

// test command tests
Deno.test("test - directory exists", async () => {
  assertEquals(await test("-d", "."), true);
  assertEquals(await test("-d", "/nonexistent"), false);
});

Deno.test("test - file exists", async () => {
  await setup();
  try {
    assertEquals(await test("-f", join(testDir, "file1.txt")), true);
    assertEquals(await test("-f", testDir), false); // directory
  } finally {
    await cleanup();
  }
});

Deno.test("test - exists", async () => {
  await setup();
  try {
    assertEquals(await test("-e", testDir), true);
    assertEquals(await test("-e", join(testDir, "file1.txt")), true);
    assertEquals(await test("-e", "/nonexistent"), false);
  } finally {
    await cleanup();
  }
});

// echo tests
Deno.test("echo - basic", () => {
  const result = echo("hello", "world");
  assertEquals(result.stdout, "hello world\n");
});

Deno.test("echo - no newline", () => {
  const result = echo({ noNewline: true }, "hello");
  assertEquals(result.stdout, "hello");
});

Deno.test("echo - escapes", () => {
  const result = echo({ escapes: true }, "hello\\tworld");
  assertEquals(result.stdout, "hello\tworld\n");
});

// pwd tests
Deno.test("pwd - returns current directory", () => {
  const result = pwd();
  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), Deno.cwd());
});

// cd tests
Deno.test("cd - change directory", async () => {
  await setup();
  const original = Deno.cwd();
  try {
    const result = cd(testDir);
    assertEquals(result.code, 0);
    assertStringIncludes(Deno.cwd(), "shelljs-test");
  } finally {
    Deno.chdir(original);
    await cleanup();
  }
});

Deno.test("cd - to home", () => {
  const original = Deno.cwd();
  try {
    const result = cd();
    assertEquals(result.code, 0);
    assertEquals(Deno.cwd(), Deno.env.get("HOME"));
  } finally {
    Deno.chdir(original);
  }
});

// Directory stack tests
Deno.test("pushd/popd - basic", async () => {
  await setup();
  const original = Deno.cwd();
  try {
    // Push to testDir
    const pushed = pushd(testDir);
    assertEquals(Array.isArray(pushed), true);
    assertStringIncludes(Deno.cwd(), "shelljs-test");

    // Pop back
    const popped = popd();
    assertEquals(Array.isArray(popped), true);
    assertEquals(Deno.cwd(), original);
  } finally {
    Deno.chdir(original);
    await cleanup();
  }
});

Deno.test("dirs - show stack", async () => {
  await setup();
  const original = Deno.cwd();
  try {
    pushd(testDir);
    const stack = dirs();
    assertEquals(Array.isArray(stack), true);
    assertEquals(stack.length, 2);
  } finally {
    Deno.chdir(original);
    await cleanup();
  }
});

// tempdir tests
Deno.test("tempdir - returns temp directory", () => {
  const tmp = tempdir();
  assertExists(tmp);
  // Should be a valid path
  assertEquals(typeof tmp, "string");
  assertEquals(tmp.length > 0, true);
});

// env tests
Deno.test("env - get variable", () => {
  const path = env.PATH;
  assertExists(path);
});

Deno.test("env - set and get", () => {
  setEnv("SHELLJS_TEST_VAR", "test_value");
  assertEquals(getEnv("SHELLJS_TEST_VAR"), "test_value");
  assertEquals(env.SHELLJS_TEST_VAR, "test_value");

  // Cleanup
  Deno.env.delete("SHELLJS_TEST_VAR");
});

// ln tests
Deno.test("ln - create symbolic link", async () => {
  await setup();
  try {
    const target = join(testDir, "file1.txt");
    const link = join(testDir, "link.txt");

    const result = await ln(target, link);
    assertEquals(result.code, 0);

    // Verify link exists
    const stat = await Deno.lstat(link);
    assertEquals(stat.isSymlink, true);
  } finally {
    await cleanup();
  }
});

Deno.test("ln - force overwrite", async () => {
  await setup();
  try {
    const target = join(testDir, "file1.txt");
    const link = join(testDir, "link.txt");

    // Create initial link
    await ln(target, link);

    // Overwrite with force
    const target2 = join(testDir, "file2.txt");
    const result = await ln(target2, link, { force: true });
    assertEquals(result.code, 0);
  } finally {
    await cleanup();
  }
});
