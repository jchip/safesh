/**
 * AWK Interpreter
 *
 * Main interpreter class that orchestrates AWK program execution.
 */

import type { AwkPattern, AwkProgram, AwkRule } from "../ast.ts";
import type { AwkRuntimeContext } from "./context.ts";
import { evalExpr } from "./expressions.ts";
import { setCurrentLine } from "./fields.ts";
import { isTruthy, matchRegex } from "./helpers.ts";
import { executeBlock } from "./statements.ts";

export class AwkInterpreter {
  private ctx: AwkRuntimeContext;
  private program: AwkProgram | null = null;
  private rangeStates: boolean[] = [];

  constructor(ctx: AwkRuntimeContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize the interpreter with a program.
   * Must be called before executeBegin/executeLine/executeEnd.
   */
  initialize(program: AwkProgram): void {
    this.program = program;
    this.ctx.output = "";

    // Register user-defined functions
    for (const func of program.functions) {
      this.ctx.functions.set(func.name, func);
    }

    // Initialize range states
    this.rangeStates = program.rules.map(() => false);
  }

  /**
   * Execute all BEGIN blocks.
   */
  async executeBegin(): Promise<void> {
    if (!this.program) return;

    for (const rule of this.program.rules) {
      if (rule.pattern?.type === "begin") {
        await executeBlock(this.ctx, rule.action.statements);
        if (this.ctx.shouldExit) break;
      }
    }
  }

  /**
   * Execute rules for a single input line.
   */
  async executeLine(line: string): Promise<void> {
    if (!this.program || this.ctx.shouldExit) return;

    // Update context with new line
    setCurrentLine(this.ctx, line);
    this.ctx.NR++;
    this.ctx.FNR++;
    this.ctx.shouldNext = false;

    for (let i = 0; i < this.program.rules.length; i++) {
      if (this.ctx.shouldExit || this.ctx.shouldNext || this.ctx.shouldNextFile)
        break;

      const rule = this.program.rules[i]!;

      // Skip BEGIN/END rules
      if (rule.pattern?.type === "begin" || rule.pattern?.type === "end") {
        continue;
      }

      if (await this.matchesRule(rule, i)) {
        await executeBlock(this.ctx, rule.action.statements);
      }
    }
  }

  /**
   * Execute all END blocks.
   */
  /**
   * Execute all END blocks.
   * Always runs END blocks if exit was called from a rule (not from END).
   * If exit is called from within an END block, skip remaining END blocks.
   */
  async executeEnd(): Promise<void> {
    if (!this.program) return;

    // If exit was set from a rule (not from END), clear it so END blocks run
    if (this.ctx.shouldExit && !this.ctx.exitFromEnd) {
      this.ctx.shouldExit = false;
    }

    for (const rule of this.program.rules) {
      if (this.ctx.shouldExit) break;

      if (rule.pattern?.type === "end") {
        await executeBlock(this.ctx, rule.action.statements);
        // If exit was called from within an END block, mark it
        if (this.ctx.shouldExit) {
          this.ctx.exitFromEnd = true;
        }
      }
    }
  }

  /**
   * Get the accumulated output.
   */
  getOutput(): string {
    return this.ctx.output;
  }

  /**
   * Get the exit code.
   */
  getExitCode(): number {
    return this.ctx.exitCode;
  }

  /**
   * Get the runtime context (for access to control flow flags, etc.)
   */
  getContext(): AwkRuntimeContext {
    return this.ctx;
  }

  /**
   * Check if a rule matches the current line.
   */
  private async matchesRule(
    rule: AwkRule,
    ruleIndex: number,
  ): Promise<boolean> {
    const pattern = rule.pattern;

    // No pattern - always matches
    if (!pattern) return true;

    switch (pattern.type) {
      case "begin":
      case "end":
        return false;

      case "regex_pattern":
        return matchRegex(pattern.pattern, this.ctx.line, this.ctx);

      case "expr_pattern":
        return isTruthy(await evalExpr(this.ctx, pattern.expression));

      case "range": {
        if (!this.rangeStates[ruleIndex]) {
          const startMatches = await this.matchPattern(pattern.start);
          if (startMatches) {
            this.rangeStates[ruleIndex] = true;
            return true; // match this line, don't check end yet
          }
          return false;
        } else {
          // In range - check if end pattern matches
          const endMatches = await this.matchPattern(pattern.end);
          if (endMatches) {
            this.rangeStates[ruleIndex] = false; // inclusive end
          }
          return true;
        }
      }

      default:
        return false;
    }
  }

  /**
   * Check if a pattern matches.
   */
  private async matchPattern(pattern: AwkPattern): Promise<boolean> {
    switch (pattern.type) {
      case "regex_pattern":
        return matchRegex(pattern.pattern, this.ctx.line, this.ctx);
      case "expr_pattern":
        return isTruthy(await evalExpr(this.ctx, pattern.expression));
      default:
        return false;
    }
  }
}
