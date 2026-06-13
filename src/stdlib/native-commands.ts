/**
 * Native command registry (SSH-629)
 *
 * Maps command names to native TypeScript implementations that Command can
 * consult BEFORE spawning the real binary. Gated behind the `nativeCommands`
 * config flag (default false): when disabled, behavior is identical to today
 * (the real binary always runs).
 *
 * A registered NativeCommand decides for itself (`supports`) whether it can
 * faithfully handle a given argv. It must be CONSERVATIVE — returning false
 * for any flag/arg shape it does not fully implement — so Command falls back
 * to the real binary instead of producing wrong output.
 *
 * Only the buffered exec() path consults this registry. The streaming/.pipe()
 * path is unchanged and remains a documented follow-up.
 *
 * @module
 */

import { tr, type TrOptions } from "../commands/tr.ts";

/**
 * A native implementation of a shell command.
 */
export interface NativeCommand {
  /** Command name (e.g. "tr"). */
  name: string;

  /**
   * Whether this implementation can faithfully handle the given argv.
   * MUST be conservative: return false for anything unsupported so Command
   * falls back to spawning the real binary.
   */
  supports(argv: string[]): boolean;

  /**
   * Run the implementation against buffered stdin, returning buffered output.
   * Only called when supports(argv) returned true.
   */
  run(
    argv: string[],
    stdin: string,
  ): Promise<{ stdout: string; stderr?: string; code: number }>;
}

/** Registry of native command implementations, keyed by command name. */
export const NATIVE_CMDS = new Map<string, NativeCommand>();

/**
 * Look up a native implementation for a command name.
 */
export function getNativeCommand(name: string): NativeCommand | undefined {
  return NATIVE_CMDS.get(name);
}

// ============================================================================
// tr - first proof util (adapts src/commands/tr.ts)
// ============================================================================

/**
 * Parsed tr invocation, or null if the argv shape is unsupported.
 *
 * The underlying impl (src/commands/tr.ts) handles translate (SET1 SET2),
 * delete (-d), squeeze (-s), and complement (-c/-C). We only accept argv whose
 * flags are exactly within {d, s, c, C} and whose operand count matches the
 * selected mode. Anything else (GNU long options like --delete, -t, unknown
 * flags, wrong operand counts) → null, so Command falls back to real `tr`.
 */
function parseTrArgs(argv: string[]): TrOptions | null {
  let deleteMode = false;
  let squeeze = false;
  let complement = false;
  const operands: string[] = [];

  for (const arg of argv) {
    // A single "-" is not stdin for tr; treat as unsupported to be safe.
    if (arg.startsWith("-") && arg !== "-" && !arg.startsWith("--")) {
      // Short flag cluster, e.g. -d, -s, -ds, -cs
      const flags = arg.slice(1);
      for (const f of flags) {
        if (f === "d") deleteMode = true;
        else if (f === "s") squeeze = true;
        else if (f === "c" || f === "C") complement = true;
        else return null; // unsupported short flag
      }
    } else if (arg.startsWith("--") || arg === "-") {
      // Long options and bare "-" are not handled by the impl.
      return null;
    } else {
      operands.push(arg);
    }
  }

  // Operand-count rules mirror real tr's mode requirements:
  // - delete (without squeeze): exactly SET1
  // - delete + squeeze:         SET1 SET2
  // - squeeze only:             exactly SET1
  // - translate:                SET1 SET2
  if (deleteMode) {
    if (squeeze) {
      if (operands.length !== 2) return null;
      return {
        set1: operands[0]!,
        set2: operands[1]!,
        delete: true,
        squeeze: true,
        complement,
      };
    }
    if (operands.length !== 1) return null;
    return { set1: operands[0]!, delete: true, complement };
  }

  if (squeeze && operands.length === 1) {
    return { set1: operands[0]!, squeeze: true, complement };
  }

  // Translate (optionally with squeeze on SET2): requires both sets.
  if (operands.length === 2) {
    return {
      set1: operands[0]!,
      set2: operands[1]!,
      squeeze,
      complement,
    };
  }

  return null;
}

/**
 * Run the tr impl over buffered stdin and collect the full output.
 */
async function runTr(options: TrOptions, stdin: string): Promise<string> {
  // The impl is a per-chunk transform; feed the whole buffer as one chunk.
  async function* input(): AsyncIterable<string> {
    yield stdin;
  }
  let out = "";
  for await (const chunk of tr(input(), options)) {
    out += chunk;
  }
  return out;
}

const trNative: NativeCommand = {
  name: "tr",
  supports(argv: string[]): boolean {
    return parseTrArgs(argv) !== null;
  },
  async run(argv: string[], stdin: string) {
    const options = parseTrArgs(argv);
    if (options === null) {
      // Should not happen (Command only calls run after supports), but be safe.
      return { stdout: "", stderr: "tr: unsupported arguments\n", code: 1 };
    }
    const stdout = await runTr(options, stdin);
    return { stdout, code: 0 };
  },
};

NATIVE_CMDS.set(trNative.name, trNative);
