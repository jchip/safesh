import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { withTestDir } from "../../tests/helpers.ts";
import {
  BEGIN_MARKER,
  END_MARKER,
  installCodexHooks,
  mergeCodexHookConfig,
  renderCodexHookConfig,
} from "./install.ts";

const TEMPLATE = `${BEGIN_MARKER}
[[hooks.PreToolUse]]
command = "__SAFESH_CODEX_BASH_PREHOOK__"
[[hooks.PermissionRequest]]
command = "__SAFESH_CODEX_PERMISSION_HOOK__"
${END_MARKER}
`;

Deno.test("SSH-669: renders absolute Codex hook paths from the source config", () => {
  const rendered = renderCodexHookConfig(TEMPLATE, "/opt/Safe Shell/hooks/codex");
  assertStringIncludes(rendered, "'/opt/Safe Shell/hooks/codex/bash-prehook.ts'");
  assertStringIncludes(rendered, "'/opt/Safe Shell/hooks/codex/safesh-permission-hook.ts'");
});

Deno.test("SSH-669: preserves unrelated user config when adding the managed block", () => {
  const existing = 'model = "gpt-test"\n\n[features]\nexample = true\n';
  const managed = renderCodexHookConfig(TEMPLATE, "/opt/safesh/hooks/codex");
  const merged = mergeCodexHookConfig(existing, managed);

  assertStringIncludes(merged, existing.trimEnd());
  assertStringIncludes(merged, managed);
});

Deno.test("SSH-669: replaces only the existing managed block", () => {
  const oldBlock = renderCodexHookConfig(TEMPLATE, "/old/hooks/codex");
  const newBlock = renderCodexHookConfig(TEMPLATE, "/new/hooks/codex");
  const existing = `model = "gpt-test"\n\n${oldBlock}\n\n[features]\nexample = true\n`;
  const merged = mergeCodexHookConfig(existing, newBlock);

  assertEquals(merged, `model = "gpt-test"\n\n${newBlock}\n\n[features]\nexample = true\n`);
});

Deno.test("SSH-669: rejects malformed or unmarked SafeShell hook config", () => {
  assertThrows(
    () => mergeCodexHookConfig(`${BEGIN_MARKER}\nbroken\n`, "replacement"),
    Error,
    "Malformed SafeShell Codex hook block",
  );
  assertThrows(
    () =>
      mergeCodexHookConfig(
        'command = "/opt/safesh/hooks/codex/bash-prehook.ts"\n',
        "replacement",
      ),
    Error,
    "Existing unmarked SafeShell Codex hooks",
  );
  assertThrows(
    () => mergeCodexHookConfig(`${END_MARKER}\n${BEGIN_MARKER}\n`, "replacement"),
    Error,
    "end marker precedes begin marker",
  );
});

Deno.test("SSH-669: installation is idempotent and preserves user settings", async () => {
  await withTestDir("ssh-669-codex-install", async (dir) => {
    const configPath = `${dir}/codex/config.toml`;
    const templatePath = `${dir}/source.toml`;
    await Deno.writeTextFile(templatePath, TEMPLATE);
    await Deno.mkdir(`${dir}/codex`, { recursive: true });
    await Deno.writeTextFile(configPath, 'model = "gpt-test"\n');

    const first = await installCodexHooks({
      configPath,
      hookDir: "/opt/safesh/hooks/codex",
      templatePath,
    });
    const firstContent = await Deno.readTextFile(configPath);
    const second = await installCodexHooks({
      configPath,
      hookDir: "/opt/safesh/hooks/codex",
      templatePath,
    });

    assertEquals(first.changed, true);
    assertEquals(second.changed, false);
    assertEquals(await Deno.readTextFile(configPath), firstContent);
    assertStringIncludes(firstContent, 'model = "gpt-test"');
  });
});
