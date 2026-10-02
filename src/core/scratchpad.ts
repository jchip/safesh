/**
 * Claude Code session scratchpad detection.
 *
 * Claude Code gives each session a private scratch dir at
 * `/private/tmp/claude-<uid>/<project>/<session-id>/scratchpad`. Scripts the
 * agent writes there are trusted for that session only.
 *
 * @module
 */

import { isAbsolute, normalize } from "@std/path";

/** Session ids are UUID-like; anything else could smuggle path or regex syntax. */
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Our uid. `Deno.uid()` needs --allow-sys, which the hook doesn't have, so
 * fall back to the owner of $HOME.
 */
function currentUid(): number | null {
  try {
    return Deno.uid();
  } catch {
    // fall through
  }
  const home = Deno.env.get("HOME");
  try {
    return home ? Deno.statSync(home).uid : null;
  } catch {
    return null;
  }
}

/** Fold the macOS `/private/tmp` spelling onto `/tmp`. */
function foldTmp(path: string): string {
  return path.startsWith("/private/tmp/") ? path.slice("/private".length) : path;
}

/** Lexical check: `path` sits below this session's scratchpad dir. */
export function isUnderSessionScratchpad(
  path: string,
  sessionId: string | undefined,
  uid: number | null = currentUid(),
): boolean {
  if (!sessionId || !SESSION_ID.test(sessionId) || uid === null || !isAbsolute(path)) {
    return false;
  }
  const pattern = new RegExp(`^/tmp/claude-${uid}/[^/]+/${sessionId}/scratchpad/[^/]`);
  return pattern.test(foldTmp(normalize(path)));
}

/**
 * Whether `path` is an existing file in this session's scratchpad. The real
 * path must stay inside it too, and the `claude-<uid>` dir must belong to us,
 * so a symlink or another user's pre-made dir can't widen the trust.
 */
export async function isSessionScratchpadScript(
  path: string,
  sessionId: string | undefined,
  uid: number | null = currentUid(),
): Promise<boolean> {
  if (!isUnderSessionScratchpad(path, sessionId, uid)) return false;
  try {
    const real = await Deno.realPath(path);
    if (!isUnderSessionScratchpad(real, sessionId, uid)) return false;
    if (!(await Deno.stat(real)).isFile) return false;
    const owner = await Deno.stat(`/tmp/claude-${uid}`);
    return owner.uid === uid;
  } catch {
    return false;
  }
}
