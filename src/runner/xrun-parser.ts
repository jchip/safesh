/**
 * xrun-style array syntax parser
 *
 * Parses task execution syntax like:
 * - '[a, b, c]' → parallel execution
 * - '[-s, a, b, c]' → serial execution
 * - '[a, [-s, b, c], d]' → nested (a and d parallel, b then c serial)
 */

import type { TaskConfig } from "../core/types.ts";

// ============================================================================
// Tokenizer
// ============================================================================

type Token =
  | { type: "bracket"; value: "[" | "]" }
  | { type: "comma" }
  | { type: "flag"; value: "-s" }
  | { type: "identifier"; value: string };

/**
 * Tokenize an xrun syntax string into tokens
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i];

    // Skip whitespace
    if (/\s/.test(char!)) {
      i++;
      continue;
    }

    // Brackets
    if (char === "[" || char === "]") {
      tokens.push({ type: "bracket", value: char });
      i++;
      continue;
    }

    // Comma
    if (char === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }

    // Flag or identifier
    if (char === "-" && input[i + 1] === "s") {
      tokens.push({ type: "flag", value: "-s" });
      i += 2;
      continue;
    }

    // Identifier (task name)
    if (/[a-zA-Z0-9_:-]/.test(char!)) {
      let value = "";
      while (i < input.length && /[a-zA-Z0-9_:-]/.test(input[i]!)) {
        value += input[i];
        i++;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }

    throw new Error(`Unexpected character '${char}' at position ${i}`);
  }

  return tokens;
}

// ============================================================================
// Parser
// ============================================================================

type XrunNode =
  | { type: "task"; name: string }
  | { type: "parallel"; tasks: XrunNode[] }
  | { type: "serial"; tasks: XrunNode[] };

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private expect(type: Token["type"], value?: string): Token {
    const token = this.current();
    if (!token || token.type !== type) {
      throw new Error(
        `Expected ${type}${value ? ` '${value}'` : ""}, got ${token?.type || "EOF"}`,
      );
    }
    if (value !== undefined && "value" in token && token.value !== value) {
      throw new Error(`Expected '${value}', got '${token.value}'`);
    }
    this.advance();
    return token;
  }

  /**
   * Parse the entire input
   */
  parse(): XrunNode {
    const node = this.parseNode();
    if (this.current()) {
      throw new Error(`Unexpected token after end: ${this.current()!.type}`);
    }
    return node;
  }

  /**
   * Parse a node (task name or array)
   */
  private parseNode(): XrunNode {
    const token = this.current();

    if (!token) {
      throw new Error("Unexpected end of input");
    }

    // Array: [...]
    if (token.type === "bracket" && token.value === "[") {
      return this.parseArray();
    }

    // Task name
    if (token.type === "identifier") {
      const name = token.value;
      this.advance();
      return { type: "task", name };
    }

    throw new Error(`Unexpected token: ${token.type}`);
  }

  /**
   * Parse an array: [items...] or [-s, items...]
   */
  private parseArray(): XrunNode {
    this.expect("bracket", "[");

    // Check for -s flag
    let isSerial = false;
    if (this.current()?.type === "flag") {
      const flag = this.current() as { type: "flag"; value: string };
      if (flag.value === "-s") {
        isSerial = true;
        this.advance();

        // Expect comma after flag
        if (this.current()?.type === "comma") {
          this.advance();
        }
      }
    }

    // Parse items
    const tasks: XrunNode[] = [];
    while (this.current() && !(this.current()?.type === "bracket" && (this.current() as { value: string }).value === "]")) {
      tasks.push(this.parseNode());

      // Optional comma
      if (this.current()?.type === "comma") {
        this.advance();
      }
    }

    this.expect("bracket", "]");

    // Validate that we have at least one task
    if (tasks.length === 0) {
      throw new Error("Array must contain at least one task");
    }

    return {
      type: isSerial ? "serial" : "parallel",
      tasks,
    };
  }
}

// ============================================================================
// Converter
// ============================================================================

/**
 * Convert XrunNode tree to TaskConfig
 */
function nodeToTaskConfig(node: XrunNode, taskName = "xrun"): TaskConfig {
  if (node.type === "task") {
    // Task reference - return as string for now, but we need to return TaskConfig
    // So we create a special marker that runTask will recognize
    throw new Error(
      `Internal: Cannot convert single task to TaskConfig. Use directly as string reference.`,
    );
  }

  if (node.type === "parallel") {
    return {
      parallel: node.tasks.map((t, i) =>
        t.type === "task" ? t.name : `${taskName}-p${i}`
      ),
    };
  }

  // node.type === "serial"
  return {
    serial: node.tasks.map((t, i) =>
      t.type === "task" ? t.name : `${taskName}-s${i}`
    ),
  };
}

/**
 * Generate task definitions for nested structures
 */
function generateTaskDefs(
  node: XrunNode,
  baseName = "xrun",
): Record<string, TaskConfig> {
  const tasks: Record<string, TaskConfig> = {};

  if (node.type === "task") {
    // No task def needed for simple task reference
    return tasks;
  }

  if (node.type === "parallel" || node.type === "serial") {
    // Generate task defs for nested arrays
    node.tasks.forEach((child, i) => {
      if (child.type !== "task") {
        const childName = `${baseName}-${node.type === "parallel" ? "p" : "s"}${i}`;
        tasks[childName] = nodeToTaskConfig(child, childName);
        // Recursively generate for deeper nesting
        Object.assign(tasks, generateTaskDefs(child, childName));
      }
    });
  }

  return tasks;
}

// ============================================================================
// Public API
// ============================================================================

export interface ParseResult {
  /** The main task configuration */
  mainTask: TaskConfig;
  /** Additional task definitions for nested structures */
  additionalTasks: Record<string, TaskConfig>;
}

/**
 * Parse xrun-style array syntax into task configuration
 *
 * @param input - xrun syntax string (e.g., "[a, b, c]" or "[-s, a, b, c]")
 * @returns Parsed task configuration
 *
 * @example
 * ```ts
 * // Parallel: [a, b, c]
 * parseXrun("[a, b, c]")
 * // → { mainTask: { parallel: ["a", "b", "c"] }, additionalTasks: {} }
 *
 * // Serial: [-s, a, b, c]
 * parseXrun("[-s, a, b, c]")
 * // → { mainTask: { serial: ["a", "b", "c"] }, additionalTasks: {} }
 *
 * // Nested: [a, [-s, b, c], d]
 * parseXrun("[a, [-s, b, c], d]")
 * // → {
 * //     mainTask: { parallel: ["a", "xrun-p1", "d"] },
 * //     additionalTasks: { "xrun-p1": { serial: ["b", "c"] } }
 * //   }
 * ```
 */
export function parseXrun(input: string): ParseResult {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const tree = parser.parse();

  const mainTask = nodeToTaskConfig(tree);
  const additionalTasks = generateTaskDefs(tree);

  return { mainTask, additionalTasks };
}

/**
 * Check if a string looks like xrun syntax
 */
export function isXrunSyntax(input: string): boolean {
  return input.trim().startsWith("[");
}
