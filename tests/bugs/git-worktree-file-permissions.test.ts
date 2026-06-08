import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { parse, transpile } from "../../src/bash/mod.ts";
import { loadSessionConfig } from "../../src/core/config.ts";
import { executeCode } from "../../src/runtime/executor.ts";

Deno.test("SSH-102: shelljs file commands keep git-aware roots after cd into nested worktree", async () => {
  const testDir = join(Deno.cwd(), ".temp", `ssh-102-${crypto.randomUUID()}`);
  const topWorktree = join(testDir, "workflow-engine");
  const linkedWorktree = join(topWorktree, ".worktrees", "config-driven-testing");
  const sourcePath = join(linkedWorktree, "deploy-local/docker/traefik/routes.yml");
  const destPath = join(topWorktree, ".local/deploy-local/docker/traefik/routes.yml");
  const originalProjectEnv = Deno.env.get("CLAUDE_PROJECT_DIR");

  try {
    Deno.env.delete("CLAUDE_PROJECT_DIR");
    await Deno.mkdir(join(topWorktree, ".git/worktrees/config-driven-testing"), {
      recursive: true,
    });
    await Deno.mkdir(dirname(sourcePath), { recursive: true });
    await Deno.mkdir(dirname(destPath), { recursive: true });
    await Deno.writeTextFile(
      join(linkedWorktree, ".git"),
      "gitdir: ../../.git/worktrees/config-driven-testing\n",
    );
    await Deno.writeTextFile(sourcePath, "routes\n");

    const { config } = await loadSessionConfig(linkedWorktree);
    const code = transpile(
      parse(`cd ${linkedWorktree}
cp deploy-local/docker/traefik/routes.yml ${destPath}`),
      { imports: false, strict: false },
    );

    const result = await executeCode(code, config, { cwd: topWorktree });

    assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
    assertEquals(result.stderr, "", `code:\n${code}`);
    assertEquals(await Deno.readTextFile(destPath), "routes\n");
  } finally {
    if (originalProjectEnv !== undefined) {
      Deno.env.set("CLAUDE_PROJECT_DIR", originalProjectEnv);
    } else {
      Deno.env.delete("CLAUDE_PROJECT_DIR");
    }
    await Deno.remove(testDir, { recursive: true }).catch(() => {});
  }
});
