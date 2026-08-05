/**
 * Unit tests for bash-prehook command detection.
 *
 * The prehook module is import-safe: its entrypoint is guarded by
 * import.meta.main, so importing it here only loads the functions.
 */

import { assertEquals } from "@std/assert";
import { parseHookInput, shouldPassthrough, stripLeadingAssignments } from "./bash-prehook.ts";

Deno.test("SSH-570: env-prefixed desh is recognized as passthrough", () => {
  assertEquals(
    shouldPassthrough("TMPDIR=/tmp desh retry-path --id=abc --choice=w2d"),
    true,
  );
  assertEquals(shouldPassthrough("FOO=bar BAZ=qux desh retry --id=x"), true);
});

Deno.test("SSH-666: shared hook retains Claude and Gemini compatibility passthroughs", () => {
  assertEquals(shouldPassthrough("desh retry --id=x"), true);
  assertEquals(shouldPassthrough("./src/cli/desh.ts retry-path --id=x"), true);
  assertEquals(
    shouldPassthrough(
      "/Users/jc/dev/safesh/src/cli/desh.ts -q -f /tmp/safesh/scripts/tx-script-abc_123.ts",
    ),
    true,
  );
  assertEquals(
    shouldPassthrough(
      "/bin/zsh -lc '/Users/jc/dev/safesh/src/cli/desh.ts -q -f /tmp/safesh/scripts/script-abc.ts'",
    ),
    true,
  );
  assertEquals(shouldPassthrough("deno test"), true);
  assertEquals(shouldPassthrough("desh run git status"), true);
  assertEquals(shouldPassthrough("./src/cli/desh.ts run git status"), true);
});

Deno.test("SSH-666: Codex route-all policy only passes SafeShell control-plane commands", () => {
  assertEquals(shouldPassthrough("desh retry --id=x", true), true);
  assertEquals(shouldPassthrough("./src/cli/desh.ts retry-path --id=x", true), true);
  assertEquals(shouldPassthrough("deno test", true), false);
  assertEquals(shouldPassthrough("desh run git status", true), false);
  assertEquals(shouldPassthrough("./src/cli/desh.ts run git status", true), false);
});

Deno.test("SSH-570: non-passthrough commands are unaffected", () => {
  assertEquals(shouldPassthrough("ls -la"), false);
  assertEquals(shouldPassthrough("TMPDIR=/tmp ls"), false);
  // a pure assignment has no command word to match
  assertEquals(shouldPassthrough("FOO=desh"), false);
  // desh as an argument, not the command word
  assertEquals(shouldPassthrough("echo desh retry"), false);
});

Deno.test("SSH-570: stripLeadingAssignments handles quoted values", () => {
  assertEquals(
    stripLeadingAssignments(`FOO='a b' BAR="c d" desh run`),
    "desh run",
  );
  assertEquals(stripLeadingAssignments(`FOO= desh run`), "desh run");
  assertEquals(stripLeadingAssignments(`PATH+=:/x desh run`), "desh run");
  // not assignments: leave untouched
  assertEquals(stripLeadingAssignments("echo FOO=bar"), "echo FOO=bar");
  assertEquals(stripLeadingAssignments("desh run"), "desh run");
});

Deno.test("SSH-650: Codex hook input normalizes snake-case fields", () => {
  assertEquals(
    parseHookInput(JSON.stringify({
      session_id: "codex-session",
      turn_id: "codex-turn",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "echo codex",
        timeout: 15,
        run_in_background: true,
      },
    })),
    {
      command: "echo codex",
      timeout: 15,
      runInBackground: true,
      hookEventName: "PreToolUse",
      sessionId: "codex-session",
      turnId: "codex-turn",
    },
  );
});

Deno.test("SSH-650: existing camel-case hook input remains supported", () => {
  assertEquals(
    parseHookInput(JSON.stringify({
      hookEventName: "PreToolUse",
      toolName: "run_shell_command",
      toolInput: { command: "echo gemini" },
    })),
    {
      command: "echo gemini",
      timeout: undefined,
      runInBackground: undefined,
      hookEventName: "PreToolUse",
    },
  );
});

Deno.test("SSH-650: unsupported hook tools are ignored", () => {
  assertEquals(
    parseHookInput(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: { command: "patch" },
    })),
    null,
  );
});
