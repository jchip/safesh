import { assertEquals, assertStringIncludes } from "@std/assert";
import { lowerShellBuiltin } from "./builtin-lowering.ts";
import { SHELL_BUILTINS } from "./builtins.ts";

Deno.test("builtin lowering captures print builtins into stdout capture context", () => {
  const result = lowerShellBuiltin({
    name: "echo",
    builtin: SHELL_BUILTINS.echo!,
    formattedArgs: ['"one"', '"two"'],
    stdoutCaptureVar: "__stdout",
  });

  assertEquals(result, {
    code: '__stdout.push(["one", "two"].join(" "))',
    async: false,
  });
});

Deno.test("builtin lowering silences echo in redirect or capture contexts", () => {
  const redirected = lowerShellBuiltin({
    name: "echo",
    builtin: SHELL_BUILTINS.echo!,
    formattedArgs: ['"hello"'],
    hasRedirects: true,
  });
  const captured = lowerShellBuiltin({
    name: "echo",
    builtin: SHELL_BUILTINS.echo!,
    formattedArgs: ['"hello"'],
    captureOutput: true,
  });

  assertEquals(redirected.code, '$.echo({ silent: true }, "hello")');
  assertEquals(redirected.isShellBuiltin, true);
  assertEquals(captured.code, '$.echo({ silent: true }, "hello")');
});

Deno.test("builtin lowering wraps output builtins as command-style results for statements", () => {
  const result = lowerShellBuiltin({
    name: "pwd",
    builtin: SHELL_BUILTINS.pwd!,
    formattedArgs: [],
  });

  assertEquals(result.async, true);
  assertEquals(result.isShellBuiltin, true);
  assertStringIncludes(result.code, "await Promise.resolve($.pwd())");
  assertStringIncludes(result.code, "success: __code === 0");
});

Deno.test("builtin lowering preserves silent state mutation marker", () => {
  const result = lowerShellBuiltin({
    name: "cd",
    builtin: SHELL_BUILTINS.cd!,
    formattedArgs: ['"/tmp"'],
  });

  assertEquals(result, {
    code: '$.cd("/tmp")',
    async: false,
    isShellBuiltin: true,
    isSilentShellBuiltin: true,
  });
});

Deno.test("builtin lowering emits exit as a silent builtin", () => {
  const result = lowerShellBuiltin({
    name: "exit",
    builtin: SHELL_BUILTINS.exit!,
    formattedArgs: ["7"],
  });

  assertEquals(result, {
    code: "Deno.exit(Number(7) || 0)",
    async: false,
    isShellBuiltin: true,
    isSilentShellBuiltin: true,
  });
});
