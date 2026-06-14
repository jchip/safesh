/**
 * TypeScript/Hybrid Command Detection Module
 *
 * Provides functions to detect SafeShell TypeScript code and hybrid
 * bash | TypeScript commands. Extracted from bash-prehook.ts for testability.
 *
 * SSH-480: This module exists to enable unit testing of detection logic.
 */

/**
 * SafeShell TypeScript signature prefix
 * Agent must prefix code with this to indicate it's SafeShell TypeScript
 */
export const SAFESH_SIGNATURE = "/*#*/";

/**
 * Result of hybrid command detection
 */
export interface HybridCommandResult {
  bashPart: string;
  tsPart: string;
}

/**
 * Detect if command is hybrid bash | TypeScript
 * Returns {bashPart, tsPart} if detected, null otherwise
 *
 * Example: "echo test | /*#*\/ const data = await $.text.lines(Deno.stdin); etc"
 * Returns: {bashPart: "echo test", tsPart: "const data = await $.text.lines(Deno.stdin); etc"}
 *
 * @param command - The command string to check
 * @returns Parsed hybrid command or null if not a hybrid command
 */
export function detectHybridCommand(command: string): HybridCommandResult | null {
  const pipeSignature = `| ${SAFESH_SIGNATURE}`;
  const index = command.indexOf(pipeSignature);

  if (index === -1) {
    return null;
  }

  const bashPart = command.slice(0, index).trim();
  const tsPart = command.slice(index + pipeSignature.length).trim();

  if (!bashPart || !tsPart) {
    return null;
  }

  return { bashPart, tsPart };
}

/**
 * Detect if the command is SafeShell TypeScript
 * Returns the TypeScript code if detected, null otherwise
 *
 * Detection methods:
 * 1. Signature prefix: /*#*\/ followed by TypeScript code
 * 2. .ts file path: path/to/script.ts (reads and returns file contents)
 *
 * @param command - The command string to check
 * @param readFile - Optional function to read file contents (for testing)
 * @returns TypeScript code or null if not detected
 */
export function detectTypeScript(
  command: string,
  readFile?: (path: string) => string | null,
): string | null {
  const trimmed = command.trim();

  // Check for SafeShell signature prefix: /*#*/
  if (trimmed.startsWith(SAFESH_SIGNATURE)) {
    const code = trimmed.slice(SAFESH_SIGNATURE.length).trim();
    if (!code) {
      // No-op TypeScript for empty code
      return "// empty";
    }
    return code;
  }

  // Check if it's a .ts file path (execute the file)
  if (trimmed.endsWith(".ts") && !trimmed.includes(" ")) {
    // Single .ts file path - read and return its contents
    if (readFile) {
      return readFile(trimmed);
    }
    // Default: try to read from filesystem
    try {
      const code = Deno.readTextFileSync(trimmed);
      return code;
    } catch {
      // File doesn't exist or can't be read, fall through to transpilation
      return null;
    }
  }

  return null;
}

/**
 * SSH-640: Detect a misplaced SafeShell signature.
 *
 * The `/*#*\/` signature is only recognized as a whole-command prefix
 * (see {@link detectTypeScript}) or as a `| /*#*\/` hybrid pipe
 * (see {@link detectHybridCommand}). When it appears anywhere else — most
 * commonly embedded inside a command substitution like `x=$(/*#*\/ ...)` — the
 * command is parsed as bash and fails with a cryptic parser error
 * (e.g. "Expected command name in subshell").
 *
 * Returns an actionable hint when `command` contains a misplaced signature, or
 * null otherwise. This is meant to enrich an already-failing command's error
 * message, so a stray signature inside a quoted string is harmless: such a
 * command parses fine and never reaches the error path.
 *
 * @param command - The original command string
 * @returns Hint string for a misplaced signature, or null
 */
export function detectMisplacedSignature(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed.includes(SAFESH_SIGNATURE)) return null;
  if (trimmed.startsWith(SAFESH_SIGNATURE)) return null; // valid whole-command prefix
  if (detectHybridCommand(command) !== null) return null; // valid `| /*#*/` hybrid

  return (
    `A '${SAFESH_SIGNATURE}' SafeShell signature is embedded inside the command ` +
    `(for example within a $(...) substitution). The signature must be the FIRST ` +
    `characters of the entire command — it cannot be nested in a substitution or ` +
    `placed mid-command. To compute a value with TypeScript, run it as its own ` +
    `'${SAFESH_SIGNATURE} ...' command, or use a bash builtin instead.`
  );
}
