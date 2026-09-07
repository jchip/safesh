import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { withTestDir } from "../../tests/helpers.ts";
import {
  defaultConfigPath,
  installAgyHooks,
  MANAGED_HOOK_NAME,
  mergeAgyHookConfig,
  renderAgyHookConfig,
  uninstallAgyHookConfig,
} from "./install.ts";

const SAMPLE_TEMPLATE = `{
  "safesh": {
    "enabled": true,
    "PreToolUse": [
      {
        "matcher": "run_command",
        "hooks": [
          {
            "type": "command",
            "command": "__SAFESH_AGY_BASH_PREHOOK__",
            "timeout": 30
          }
        ]
      }
    ]
  }
}`;

Deno.test("SSH-681: renderAgyHookConfig renders absolute path to bash-prehook.ts", () => {
  const rendered = renderAgyHookConfig(SAMPLE_TEMPLATE, "/opt/safesh/hooks/agy");
  assertEquals(rendered[MANAGED_HOOK_NAME] !== undefined, true);

  const safeshConfig = rendered[MANAGED_HOOK_NAME] as {
    enabled: boolean;
    PreToolUse: Array<{ hooks: Array<{ command: string }> }>;
  };
  assertEquals(safeshConfig.enabled, true);
  assertEquals(
    safeshConfig.PreToolUse[0]?.hooks[0]?.command,
    "/opt/safesh/hooks/agy/bash-prehook.ts",
  );
});

Deno.test("SSH-681: mergeAgyHookConfig creates valid config from empty or missing file", () => {
  const rendered = renderAgyHookConfig(SAMPLE_TEMPLATE, "/opt/safesh/hooks/agy");
  const merged = mergeAgyHookConfig("", rendered);
  const parsed = JSON.parse(merged);

  assertEquals(parsed[MANAGED_HOOK_NAME] !== undefined, true);
  assertEquals(
    parsed[MANAGED_HOOK_NAME].PreToolUse[0].hooks[0].command,
    "/opt/safesh/hooks/agy/bash-prehook.ts",
  );
});

Deno.test("SSH-681: mergeAgyHookConfig preserves unrelated existing hooks", () => {
  const existing = JSON.stringify(
    {
      "custom-gate": {
        enabled: true,
        PreToolUse: [{ matcher: "view_file", hooks: [{ command: "guard.sh" }] }],
      },
    },
    null,
    2,
  );

  const rendered = renderAgyHookConfig(SAMPLE_TEMPLATE, "/opt/safesh/hooks/agy");
  const merged = mergeAgyHookConfig(existing, rendered);
  const parsed = JSON.parse(merged);

  assertEquals(parsed["custom-gate"] !== undefined, true);
  assertEquals(parsed[MANAGED_HOOK_NAME] !== undefined, true);
  assertEquals(parsed["custom-gate"].PreToolUse[0].matcher, "view_file");
});

Deno.test("SSH-681: mergeAgyHookConfig updates existing safesh hook definition", () => {
  const existing = JSON.stringify(
    {
      safesh: {
        enabled: false,
        PreToolUse: [{ matcher: "run_command", hooks: [{ command: "/old/path.ts" }] }],
      },
      "custom-gate": { enabled: true },
    },
    null,
    2,
  );

  const rendered = renderAgyHookConfig(SAMPLE_TEMPLATE, "/new/path/hooks/agy");
  const merged = mergeAgyHookConfig(existing, rendered);
  const parsed = JSON.parse(merged);

  assertEquals(parsed.safesh.enabled, true);
  assertEquals(
    parsed.safesh.PreToolUse[0].hooks[0].command,
    "/new/path/hooks/agy/bash-prehook.ts",
  );
  assertEquals(parsed["custom-gate"].enabled, true);
});

Deno.test("SSH-681: mergeAgyHookConfig rejects malformed JSON", () => {
  const rendered = renderAgyHookConfig(SAMPLE_TEMPLATE, "/opt/safesh/hooks/agy");
  assertThrows(
    () => mergeAgyHookConfig("{ not valid json", rendered),
    Error,
    "Existing hooks.json is not valid JSON",
  );
});

Deno.test("SSH-681: uninstallAgyHookConfig removes safesh and preserves other hooks", () => {
  const existing = JSON.stringify(
    {
      safesh: { enabled: true },
      "custom-gate": { enabled: true },
    },
    null,
    2,
  );

  const { content, changed } = uninstallAgyHookConfig(existing);
  assertEquals(changed, true);

  const parsed = JSON.parse(content);
  assertEquals(parsed.safesh, undefined);
  assertEquals(parsed["custom-gate"].enabled, true);
});

Deno.test("SSH-681: uninstallAgyHookConfig is a no-op when safesh hook is not present", () => {
  const existing = JSON.stringify({ "custom-gate": { enabled: true } });
  const { changed } = uninstallAgyHookConfig(existing);
  assertEquals(changed, false);
});

Deno.test("SSH-681: defaultConfigPath resolves global and workspace scopes", () => {
  const globalPath = defaultConfigPath("global");
  assertStringIncludes(globalPath, ".gemini/config/hooks.json");

  const workspacePath = defaultConfigPath("workspace", "/path/to/project");
  assertEquals(workspacePath, "/path/to/project/.agents/hooks.json");
});

Deno.test("SSH-681: installAgyHooks is idempotent and atomic", async () => {
  await withTestDir("ssh-681-agy-install", async (dir) => {
    const configPath = `${dir}/hooks.json`;
    const templatePath = `${dir}/template.json`;
    await Deno.writeTextFile(templatePath, SAMPLE_TEMPLATE);

    // Initial install
    const first = await installAgyHooks({
      configPath,
      hookDir: "/opt/safesh/hooks/agy",
      templatePath,
    });
    assertEquals(first.changed, true);

    const firstContent = await Deno.readTextFile(configPath);
    assertStringIncludes(firstContent, "/opt/safesh/hooks/agy/bash-prehook.ts");

    // Second install should be idempotent
    const second = await installAgyHooks({
      configPath,
      hookDir: "/opt/safesh/hooks/agy",
      templatePath,
    });
    assertEquals(second.changed, false);
    assertEquals(await Deno.readTextFile(configPath), firstContent);

    // Uninstall
    const uninstalled = await installAgyHooks({
      configPath,
      uninstall: true,
    });
    assertEquals(uninstalled.changed, true);
    const afterUninstall = JSON.parse(await Deno.readTextFile(configPath));
    assertEquals(afterUninstall[MANAGED_HOOK_NAME], undefined);
  });
});
