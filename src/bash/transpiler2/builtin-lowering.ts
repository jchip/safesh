import type { ExpressionResult } from "./types.ts";
import type { BuiltinConfig } from "./builtins.ts";

export interface BuiltinLoweringOptions {
  name: string;
  builtin: BuiltinConfig;
  formattedArgs: string[];
  hasRedirects?: boolean;
  captureOutput?: boolean;
  stdoutCaptureVar?: string | null;
  /** SSH-584: exit inside a subshell leaves the subshell, not the process */
  inSubshell?: boolean;
}

export type BuiltinLoweringResult = ExpressionResult & {
  isShellBuiltin?: boolean;
  isSilentShellBuiltin?: boolean;
  formatsOutput?: boolean;
};

function buildOutputResultExpression(cmdExpr: string, formatsOutput = false): string {
  const lines = [
    `let __result: any;`,
    `try { __result = await Promise.resolve(${cmdExpr}); } catch (__error) { __result = { stdout: "", stderr: __error instanceof Error ? __error.message : String(__error), code: 1 }; }`,
    `const __code = typeof __result === "boolean" ? (__result ? 0 : 1) : (__result ? (__result.code ?? 0) : 1);`,
    `let __stdout = Array.isArray(__result) ? __result.join("\\n") : ((typeof __result === "boolean" || __result == null) ? "" : (typeof __result.stdout === "string" ? __result.stdout : String(__result)));`,
    `let __stderr = (typeof __result?.stderr === "string") ? __result.stderr : "";`,
  ];

  if (formatsOutput) {
    lines.push(`if (__stdout) __stdout += "\\n";`);
  }

  lines.push(
    `return { stdout: __stdout, stderr: __stderr, code: __code, success: __code === 0 };`,
  );

  return `(async () => { ${lines.join(" ")} })()`;
}

function argsArray(formattedArgs: string[]): string {
  return formattedArgs.join(", ");
}

function callExpression(fn: string, formattedArgs: string[]): string {
  const args = argsArray(formattedArgs);
  return `${fn}(${args})`;
}

function capturedPrintArg(formattedArgs: string[]): string {
  if (formattedArgs.length === 0) return '""';
  if (formattedArgs.length === 1) return formattedArgs[0]!;
  return `[${formattedArgs.join(", ")}].join(" ")`;
}

export function lowerShellBuiltin(options: BuiltinLoweringOptions): BuiltinLoweringResult {
  const {
    name,
    builtin,
    formattedArgs,
    hasRedirects = false,
    captureOutput = false,
    stdoutCaptureVar,
    inSubshell = false,
  } = options;

  if (name === "exit") {
    const code = formattedArgs.length > 0 ? `Number(${formattedArgs[0] ?? "0"}) || 0` : "0";
    // SSH-584: inside a subshell, exit must only leave the subshell — throw a
    // sentinel that visitSubshell's boundary catch converts to the subshell's
    // status; bash continues the parent script with $? set.
    const exitExpr = inSubshell
      ? `(() => { throw { __sshSubshellExit: ${code} }; })()`
      : `Deno.exit(${code})`;
    return {
      code: exitExpr,
      async: false,
      isShellBuiltin: true,
      isSilentShellBuiltin: true,
    };
  }

  if (name === "unset") {
    // SSH-612: unset is a shell builtin — spawning it as a command fails.
    // Clear the local JS binding when one exists, the $.ENV proxy target,
    // $.VARS, and Deno.env (the SSH-599 state marker then reports the unset
    // to the parent shell). -v is the default; -f (function unset) cannot be
    // expressed in emitted JS and fails loudly.
    if (formattedArgs.includes(`"-f"`)) {
      return {
        code:
          `{ code: 1, stdout: "", stderr: "unset: -f: functions cannot be unset in transpiled mode", success: false }`,
        async: false,
        isShellBuiltin: true,
        isSilentShellBuiltin: true,
      };
    }
    const clears = formattedArgs
      .filter((a) => a !== `"-v"`)
      .map((a) => {
        const literal = a.match(/^"([A-Za-z_][A-Za-z0-9_]*)"$/);
        if (literal) {
          const n = literal[1]!;
          return `(typeof ${n} !== "undefined" ? (${n} = undefined) : undefined), ` +
            `delete ($.ENV ?? {}).${n}, delete $.VARS?.${n}, Deno.env.delete("${n}")`;
        }
        // Dynamic name: runtime stores only (a local JS binding cannot be
        // cleared through a computed name)
        return `((__n) => { delete ($.ENV ?? {})[__n]; if ($.VARS) delete $.VARS[__n]; Deno.env.delete(String(__n)); })(${a})`;
      });
    return {
      code: clears.length > 0
        ? `(${clears.join(", ")}, { code: 0, stdout: "", stderr: "", success: true })`
        : `{ code: 0, stdout: "", stderr: "", success: true }`,
      async: false,
      isShellBuiltin: true,
      isSilentShellBuiltin: true,
    };
  }

  if (name === ":") {
    // SSH-609: `:` is a no-op but bash still expands its arguments, so a
    // `${VAR:=default}` argument must perform its assignment. Evaluate the
    // argument expressions for their side effects, discard the values.
    const code = formattedArgs.length > 0
      ? `(void [${formattedArgs.join(", ")}], { code: 0, stdout: "", stderr: "", success: true })`
      : `{ code: 0, stdout: "", stderr: "", success: true }`;
    return {
      code,
      async: false,
      isShellBuiltin: true,
      isSilentShellBuiltin: true,
    };
  }

  if (builtin.type === "prints" && stdoutCaptureVar) {
    return { code: `${stdoutCaptureVar}.push(${capturedPrintArg(formattedArgs)})`, async: false };
  }

  if (builtin.type === "output") {
    const outputExpr = callExpression(builtin.fn, formattedArgs);
    if (captureOutput) {
      return {
        code: outputExpr,
        async: false,
        isShellBuiltin: true,
      };
    }

    if (hasRedirects) {
      return {
        code: outputExpr,
        async: false,
        isShellBuiltin: true,
        formatsOutput: true,
      };
    }

    return {
      code: buildOutputResultExpression(outputExpr, true),
      async: true,
      isShellBuiltin: true,
    };
  }

  if (builtin.type === "prints") {
    if ((hasRedirects || captureOutput) && name === "echo") {
      return {
        code: formattedArgs.length > 0
          ? `${builtin.fn}({ silent: true }, ${argsArray(formattedArgs)})`
          : `${builtin.fn}({ silent: true })`,
        async: false,
        isShellBuiltin: true,
      };
    }

    return {
      code: callExpression(builtin.fn, formattedArgs),
      async: false,
      isShellBuiltin: true,
    };
  }

  if (builtin.type === "async") {
    return {
      code: callExpression(builtin.fn, formattedArgs),
      async: true,
      isShellBuiltin: true,
    };
  }

  return {
    code: callExpression(builtin.fn, formattedArgs),
    async: false,
    isShellBuiltin: true,
    isSilentShellBuiltin: true,
  };
}
