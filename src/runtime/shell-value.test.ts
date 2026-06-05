import { assertEquals } from "@std/assert";
import { captureShellValue, commandSubstitutionText, printShellValue } from "./shell-value.ts";

function memoryWriter() {
  let text = "";
  return {
    writer: {
      write(data: Uint8Array): number {
        text += new TextDecoder().decode(data);
        return data.length;
      },
    },
    get text(): string {
      return text;
    },
  };
}

Deno.test("captureShellValue converts null-like values to failed empty results", async () => {
  let pipeStatus: number[] | undefined;
  const result = await captureShellValue(null, (status, code) => {
    pipeStatus = Array.isArray(status) ? status : [code];
    return code;
  });

  assertEquals(result, {
    code: 1,
    stdout: "",
    stderr: "",
    success: false,
  });
  assertEquals(pipeStatus, [1]);
});

Deno.test("captureShellValue preserves command result output and pipe status", async () => {
  let pipeStatus: number[] | undefined;
  const result = await captureShellValue(
    { stdout: "out", stderr: "err", code: 7, pipeStatus: [3, 7] },
    (status, code) => {
      pipeStatus = Array.isArray(status) ? status : [code];
      return code;
    },
  );

  assertEquals(result, {
    code: 7,
    stdout: "out",
    stderr: "err",
    success: false,
    pipeStatus: [3, 7],
  });
  assertEquals(pipeStatus, [3, 7]);
});

Deno.test("captureShellValue captures async iterable output as stdout lines", async () => {
  async function* lines() {
    yield "a";
    yield "b";
  }

  const result = await captureShellValue(lines());

  assertEquals(result, {
    code: 0,
    stdout: "a\nb\n",
    stderr: "",
    success: true,
  });
});

Deno.test("printShellValue streams stdout and stderr chunks", async () => {
  const stdout = memoryWriter();
  const stderr = memoryWriter();
  let pipeStatus: number[] | undefined;
  const command = {
    async *stream() {
      yield { type: "stdout", data: "out" };
      yield { type: "stderr", data: "err" };
      yield { type: "exit", code: 4, pipeStatus: [2, 4] };
    },
  };

  const code = await printShellValue(
    command,
    (status, nextCode) => {
      pipeStatus = Array.isArray(status) ? status : [nextCode];
      return nextCode;
    },
    { stdout: stdout.writer, stderr: stderr.writer },
  );

  assertEquals(code, 4);
  assertEquals(stdout.text, "out");
  assertEquals(stderr.text, "err");
  assertEquals(pipeStatus, [2, 4]);
});

Deno.test("commandSubstitutionText awaits promises and strips trailing newlines", async () => {
  const text = await commandSubstitutionText(
    Promise.resolve({ stdout: "value\n\n", code: 0 }),
  );

  assertEquals(text, "value");
});

Deno.test("commandSubstitutionText collects fluent stream-like values", async () => {
  const text = await commandSubstitutionText({
    async collect() {
      return ["a", "b"];
    },
  });

  assertEquals(text, "a\nb");
});
