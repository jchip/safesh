/**
 * command - POSIX special builtin (SSH-647)
 *
 * `command` is a shell builtin, never an executable on disk, so letting it fall
 * through to $.cmd("command", ...) always died with
 * `Command not found: "command"`. This implements the builtin natively.
 *
 * Forms:
 *   command -v NAME...   how NAME would be resolved (path, or the name itself
 *                        for a builtin); exit 0 only if every NAME resolved
 *   command -V NAME...   same lookup, human-readable phrasing
 *   command NAME [args]  run NAME, suppressing shell-function lookup
 *   command -p ...       resolve via the default PATH
 *
 * Spawning still goes through Command, so Deno's --allow-run sandbox governs
 * the exec form exactly as it governs a bare command.
 */

import { ShellString } from "./types.ts";
import { which } from "./which.ts";
import { cmd as spawnCmd } from "../command.ts";
import { SHELL_BUILTINS } from "../../bash/transpiler2/builtins.ts";

type LookupMode = "exec" | "v" | "V";

/**
 * Resolve one name the way `command -v` reports it.
 * Returns null when the name resolves to nothing.
 */
async function resolveName(name: string): Promise<string | null> {
  // A name the transpiler lowers itself is a builtin: bash prints it bare.
  if (Object.hasOwn(SHELL_BUILTINS, name)) return name;

  const hit = await which(name);
  if (!hit) return null;
  const path = String(hit).trim();
  return path.length > 0 ? path : null;
}

export async function command(...args: unknown[]): Promise<ShellString> {
  const argv = args.map((a) => String(a));

  let mode: LookupMode = "exec";
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      i++;
      break;
    }
    // -p asks for the default PATH; SafeShell resolves against one PATH, so
    // honoring it is a no-op rather than an error.
    if (arg === "-p") continue;
    if (arg === "-v") {
      mode = "v";
      continue;
    }
    if (arg === "-V") {
      mode = "V";
      continue;
    }
    break;
  }

  const rest = argv.slice(i);

  if (rest.length === 0) {
    // `command` with nothing to run is a no-op; `command -v` with no name
    // has nothing to report and fails, matching bash.
    return mode === "exec" ? ShellString.ok("") : ShellString.error("", 1);
  }

  if (mode === "exec") {
    const result = await spawnCmd(rest[0]!, ...rest.slice(1)).exec();
    return new ShellString(
      result.stdout ?? "",
      result.stderr ?? "",
      result.code ?? 0,
    );
  }

  const lines: string[] = [];
  const missing: string[] = [];

  for (const name of rest) {
    const resolved = await resolveName(name);
    if (resolved === null) {
      missing.push(name);
      // -v stays silent on a miss; -V explains it.
      if (mode === "V") lines.push(`${name}: not found`);
      continue;
    }
    if (mode === "V") {
      lines.push(
        resolved === name
          ? `${name} is a shell builtin`
          : `${name} is ${resolved}`,
      );
    } else {
      lines.push(resolved);
    }
  }

  const stdout = lines.length > 0 ? lines.join("\n") + "\n" : "";
  return new ShellString(stdout, "", missing.length > 0 ? 1 : 0);
}
