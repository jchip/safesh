/**
 * Text Processing Commands
 *
 * Provides Unix-like text processing utilities for stream pipelines:
 * - cut: Extract sections from each line
 * - tr: Translate or delete characters
 * - sort: Sort lines of text
 * - uniq: Report or filter out repeated lines
 * - head: Output first part of input
 * - tail: Output last part of input
 * - wc: Word, line, and character count
 * - nl: Number lines of input
 *
 * All commands work with AsyncIterable<string> and return AsyncIterable<string>.
 * Each provides both a function version and a transform version for pipelines.
 *
 * @module
 */

// cut - field/character extraction
export { cut, cutTransform, type CutOptions } from "./cut.ts";
export { default as cutDefault } from "./cut.ts";

// tr - character translation
export { tr, trTransform, type TrOptions } from "./tr.ts";
export { default as trDefault } from "./tr.ts";

// sort - line sorting
export {
  sort,
  sortTransform,
  parseKeySpec,
  type SortOptions,
  type SortKeySpec,
} from "./sort.ts";
export { default as sortDefault } from "./sort.ts";

// uniq - unique/duplicate filtering
export { uniq, uniqTransform, type UniqOptions } from "./uniq.ts";
export { default as uniqDefault } from "./uniq.ts";

// head - output first part
export {
  head,
  headTransform,
  headLines,
  headLinesNegative,
  headBytes,
  headBytesNegative,
  headBytes_,
  headWithOptions,
  type HeadOptions,
} from "./head.ts";
export { default as headDefault } from "./head.ts";

// tail - output last part
export {
  tail,
  tailTransform,
  tailLines,
  tailFromLine,
  tailBytes,
  tailFromByte,
  tailFrom,
  tailBytes_,
  tailWithOptions,
  type TailOptions,
} from "./tail.ts";
export { default as tailDefault } from "./tail.ts";

// wc - word/line/character count
export {
  wc,
  wcTransform,
  wcCount,
  wcLines,
  wcWords,
  wcBytes,
  wcChars,
  wcL,
  wcW,
  wcC,
  wcM,
  formatWcStats,
  wcWithOptions,
  type WcOptions,
  type WcStats,
} from "./wc.ts";
export { default as wcDefault } from "./wc.ts";

// nl - number lines
export {
  nl,
  nlTransform,
  nlLines,
  nlSimple,
  nlAll,
  nlNonEmpty,
  nlWithOptions,
  type NlOptions,
  type NumberingStyle,
  type NumberFormat,
} from "./nl.ts";
export { default as nlDefault } from "./nl.ts";

// grep - pattern matching
export {
  grep,
  grepTransform,
  grepLines,
  formatGrepMatch,
  grepFormat,
  grepStream,
  type GrepOptions,
  type GrepMatch,
} from "./grep.ts";

// sed - stream editor
export {
  sed,
  sedExec,
  type SedOptions,
  type SedResult,
} from "./sed/sed.ts";

// awk - text processing language
export {
  awk,
  awkExec,
  awkTransform,
  type AwkOptions,
  type AwkResult,
} from "./awk/awk.ts";

// jq - JSON query processor
export {
  jq,
  jqExec,
  jqTransform,
  jqLines,
  type JqOptions,
  type JqResult,
} from "./jq/jq.ts";
