/**
 * SSH-685: the "too complex for automatic transpilation" guard denied a valid
 * command when it contained TWO command substitutions inside one double-quoted
 * string.
 *
 * `knownBadPatterns[3]` in hooks/bash-prehook.ts looks for `.stdout()` called
 * after transform pipes. Its gap classes excluded only newline and backtick, so
 * with both substitutions emitted on one line of the same template literal the
 * match could start inside the first `${...}` and end on the `.stdout()`
 * belonging to the second. The emitted TypeScript was valid — a pure false
 * positive that denied the command and offered no way forward.
 *
 * The gaps now also refuse `${`, so a match cannot cross into a new
 * interpolation. Excluding `}` instead — the obvious-looking one-character
 * change — would break the common `$.wc({ lines: true })` form and silently
 * neuter the guard, so the tests below pin BOTH directions: the false positive
 * is gone AND genuinely-bad output is still caught.
 */
import { assert, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { runBashPrehook } from "../helpers.ts";

/** The two patterns as shipped, rebuilt here so the gap class is under test. */
const GAP = "(?!\\breturn\\b)(?!\\$\\{)[^\\n`]";
const STDOUT_AFTER_PIPES = new RegExp(
  "\\.pipe\\(\\$\\.(?:grep|head|tail|sort|uniq|wc|filter|map|flatMap|take|tee)\\(" +
    `(?:${GAP}){0,500}` + "\\)\\)\\.pipe\\(" + `(?:${GAP}){1,500}` + "\\)\\.stdout\\(\\)",
);
const DOUBLE_LINES = new RegExp(
  "\\.lines\\(\\)\\.pipe\\(" + `(?:${GAP}){1,500}` + "\\)\\.lines\\(\\)",
);

// Built without a literal "${" so this file cannot trip the guard it tests.
const INTERP = "$" + "{";

describe("SSH-685: complexity guard allows two command substitutions", () => {
  const one = `echo "a=$(ls dist/*.map 2>/dev/null | wc -l | tr -d ' ')"`;
  const two =
    `echo "a=$(ls dist/*.map 2>/dev/null | wc -l | tr -d ' ') b=$(grep -l foo dist/*.js 2>/dev/null | wc -l | tr -d ' ')"`;

  it("allows a single command substitution", async () => {
    const r = await runBashPrehook(one, Deno.cwd());
    assertStringIncludes(r.stdout, '"permissionDecision":"allow"');
  });

  it("allows two command substitutions in one string", async () => {
    const r = await runBashPrehook(two, Deno.cwd());
    assertStringIncludes(r.stdout, '"permissionDecision":"allow"');
    assert(
      !r.stdout.includes("too complex"),
      `still denied as too complex: ${r.stdout.slice(0, 300)}`,
    );
  });
});

describe("SSH-685: the guard still catches genuinely invalid output", () => {
  it("flags stdout() after transform pipes, including with an options object", () => {
    // `$.wc({ lines: true })` contains `}` — excluding `}` from the gap would
    // make this stop matching, which is why that approach was rejected.
    assert(
      STDOUT_AFTER_PIPES.test(
        '.pipe($.wc({ lines: true })).pipe($.toCmdLines($.cmd("tr", "-d", " "))).stdout()',
      ),
      "guard no longer catches stdout() after pipes with an options object",
    );
    assert(
      STDOUT_AFTER_PIPES.test('.pipe($.grep("x")).pipe($.head(3)).stdout()'),
      "guard no longer catches the plain stdout()-after-pipes form",
    );
  });

  it("flags .lines() twice around a pipe", () => {
    assert(
      DOUBLE_LINES.test('.lines().pipe($.grep("a")).lines()'),
      "guard no longer catches the double-.lines() form",
    );
  });

  it("does not match across a template-literal interpolation boundary", () => {
    // First substitution's pipes, then a new interpolation, then the SECOND
    // substitution's .stdout() — the SSH-685 false positive.
    assert(
      !STDOUT_AFTER_PIPES.test(
        '.pipe($.wc({ lines: true })).pipe($.toCmdLines($.cmd("tr", "-d", " "))))} b=' +
          INTERP + 'await __cmdSubText($.cmd("grep", "-l", "foo").stderr("/dev/null").stdout()',
      ),
      "guard still spans two command substitutions",
    );
    assert(
      !DOUBLE_LINES.test(
        '.lines().pipe($.grep("a")))} b=' + INTERP + 'await __cmdSubText($.cat("f").lines()',
      ),
      "double-.lines() guard still spans two command substitutions",
    );
  });
});
