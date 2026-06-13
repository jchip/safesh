/**
 * Unit tests for preamble.ts
 *
 * Tests the generated preamble code that gets prepended to executed scripts.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { buildPreamble, extractPreambleConfig, type PreambleConfig } from "./preamble.ts";
import type { SafeShellConfig } from "../core/types.ts";

describe("preamble", () => {
  describe("buildPreamble", () => {
    it("generates valid TypeScript code", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(typeof preamble, "string");
      assertEquals(preamble.length > 0, true);
    });

    it("includes __printCmd helper function", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("async function __printCmd"), true);
    });

    it("includes __cmdSubText helper function", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("async function __cmdSubText"), true);
    });

    it("sets up $ global namespace", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("(globalThis as any).$ ="), true);
    });

    it("exposes project directory via $.ProjectDir", () => {
      const projectDir = "/test/my-project";
      const config: PreambleConfig = {
        projectDir,
        allowedCommands: [],
        cwd: projectDir,
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes(`ProjectDir: "${projectDir}"`), true);
    });
  });

  describe("shared shell value coercion helpers", () => {
    it("imports shared runtime coercions", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(
        preamble.includes("printShellValue as __printShellValue"),
        true,
        "Should import printShellValue",
      );
      assertEquals(
        preamble.includes("captureShellValue as __captureShellValue"),
        true,
        "Should import captureShellValue",
      );
      assertEquals(
        preamble.includes("commandSubstitutionText as __commandSubstitutionText"),
        true,
        "Should import commandSubstitutionText",
      );
    });

    it("keeps generated helper names as thin wrappers", () => {
      const config: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: [],
        cwd: "/test/project",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(preamble.includes("async function __printCmd"), true);
      assertEquals(
        preamble.includes(
          "return await __printShellValue(cmd, __rec ? __setPipeStatusRec : __setPipeStatus);",
        ),
        true,
      );
      assertEquals(preamble.includes("async function __captureCmd"), true);
      assertEquals(
        preamble.includes("return await __captureShellValue(cmd, __setPipeStatusRec);"),
        true,
      );
      assertEquals(preamble.includes("async function __cmdSubText"), true);
      assertEquals(
        preamble.includes("return await __commandSubstitutionText(__result, __setPipeStatusRec);"),
        true,
      );
      // SSH-581: status recording helpers
      assertEquals(preamble.includes("function __setPipeStatusRec"), true);
      assertEquals(preamble.includes("function __recStatus"), true);
    });
  });

  describe("edge cases", () => {
    it("handles empty project directory", () => {
      const config: PreambleConfig = {
        projectDir: "",
        allowedCommands: [],
        cwd: "/test",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(typeof preamble, "string");
      assertEquals(preamble.includes('ProjectDir: ""'), true);
    });

    it("handles minimal config", () => {
      const config: PreambleConfig = {
        allowedCommands: [],
        cwd: "/test",
      };
      const { preamble } = buildPreamble(undefined, config);

      assertEquals(typeof preamble, "string");
      assertEquals(preamble.length > 0, true);
    });
  });

  describe("extractPreambleConfig", () => {
    it("includes sessionAllowedCommands in config when present", async () => {
      const tmpDir = await Deno.makeTempDir();

      try {
        const config: SafeShellConfig = {
          projectDir: tmpDir,
          permissions: { run: ["git"] },
          external: { curl: { allow: true } },
        };
        const result = extractPreambleConfig(config, tmpDir);

        assertEquals(result.allowedCommands.includes("git"), true);
        assertEquals(result.allowedCommands.includes("curl"), true);
        // sessionAllowedCommands is undefined when no session file exists
        assertEquals(result.sessionAllowedCommands, undefined);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("includes workspaceRoots in preamble config", async () => {
      const tmpDir = await Deno.makeTempDir();
      const rootA = `${tmpDir}/root-a`;
      const rootB = `${tmpDir}/root-b`;

      try {
        const config: SafeShellConfig = {
          projectDir: rootA,
          workspaceRoots: [rootA, rootB],
          permissions: { run: [] },
        };
        const result = extractPreambleConfig(config, rootB);

        assertEquals(result.workspaceRoots, [rootA, rootB]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("defaults allowProjectCommands to true when CLAUDE_SESSION_ID is set", async () => {
      const tmpDir = await Deno.makeTempDir();
      const original = Deno.env.get("CLAUDE_SESSION_ID");
      Deno.env.set("CLAUDE_SESSION_ID", "test-preamble-session");

      try {
        const config: SafeShellConfig = {
          projectDir: tmpDir,
          permissions: { run: [] },
        };
        const result = extractPreambleConfig(config, tmpDir);

        assertEquals(result.allowProjectCommands, true);
      } finally {
        if (original !== undefined) {
          Deno.env.set("CLAUDE_SESSION_ID", original);
        } else {
          Deno.env.delete("CLAUDE_SESSION_ID");
        }
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("defaults allowProjectCommands to false without CLAUDE_SESSION_ID", async () => {
      const tmpDir = await Deno.makeTempDir();
      const original = Deno.env.get("CLAUDE_SESSION_ID");
      Deno.env.delete("CLAUDE_SESSION_ID");

      try {
        const config: SafeShellConfig = {
          projectDir: tmpDir,
          permissions: { run: [] },
        };
        const result = extractPreambleConfig(config, tmpDir);

        assertEquals(result.allowProjectCommands, false);
      } finally {
        if (original !== undefined) {
          Deno.env.set("CLAUDE_SESSION_ID", original);
        }
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("preserves explicit allowProjectCommands from config", async () => {
      const tmpDir = await Deno.makeTempDir();
      const original = Deno.env.get("CLAUDE_SESSION_ID");
      Deno.env.set("CLAUDE_SESSION_ID", "test-preamble-override");

      try {
        const config: SafeShellConfig = {
          projectDir: tmpDir,
          allowProjectCommands: false, // Explicit false
          permissions: { run: [] },
        };
        const result = extractPreambleConfig(config, tmpDir);

        // Explicit false should override the CLAUDE_SESSION_ID default
        assertEquals(result.allowProjectCommands, false);
      } finally {
        if (original !== undefined) {
          Deno.env.set("CLAUDE_SESSION_ID", original);
        } else {
          Deno.env.delete("CLAUDE_SESSION_ID");
        }
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("serializes sessionAllowedCommands into preamble config JSON", () => {
      const preambleConfig: PreambleConfig = {
        projectDir: "/test/project",
        allowedCommands: ["git"],
        sessionAllowedCommands: ["cargo", "rustc"],
        cwd: "/test",
      };
      const { preamble } = buildPreamble(undefined, preambleConfig);

      // The config is serialized via JSON.stringify and injected via Symbol.for('safesh.config')
      // Verify sessionAllowedCommands appears in the serialized config
      assertEquals(preamble.includes('"sessionAllowedCommands"'), true);
      assertEquals(preamble.includes('"cargo"'), true);
      assertEquals(preamble.includes('"rustc"'), true);
    });
  });
});

import { buildFilePreamble } from "./preamble.ts";

describe("status-recording runtime (SSH-597)", () => {
  it("embeds the shared block exactly once in both preambles", () => {
    const config: PreambleConfig = {
      projectDir: "/test/project",
      allowedCommands: [],
      cwd: "/test/project",
    };
    const { preamble } = buildPreamble(undefined, config);
    const filePreamble = buildFilePreamble(undefined, config);

    for (const text of [preamble, filePreamble]) {
      assertEquals(text.split("function __setPipeStatusRec").length - 1, 1);
      assertEquals(text.split("function __recStatus").length - 1, 1);
      assertEquals(text.split("async function __cmdSubText").length - 1, 1);
      assertEquals(text.split("async function __printCmd").length - 1, 1);
      assertEquals(text.split("async function __captureCmd").length - 1, 1);
    }
  });
});

import {
  buildErrorHandler,
  buildFilePostamble,
  extractShellState,
  SHELL_STATE_MARKER,
} from "./preamble.ts";

describe("state marker env deltas (SSH-599)", () => {
  const config: PreambleConfig = {
    projectDir: "/test/project",
    allowedCommands: [],
    cwd: "/test/project",
  };

  it("embeds the env-delta capture exactly once in both preambles", () => {
    const { preamble } = buildPreamble(undefined, config);
    const filePreamble = buildFilePreamble(undefined, config);

    for (const text of [preamble, filePreamble]) {
      assertEquals(text.split("const __SSH_ENV0").length - 1, 1);
      assertEquals(text.split("function __sshShellState").length - 1, 1);
    }
  });

  it("emits the marker through the delta helper in postamble and error handler", () => {
    const postamble = buildFilePostamble(true);
    assertEquals(postamble.includes(`"${SHELL_STATE_MARKER}" + __sshShellState()`), true);

    const errorHandler = buildErrorHandler("/tmp/script.ts", 10, true);
    assertEquals(errorHandler.includes(`"${SHELL_STATE_MARKER}" + __sshShellState()`), true);

    // No marker without a shell
    assertEquals(buildFilePostamble(false), "");
    assertEquals(buildErrorHandler("/tmp/script.ts", 10, false).includes(SHELL_STATE_MARKER), false);
  });

  describe("extractShellState", () => {
    it("parses set and unset env deltas and strips the marker line", () => {
      const state = { CWD: "/work", ENV: { FOO: "x" }, UNSET_ENV: ["BAR"], VARS: { n: 1 } };
      const output = `hello\n${SHELL_STATE_MARKER}${JSON.stringify(state)}\nworld`;

      const result = extractShellState(output);

      assertEquals(result.cleanOutput, "hello\nworld");
      assertEquals(result.cwd, "/work");
      assertEquals(result.env, { FOO: "x" });
      assertEquals(result.envUnset, ["BAR"]);
      assertEquals(result.vars, { n: 1 });
    });

    it("tolerates a marker without UNSET_ENV", () => {
      const output = `${SHELL_STATE_MARKER}${JSON.stringify({ CWD: "/w", ENV: {}, VARS: {} })}`;

      const result = extractShellState(output);

      assertEquals(result.cwd, "/w");
      assertEquals(result.envUnset, undefined);
    });

    it("returns output unchanged when no marker is present", () => {
      const result = extractShellState("plain output\nno marker");

      assertEquals(result.cleanOutput, "plain output\nno marker");
      assertEquals(result.cwd, undefined);
      assertEquals(result.env, undefined);
      assertEquals(result.envUnset, undefined);
    });

    it("returns output unchanged when the marker JSON is invalid", () => {
      const output = `${SHELL_STATE_MARKER}{not json`;

      const result = extractShellState(output);

      assertEquals(result.cleanOutput, output);
      assertEquals(result.env, undefined);
    });
  });
});

import { buildStateTrailerHook } from "./preamble.ts";

describe("state trailer VARS filter (SSH-600)", () => {
  it("emits only clean scalars and stays bash-parseable", async () => {
    const tmpDir = await Deno.makeTempDir();
    const trailerPath = `${tmpDir}/trailer.sh`;
    const scriptPath = `${tmpDir}/script.ts`;

    try {
      // VARS pre-seeded so a later `= undefined` registers as a change
      await Deno.writeTextFile(
        scriptPath,
        [
          `(globalThis as any).$ = { VARS: { SSH600_UNDEF: "was-set" } as Record<string, unknown> };`,
          buildStateTrailerHook(),
          `const __vars = (globalThis as any).$.VARS;`,
          `__vars.SSH600_GOOD = "clean value";`,
          `__vars.SSH600_NUM = 42;`,
          `__vars.SSH600_FLAG = true;`,
          `__vars.SSH600_FN = () => "garbage";`,
          `__vars.SSH600_UNDEF = undefined;`,
        ].join("\n"),
      );

      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-env", "--allow-read", "--allow-write", scriptPath],
        env: { SAFESH_STATE_TRAILER: trailerPath },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        output.code,
        0,
        `hook script failed: ${new TextDecoder().decode(output.stderr)}`,
      );

      const trailer = await Deno.readTextFile(trailerPath);

      // Clean scalars survive
      assertEquals(trailer.includes("SSH600_GOOD='clean value'"), true, trailer);
      assertEquals(trailer.includes("SSH600_NUM='42'"), true, trailer);
      assertEquals(trailer.includes("SSH600_FLAG='true'"), true, trailer);
      // Functions and undefined must not produce garbage assignments
      assertEquals(trailer.includes("SSH600_FN"), false, trailer);
      assertEquals(trailer.includes("SSH600_UNDEF"), false, trailer);

      // Parser side: the calling shell must be able to source the trailer
      const sourced = await new Deno.Command("/bin/bash", {
        args: ["-c", `set -e; . '${trailerPath}'; echo "$SSH600_GOOD|$SSH600_NUM|$SSH600_FLAG"`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(sourced.code, 0, new TextDecoder().decode(sourced.stderr));
      assertEquals(new TextDecoder().decode(sourced.stdout).trim(), "clean value|42|true");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  it("skips writing the trailer when only garbage values changed", async () => {
    const tmpDir = await Deno.makeTempDir();
    const trailerPath = `${tmpDir}/trailer.sh`;
    const scriptPath = `${tmpDir}/script.ts`;

    try {
      await Deno.writeTextFile(
        scriptPath,
        [
          `(globalThis as any).$ = { VARS: {} as Record<string, unknown> };`,
          buildStateTrailerHook(),
          `(globalThis as any).$.VARS.SSH600_FN = () => "garbage";`,
        ].join("\n"),
      );

      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-env", "--allow-read", "--allow-write", scriptPath],
        env: { SAFESH_STATE_TRAILER: trailerPath },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        output.code,
        0,
        `hook script failed: ${new TextDecoder().decode(output.stderr)}`,
      );

      let exists = true;
      try {
        await Deno.stat(trailerPath);
      } catch {
        exists = false;
      }
      assertEquals(exists, false, "no trailer should be written for garbage-only changes");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});
