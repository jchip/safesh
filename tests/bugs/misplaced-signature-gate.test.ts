/**
 * SSH-687: a `/*#*&#47;` signature in an invalid position asked the user to approve
 * a "command" literally named `/*#*&#47;`.
 *
 * detectMisplacedSignature() was only consulted in the transpile CATCH path, so
 * it only fired when the rest of the line failed to parse. When the text after
 * the signature still parsed as bash, `/*#*&#47;` was just an ordinary command word:
 * it reached the permission gate, prompted for approval, and on "always allow"
 * persisted `/*#*&#47;` into allowedCommands where it can never match a real
 * command. The check now runs before the gate and denies with the hint.
 */
import { assert, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { runBashPrehook } from "../helpers.ts";

const SIG = "/*#*/";

describe("SSH-687: misplaced signature is explained, not offered for approval", () => {
  // Each of these still parses as bash, which is why they used to slip through.
  for (const cmd of [`echo a; ${SIG} echo hi`, `echo a; ${SIG}`, `echo a && ${SIG} ls`]) {
    it(`explains the invalid position for: ${cmd}`, async () => {
      const r = await runBashPrehook(cmd, Deno.cwd());

      assertStringIncludes(r.stdout, '"permissionDecision":"deny"');
      // The actionable hint, not a permission prompt.
      assertStringIncludes(r.stdout, "only recognized at the very START");
      assert(
        !r.stdout.includes(`BLOCKED: ${SIG}`),
        `still prompts to approve a command named ${SIG}: ${r.stdout.slice(0, 200)}`,
      );
      assert(
        !r.stdout.includes("WAIT for user choice"),
        `still offers the approve/deny choice, which can persist ${SIG} into allowedCommands: ${
          r.stdout.slice(0, 200)
        }`,
      );
    });
  }

  it("still gets the hint when the rest does not parse as bash", async () => {
    // The original catch-path route must keep working. It reports differently:
    // a transpile error on stderr with the hint attached, rather than a deny
    // decision on stdout, because there the bash genuinely failed to parse.
    const r = await runBashPrehook(`echo a; ${SIG} console.log(1)`, Deno.cwd());
    assertStringIncludes(r.stderr, "only recognized at the very START");
  });
});

describe("SSH-687: valid signature positions are untouched", () => {
  it("allows a whole-command signature", async () => {
    const r = await runBashPrehook(`${SIG} console.log(1)`, Deno.cwd());
    assertStringIncludes(r.stdout, '"permissionDecision":"allow"');
  });

  it("allows a post-pipe hybrid signature", async () => {
    const r = await runBashPrehook(
      `echo hi | ${SIG} console.log(await $.stdin.text())`,
      Deno.cwd(),
    );
    assertStringIncludes(r.stdout, '"permissionDecision":"allow"');
  });

  it("leaves an ordinary command with no signature alone", async () => {
    const r = await runBashPrehook("echo a; echo b", Deno.cwd());
    assert(
      !r.stdout.includes("only recognized at the very START"),
      `false positive on a command with no signature: ${r.stdout.slice(0, 200)}`,
    );
  });
});
