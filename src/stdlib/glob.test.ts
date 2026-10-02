/**
 * Tests for bash-faithful command-argument glob expansion (SSH-642).
 *
 * Behaviors here were verified equal to `bash -c` under LC_ALL=C during
 * development; these lock them in.
 */

import { assertEquals } from "@std/assert";
import { expandGlobArg, expandWordFields } from "./glob.ts";

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

Deno.test("expandWordFields - unquoted expansion splits on IFS whitespace", async () => {
  assertEquals(await expandWordFields([["pre", 1], [" a  b ", 2]]), ["pre", "a", "b"]);
  assertEquals(await expandWordFields([["x", 0], ["a b", 2], ["y", 0]]), ["xa", "by"]);
});

Deno.test("expandWordFields - empty unquoted adds no field, empty quoted adds one", async () => {
  assertEquals(await expandWordFields([["", 2]]), []);
  assertEquals(await expandWordFields([["", 0]]), [""]);
  assertEquals(await expandWordFields([["", 0], ["", 2]]), [""]);
});

Deno.test("expandWordFields - globs each field, quoted glob chars stay literal", async () => {
  await withFixture(["a1", "a2", "a*1"], async (dir) => {
    assertEquals(await expandWordFields([["a", 2], ["*", 1]], undefined, dir), ["a*1", "a1", "a2"]);
    assertEquals(await expandWordFields([["a*", 0]], undefined, dir), ["a*"]);
    assertEquals(await expandWordFields([["a*", 0], ["*", 1]], undefined, dir), ["a*1"]);
    assertEquals(await expandWordFields([["zz", 2], ["*", 1]], undefined, dir), ["zz*"]);
  });
});
