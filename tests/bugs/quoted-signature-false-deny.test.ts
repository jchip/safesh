/**
 * SSH-696: the SSH-687 pre-gate signature check is quoting-blind.
 *
 * SSH-687 moved the misplaced-`/*#*&#47;` check ahead of the permission gate so a
 * stray signature is explained instead of offered for approval as a command
 * literally named with the signature text. But it asks
 * detectMisplacedSignature(), which scans the RAW command string: any
 * occurrence outside the two valid positions is a misplaced signature to it.
 *
 * A signature inside a quoted argument or a comment is not misplaced — it is
 * ordinary, valid bash that the shell never treats as a command word. Denying
 * it blocks real work: this was found when the commit recording the SSH-687 fix
 * was refused, because its own message quotes the signature.
 *
 * The position question is structural, so it is answered from the parsed AST
 * (usesSignatureAsCommandName) rather than from the string. Both directions are
 * pinned: the quoted/commented forms must run, and every shape where the
 * signature really is a command word must still be explained.
 */
import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { runBashPrehook } from "../helpers.ts";

const SIG = "/*#*/";
const HINT = "only recognized at the very START";

const opts = { sessionId: "ssh696-quoted-signature" };

/** The hint must appear on neither stream, whichever route produced it. */
function assertNoHint(r: { stdout: string; stderr: string }, label: string) {
  assert(
    !r.stdout.includes(HINT) && !r.stderr.includes(HINT),
    `${label}: denied as a misplaced signature.\n  stdout: ${r.stdout.slice(0, 300)}\n  stderr: ${
      r.stderr.slice(0, 300)
    }`,
  );
}

describe("SSH-696: a quoted or commented signature is ordinary bash", () => {
  // Each case pairs the command with the same command minus the signature, so
  // the assertion is "the signature changed nothing" rather than a guess at
  // which route (passthrough, allow, or the permission gate) it should take.
  const cases: Array<{ what: string; withSig: string; without: string }> = [
    {
      what: "double-quoted argument (the commit message that found this)",
      withSig: `git commit -m "SSH-687: a misplaced ${SIG} signature is explained"`,
      without: `git commit -m "SSH-687: a misplaced signature is explained"`,
    },
    {
      what: "single-quoted argument",
      withSig: `git commit -m 'message with ${SIG} inside'`,
      without: `git commit -m 'message with inside'`,
    },
    {
      what: "trailing comment",
      withSig: `echo hi # ${SIG} note to self`,
      without: `echo hi # note to self`,
    },
    {
      what: "quoted literal in a command that must be transpiled",
      // A for-loop is never a passthrough candidate, so this proves the check
      // itself stopped firing — not that the command dodged it by passing
      // through to native bash before the check runs.
      withSig: `for i in 1 2; do echo "lit ${SIG} inside"; done`,
      without: `for i in 1 2; do echo "lit inside"; done`,
    },
    {
      what: "unquoted, but in argument position",
      // bash passes this through as a literal word (an unmatched glob), so it
      // is not a signature position either. Nothing can reach the permission
      // gate under the signature's name from here.
      withSig: `echo ${SIG} hi`,
      without: `echo hi`,
    },
  ];

  for (const { what, withSig, without } of cases) {
    it(`runs it: ${what}`, async () => {
      const r = await runBashPrehook(withSig, Deno.cwd(), opts);
      assertNoHint(r, what);

      const baseline = await runBashPrehook(without, Deno.cwd(), opts);
      assertEquals(
        r.code,
        baseline.code,
        `${what}: exit code differs from the same command without the signature`,
      );
    });
  }
});

describe("SSH-696: narrowing the check keeps every real signature position", () => {
  // The shapes SSH-640/687 exist for: the signature IS the command word. The
  // last one is why the check reads the AST structurally instead of only the
  // permission extractor's command list — that list does not descend into a
  // command substitution, so this shape would otherwise lose its hint.
  for (
    const cmd of [
      `echo a; ${SIG} echo hi`,
      `echo a; ${SIG}`,
      `echo a && ${SIG} ls`,
      `x=$(${SIG} echo hi)`,
    ]
  ) {
    it(`still explains: ${cmd}`, async () => {
      const r = await runBashPrehook(cmd, Deno.cwd(), opts);
      assert(
        r.stdout.includes(HINT) || r.stderr.includes(HINT),
        `lost the hint for a genuine misplaced signature.\n  stdout: ${
          r.stdout.slice(0, 300)
        }\n  stderr: ${r.stderr.slice(0, 300)}`,
      );
      assert(
        !r.stdout.includes(`BLOCKED: ${SIG}`),
        `back to prompting for approval of a command named ${SIG}: ${r.stdout.slice(0, 200)}`,
      );
    });
  }
});
