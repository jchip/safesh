import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse } from "../../src/bash/parser.ts";
import { transpile } from "../../src/bash/transpiler2/mod.ts";
import { executeCode } from "../../src/runtime/executor.ts";
import type { SafeShellConfig } from "../../src/core/types.ts";
import { REAL_TMP } from "../helpers.ts";

function transpileBash(bash: string): string {
  return transpile(parse(bash), { imports: false, strict: false });
}

interface MatrixContext {
  testDir: string;
  code: string;
  result: Awaited<ReturnType<typeof executeCode>>;
}

interface MatrixCase {
  name: string;
  source: string;
  context: string;
  dataMode: string;
  status: string;
  setup?: (testDir: string) => Promise<void>;
  script: (testDir: string) => string;
  verify: (ctx: MatrixContext) => Promise<void> | void;
}

const config: SafeShellConfig = {
  permissions: {
    read: [Deno.cwd(), REAL_TMP],
    write: [REAL_TMP],
    run: ["false", "grep", "printf", "tr", "cut"],
  },
  timeout: 5000,
};

const cases: MatrixCase[] = [
  {
    name: "external recursive grep fallback",
    source: "external command",
    context: "statement",
    dataMode: "result object",
    status: "success with matched file output",
    async setup(testDir) {
      await Deno.mkdir(`${testDir}/demo/trust-mock/src`, { recursive: true });
      await Deno.mkdir(`${testDir}/scripts/dev`, { recursive: true });
      await Deno.writeTextFile(
        `${testDir}/demo/trust-mock/package.json`,
        '{"name":"trust-mock"}\n',
      );
      await Deno.writeTextFile(
        `${testDir}/demo/trust-mock/src/index.ts`,
        "const service = 'trustMock';\n",
      );
      await Deno.writeTextFile(
        `${testDir}/scripts/dev/start-local-infra.js`,
        "const svc = 'trust_mock';\n",
      );
      await Deno.writeTextFile(`${testDir}/unrelated.txt`, "nothing here\n");
    },
    script: () => `grep -rln "trust-mock\\|trustMock\\|trust_mock" .`,
    verify({ code, result }) {
      assertStringIncludes(code, '$.cmd("grep", "-rln"');
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "./demo/trust-mock/package.json");
      assertStringIncludes(result.stdout, "./demo/trust-mock/src/index.ts");
      assertStringIncludes(result.stdout, "./scripts/dev/start-local-infra.js");
      assertEquals(result.stdout.includes("./unrelated.txt"), false);
    },
  },
  {
    name: "failed cd continues newline script",
    source: "stateful builtin",
    context: "newline statement list",
    dataMode: "effect plus stderr",
    status: "non-zero command followed by later success",
    script: (testDir) =>
      `cd ${testDir}/missing-dir
pwd
echo blah blah
pwd`,
    verify({ testDir, code, result }) {
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stderr, `cd: ${testDir}/missing-dir: No such file or directory`);
      assertEquals(result.stdout.trim().split(/\r?\n/), [testDir, "blah blah", testDir]);
    },
  },
  {
    name: "redirected cd drives && status",
    source: "stateful builtin",
    context: "logical operator with stderr redirect",
    dataMode: "effect",
    status: "success gates right side",
    async setup(testDir) {
      await Deno.mkdir(`${testDir}/target`);
    },
    script: (testDir) => `cd ${testDir}/target 2>/dev/null && echo marker && pwd`,
    verify({ testDir, code, result }) {
      assertEquals(code.includes('$.cmd("cd"'), false, code);
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim().split(/\r?\n/), ["marker", `${testDir}/target`]);
    },
  },
  {
    name: "output builtins write redirected files",
    source: "output builtin",
    context: "stdout redirection",
    dataMode: "captured result",
    status: "success with silent statement output",
    script: () =>
      `echo hello > echo.txt
pwd > pwd.txt`,
    async verify({ testDir, code, result }) {
      assertEquals(code.includes('$.cmd("echo"'), false, code);
      assertEquals(code.includes('$.cmd("pwd"'), false, code);
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "");
      assertEquals(await Deno.readTextFile(`${testDir}/echo.txt`), "hello\n");
      assertEquals(await Deno.readTextFile(`${testDir}/pwd.txt`), `${testDir}\n`);
    },
  },
  {
    name: "logical command substitution awaits fallback",
    source: "grouped logical expression",
    context: "command substitution in echo arg",
    dataMode: "captured stdout text",
    status: "failed left branch with successful fallback",
    script: (testDir) => `echo "pom=$(test -f ${testDir}/missing-pom.xml && echo yes || echo no)"`,
    verify({ code, result }) {
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "pom=no\n");
      assertEquals(result.stdout.includes("[object Promise]"), false);
    },
  },
  {
    name: "pipeline command substitution preserves wc line count",
    source: "external command plus fluent command",
    context: "command substitution",
    dataMode: "raw stream to line count",
    status: "success",
    script: () => `echo "tracked-files=$(printf "a\\nb\\n" | wc -l)"`,
    verify({ code, result }) {
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "tracked-files=2");
    },
  },
  {
    name: "external command object pipes through external command",
    source: "external command",
    context: "pipeline middle command",
    dataMode: "command object stream",
    status: "success",
    script: () => `printf " a\\n" | tr -d " " | wc -l`,
    verify({ code, result }) {
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout.trim(), "1");
    },
  },
  {
    name: "grouped logical output pipes to head",
    source: "subshell/group",
    context: "pipeline producer",
    dataMode: "stdout stream",
    status: "non-zero intermediates with output fallback",
    script: () => `(false || false || printf "first\\nsecond\\n") | head -1`,
    verify({ code, result }) {
      assertEquals(code.includes("})().stdout()"), false, code);
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "first\n");
    },
  },
  {
    name: "assignment capture participates in &&",
    source: "assignment",
    context: "logical operator",
    dataMode: "effect plus captured text",
    status: "assignment-only command succeeds",
    script: () => `out=$(printf "ok" 2>&1) && echo "$out" || echo fail`,
    verify({ code, result }) {
      assertEquals(code.includes("__captureCmd(let out"), false, code);
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertEquals(result.stdout, "ok\n");
    },
  },
  {
    name: "subshell read consumes pipeline input",
    source: "subshell read group",
    context: "pipeline consumer",
    dataMode: "raw stream into stateful read",
    status: "success",
    script: () => `printf " 123\\n" | tr -d " " | (read p; printf "$p\\n" | tail -1 | cut -c1-160)`,
    verify({ code, result }) {
      assertEquals(code.includes(".pipe((async () =>"), false, code);
      assertEquals(result.success, true, `stderr: ${result.stderr}\ncode:\n${code}`);
      assertStringIncludes(result.stdout, "123");
    },
  },
];

describe("Bash lowering conformance matrix", () => {
  for (const testCase of cases) {
    it(`${testCase.name} [${testCase.source}; ${testCase.context}; ${testCase.dataMode}; ${testCase.status}]`, async () => {
      const testDir = await Deno.makeTempDir({ dir: REAL_TMP });
      try {
        await testCase.setup?.(testDir);
        const code = transpileBash(testCase.script(testDir));
        const result = await executeCode(code, config, { cwd: testDir });
        await testCase.verify({ testDir, code, result });
      } finally {
        await Deno.remove(testDir, { recursive: true });
      }
    });
  }
});
