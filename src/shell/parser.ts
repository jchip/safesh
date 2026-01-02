/**
 * Shell Command Parser for SafeShell
 *
 * Parses basic shell commands and converts them to TypeScript for execution.
 *
 * Supported syntax:
 * - Command sequences: && (AND), || (OR), ; (sequential)
 * - Pipes: cmd1 | cmd2 | cmd3
 * - Stderr redirect: 2>&1
 * - Output redirect: > file, >> file
 * - Background: &
 * - Quoted strings: 'single' and "double"
 * - Environment variables: $VAR, ${VAR}
 *
 * NOT supported:
 * - Bash programming: for, while, if, case, etc.
 * - Subshells: $(...)
 * - Here-docs: <<EOF
 * - Input redirect: < file
 */

// ============================================================================
// Token Types
// ============================================================================

export type TokenType =
  | "WORD"           // command or argument
  | "PIPE"           // |
  | "AND"            // &&
  | "OR"             // ||
  | "SEMI"           // ;
  | "BACKGROUND"     // &
  | "REDIRECT_OUT"   // >
  | "REDIRECT_APPEND"// >>
  | "STDERR_MERGE"   // 2>&1
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

// ============================================================================
// AST Node Types
// ============================================================================

export interface SimpleCommand {
  type: "simple";
  command: string;
  args: string[];
  redirects: Redirect[];
  stderrMerge: boolean;
  /** Inline env vars: VAR=value before command */
  envVars: Record<string, string>;
}

export interface PipelineCommand {
  type: "pipeline";
  commands: SimpleCommand[];
}

export interface SequenceCommand {
  type: "sequence";
  left: Command;
  operator: "&&" | "||" | ";";
  right: Command;
}

export interface BackgroundCommand {
  type: "background";
  command: Command;
}

export interface Redirect {
  type: ">" | ">>";
  target: string;
}

export type Command = SimpleCommand | PipelineCommand | SequenceCommand | BackgroundCommand;

// ============================================================================
// Tokenizer
// ============================================================================

export class ShellTokenizer {
  private input: string;
  private position: number = 0;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.position < this.input.length) {
      this.skipWhitespace();
      if (this.position >= this.input.length) break;

      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    tokens.push({ type: "EOF", value: "", position: this.position });
    return tokens;
  }

  private skipWhitespace(): void {
    while (this.position < this.input.length && /[ \t\r]/.test(this.input[this.position]!)) {
      this.position++;
    }
  }

  private nextToken(): Token | null {
    const start = this.position;
    const char = this.input[this.position];
    const next = this.input[this.position + 1];

    // Check for operators (multi-char first)
    if (char === ">" && next === ">") {
      this.position += 2;
      return { type: "REDIRECT_APPEND", value: ">>", position: start };
    }
    if (char === "&" && next === "&") {
      this.position += 2;
      return { type: "AND", value: "&&", position: start };
    }
    if (char === "|" && next === "|") {
      this.position += 2;
      return { type: "OR", value: "||", position: start };
    }
    if (char === "2" && next === ">" && this.input[this.position + 2] === "&" && this.input[this.position + 3] === "1") {
      this.position += 4;
      return { type: "STDERR_MERGE", value: "2>&1", position: start };
    }

    // Single-char operators
    if (char === "|") {
      this.position++;
      return { type: "PIPE", value: "|", position: start };
    }
    if (char === "&") {
      this.position++;
      return { type: "BACKGROUND", value: "&", position: start };
    }
    if (char === ">") {
      this.position++;
      return { type: "REDIRECT_OUT", value: ">", position: start };
    }
    if (char === ";" || char === "\n") {
      this.position++;
      return { type: "SEMI", value: ";", position: start };
    }

    // Word (command or argument)
    return this.readWord(start);
  }

  private readWord(start: number): Token {
    let value = "";

    while (this.position < this.input.length) {
      const char = this.input[this.position];

      // Check for operators
      if (/[|&;><]/.test(char!)) {
        // Check for 2>&1 special case
        if (value === "2" && char === ">" && this.input[this.position + 1] === "&") {
          // Don't consume "2", let it be part of the 2>&1 token
          value = value.slice(0, -1);
          this.position--;
          break;
        }
        break;
      }

      // Whitespace ends word
      if (/\s/.test(char!)) {
        break;
      }

      // Handle quotes
      if (char === '"' || char === "'") {
        value += this.readQuoted(char);
        continue;
      }

      // Handle escape
      if (char === "\\") {
        this.position++;
        if (this.position < this.input.length) {
          value += this.input[this.position];
          this.position++;
        }
        continue;
      }

      value += char;
      this.position++;
    }

    return { type: "WORD", value, position: start };
  }

  private readQuoted(quote: string): string {
    this.position++; // skip opening quote
    let value = "";

    while (this.position < this.input.length) {
      const char = this.input[this.position];

      if (char === quote) {
        this.position++; // skip closing quote
        break;
      }

      // Handle escape in double quotes
      if (quote === '"' && char === "\\") {
        this.position++;
        if (this.position < this.input.length) {
          const escaped = this.input[this.position];
          // Only escape certain chars in double quotes
          if (["\\", '"', "$", "`", "\n"].includes(escaped!)) {
            value += escaped;
          } else {
            value += "\\" + escaped;
          }
          this.position++;
          continue;
        }
      }

      value += char;
      this.position++;
    }

    return value;
  }
}

// ============================================================================
// Parser
// ============================================================================

export class ShellParser {
  private tokens: Token[];
  private position: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Command {
    const command = this.parseSequence();
    return command;
  }

  private current(): Token {
    return this.tokens[this.position] ?? { type: "EOF", value: "", position: -1 };
  }

  private advance(): Token {
    const token = this.current();
    this.position++;
    return token;
  }

  private parseSequence(): Command {
    let left = this.parsePipelineOrBackground();

    while (["AND", "OR", "SEMI"].includes(this.current().type)) {
      const op = this.advance();
      const right = this.parsePipelineOrBackground();
      left = {
        type: "sequence",
        left,
        operator: op.value as "&&" | "||" | ";",
        right,
      };
    }

    return left;
  }

  private parsePipelineOrBackground(): Command {
    let command = this.parsePipeline();

    // Check for background operator
    if (this.current().type === "BACKGROUND") {
      this.advance();
      command = { type: "background", command };
    }

    return command;
  }

  private parsePipeline(): Command {
    const commands: SimpleCommand[] = [this.parseSimple()];

    while (this.current().type === "PIPE") {
      this.advance();
      commands.push(this.parseSimple());
    }

    if (commands.length === 1) {
      return commands[0]!;
    }

    return { type: "pipeline", commands };
  }

  private parseSimple(): SimpleCommand {
    const words: string[] = [];
    const redirects: Redirect[] = [];
    const envVars: Record<string, string> = {};
    let stderrMerge = false;
    let foundCommand = false;

    while (true) {
      const token = this.current();

      if (token.type === "WORD") {
        // Check for VAR=value pattern before command is found
        if (!foundCommand) {
          const eqIdx = token.value.indexOf("=");
          if (eqIdx > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token.value.slice(0, eqIdx))) {
            envVars[token.value.slice(0, eqIdx)] = token.value.slice(eqIdx + 1);
            this.advance();
            continue;
          }
          foundCommand = true;
        }
        words.push(token.value);
        this.advance();
      } else if (token.type === "REDIRECT_OUT" || token.type === "REDIRECT_APPEND") {
        const type = token.value as ">" | ">>";
        this.advance();
        const target = this.current();
        if (target.type !== "WORD") {
          throw new Error(`Expected filename after ${type}`);
        }
        redirects.push({ type, target: target.value });
        this.advance();
      } else if (token.type === "STDERR_MERGE") {
        stderrMerge = true;
        this.advance();
      } else {
        break;
      }
    }

    if (words.length === 0) {
      throw new Error("Expected command");
    }

    return {
      type: "simple",
      command: words[0]!,
      args: words.slice(1),
      redirects,
      stderrMerge,
      envVars,
    };
  }
}

// ============================================================================
// Code Generator
// ============================================================================

export class TypeScriptGenerator {
  private varCounter = 0;

  generate(command: Command): string {
    const lines: string[] = [];

    // Collect all external commands and pre-check with initCmds
    const commands = this.collectCommands(command);
    if (commands.length > 0) {
      const cmdsStr = commands.map(c => `'${this.escapeString(c)}'`).join(", ");
      lines.push(`await $.initCmds([${cmdsStr}]);`);
    }

    const resultVar = this.generateCommand(command, lines);

    // Print output and return the final result
    if (resultVar && resultVar !== "null") {
      // Handle merged output (2>&1) vs separate stdout/stderr
      lines.push(`if (${resultVar}?.output) console.log(${resultVar}.output);`);
      lines.push(`else if (${resultVar}?.stdout) console.log(${resultVar}.stdout);`);
      lines.push(`if (${resultVar}?.stderr) console.error(${resultVar}.stderr);`);
      lines.push(`return ${resultVar};`);
    }

    return lines.join("\n");
  }

  /**
   * Collect all external command names from AST (excludes builtins like cd, pwd)
   */
  private collectCommands(command: Command): string[] {
    const commands = new Set<string>();
    this.collectCommandsRecursive(command, commands);
    return Array.from(commands);
  }

  /** Builtins that don't need permission checks */
  private static readonly BUILTINS = new Set([
    "cd", "pwd", "pushd", "popd", "dirs",
    "echo", "test", "[", "true", "false", "export",
    "ls", "mkdir", "rm", "cp", "mv", "touch", "chmod", "ln", "which",
  ]);

  private collectCommandsRecursive(command: Command, commands: Set<string>): void {
    switch (command.type) {
      case "simple":
        if (!TypeScriptGenerator.BUILTINS.has(command.command)) {
          commands.add(command.command);
        }
        break;
      case "pipeline":
        for (const cmd of command.commands) {
          if (!TypeScriptGenerator.BUILTINS.has(cmd.command)) {
            commands.add(cmd.command);
          }
        }
        break;
      case "sequence":
        this.collectCommandsRecursive(command.left, commands);
        this.collectCommandsRecursive(command.right, commands);
        break;
      case "background":
        this.collectCommandsRecursive(command.command, commands);
        break;
    }
  }

  private nextVar(): string {
    return `_r${this.varCounter++}`;
  }

  private generateCommand(command: Command, lines: string[]): string | null {
    switch (command.type) {
      case "simple":
        return this.generateSimple(command, lines);
      case "pipeline":
        return this.generatePipeline(command, lines);
      case "sequence":
        return this.generateSequence(command, lines);
      case "background":
        return this.generateBackground(command, lines);
    }
  }

  private escapeString(s: string): string {
    return s
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  private generateSimple(cmd: SimpleCommand, lines: string[]): string {
    const resultVar = this.nextVar();
    const argsStr = cmd.args.map(a => `'${this.escapeString(a)}'`).join(", ");

    // Handle builtins
    switch (cmd.command) {
      // Directory operations
      case "cd": {
        const dir = cmd.args[0] ?? "~";
        lines.push(`await $.cd('${this.escapeString(dir)}');`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      }
      case "pwd":
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String($.pwd()).trim(), stderr: '' };`);
        return resultVar;
      case "pushd": {
        const dir = cmd.args[0] ?? "";
        lines.push(`const _pd = $.pushd('${this.escapeString(dir)}');`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String(_pd).trim(), stderr: '' };`);
        return resultVar;
      }
      case "popd":
        lines.push(`const _pd = $.popd();`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String(_pd).trim(), stderr: '' };`);
        return resultVar;
      case "dirs":
        lines.push(`const _ds = $.dirs();`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: _ds.join('\\n'), stderr: '' };`);
        return resultVar;

      // Output
      case "echo":
        lines.push(`const _echo = $.echo(${argsStr || "''"});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String(_echo).trim(), stderr: '' };`);
        return resultVar;

      // Tests
      case "true":
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "false":
        lines.push(`const ${resultVar} = { code: 1, success: false, stdout: '', stderr: '' };`);
        return resultVar;
      case "test":
      case "[":
        lines.push(`const _test = $.test(${argsStr});`);
        lines.push(`const ${resultVar} = { code: _test ? 0 : 1, success: _test, stdout: '', stderr: '' };`);
        return resultVar;

      // File listing
      case "ls":
        lines.push(`const _ls = $.ls(${argsStr || "'.'"});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: Array.isArray(_ls) ? _ls.join('\\n') : String(_ls), stderr: '' };`);
        return resultVar;

      // File operations
      case "mkdir":
        lines.push(`await $.mkdir(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "rm":
        lines.push(`await $.rm(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "cp":
        lines.push(`await $.cp(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "mv":
        lines.push(`await $.mv(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "touch":
        lines.push(`await $.touch(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "chmod":
        lines.push(`await $.chmod(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "ln":
        lines.push(`await $.ln(${argsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "which":
        lines.push(`const _which = await $.which(${argsStr});`);
        lines.push(`const ${resultVar} = { code: _which ? 0 : 1, success: !!_which, stdout: _which || '', stderr: '' };`);
        return resultVar;

      case "export":
        // Handle export VAR=value
        for (const arg of cmd.args) {
          const eqIdx = arg.indexOf("=");
          if (eqIdx > 0) {
            const varName = arg.slice(0, eqIdx);
            const varValue = arg.slice(eqIdx + 1);
            lines.push(`$.ENV['${this.escapeString(varName)}'] = '${this.escapeString(varValue)}';`);
            lines.push(`Deno.env.set('${this.escapeString(varName)}', '${this.escapeString(varValue)}');`);
          }
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
    }

    // External command - use $.cmd()
    const cmdStr = `'${this.escapeString(cmd.command)}'`;

    // Build options if needed
    const options: string[] = [];
    if (cmd.stderrMerge) {
      options.push("mergeStreams: true");
    }
    if (Object.keys(cmd.envVars).length > 0) {
      const envEntries = Object.entries(cmd.envVars)
        .map(([k, v]) => `'${this.escapeString(k)}': '${this.escapeString(v)}'`)
        .join(", ");
      options.push(`env: { ${envEntries} }`);
    }

    let expr: string;
    if (argsStr && options.length > 0) {
      expr = `$.cmd(${cmdStr}, [${argsStr}], { ${options.join(", ")} })`;
    } else if (argsStr) {
      expr = `$.cmd(${cmdStr}, [${argsStr}])`;
    } else if (options.length > 0) {
      expr = `$.cmd(${cmdStr}, [], { ${options.join(", ")} })`;
    } else {
      expr = `$.cmd(${cmdStr})`;
    }

    lines.push(`const ${resultVar} = await ${expr};`);

    // Handle file redirects
    for (const redirect of cmd.redirects) {
      if (redirect.type === ">") {
        lines.push(`await Deno.writeTextFile('${this.escapeString(redirect.target)}', ${resultVar}.stdout);`);
      } else {
        lines.push(`await Deno.writeTextFile('${this.escapeString(redirect.target)}', ${resultVar}.stdout, { append: true });`);
      }
    }

    return resultVar;
  }

  private generatePipeline(pipeline: PipelineCommand, lines: string[]): string {
    // Build pipeline expression
    const cmds = pipeline.commands;

    // First command
    const first = cmds[0]!;
    const firstCmdStr = `'${this.escapeString(first.command)}'`;
    const firstArgsStr = first.args.map(a => `'${this.escapeString(a)}'`).join(", ");

    // Build first command with options if stderr merge
    let expr: string;
    if (first.stderrMerge) {
      expr = firstArgsStr
        ? `$.cmd(${firstCmdStr}, [${firstArgsStr}], { mergeStreams: true })`
        : `$.cmd(${firstCmdStr}, [], { mergeStreams: true })`;
    } else {
      expr = firstArgsStr
        ? `$.cmd(${firstCmdStr}, [${firstArgsStr}])`
        : `$.cmd(${firstCmdStr})`;
    }

    // Pipe to remaining commands
    for (let i = 1; i < cmds.length; i++) {
      const cmd = cmds[i]!;
      const cmdStr = `'${this.escapeString(cmd.command)}'`;
      const argsStr = cmd.args.map(a => `'${this.escapeString(a)}'`).join(", ");

      if (argsStr) {
        expr += `.pipe(${cmdStr}, [${argsStr}])`;
      } else {
        expr += `.pipe(${cmdStr})`;
      }
    }

    const resultVar = this.nextVar();
    lines.push(`const ${resultVar} = await ${expr};`);

    // Handle redirects on last command
    const last = cmds[cmds.length - 1]!;
    for (const redirect of last.redirects) {
      if (redirect.type === ">") {
        lines.push(`await Deno.writeTextFile('${this.escapeString(redirect.target)}', ${resultVar}.stdout);`);
      } else {
        lines.push(`await Deno.writeTextFile('${this.escapeString(redirect.target)}', ${resultVar}.stdout, { append: true });`);
      }
    }

    return resultVar;
  }

  private generateSequence(seq: SequenceCommand, lines: string[]): string {
    const leftVar = this.generateCommand(seq.left, lines);

    if (seq.operator === "&&") {
      // AND: only continue if left succeeded
      lines.push(`if (${leftVar}?.code !== 0) return ${leftVar};`);
      return this.generateCommand(seq.right, lines) ?? "null";
    } else if (seq.operator === "||") {
      // OR: only continue if left failed
      lines.push(`if (${leftVar}?.code === 0) return ${leftVar};`);
      return this.generateCommand(seq.right, lines) ?? "null";
    } else {
      // SEMI: always continue, print intermediate output
      lines.push(`if (${leftVar}?.output) console.log(${leftVar}.output);`);
      lines.push(`else if (${leftVar}?.stdout) console.log(${leftVar}.stdout);`);
      lines.push(`if (${leftVar}?.stderr) console.error(${leftVar}.stderr);`);
      return this.generateCommand(seq.right, lines) ?? "null";
    }
  }

  private generateBackground(bg: BackgroundCommand, lines: string[]): string {
    // For background commands, generate the inner command code directly
    // The MCP tool handler will detect isBackground and launch it appropriately
    return this.generateCommand(bg.command, lines) ?? "null";
  }
}

// ============================================================================
// Main Parser Function
// ============================================================================

export interface ParseResult {
  code: string;
  isBackground: boolean;
  ast: Command;
}

export function parseShellCommand(input: string): ParseResult {
  const tokenizer = new ShellTokenizer(input);
  const tokens = tokenizer.tokenize();

  const parser = new ShellParser(tokens);
  const ast = parser.parse();

  const generator = new TypeScriptGenerator();
  const code = generator.generate(ast);

  const isBackground = ast.type === "background";

  return { code, isBackground, ast };
}
