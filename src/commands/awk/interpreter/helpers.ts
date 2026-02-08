/**
 * AWK Type Conversion Helpers
 *
 * Pure functions for type conversion and truthiness checking.
 */

import type { AwkRuntimeContext } from "./context.ts";
import type { AwkValue } from "./types.ts";

/**
 * Check if a value is truthy in AWK.
 * Numbers are truthy if non-zero, strings if non-empty.
 */
export function isTruthy(val: AwkValue): boolean {
  if (typeof val === "number") {
    return val !== 0;
  }
  return val !== "";
}

/**
 * Convert an AWK value to a number.
 * Strings are parsed as floats, empty/non-numeric strings become 0.
 */
export function toNumber(val: AwkValue): number {
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Convert an AWK value to a string.
 */
export function toAwkString(val: AwkValue): string {
  if (typeof val === "string") return val;
  return String(val);
}

/**
 * Check if a value looks like a number for comparison purposes.
 */
export function looksLikeNumber(val: AwkValue): boolean {
  if (typeof val === "number") return true;
  const s = String(val).trim();
  if (s === "") return false;
  return !Number.isNaN(Number(s));
}

/**
 * Test if a string matches a regex pattern.
 * Uses a per-context cache for compiled RegExp objects when ctx is provided.
 */
export function matchRegex(
  pattern: string,
  text: string,
  ctx?: AwkRuntimeContext,
): boolean {
  try {
    const regex = ctx ? getCachedRegex(ctx, pattern) : new RegExp(pattern);
    return regex.test(text);
  } catch {
    return false;
  }
}

/**
 * Get a cached RegExp from the context cache, or compile and cache it.
 */
export function getCachedRegex(
  ctx: AwkRuntimeContext,
  pattern: string,
  flags?: string,
): RegExp {
  const cacheKey = flags ? pattern + "/" + flags : pattern;
  let regex = ctx.regexCache.get(cacheKey);
  if (!regex) {
    regex = new RegExp(pattern, flags);
    ctx.regexCache.set(cacheKey, regex);
  }
  return regex;
}
