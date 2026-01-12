/**
 * Output Emitter
 *
 * Builds the transpiled TypeScript output with proper formatting.
 */

import type { TranspilerContext } from "./context.ts";

// =============================================================================
// Import Tracking
// =============================================================================

interface ImportEntry {
  specifiers: Set<string>;
  defaultImport?: string;
}

// =============================================================================
// Output Emitter
// =============================================================================

export class OutputEmitter {
  private readonly ctx: TranspilerContext;
  private readonly lines: string[] = [];
  private readonly imports: Map<string, ImportEntry> = new Map();

  constructor(ctx: TranspilerContext) {
    this.ctx = ctx;
  }

  // ===========================================================================
  // Line Emission
  // ===========================================================================

  /** Emit a line with current indentation */
  emit(line: string): void {
    if (line === "") {
      this.lines.push("");
    } else {
      this.lines.push(this.ctx.getIndent() + line);
    }
  }

  /** Emit multiple lines with current indentation */
  emitLines(lines: string[]): void {
    for (const line of lines) {
      this.emit(line);
    }
  }

  /** Emit raw text without indentation */
  emitRaw(text: string): void {
    this.lines.push(text);
  }

  /** Emit a blank line */
  emitBlank(): void {
    this.lines.push("");
  }

  // ===========================================================================
  // Block Emission
  // ===========================================================================

  /** Emit opening brace and indent */
  emitBlockStart(prefix = ""): void {
    this.emit(prefix + "{");
    this.ctx.indent();
  }

  /** Dedent and emit closing brace */
  emitBlockEnd(suffix = ""): void {
    this.ctx.dedent();
    this.emit("}" + suffix);
  }

  /** Emit a complete block */
  emitBlock(prefix: string, bodyFn: () => void, suffix = ""): void {
    this.emitBlockStart(prefix);
    bodyFn();
    this.emitBlockEnd(suffix);
  }

  // ===========================================================================
  // Import Management
  // ===========================================================================

  /** Add a named import */
  addImport(module: string, specifiers: string | string[]): void {
    const specs = Array.isArray(specifiers) ? specifiers : [specifiers];
    let entry = this.imports.get(module);

    if (!entry) {
      entry = { specifiers: new Set() };
      this.imports.set(module, entry);
    }

    for (const spec of specs) {
      entry.specifiers.add(spec);
    }
  }

  /** Add a default import */
  addDefaultImport(module: string, name: string): void {
    let entry = this.imports.get(module);

    if (!entry) {
      entry = { specifiers: new Set() };
      this.imports.set(module, entry);
    }

    entry.defaultImport = name;
  }

  /** Generate import statements */
  private generateImports(): string[] {
    const result: string[] = [];

    for (const [module, entry] of this.imports) {
      const parts: string[] = [];

      if (entry.defaultImport) {
        parts.push(entry.defaultImport);
      }

      if (entry.specifiers.size > 0) {
        const specs = Array.from(entry.specifiers).sort().join(", ");
        parts.push(`{ ${specs} }`);
      }

      if (parts.length > 0) {
        result.push(`import ${parts.join(", ")} from "${module}";`);
      }
    }

    return result;
  }

  // ===========================================================================
  // Output Generation
  // ===========================================================================

  /** Get all emitted lines */
  getLines(): string[] {
    return [...this.lines];
  }

  /** Get final output string */
  toString(): string {
    const imports = this.generateImports();
    const output: string[] = [];

    // Add imports at the top
    if (imports.length > 0) {
      output.push(...imports);
      output.push("");
    }

    // Add content
    output.push(...this.lines);

    return output.join("\n");
  }

  /** Get current line count */
  lineCount(): number {
    return this.lines.length;
  }

  /** Clear all output */
  clear(): void {
    this.lines.length = 0;
    this.imports.clear();
  }
}
