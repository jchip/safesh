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
 * - Environment variables: $VAR, ${VAR} (expanded in unquoted and double-quoted contexts)
 * - Tilde expansion: ~ expands to home directory
 * - Glob patterns: `*.ts`, `**\/*.json` (expanded at runtime)
 * - Input redirect: < file
 *
 * NOT supported:
 * - Bash programming: for, while, if, case, etc.
 * - Subshells: $(...)
 * - Here-docs: <<EOF
 */

// Variable marker characters (Unicode private use area)
export const VAR_START = "\u0001";
export const VAR_END = "\u0002";
export const TILDE_MARKER = "\u0003";
export const GLOB_MARKER = "\u0004";

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
  | "REDIRECT_IN"    // <
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
  type: ">" | ">>" | "<";
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
    if (char === "<") {
      this.position++;
      return { type: "REDIRECT_IN", value: "<", position: start };
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
    let hasGlob = false;

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

      // Handle tilde at start of word
      if (char === "~" && value === "") {
        value += TILDE_MARKER;
        this.position++;
        continue;
      }

      // Handle variable expansion: $VAR or ${VAR}
      if (char === "$") {
        value += this.readVariable();
        continue;
      }

      // Track glob characters
      if (char === "*" || char === "?") {
        hasGlob = true;
      }

      value += char;
      this.position++;
    }

    // Mark as glob pattern if it contains glob chars
    if (hasGlob) {
      value = GLOB_MARKER + value;
    }

    return { type: "WORD", value, position: start };
  }

  /**
   * Read a variable reference: $VAR or ${VAR}
   * Returns the variable wrapped in markers for later expansion
   */
  private readVariable(): string {
    this.position++; // skip $

    if (this.position >= this.input.length) {
      return "$"; // trailing $
    }

    const char = this.input[this.position];

    // ${VAR} form
    if (char === "{") {
      this.position++; // skip {
      let varName = "";
      while (this.position < this.input.length && this.input[this.position] !== "}") {
        varName += this.input[this.position];
        this.position++;
      }
      if (this.position < this.input.length) {
        this.position++; // skip }
      }
      if (varName) {
        return VAR_START + varName + VAR_END;
      }
      return "${}";
    }

    // $VAR form - valid var chars: [a-zA-Z_][a-zA-Z0-9_]*
    if (/[a-zA-Z_]/.test(char!)) {
      let varName = char!;
      this.position++;
      while (this.position < this.input.length && /[a-zA-Z0-9_]/.test(this.input[this.position]!)) {
        varName += this.input[this.position];
        this.position++;
      }
      return VAR_START + varName + VAR_END;
    }

    // Special vars like $?, $!, $$ - pass through for now
    return "$" + char;
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

      // Variable expansion in double quotes (not single quotes)
      if (quote === '"' && char === "$") {
        value += this.readVariable();
        continue;
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
      } else if (token.type === "REDIRECT_OUT" || token.type === "REDIRECT_APPEND" || token.type === "REDIRECT_IN") {
        const type = token.value as ">" | ">>" | "<";
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

  /**
   * Check if a string contains expansion markers (vars, tilde, glob)
   */
  private hasExpansion(s: string): boolean {
    return s.includes(VAR_START) || s.includes(TILDE_MARKER) || s.includes(GLOB_MARKER);
  }

  /**
   * Check if string is a glob pattern
   */
  private isGlob(s: string): boolean {
    return s.startsWith(GLOB_MARKER);
  }

  /**
   * Convert a string with markers to a JS expression.
   * Returns either a string literal or a template expression.
   */
  private expandArg(s: string): string {
    // Handle glob marker
    if (s.startsWith(GLOB_MARKER)) {
      s = s.slice(1); // remove glob marker, will handle expansion separately
    }

    // If no expansion needed, return quoted string
    if (!s.includes(VAR_START) && !s.includes(TILDE_MARKER)) {
      return `'${this.escapeString(s)}'`;
    }

    // Build template literal parts
    const parts: string[] = [];
    let i = 0;
    let literal = "";

    while (i < s.length) {
      if (s[i] === TILDE_MARKER) {
        // Tilde expansion
        if (literal) {
          parts.push(`'${this.escapeString(literal)}'`);
          literal = "";
        }
        parts.push(`(Deno.env.get('HOME') ?? '')`);
        i++;
      } else if (s[i] === VAR_START) {
        // Variable expansion
        if (literal) {
          parts.push(`'${this.escapeString(literal)}'`);
          literal = "";
        }
        i++; // skip VAR_START
        let varName = "";
        while (i < s.length && s[i] !== VAR_END) {
          varName += s[i];
          i++;
        }
        i++; // skip VAR_END
        parts.push(`($.ENV['${varName}'] ?? Deno.env.get('${varName}') ?? '')`);
      } else {
        literal += s[i];
        i++;
      }
    }

    if (literal) {
      parts.push(`'${this.escapeString(literal)}'`);
    }

    if (parts.length === 1) {
      return parts[0]!;
    }
    return parts.join(" + ");
  }

  /**
   * Generate expanded args array expression
   * Handles glob expansion at runtime
   */
  private generateArgsExpr(args: string[]): string {
    const hasGlobs = args.some(a => this.isGlob(a));

    if (!hasGlobs) {
      // Simple case - no globs
      const parts = args.map(a => this.expandArg(a));
      return `[${parts.join(", ")}]`;
    }

    // Complex case - need to expand globs at runtime
    // Generate code that expands globs and flattens
    const parts: string[] = [];
    for (const arg of args) {
      if (this.isGlob(arg)) {
        const pattern = arg.slice(1); // remove GLOB_MARKER
        const expanded = this.expandArg(pattern);
        parts.push(`...(await $.glob(${expanded})).map(f => f.path)`);
      } else {
        parts.push(this.expandArg(arg));
      }
    }
    return `[${parts.join(", ")}]`;
  }

  /**
   * Generate output redirect code for a result variable
   */
  private generateOutputRedirects(resultVar: string, redirects: Redirect[], lines: string[]): void {
    for (const redirect of redirects) {
      if (redirect.type === "<") continue; // skip input redirects
      const target = this.expandArg(redirect.target);
      if (redirect.type === ">") {
        lines.push(`await Deno.writeTextFile(${target}, ${resultVar}.stdout);`);
      } else if (redirect.type === ">>") {
        lines.push(`await Deno.writeTextFile(${target}, ${resultVar}.stdout, { append: true });`);
      }
    }
  }

  private generateSimple(cmd: SimpleCommand, lines: string[]): string {
    const resultVar = this.nextVar();

    // Check if any args have expansion (vars, tilde, globs)
    const hasExpansions = cmd.args.some(a => this.hasExpansion(a));
    const hasGlobs = cmd.args.some(a => this.isGlob(a));

    // Generate args expression - handles var/tilde/glob expansion
    const argsExpr = this.generateArgsExpr(cmd.args);
    // Simple comma-joined args for builtins that don't need glob expansion
    const simpleArgsStr = cmd.args.map(a => this.expandArg(a)).join(", ");

    // Check for input redirect
    const inputRedirect = cmd.redirects.find(r => r.type === "<");
    const outputRedirects = cmd.redirects.filter(r => r.type !== "<");

    // Handle builtins
    switch (cmd.command) {
      // Directory operations
      case "cd": {
        const dir = cmd.args[0] ? this.expandArg(cmd.args[0]) : `(Deno.env.get('HOME') ?? '~')`;
        lines.push(`await $.cd(${dir});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      }
      case "pwd":
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String($.pwd()).trim(), stderr: '' };`);
        this.generateOutputRedirects(resultVar, cmd.redirects, lines);
        return resultVar;
      case "pushd": {
        const dir = cmd.args[0] ? this.expandArg(cmd.args[0]) : "''";
        const pdVar = this.nextVar();
        lines.push(`const ${pdVar} = $.pushd(${dir});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String(${pdVar}).trim(), stderr: '' };`);
        return resultVar;
      }
      case "popd": {
        const pdVar = this.nextVar();
        lines.push(`const ${pdVar} = $.popd();`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String(${pdVar}).trim(), stderr: '' };`);
        return resultVar;
      }
      case "dirs": {
        const dsVar = this.nextVar();
        lines.push(`const ${dsVar} = $.dirs();`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: ${dsVar}.join('\\n'), stderr: '' };`);
        this.generateOutputRedirects(resultVar, cmd.redirects, lines);
        return resultVar;
      }

      // Output
      case "echo": {
        const echoVar = this.nextVar();
        lines.push(`const ${echoVar} = $.echo(${simpleArgsStr || "''"});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: String(${echoVar}).trim(), stderr: '' };`);
        this.generateOutputRedirects(resultVar, cmd.redirects, lines);
        return resultVar;
      }

      // Tests
      case "true":
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "false":
        lines.push(`const ${resultVar} = { code: 1, success: false, stdout: '', stderr: '' };`);
        return resultVar;
      case "test":
      case "[": {
        const testVar = this.nextVar();
        lines.push(`const ${testVar} = $.test(${simpleArgsStr});`);
        lines.push(`const ${resultVar} = { code: ${testVar} ? 0 : 1, success: ${testVar}, stdout: '', stderr: '' };`);
        return resultVar;
      }

      // File listing - supports globs
      case "ls": {
        const lsVar = this.nextVar();
        if (hasGlobs) {
          const lsArgsVar = this.nextVar();
          lines.push(`const ${lsArgsVar} = ${argsExpr};`);
          lines.push(`const ${lsVar} = $.ls(...${lsArgsVar});`);
        } else {
          lines.push(`const ${lsVar} = $.ls(${simpleArgsStr || "'.'"});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: Array.isArray(${lsVar}) ? ${lsVar}.join('\\n') : String(${lsVar}), stderr: '' };`);
        this.generateOutputRedirects(resultVar, cmd.redirects, lines);
        return resultVar;
      }

      // File operations - support globs and expansion
      case "mkdir":
        if (hasGlobs) {
          const argsVar = this.nextVar();
          lines.push(`const ${argsVar} = ${argsExpr};`);
          lines.push(`await $.mkdir(...${argsVar});`);
        } else {
          lines.push(`await $.mkdir(${simpleArgsStr});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "rm":
        if (hasGlobs) {
          const argsVar = this.nextVar();
          lines.push(`const ${argsVar} = ${argsExpr};`);
          lines.push(`await $.rm(...${argsVar});`);
        } else {
          lines.push(`await $.rm(${simpleArgsStr});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "cp":
        if (hasGlobs) {
          const argsVar = this.nextVar();
          lines.push(`const ${argsVar} = ${argsExpr};`);
          lines.push(`await $.cp(...${argsVar});`);
        } else {
          lines.push(`await $.cp(${simpleArgsStr});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "mv":
        if (hasGlobs) {
          const argsVar = this.nextVar();
          lines.push(`const ${argsVar} = ${argsExpr};`);
          lines.push(`await $.mv(...${argsVar});`);
        } else {
          lines.push(`await $.mv(${simpleArgsStr});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "touch":
        if (hasGlobs) {
          const argsVar = this.nextVar();
          lines.push(`const ${argsVar} = ${argsExpr};`);
          lines.push(`await $.touch(...${argsVar});`);
        } else {
          lines.push(`await $.touch(${simpleArgsStr});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "chmod":
        if (hasGlobs) {
          const argsVar = this.nextVar();
          lines.push(`const ${argsVar} = ${argsExpr};`);
          lines.push(`await $.chmod(...${argsVar});`);
        } else {
          lines.push(`await $.chmod(${simpleArgsStr});`);
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "ln":
        lines.push(`await $.ln(${simpleArgsStr});`);
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
      case "which": {
        const whichVar = this.nextVar();
        lines.push(`const ${whichVar} = await $.which(${simpleArgsStr});`);
        lines.push(`const ${resultVar} = { code: ${whichVar} ? 0 : 1, success: !!${whichVar}, stdout: ${whichVar} || '', stderr: '' };`);
        this.generateOutputRedirects(resultVar, cmd.redirects, lines);
        return resultVar;
      }

      case "export":
        // Handle export VAR=value - expand values
        for (const arg of cmd.args) {
          const eqIdx = arg.indexOf("=");
          if (eqIdx > 0) {
            const varName = arg.slice(0, eqIdx);
            const varValue = arg.slice(eqIdx + 1);
            const expandedValue = this.expandArg(varValue);
            lines.push(`$.ENV['${this.escapeString(varName)}'] = ${expandedValue};`);
            lines.push(`Deno.env.set('${this.escapeString(varName)}', ${expandedValue});`);
          }
        }
        lines.push(`const ${resultVar} = { code: 0, success: true, stdout: '', stderr: '' };`);
        return resultVar;
    }

    // External command - use $.cmd()
    const cmdStr = `'${this.escapeString(cmd.command)}'`;

    // Build options
    const options: string[] = [];
    if (cmd.stderrMerge) {
      options.push("mergeStreams: true");
    }
    if (Object.keys(cmd.envVars).length > 0) {
      const envEntries = Object.entries(cmd.envVars)
        .map(([k, v]) => `'${this.escapeString(k)}': ${this.expandArg(v)}`)
        .join(", ");
      options.push(`env: { ${envEntries} }`);
    }
    // Handle input redirect - read file and pass as stdin
    if (inputRedirect) {
      const inputFile = this.expandArg(inputRedirect.target);
      options.push(`stdin: await Deno.readTextFile(${inputFile})`);
    }

    // Generate the command call
    const optionsStr = options.length > 0 ? `, { ${options.join(", ")} }` : "";

    if (hasGlobs || hasExpansions) {
      // Need to evaluate args expression
      lines.push(`const _args = ${argsExpr};`);
      lines.push(`const ${resultVar} = await $.cmd(${cmdStr}, _args${optionsStr});`);
    } else if (cmd.args.length > 0) {
      lines.push(`const ${resultVar} = await $.cmd(${cmdStr}, ${argsExpr}${optionsStr});`);
    } else if (options.length > 0) {
      lines.push(`const ${resultVar} = await $.cmd(${cmdStr}, []${optionsStr});`);
    } else {
      lines.push(`const ${resultVar} = await $.cmd(${cmdStr});`);
    }

    // Handle output redirects
    for (const redirect of outputRedirects) {
      const target = this.expandArg(redirect.target);
      if (redirect.type === ">") {
        lines.push(`await Deno.writeTextFile(${target}, ${resultVar}.stdout);`);
      } else if (redirect.type === ">>") {
        lines.push(`await Deno.writeTextFile(${target}, ${resultVar}.stdout, { append: true });`);
      }
    }

    return resultVar;
  }

  private generatePipeline(pipeline: PipelineCommand, lines: string[]): string {
    // Build pipeline expression
    const cmds = pipeline.commands;

    // Check if first command has expansions
    const first = cmds[0]!;
    const firstHasExpansion = first.args.some(a => this.hasExpansion(a));
    const firstHasGlobs = first.args.some(a => this.isGlob(a));
    const firstCmdStr = `'${this.escapeString(first.command)}'`;

    // Check for input redirect on first command
    const inputRedirect = first.redirects.find(r => r.type === "<");

    let expr: string;
    const firstOptions: string[] = [];
    if (first.stderrMerge) {
      firstOptions.push("mergeStreams: true");
    }
    if (inputRedirect) {
      const inputFile = this.expandArg(inputRedirect.target);
      firstOptions.push(`stdin: await Deno.readTextFile(${inputFile})`);
    }
    const firstOptStr = firstOptions.length > 0 ? `, { ${firstOptions.join(", ")} }` : "";

    if (firstHasGlobs || firstHasExpansion) {
      const argsExpr = this.generateArgsExpr(first.args);
      lines.push(`const _pipeArgs0 = ${argsExpr};`);
      expr = `$.cmd(${firstCmdStr}, _pipeArgs0${firstOptStr})`;
    } else if (first.args.length > 0) {
      const argsExpr = this.generateArgsExpr(first.args);
      expr = `$.cmd(${firstCmdStr}, ${argsExpr}${firstOptStr})`;
    } else if (firstOptions.length > 0) {
      expr = `$.cmd(${firstCmdStr}, []${firstOptStr})`;
    } else {
      expr = `$.cmd(${firstCmdStr})`;
    }

    // Pipe to remaining commands
    for (let i = 1; i < cmds.length; i++) {
      const cmd = cmds[i]!;
      const cmdStr = `'${this.escapeString(cmd.command)}'`;
      const hasExpansion = cmd.args.some(a => this.hasExpansion(a));
      const hasGlobs = cmd.args.some(a => this.isGlob(a));

      if (hasGlobs || hasExpansion) {
        const argsExpr = this.generateArgsExpr(cmd.args);
        lines.push(`const _pipeArgs${i} = ${argsExpr};`);
        expr += `.pipe(${cmdStr}, _pipeArgs${i})`;
      } else if (cmd.args.length > 0) {
        const argsExpr = this.generateArgsExpr(cmd.args);
        expr += `.pipe(${cmdStr}, ${argsExpr})`;
      } else {
        expr += `.pipe(${cmdStr})`;
      }
    }

    const resultVar = this.nextVar();
    lines.push(`const ${resultVar} = await ${expr};`);

    // Handle output redirects on last command
    const last = cmds[cmds.length - 1]!;
    const outputRedirects = last.redirects.filter(r => r.type !== "<");
    for (const redirect of outputRedirects) {
      const target = this.expandArg(redirect.target);
      if (redirect.type === ">") {
        lines.push(`await Deno.writeTextFile(${target}, ${resultVar}.stdout);`);
      } else if (redirect.type === ">>") {
        lines.push(`await Deno.writeTextFile(${target}, ${resultVar}.stdout, { append: true });`);
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
