/**
 * Shared coercions for values produced by transpiled bash execution.
 *
 * The transpiler can produce Commands, command results, streams, builtins,
 * assignment-only effects, and async IIFEs that resolve to any of those.
 * Keep the runtime conversions in one module so preamble generation stays thin.
 *
 * @module
 */

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
  success: boolean;
  pipeStatus?: number[];
}

export type SetPipeStatus = (status: unknown, code: number) => number;

interface ByteWriter {
  write(data: Uint8Array): number | Promise<number>;
}

export interface ShellValueIo {
  stdout?: ByteWriter;
  stderr?: ByteWriter;
}

interface StreamChunkLike {
  type?: unknown;
  data?: unknown;
  code?: unknown;
  pipeStatus?: unknown;
}

type UnknownRecord = Record<PropertyKey, unknown>;

function emptyExitCode(value: unknown): number | undefined {
  const record = asRecord(value);
  const getter = record?.getEmptyExitCode;
  if (typeof getter === "function") {
    const code = getter.call(value);
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

function noopSetPipeStatus(_status: unknown, code: number): number {
  return code;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function hasFunction<T extends string>(
  value: unknown,
  name: T,
): value is Record<T, (...args: never[]) => unknown> {
  const record = asRecord(value);
  return typeof record?.[name] === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  const record = asRecord(value);
  return typeof record?.[Symbol.asyncIterator] === "function";
}

function isStreamCommand(value: unknown): value is { stream(): AsyncIterable<StreamChunkLike> } {
  return hasFunction(value, "stream") && !isAsyncIterable(value);
}

function asPipeStatus(value: unknown): number[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number")
    : undefined;
}

function resultCode(value: UnknownRecord | null, fallback: number): number {
  return typeof value?.code === "number" ? value.code : fallback;
}

function resultText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stdoutOf(value: UnknownRecord): string {
  if (typeof value.output === "string") return value.output;
  return resultText(value.stdout);
}

function stderrOf(value: UnknownRecord): string {
  return typeof value.output === "string" ? "" : resultText(value.stderr);
}

async function write(writer: ByteWriter, text: string): Promise<void> {
  if (text.length === 0) return;
  await writer.write(new TextEncoder().encode(text));
}

function writers(io: ShellValueIo = {}): Required<ShellValueIo> {
  return {
    stdout: io.stdout ?? Deno.stdout,
    stderr: io.stderr ?? Deno.stderr,
  };
}

async function captureStreamCommand(
  command: { stream(): AsyncIterable<StreamChunkLike> },
  setPipeStatus: SetPipeStatus = noopSetPipeStatus,
): Promise<ShellResult> {
  let stdout = "";
  let stderr = "";
  let code = 1;
  let pipeStatus: number[] | undefined;

  for await (const chunk of command.stream()) {
    if (chunk.type === "stdout" && chunk.data) {
      stdout += String(chunk.data);
    } else if (chunk.type === "stderr" && chunk.data) {
      stderr += String(chunk.data);
    } else if (chunk.type === "exit") {
      code = typeof chunk.code === "number" ? chunk.code : 1;
      pipeStatus = asPipeStatus(chunk.pipeStatus);
    }
  }

  setPipeStatus(pipeStatus, code);
  return { code, stdout, stderr, success: code === 0, pipeStatus };
}

async function captureAsyncIterable(
  iterable: AsyncIterable<unknown>,
  setPipeStatus: SetPipeStatus = noopSetPipeStatus,
): Promise<ShellResult> {
  let stdout = "";
  let itemCount = 0;
  try {
    for await (const line of iterable) {
      itemCount++;
      stdout += String(line) + "\n";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = message + (message.endsWith("\n") ? "" : "\n");
    setPipeStatus(undefined, 1);
    return { code: 1, stdout, stderr, success: false };
  }

  const code = itemCount === 0 ? emptyExitCode(iterable) ?? 0 : 0;
  setPipeStatus(undefined, code);
  return { code, stdout, stderr: "", success: code === 0 };
}

export async function captureShellValue(
  value: unknown,
  setPipeStatus: SetPipeStatus = noopSetPipeStatus,
): Promise<ShellResult> {
  if (isStreamCommand(value)) return await captureStreamCommand(value, setPipeStatus);
  if (isAsyncIterable(value)) return await captureAsyncIterable(value, setPipeStatus);

  const resolved = await Promise.resolve(value);

  if (isStreamCommand(resolved)) return await captureStreamCommand(resolved, setPipeStatus);
  if (isAsyncIterable(resolved)) return await captureAsyncIterable(resolved, setPipeStatus);

  if (typeof resolved === "boolean") {
    const code = resolved ? 0 : 1;
    setPipeStatus(undefined, code);
    return { code, stdout: "", stderr: "", success: code === 0 };
  }

  if (resolved === undefined || resolved === null) {
    setPipeStatus(undefined, 1);
    return { code: 1, stdout: "", stderr: "", success: false };
  }

  if (typeof resolved === "string") {
    const stdout = resolved ? resolved + "\n" : "";
    setPipeStatus(undefined, 0);
    return { code: 0, stdout, stderr: "", success: true };
  }

  if (Array.isArray(resolved)) {
    const stdout = resolved.length ? resolved.join("\n") + "\n" : "";
    setPipeStatus(undefined, 0);
    return { code: 0, stdout, stderr: "", success: true };
  }

  const record = asRecord(resolved);
  const code = resultCode(record, 0);
  const stdout = record ? stdoutOf(record) : "";
  const stderr = record ? stderrOf(record) : "";
  const pipeStatus = asPipeStatus(record?.pipeStatus);
  setPipeStatus(pipeStatus, code);
  return { code, stdout, stderr, success: code === 0, pipeStatus };
}

export async function printShellValue(
  value: unknown,
  setPipeStatus: SetPipeStatus = noopSetPipeStatus,
  io: ShellValueIo = {},
): Promise<number> {
  const output = writers(io);

  async function printStreamCommand(command: { stream(): AsyncIterable<StreamChunkLike> }) {
    let code = 1;
    let pipeStatus: number[] | undefined;
    for await (const chunk of command.stream()) {
      if (chunk.type === "stdout" && chunk.data) {
        await write(output.stdout, String(chunk.data));
      } else if (chunk.type === "stderr" && chunk.data) {
        await write(output.stderr, String(chunk.data));
      } else if (chunk.type === "exit") {
        code = typeof chunk.code === "number" ? chunk.code : 1;
        pipeStatus = asPipeStatus(chunk.pipeStatus);
      }
    }

    return setPipeStatus(pipeStatus, code);
  }

  async function printAsyncIterable(iterable: AsyncIterable<unknown>) {
    let itemCount = 0;
    try {
      for await (const line of iterable) {
        itemCount++;
        await write(output.stdout, String(line) + "\n");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await write(output.stderr, message + (message.endsWith("\n") ? "" : "\n"));
      return setPipeStatus(undefined, 1);
    }

    return setPipeStatus(undefined, itemCount === 0 ? emptyExitCode(iterable) ?? 0 : 0);
  }

  if (isStreamCommand(value)) return await printStreamCommand(value);
  if (isAsyncIterable(value)) return await printAsyncIterable(value);

  const resolved = await Promise.resolve(value);

  if (isStreamCommand(resolved)) return await printStreamCommand(resolved);
  if (isAsyncIterable(resolved)) return await printAsyncIterable(resolved);

  if (typeof resolved === "boolean") {
    return setPipeStatus(undefined, resolved ? 0 : 1);
  }

  if (resolved === undefined || resolved === null) {
    return setPipeStatus(undefined, 1);
  }

  const record = asRecord(resolved);
  if (record?.output) {
    await write(output.stdout, String(record.output));
  } else if (record) {
    await write(output.stdout, resultText(record.stdout));
    await write(output.stderr, resultText(record.stderr));
  }

  return setPipeStatus(record?.pipeStatus, resultCode(record, 1));
}

export async function commandSubstitutionText(value: unknown): Promise<string> {
  const resolved = await Promise.resolve(value);

  if (resolved === undefined || resolved === null) return "";
  if (Array.isArray(resolved)) return resolved.join("\n").replace(/\n+$/, "");
  if (hasFunction(resolved, "text")) {
    return String(await resolved.text()).replace(/\n+$/, "");
  }
  if (hasFunction(resolved, "collect")) {
    const collected = await resolved.collect();
    return Array.isArray(collected)
      ? collected.join("\n").replace(/\n+$/, "")
      : String(collected).replace(/\n+$/, "");
  }
  if (typeof resolved === "string") return resolved.replace(/\n+$/, "");

  const record = asRecord(resolved);
  if (typeof record?.output === "string") return record.output.replace(/\n+$/, "");
  if (typeof record?.stdout === "string") return record.stdout.replace(/\n+$/, "");

  return String(resolved);
}
