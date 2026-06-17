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

export interface GrepCommandCapability extends BaseCommandCapability {
  kind: "grep";
  invertShortFlags: readonly string[];
  ignoreCaseShortFlags: readonly string[];
  lineNumberShortFlags: readonly string[];
  recursiveShortFlags: readonly string[];
}

export interface SourceCommandCapability extends BaseCommandCapability {
  kind: "source";
  runtimeName: "cat";
}

export type FluentCommandCapability =
  | CountTransformCapability
  | GrepCommandCapability
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
  grep: {
    kind: "grep",
    name: "grep",
    inputMode: "line",
    outputMode: "transform",
    fileOperands: true,
    invertShortFlags: ["v"],
    ignoreCaseShortFlags: ["i"],
    lineNumberShortFlags: ["n"],
    recursiveShortFlags: ["r", "R"],
    // SSH-646: `q` joins the delegate-to-real-grep set. Fluent grep is a
    // passthrough filter, so it can't honor `-q` (quiet): the match would leak
    // to stdout in print positions even though the exit code is right.
    unsupportedShortFlags: ["A", "B", "C", "c", "m", "q"],
  },
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

export function getGrepCommandCapability(): GrepCommandCapability {
  return FLUENT_COMMAND_CAPABILITIES.grep;
}

export function getSimpleTransformCapability(name: string): SimpleTransformCapability | undefined {
  const capability = getFluentCommandCapability(name);
  return capability?.kind === "count-transform" || capability?.kind === "option-transform"
    ? capability
    : undefined;
}
