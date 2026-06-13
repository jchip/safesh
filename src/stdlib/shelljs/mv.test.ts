/**
 * SSH-574: mv must expand glob source operands (real mv relies on shell
 * expansion, which transpiled operands never got) and the expansion must
 * survive symlinked roots like macOS /tmp -> /private/tmp.
 */

import { assertEquals } from "@std/assert";
import { mv } from "./mv.ts";
import { REAL_TMP } from "../../../tests/helpers.ts";

async function withMvDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = `${REAL_TMP}/safesh-574-mv-${crypto.randomUUID().slice(0, 8)}`;
  await Deno.mkdir(`${dir}/dest`, { recursive: true });
  const prevCwd = Deno.cwd();
  Deno.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    Deno.chdir(prevCwd);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

Deno.test("SSH-574: mv expands glob source operands", async () => {
  await withMvDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/a1.json`, "1");
    await Deno.writeTextFile(`${dir}/a2.json`, "2");
    await Deno.writeTextFile(`${dir}/keep.txt`, "x");

    const result = await mv("*.json", `${dir}/dest`);

    assertEquals(result.code, 0, result.stderr);
    assertEquals(await exists(`${dir}/dest/a1.json`), true);
    assertEquals(await exists(`${dir}/dest/a2.json`), true);
    assertEquals(await exists(`${dir}/a1.json`), false);
    assertEquals(await exists(`${dir}/keep.txt`), true);
  });
});

Deno.test("SSH-574: mv with a non-matching glob reports the literal as missing", async () => {
  await withMvDir(async (dir) => {
    const result = await mv("*.nomatch", `${dir}/dest`);

    assertEquals(result.code, 1);
    assertEquals(result.stderr.includes("*.nomatch"), true);
  });
});

Deno.test("SSH-574: mv glob expansion works under a symlinked cwd form", async () => {
  // macOS: /tmp is a symlink to /private/tmp; using the symlinked spelling
  // for cwd/operands must not be rejected as outside the sandbox
  const linkForm = `/tmp/safesh-574-link-${crypto.randomUUID().slice(0, 8)}`;
  await Deno.mkdir(`${linkForm}/dest`, { recursive: true });
  const prevCwd = Deno.cwd();
  Deno.chdir(linkForm);
  try {
    await Deno.writeTextFile(`${linkForm}/p1.json`, "1");

    const result = await mv("*.json", `${linkForm}/dest`);

    assertEquals(result.code, 0, result.stderr);
    assertEquals(await exists(`${linkForm}/dest/p1.json`), true);
  } finally {
    Deno.chdir(prevCwd);
    await Deno.remove(linkForm, { recursive: true }).catch(() => {});
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
