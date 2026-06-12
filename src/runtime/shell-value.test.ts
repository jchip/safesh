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

Deno.test("SSH-595: commandSubstitutionText propagates a stream command's exit status", async () => {
  let recorded: number | undefined;
  const text = await commandSubstitutionText(
    {
      async *streamChunks() {},
      stream() {
        return (async function* () {
          yield { type: "stdout", data: "partial\n" };
          yield { type: "exit", code: 1 };
        })();
      },
    },
    (_status, code) => {
      recorded = code;
      return code;
    },
  );

  assertEquals(text, "partial");
  assertEquals(recorded, 1);
});

Deno.test("SSH-595: commandSubstitutionText propagates getEmptyExitCode for empty fluent streams", async () => {
  // fluent-lowered `grep nomatch` yields no items and reports bash's exit 1
  // through getEmptyExitCode
  let recorded: number | undefined;
  const iterable = {
    async *[Symbol.asyncIterator]() {},
    getEmptyExitCode() {
      return 1;
    },
  };

  const text = await commandSubstitutionText(iterable, (_status, code) => {
    recorded = code;
    return code;
  });

  assertEquals(text, "");
  assertEquals(recorded, 1);
});

Deno.test("SSH-595: commandSubstitutionText captures items from a fluent stream with status 0", async () => {
  let recorded: number | undefined;
  const iterable = {
    async *[Symbol.asyncIterator]() {
      yield "a";
      yield "b";
    },
  };

  const text = await commandSubstitutionText(iterable, (_status, code) => {
    recorded = code;
    return code;
  });

  assertEquals(text, "a\nb");
  assertEquals(recorded, 0);
});

Deno.test("SSH-595: commandSubstitutionText maps booleans to bash-style status with empty text", async () => {
  let recorded: number | undefined;
  const record = (_status: unknown, code: number) => {
    recorded = code;
    return code;
  };

  assertEquals(await commandSubstitutionText(false, record), "");
  assertEquals(recorded, 1);
  assertEquals(await commandSubstitutionText(true, record), "");
  assertEquals(recorded, 0);
});
