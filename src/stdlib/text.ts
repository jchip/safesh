/**
 * Text processing utilities
 *
 * @module
 */

// TODO: Implement after SSH-21

export interface GrepMatch {
  path?: string;
  line: number;
  content: string;
  match: string;
}

export async function grep(
  pattern: RegExp,
  input: string | AsyncIterable<string>,
): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = [];

  if (typeof input === "string") {
    const lines = input.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(pattern);
      if (match) {
        matches.push({
          line: i + 1,
          content: line,
          match: match[0],
        });
      }
    }
  } else {
    let lineNum = 0;
    for await (const line of input) {
      lineNum++;
      const match = line.match(pattern);
      if (match) {
        matches.push({
          line: lineNum,
          content: line,
          match: match[0],
        });
      }
    }
  }

  return matches;
}

export function head(input: string, n: number = 10): string[] {
  return input.split("\n").slice(0, n);
}

export function tail(input: string, n: number = 10): string[] {
  const lines = input.split("\n");
  return lines.slice(Math.max(0, lines.length - n));
}

export function replace(
  input: string,
  pattern: RegExp | string,
  replacement: string,
): string {
  return input.replace(pattern, replacement);
}

export function lines(input: string): string[] {
  return input.split("\n");
}

export function count(input: string): { lines: number; words: number; chars: number } {
  const lineCount = input.split("\n").length;
  const wordCount = input.split(/\s+/).filter((w) => w.length > 0).length;
  const charCount = input.length;
  return { lines: lineCount, words: wordCount, chars: charCount };
}
