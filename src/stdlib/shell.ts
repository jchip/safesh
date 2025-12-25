/**
 * Fluent shell API ($)
 *
 * Provides shell-like ergonomics with method chaining.
 *
 * @module
 */

// TODO: Implement after SSH-41

import * as fs from "./fs.ts";
import * as text from "./text.ts";

class Shell {
  private source: string | undefined;
  private content: string | undefined;

  constructor(source?: string) {
    this.source = source;
  }

  async read(): Promise<string> {
    if (!this.source) throw new Error("No source specified");
    this.content = await fs.read(this.source);
    return this.content;
  }

  grep(pattern: RegExp): Shell {
    // TODO: Implement lazy evaluation
    return this;
  }

  lines(): Shell {
    return this;
  }

  filter(_predicate: (line: string) => boolean): Shell {
    return this;
  }

  take(_n: number): Shell {
    return this;
  }

  async print(): Promise<void> {
    if (this.content) {
      console.log(this.content);
    } else if (this.source) {
      console.log(await this.read());
    }
  }

  async save(dest?: string): Promise<void> {
    const target = dest ?? this.source;
    if (!target) throw new Error("No destination specified");
    if (!this.content) throw new Error("No content to save");
    await fs.write(target, this.content);
  }
}

// Shell function factory
function $(source?: string): Shell {
  return new Shell(source);
}

// External command shortcuts (to be implemented)
$.git = async (..._args: string[]): Promise<void> => {
  // TODO: Implement via external command runner
  throw new Error("Not implemented");
};

$.docker = async (..._args: string[]): Promise<void> => {
  // TODO: Implement via external command runner
  throw new Error("Not implemented");
};

export default $;
