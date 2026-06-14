/**
 * Tests for bash-faithful command-argument glob expansion (SSH-642).
 *
 * Behaviors here were verified equal to `bash -c` under LC_ALL=C during
 * development; these lock them in.
 */

import { assertEquals } from "@std/assert";
import { expandGlobArg } from "./glob.ts";

async function withFixture(
  files: string[],
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    for (const f of files) {
      if (f.endsWith("/")) {
        await Deno.mkdir(`${dir}/${f}`, { recursive: true });
      } else {
        const slash = f.lastIndexOf("/");
        if (slash >= 0) await Deno.mkdir(`${dir}/${f.slice(0, slash)}`, { recursive: true });
        await Deno.writeTextFile(`${dir}/${f}`, "");
      }
    }
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("expandGlobArg - matches files and excludes dotfiles like bash", async () => {
  await withFixture(["a.js", "b.js", "c.txt", ".hidden.js"], async (dir) => {
    assertEquals(await expandGlobArg("*.js", undefined, dir), ["a.js", "b.js"]);
  });
});

Deno.test("expandGlobArg - no match returns the literal pattern (nullglob off)", async () => {
  await withFixture(["a.js"], async (dir) => {
    assertEquals(await expandGlobArg("*.md", undefined, dir), ["*.md"]);
  });
});

Deno.test("expandGlobArg - results are sorted", async () => {
  // Created out of order; expansion must return them sorted (matching bash).
  await withFixture(["c.js", "a.js", "b.js"], async (dir) => {
    assertEquals(await expandGlobArg("*.js", undefined, dir), ["a.js", "b.js", "c.js"]);
  });
});

Deno.test("expandGlobArg - character class and single-char patterns", async () => {
  await withFixture(["a.js", "b.js", "cc.js"], async (dir) => {
    assertEquals(await expandGlobArg("[ab].js", undefined, dir), ["a.js", "b.js"]);
    assertEquals(await expandGlobArg("?.js", undefined, dir), ["a.js", "b.js"]);
  });
});

Deno.test("expandGlobArg - subdir pattern excludes nested dotfiles", async () => {
  await withFixture(["sub/d.js", "sub/.e.js"], async (dir) => {
    assertEquals(await expandGlobArg("sub/*", undefined, dir), ["sub/d.js"]);
  });
});

Deno.test("expandGlobArg - explicit dot pattern includes dotfiles", async () => {
  await withFixture([".hidden", "visible"], async (dir) => {
    const r = await expandGlobArg(".*", undefined, dir);
    assertEquals(r.includes(".hidden"), true);
    assertEquals(r.includes("visible"), false);
  });
});

Deno.test("expandGlobArg - directories are matched (includeDirs)", async () => {
  await withFixture(["a.js", "sub/d.js"], async (dir) => {
    assertEquals(await expandGlobArg("*", undefined, dir), ["a.js", "sub"]);
  });
});
