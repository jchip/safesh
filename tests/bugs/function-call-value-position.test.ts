/**
 * SSH-698: a call to a shell function is a Promise, not a Command.
 *
 * A function declaration lowers to `async function f(...)` whose body prints
 * straight to stdout and returns nothing. A bare `f` is fine, but every
 * position that needs the call's OUTPUT as a value was built as if `f()` were a
 * `$.cmd(...)`:
 *   - `f | cat`   -> `f().pipe($.cmd("cat"))`  TypeError: not a function
 *   - `f > out`   -> `f().stdout("out")`       TypeError: not a function
 *   - `v=$(f X)`  -> `__cmdSubText(f("X"))`    resolves undefined, so v is
 *                                              SILENTLY empty
 *
 * A value position needs the body re-emitted in capture mode, which is what
 * already happens for a `{ ...; }` group feeding a pipe. Such a call also runs
 * in a subshell in bash, so building it as its own scope is right.
 *
 * Expected values below are real `bash -c` output under LC_ALL=C.
 */
import { assertEquals } from "@std/assert";
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

describe("SSH-698: a function call feeding a pipe", () => {
  const cases: Array<[bash: string, stdout: string]> = [
    ["f() { echo hi; }; f | cat", "hi\n"],
    // The call's arguments still reach the body (SSH-674) from a pipe stage.
    ['f() { echo "got=[$1]"; }; f one | cat', "got=[one]\n"],
    ['f() { echo "$1-$2"; }; f a b | tr - _', "a_b\n"],
    // A multi-line body keeps its line structure through the pipe.
    ["f() { echo one; echo two; }; f | cat", "one\ntwo\n"],
    // Output lands in order relative to the statements around it.
    ["f() { echo hi; }; echo pre; f | cat; echo post", "pre\nhi\npost\n"],
    // Two different functions, each in its own pipe.
    ["f() { echo a; }; g() { echo b; }; f | cat; g | cat", "a\nb\n"],
  ];

  for (const [bash, stdout] of cases) {
    it(`${bash} -> ${JSON.stringify(stdout)}`, async () => {
      assertEquals(await run(bash), { stdout, code: 0 });
    });
  }

  it("reports the LAST stage's status, as bash does", async () => {
    // `$?` after a pipeline is the last stage's status. The upstream function's
    // own status is a separate, still-open problem: a captured upstream becomes
    // `$.fromArray(<stdout>)`, which carries no status, so `${PIPESTATUS[0]}`
    // reads 0 here — the same gap that keeps `( false ) | cat` pinned to
    // SSH-677, not something this fix introduced or can reach.
    assertEquals(
      await run('f() { return 3; }; f | cat; echo "rc=$?"'),
      { stdout: "rc=0\n", code: 0 },
    );
  });
});

describe("SSH-698: a function call captured into a variable", () => {
  const cases: Array<[bash: string, stdout: string]> = [
    // The headline case: v was silently empty.
    ['f() { echo "a$1"; }; v=$(f X); echo "[$v]"', "[aX]\n"],
    ['f() { echo hi; }; v=$(f); echo "[$v]"', "[hi]\n"],
    ['f() { echo one; echo two; }; v=$(f); echo "[$v]"', "[one\ntwo]\n"],
    // A capture must not ALSO print the body's output — that would be the
    // failure mode of simply letting the body write through.
    ['f() { echo hi; }; v=$(f); echo "[$v]"', "[hi]\n"],
    // $? after a capture is the function's status, and the output still arrives.
    ['f() { echo out; return 3; }; v=$(f); echo "rc=$? v=$v"', "rc=3 v=out\n"],
  ];

  for (const [bash, stdout] of cases) {
    it(`${bash} -> ${JSON.stringify(stdout)}`, async () => {
      assertEquals(await run(bash), { stdout, code: 0 });
    });
  }
});

describe("SSH-698: a function call with a redirect", () => {
  // Not covered here, and not reachable from this fix: a redirect on a
  // DOWNSTREAM stage of a captured upstream (`f | cat > /dev/null`) still
  // prints the output it should have discarded. That is the
  // `$.fromArray(...).pipe($.toCmdLines(cmd.stdout(file)))` shape ignoring the
  // sink, and a brace group upstream (`{ echo hi; } | cat > /dev/null`) leaks
  // identically — a separate, pre-existing bug this fix neither adds nor cures.

  it("discards the output to /dev/null instead of throwing", async () => {
    assertEquals(
      await run("f() { echo hi; }; f > /dev/null; echo done"),
      { stdout: "done\n", code: 0 },
    );
  });

  it("writes the body's output to a file", async () => {
    const tmp = await Deno.makeTempDir({ dir: "/tmp", prefix: "safesh-ssh698-" });
    try {
      const out = `${await Deno.realPath(tmp)}/o.txt`;
      // Read back with `cat < f`, which is independently proven, so this
      // isolates the redirect from the reader.
      assertEquals(
        await run(`f() { echo hi; }; f > ${out}; cat < ${out}`),
        { stdout: "hi\n", code: 0 },
      );
    } finally {
      await Deno.remove(tmp, { recursive: true }).catch(() => {});
    }
  });
});

describe("SSH-698: a bare call is unchanged", () => {
  // The bare path already worked and streams the body's output as it runs, so
  // it must keep emitting a plain `await f()` rather than being routed through
  // the new capturing build.
  const cases: Array<[bash: string, stdout: string]> = [
    ["f() { echo hi; }; f", "hi\n"],
    ['f() { echo "got=[$1]"; }; f hello', "got=[hello]\n"],
    ['f() { echo "count=$#"; }; f a b c', "count=3\n"],
    ["f() { echo one; echo two; }; f", "one\ntwo\n"],
    ['g() { echo "hello $1"; }; g world; g again', "hello world\nhello again\n"],
  ];

  for (const [bash, stdout] of cases) {
    it(`${bash} -> ${JSON.stringify(stdout)}`, async () => {
      assertEquals(await run(bash), { stdout, code: 0 });
    });
  }

  it("still emits a direct call, not a captured body", () => {
    const ts = transpileSource("f() { echo hi; }; f", { imports: false, strict: false });
    assertEquals(ts.includes("await f()"), true, `bare call was rerouted: ${ts}`);
  });
});

describe("SSH-698: a recursive call in a value position terminates", () => {
  // The capturing build re-emits the body at the call site, so a function that
  // captures itself must not expand forever. It falls back to the plain call
  // rather than recursing at transpile time; what matters here is that
  // transpiling returns at all.
  it("transpiles without expanding forever", () => {
    const ts = transpileSource(
      'f() { v=$(f); echo "x$v"; }; echo ok',
      { imports: false, strict: false },
    );
    assertEquals(ts.length < 20000, true, `output exploded: ${ts.length} chars`);
  });
});
