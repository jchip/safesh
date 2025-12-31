/**
 * ShellJS-like types for safesh
 *
 * Provides ShellString and related types for shell command results.
 *
 * @module
 */

import * as fs from "../fs.ts";
import type { SandboxOptions } from "../fs.ts";

/**
 * ShellString - A string wrapper returned by shell commands
 *
 * Similar to shelljs's ShellString, this wraps command output
 * and provides stdout, stderr, code properties plus utility methods.
 */
export class ShellString extends String {
  /** Standard output from the command */
  readonly stdout: string;

  /** Standard error from the command */
  readonly stderr: string;

  /** Exit code (0 = success) */
  readonly code: number;

  /** Sandbox options for file operations */
  private readonly _options?: SandboxOptions;

  constructor(
    stdout: string,
    stderr: string = "",
    code: number = 0,
    options?: SandboxOptions,
  ) {
    super(stdout);
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
    this._options = options;
  }

  /**
   * Check if the command succeeded (code === 0)
   */
  get ok(): boolean {
    return this.code === 0;
  }

  /**
   * Check if the command failed (code !== 0)
   */
  get failed(): boolean {
    return this.code !== 0;
  }

  /**
   * Write stdout to file (like > redirect)
   *
   * @param file - Destination file path
   * @returns This ShellString for chaining
   *
   * @example
   * ```ts
   * cat("input.txt").to("output.txt");
   * ```
   */
  async to(file: string): Promise<ShellString> {
    await fs.write(file, this.stdout, this._options);
    return this;
  }

  /**
   * Append stdout to file (like >> redirect)
   *
   * @param file - Destination file path
   * @returns This ShellString for chaining
   *
   * @example
   * ```ts
   * cat("input.txt").toEnd("output.txt");
   * ```
   */
  async toEnd(file: string): Promise<ShellString> {
    await fs.append(file, this.stdout, this._options);
    return this;
  }

  /**
   * Get lines as array
   */
  lines(): string[] {
    return this.stdout.split("\n");
  }

  /**
   * Convert to string (returns stdout)
   */
  override toString(): string {
    return this.stdout;
  }

  /**
   * Convert to primitive value
   */
  override valueOf(): string {
    return this.stdout;
  }

  /**
   * Create a success result
   */
  static ok(stdout: string, options?: SandboxOptions): ShellString {
    return new ShellString(stdout, "", 0, options);
  }

  /**
   * Create an error result
   */
  static error(
    stderr: string,
    code: number = 1,
    options?: SandboxOptions,
  ): ShellString {
    return new ShellString("", stderr, code, options);
  }

  /**
   * Create from stdout and stderr
   */
  static from(
    stdout: string,
    stderr: string,
    code: number,
    options?: SandboxOptions,
  ): ShellString {
    return new ShellString(stdout, stderr, code, options);
  }
}


/**
 * Options map for parseOptions
 */
export type OptionsMap = Record<string, string>;

/**
 * Parsed options result
 */
export type ParsedOptions = Record<string, boolean | string | number>;
