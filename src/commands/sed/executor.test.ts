/**
 * Sed Executor Tests for SSH-546, SSH-547, SSH-548 bug fixes
 */
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { sedExec } from "./sed.ts";
import { createInitialState, executeCommands, type ExecuteContext } from "./executor.ts";
import { parseMultipleScripts } from "./parser.ts";

// ---------------------------------------------------------------------------
// SSH-546: Error constructor uses { cause: "iterations" }
// ---------------------------------------------------------------------------
describe("SSH-546: Iteration limit error has cause", () => {
  it("should throw with cause 'iterations' when loop exceeds limit", async () => {
    try {
      await sedExec(":loop\nb loop", "test\n", { limits: { maxIterations: 5 } });
      // Should never reach here
      assertEquals(true, false, "expected an error to be thrown");
    } catch (e) {
      assertEquals((e as Error).cause, "iterations");
    }
  });

  it("should mention maxIterations value in error message", async () => {
    try {
      await sedExec(":loop\nb loop", "x\n", { limits: { maxIterations: 10 } });
      assertEquals(true, false, "expected an error to be thrown");
    } catch (e) {
      assertEquals((e as Error).message.includes("10"), true);
    }
  });

  it("should not throw when within iteration limit", async () => {
    const r = await sedExec("s/a/b/", "abc\n", { limits: { maxIterations: 100 } });
    assertEquals(r.output.trim(), "bbc");
  });
});

// ---------------------------------------------------------------------------
// SSH-546: Address ranges work correctly
// ---------------------------------------------------------------------------
describe("SSH-546: Address ranges", () => {
  it("should apply substitution to lines 1 through 3 only", async () => {
    const r = await sedExec("1,3s/a/b/", "a\na\na\na\n");
    const lines = r.output.trim().split("\n");
    assertEquals(lines[0], "b");
    assertEquals(lines[1], "b");
    assertEquals(lines[2], "b");
    assertEquals(lines[3], "a");
  });

  it("should apply step address 0~2", async () => {
    const r = await sedExec("0~2s/x/y/", "x1\nx2\nx3\nx4\n");
    const lines = r.output.trim().split("\n");
    // Lines 2, 4 should be substituted (even lines)
    assertEquals(lines[1], "y2");
    assertEquals(lines[3], "y4");
  });
});

// ---------------------------------------------------------------------------
// SSH-547: H command POSIX behavior - hold space starts empty, H prepends \n
// ---------------------------------------------------------------------------
describe("SSH-547: H command POSIX behavior", () => {
  it("should prepend newline on first H (hold space starts empty)", async () => {
    const r = await sedExec("H;g", "first\n");
    assertEquals(r.output, "\nfirst\n");
  });

  it("h then H should produce text+newline+text in hold space", async () => {
    const r = await sedExec("h;H;g", "test\n");
    assertEquals(r.output, "test\ntest\n");
  });

  it("should accumulate with multiple H commands via executeCommands", () => {
    const state = createInitialState(1);
    state.patternSpace = "hi";
    state.holdSpace = "";
    state.lineNumber = 1;
    const { commands } = parseMultipleScripts(["H;H"]);
    executeCommands(
      commands,
      state,
      { lines: ["hi"], currentLineIndex: 0 } as ExecuteContext,
    );
    assertEquals(state.holdSpace, "\nhi\nhi");
  });
});

// ---------------------------------------------------------------------------
// SSH-548: insert / append / change commands
// ---------------------------------------------------------------------------
describe("SSH-548: Insert, Append, Change commands", () => {
  it("insert (i) should add text before the addressed line", async () => {
    const r = await sedExec("2i\\inserted", "l1\nl2\nl3\n");
    const lines = r.output.trim().split("\n");
    assertEquals(lines[0], "l1");
    assertEquals(lines[1], "inserted");
    assertEquals(lines[2], "l2");
    assertEquals(lines[3], "l3");
  });

  it("append (a) should add text after the addressed line", async () => {
    const r = await sedExec("2a\\appended", "l1\nl2\nl3\n");
    const lines = r.output.trim().split("\n");
    assertEquals(lines[0], "l1");
    assertEquals(lines[1], "l2");
    assertEquals(lines[2], "appended");
    assertEquals(lines[3], "l3");
  });

  it("change (c) should replace the addressed line", async () => {
    const r = await sedExec("2c\\changed", "l1\nl2\nl3\n");
    const lines = r.output.trim().split("\n");
    assertEquals(lines[0], "l1");
    assertEquals(lines[1], "changed");
    assertEquals(lines[2], "l3");
  });
});
