/**
 * SSH-697: `${a[@]}`, `${a[*]}` and `${#a[@]}` lowered to unparseable JS.
 *
 * The subscript path (words.ts visitParameterExpansion) recognized a whole-array
 * subscript, but only honored it for PIPESTATUS; every other array fell back to
 * splicing the RAW parameter text into the output, so `${a[@]}` emitted the
 * literal `a[@]` as a JS expression. `${#a[@]}` never even reached that path —
 * the subscript block is gated on there being no modifier — and emitted
 * `a[@].length`.
 *
 * An ordinary array assignment already produces a real JS array (`var a =
 * ["1","2","3"]`), which is the same shape PIPESTATUS has, so the join the
 * PIPESTATUS branch was already doing is what every array needs.
 *
 * Expected values below are real `bash -c` output under LC_ALL=C.
 *
 * NB: this fixes the VALUE of a whole-array expansion, not bash's word
 * SPLITTING of it — an unquoted `${a[@]}` still reaches a command as one
 * argument rather than one per element. Same for a modifier other than `#` on a
 * whole-array subscript (`${a[@]:1}`): both are separate, still-open gaps.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { transpileSource } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import { getDefaultConfig } from "../../src/core/utils.ts";

const cwd = Deno.cwd();
const config = {
  ...getDefaultConfig(cwd),
  allowProjectCommands: true,
  quiet: true,
} as Parameters<typeof executeCode>[1];

async function run(bash: string): Promise<{ stdout: string; code: number }> {
  const ts = transpileSource(bash, { imports: false, strict: false });
  const r = await executeCode(ts, config, { cwd });
  return { stdout: r.stdout, code: r.code };
}

describe("SSH-697: a whole-array expansion produces the array's elements", () => {
  const cases: Array<[bash: string, stdout: string]> = [
    // The three pinned cases.
    ['a=(1 2 3); echo "${a[@]}"', "1 2 3\n"],
    ['a=(1 2 3); echo "${a[*]}"', "1 2 3\n"],
    ['a=(1 2 3); echo "${#a[@]}"', "3\n"],
    // `*` takes the same count as `@`.
    ['a=(1 2 3); echo "${#a[*]}"', "3\n"],
    // An empty array expands to nothing and counts 0 — not "undefined".
    ['a=(); echo "[${a[@]}]"; echo "${#a[@]}"', "[]\n0\n"],
    // A never-assigned name counts 0 rather than throwing a ReferenceError.
    ['echo "${#undef_arr[@]}"', "0\n"],
    // bash lets a SCALAR answer a whole-array expansion with its own value.
    ['a=hello; echo "${a[@]}"', "hello\n"],
    // Captured into a variable, not just echoed straight out.
    ['a=(1 2 3); b="${a[@]}"; echo "$b"', "1 2 3\n"],
    // Elements keep their own spaces when joined.
    ['a=("x y" z); echo "${a[@]}"', "x y z\n"],
  ];

  for (const [bash, stdout] of cases) {
    it(`${bash} -> ${JSON.stringify(stdout)}`, async () => {
      assertEquals(await run(bash), { stdout, code: 0 });
    });
  }

  it("does not splice the raw subscript text into the emitted JS", async () => {
    // The actual defect: `a[@]` is not a JS expression. Executing it is the
    // real check (above), but pin the emitted form too, since a regression
    // here fails at parse time with a message that names nothing useful.
    for (const bash of ['echo "${a[@]}"', 'echo "${a[*]}"', 'echo "${#a[@]}"']) {
      const ts = transpileSource(bash, { imports: false, strict: false });
      assertEquals(
        /a\[[@*]\]/.test(ts),
        false,
        `raw subscript still spliced into the output for ${bash}: ${ts}`,
      );
    }
  });
});

describe("SSH-697: the subscript forms that already worked still do", () => {
  // Dropping PIPESTATUS's special case means it now shares the general path.
  it("keeps ${PIPESTATUS[@]} working", async () => {
    assertEquals(await run('true; echo "${PIPESTATUS[@]}"'), { stdout: "0\n", code: 0 });
  });

  it("keeps ${PIPESTATUS[0]} working", async () => {
    assertEquals(await run('false | true; echo "${PIPESTATUS[0]}"'), { stdout: "1\n", code: 0 });
  });

  // SSH-694: an indexed read is an arithmetic context. Unchanged by this fix.
  for (
    const [bash, stdout] of [
      ['a=(1 2 3); i=1; echo "${a[$i]}"', "2\n"],
      ['a=(1 2 3); i=1; echo "${a[i+1]}"', "3\n"],
      ['a=(1 2 3); echo "${a[1]}"', "2\n"],
    ] as const
  ) {
    it(`keeps ${bash}`, async () => {
      assertEquals(await run(bash), { stdout, code: 0 });
    });
  }

  it("keeps ${#a[1]} as the length of that ELEMENT, not the array", async () => {
    // `#` with a numeric subscript is a string length, so it must not be
    // swept into the whole-array count.
    assertEquals(await run('a=(x yy); echo "${#a[1]}"'), { stdout: "2\n", code: 0 });
  });

  it("keeps a plain string length", async () => {
    const ts = transpileSource('s=hello; echo "${#s}"', { imports: false, strict: false });
    assertStringIncludes(ts, ".length");
    assertEquals(await run('s=hello; echo "${#s}"'), { stdout: "5\n", code: 0 });
  });
});
