export type CommandDataMode = "none" | "raw" | "line";
export type CommandOutputMode = "raw-stream" | "line-stream" | "transform" | "result";

interface BaseCommandCapability {
  name: string;
  inputMode: CommandDataMode;
  outputMode: CommandOutputMode;
  fileOperands: boolean;
  requiresRawInput?: boolean;
  unsupportedShortFlags?: readonly string[];
}

export interface CountTransformCapability extends BaseCommandCapability {
  kind: "count-transform";
  runtimeName: "head" | "tail";
}

export interface OptionTransformCapability extends BaseCommandCapability {
  kind: "option-transform";
  runtimeName: "sort" | "uniq" | "wc";
  flagOptions: Record<string, string>;
}

export interface SourceCommandCapability extends BaseCommandCapability {
  kind: "source";
  runtimeName: "cat";
}

export type FluentCommandCapability =
  | CountTransformCapability
  | OptionTransformCapability
  | SourceCommandCapability;

export type SimpleTransformCapability = CountTransformCapability | OptionTransformCapability;

export const FLUENT_COMMAND_CAPABILITIES = {
  cat: {
    kind: "source",
    name: "cat",
    runtimeName: "cat",
    inputMode: "none",
    outputMode: "raw-stream",
    fileOperands: true,
  },
  // SSH-675: `grep` is deliberately absent. Every bash `grep` lowers to the real
  // binary (a standard command) instead of a fluent filter — real grep has the
  // full BRE/ERE dialect, every flag, native exit codes, and is faster on large
  // inputs. Its stdout still feeds internal transforms through the usual
  // `.stdout().lines().pipe(...)` plumbing. `$.grep`/`$.grepFiles` remain
  // available to hand-written TypeScript; only the bash path stopped using them.
  head: {
    kind: "count-transform",
    name: "head",
    runtimeName: "head",
    inputMode: "line",
    outputMode: "transform",
    fileOperands: true,
    unsupportedShortFlags: ["c"],
  },
  tail: {
    kind: "count-transform",
    name: "tail",
    runtimeName: "tail",
    inputMode: "line",
    outputMode: "transform",
    fileOperands: true,
    unsupportedShortFlags: ["c"],
  },
  sort: {
    kind: "option-transform",
    name: "sort",
    runtimeName: "sort",
    inputMode: "line",
    outputMode: "transform",
    fileOperands: true,
    flagOptions: {
      "-n": "numeric: true",
      "-r": "reverse: true",
      "-u": "unique: true",
    },
  },
  uniq: {
    kind: "option-transform",
    name: "uniq",
    runtimeName: "uniq",
    inputMode: "line",
    outputMode: "transform",
    fileOperands: true,
    flagOptions: {
      "-c": "count: true",
      "-i": "ignoreCase: true",
    },
  },
  wc: {
    kind: "option-transform",
    name: "wc",
    runtimeName: "wc",
    inputMode: "raw",
    outputMode: "transform",
    fileOperands: true,
    flagOptions: {
      "-l": "lines: true",
      "-w": "words: true",
      "-c": "bytes: true",
      "-m": "chars: true",
    },
    requiresRawInput: true,
  },
} as const satisfies Record<string, FluentCommandCapability>;

export const FLUENT_COMMAND_NAMES = new Set(Object.keys(FLUENT_COMMAND_CAPABILITIES));

export function getFluentCommandCapability(name: string): FluentCommandCapability | undefined {
  return FLUENT_COMMAND_CAPABILITIES[name as keyof typeof FLUENT_COMMAND_CAPABILITIES];
}

export function getSimpleTransformCapability(name: string): SimpleTransformCapability | undefined {
  const capability = getFluentCommandCapability(name);
  return capability?.kind === "count-transform" || capability?.kind === "option-transform"
    ? capability
    : undefined;
}
