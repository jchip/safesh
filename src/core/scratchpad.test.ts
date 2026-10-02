import { assertEquals } from "@std/assert";
import { isSessionScratchpadScript, isUnderSessionScratchpad } from "./scratchpad.ts";

const SID = "7fd088c4-6653-461e-8b0d-00ce60090b5a";
const PAD = `/private/tmp/claude-502/-Users-me-proj/${SID}/scratchpad`;

Deno.test("isUnderSessionScratchpad - accepts both tmp spellings", () => {
  assertEquals(isUnderSessionScratchpad(`${PAD}/run.sh`, SID, 502), true);
  assertEquals(isUnderSessionScratchpad(`${PAD.slice("/private".length)}/a/run.sh`, SID, 502), true);
});

Deno.test("isUnderSessionScratchpad - rejects other sessions, users and traversal", () => {
  assertEquals(isUnderSessionScratchpad(`${PAD}/run.sh`, "other-session", 502), false);
  assertEquals(isUnderSessionScratchpad(`${PAD}/run.sh`, SID, 501), false);
  assertEquals(isUnderSessionScratchpad(`${PAD}/../../x/run.sh`, SID, 502), false);
  assertEquals(isUnderSessionScratchpad(`${PAD}/`, SID, 502), false);
  assertEquals(isUnderSessionScratchpad("scratchpad/run.sh", SID, 502), false);
  assertEquals(isUnderSessionScratchpad(`${PAD}/run.sh`, undefined, 502), false);
  assertEquals(isUnderSessionScratchpad(`${PAD}/run.sh`, SID, null), false);
  // A session id with path or regex syntax never matches.
  assertEquals(isUnderSessionScratchpad(`${PAD}/run.sh`, ".*", 502), false);
  assertEquals(isUnderSessionScratchpad(`/tmp/claude-502/p/a/b/scratchpad/x`, "a/b", 502), false);
});

Deno.test({
  name: "isSessionScratchpadScript - real file inside, symlink out rejected",
  ignore: Deno.uid() === null,
  fn: async () => {
    const uid = Deno.uid()!;
    const root = `/tmp/claude-${uid}`;
    let createdRoot = false;
    try {
      await Deno.stat(root);
    } catch {
      await Deno.mkdir(root, { mode: 0o700 });
      createdRoot = true;
    }
    const sid = `safesh-test-${crypto.randomUUID()}`;
    const proj = `${root}/safesh-test-${sid}`;
    const pad = `${proj}/${sid}/scratchpad`;
    const outside = await Deno.makeTempFile({ prefix: "safesh-outside-" });
    try {
      await Deno.mkdir(pad, { recursive: true });
      await Deno.writeTextFile(`${pad}/run.sh`, "echo hi\n");
      await Deno.symlink(outside, `${pad}/link.sh`);
      assertEquals(await isSessionScratchpadScript(`${pad}/run.sh`, sid), true);
      assertEquals(await isSessionScratchpadScript(`${pad}/missing.sh`, sid), false);
      assertEquals(await isSessionScratchpadScript(`${pad}/link.sh`, sid), false);
      assertEquals(await isSessionScratchpadScript(`${pad}/run.sh`, "other-session"), false);
    } finally {
      await Deno.remove(proj, { recursive: true }).catch(() => {});
      await Deno.remove(outside).catch(() => {});
      if (createdRoot) await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
});
