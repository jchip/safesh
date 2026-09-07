/**
 * Unit tests for bash-prehook command detection.
 *
 * The prehook module is import-safe: its entrypoint is guarded by
 * import.meta.main, so importing it here only loads the functions.
 */

import { assertEquals } from "@std/assert";
import {
  extractCommands,
  parseHookInput,
  shouldPassthrough,
  stripLeadingAssignments,
} from "./bash-prehook.ts";
import { parse } from "../src/bash/mod.ts";

function commandsOf(script: string): string[] {
  return [...extractCommands(parse(script))].sort();
}

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

Deno.test("desh retry inside a compound command (cd && ... | tail) is recognized as passthrough", () => {
  // Reproduces a live block loop: Claude Code prefixes the retry with `cd <dir> &&`
  // when not already in the target directory, and often pipes output to `tail`.
  // Today shouldPassthrough only matches when desh is the leading token, so this
  // compound form falls through to full permission checking and gets blocked again
  // instead of executing the already-approved command.
  assertEquals(
    shouldPassthrough(
      "cd /Users/jc/dev/fyn-prod-env && desh retry --id=1788273616944-48608 --choice=1 2>&1 | tail -20",
    ),
    true,
  );
  assertEquals(
    shouldPassthrough("cd /tmp && desh retry-path --id=x --choice=2"),
    true,
  );
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

Deno.test("SSH-673: calls to script-declared functions are not external commands", () => {
  // The function body's own commands are still collected; only the call site
  // to `norm` stops being treated as a command needing an allowlist entry.
  assertEquals(
    commandsOf(`norm() { sed "s/'/\\"/g" "$1"; }\nnorm a.txt > b.txt\nnorm c.txt`),
    ["sed"],
  );
});

Deno.test("SSH-673: function names are visible to later statements and to themselves", () => {
  // declared inside an if-branch: bash puts it in the global function table
  assertEquals(
    commandsOf(`if true; then walk() { find .; }; fi\nwalk`),
    ["find"],
  );
  // self-recursion resolves to the function, not to an external command
  assertEquals(commandsOf(`walk() { walk; awk '{print}'; }\nwalk`), ["awk"]);
});

Deno.test("SSH-673: a call before any declaration is still an external command", () => {
  assertEquals(commandsOf(`norm a.txt\nnorm() { sed -e x "$1"; }`), ["norm", "sed"]);
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

Deno.test("SSH-680: Antigravity toolCall input parses CommandLine and Cwd", () => {
  assertEquals(
    parseHookInput(JSON.stringify({
      conversationId: "test-conv-123",
      stepIdx: 42,
      toolCall: {
        name: "run_command",
        args: {
          CommandLine: "echo antigravity",
          Cwd: "/Users/jc/dev/safesh",
          WaitMsBeforeAsync: 5000,
        },
      },
    })),
    {
      command: "echo antigravity",
      cwd: "/Users/jc/dev/safesh",
      timeout: 5,
      runInBackground: undefined,
      hookEventName: undefined,
      sessionId: "test-conv-123",
      turnId: "42",
      isAntigravity: true,
    },
  );
});

