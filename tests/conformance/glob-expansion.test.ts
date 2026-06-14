/**
 * SSH-642: end-to-end command-position glob expansion vs real bash.
 *
 * Transpiles + executes each snippet with cwd set to a seeded temp dir and
 * compares stdout against `bash -c` under LC_ALL=C. `echo` is used so output is
 * exactly the expanded word list.
 */

import { assert, assertEquals } from "@std/assert";
import { parse, transpile } from "../../src/bash/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import { getDefaultConfig } from "../../src/core/utils.ts";

const dec = new TextDecoder();

async function setupDir(): Promise<string> {
  const dir = await Deno.realPath(
    await Deno.makeTempDir({ dir: "/tmp", prefix: "safesh-glob-" }),
  );
  for (const f of ["a.js", "b.js", "c.txt", ".hidden.js"]) {
    await Deno.writeTextFile(`${dir}/${f}`, `${f}\n`); // distinct content for cat/wc
  }
  await Deno.mkdir(`${dir}/sub`);
  await Deno.writeTextFile(`${dir}/sub/d.js`, "");
  await Deno.writeTextFile(`${dir}/sub/.e.js`, "");
  return dir;
}

async function runBash(src: string, cwd: string): Promise<string> {
  const o = await new Deno.Command("bash", {
    args: ["-c", src],
    cwd,
    env: { LC_ALL: "C" },
    stdout: "piped",
    stderr: "null",
  }).output();
  return dec.decode(o.stdout);
}

async function runSafesh(src: string, cwd: string): Promise<string> {
  const config = {
    ...getDefaultConfig(cwd),
    allowProjectCommands: true,
    quiet: true,
  } as Parameters<typeof executeCode>[1];
  const ts = transpile(parse(src), { imports: false, strict: false });
  const r = await executeCode(ts, config, { cwd });
  return r.stdout;
}

const MATCHING = [
  "echo *.js", // basic, dotfile excluded
  "echo *", // all (dir included, dotfile excluded)
  "echo *.md", // no match -> literal pattern
  "echo sub/*", // multi-component, nested dotfile excluded
  "echo [ab].js", // character class
  "echo a*.js x*.no", // mixed: one expands, one stays literal
  "cat *.js", // fluent cat routed to real cat — concatenates all matches
  "wc -l *.js", // fluent wc — dotfile-excluded operands via $.__expandGlobAll
];

Deno.test({
  name: "SSH-642: command glob expansion matches bash",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const dir = await setupDir();
    try {
      for (const src of MATCHING) {
        await t.step(src, async () => {
          assertEquals(await runSafesh(src, dir), await runBash(src, dir));
        });
      }

      // Documented divergence: an escaped glob (\*) loses its backslash in the
      // parser, so safesh expands it while bash keeps it literal. If this step
      // ever starts matching, the parser gained escape-aware glob tagging —
      // revisit wordIsUnquotedGlobLiteral's documented limitation in commands.ts.
      await t.step("xfail: escaped glob diverges (bash literal, safesh expands)", async () => {
        const b = await runBash("echo \\*.js", dir);
        const s = await runSafesh("echo \\*.js", dir);
        assert(
          b !== s,
          "escaped-glob now matches bash — update the documented limitation",
        );
      });
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
