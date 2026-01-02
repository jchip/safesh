/**
 * Unit tests for the shell command parser
 */
import { assertEquals, assertThrows } from "@std/assert";
import {
  ShellTokenizer,
  ShellParser,
  TypeScriptGenerator,
  parseShellCommand,
  VAR_START,
  VAR_END,
  TILDE_MARKER,
  GLOB_MARKER,
} from "./parser.ts";

// ============================================================================
// Tokenizer Tests
// ============================================================================

Deno.test("tokenizer - simple command", () => {
  const tokenizer = new ShellTokenizer("ls -la");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens.length, 3);
  assertEquals(tokens[0]?.type, "WORD");
  assertEquals(tokens[0]?.value, "ls");
  assertEquals(tokens[1]?.type, "WORD");
  assertEquals(tokens[1]?.value, "-la");
  assertEquals(tokens[2]?.type, "EOF");
});

Deno.test("tokenizer - pipe", () => {
  const tokenizer = new ShellTokenizer("ls | grep foo");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens.length, 5);
  assertEquals(tokens[0]?.type, "WORD");
  assertEquals(tokens[1]?.type, "PIPE");
  assertEquals(tokens[2]?.type, "WORD");
  assertEquals(tokens[3]?.type, "WORD");
});

Deno.test("tokenizer - AND operator", () => {
  const tokenizer = new ShellTokenizer("cmd1 && cmd2");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "AND");
  assertEquals(tokens[1]?.value, "&&");
});

Deno.test("tokenizer - OR operator", () => {
  const tokenizer = new ShellTokenizer("cmd1 || cmd2");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "OR");
  assertEquals(tokens[1]?.value, "||");
});

Deno.test("tokenizer - semicolon", () => {
  const tokenizer = new ShellTokenizer("cmd1; cmd2");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "SEMI");
});

Deno.test("tokenizer - background", () => {
  const tokenizer = new ShellTokenizer("cmd &");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "BACKGROUND");
});

Deno.test("tokenizer - redirects", () => {
  const tokenizer = new ShellTokenizer("cmd > out.txt >> append.txt < input.txt");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "REDIRECT_OUT");
  assertEquals(tokens[3]?.type, "REDIRECT_APPEND");
  assertEquals(tokens[5]?.type, "REDIRECT_IN");
});

Deno.test("tokenizer - stderr merge", () => {
  const tokenizer = new ShellTokenizer("cmd 2>&1");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "STDERR_MERGE");
  assertEquals(tokens[1]?.value, "2>&1");
});

Deno.test("tokenizer - double quotes", () => {
  const tokenizer = new ShellTokenizer('echo "hello world"');
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, "hello world");
});

Deno.test("tokenizer - single quotes", () => {
  const tokenizer = new ShellTokenizer("echo 'hello $VAR'");
  const tokens = tokenizer.tokenize();

  // Single quotes should NOT expand variables
  assertEquals(tokens[1]?.value, "hello $VAR");
});

Deno.test("tokenizer - variable $VAR in unquoted", () => {
  const tokenizer = new ShellTokenizer("echo $FOO");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, `${VAR_START}FOO${VAR_END}`);
});

Deno.test("tokenizer - variable ${VAR} in unquoted", () => {
  const tokenizer = new ShellTokenizer("echo ${BAR}");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, `${VAR_START}BAR${VAR_END}`);
});

Deno.test("tokenizer - variable in double quotes", () => {
  const tokenizer = new ShellTokenizer('echo "Hello $NAME"');
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, `Hello ${VAR_START}NAME${VAR_END}`);
});

Deno.test("tokenizer - variable NOT expanded in single quotes", () => {
  const tokenizer = new ShellTokenizer("echo '$NAME'");
  const tokens = tokenizer.tokenize();

  // Should be literal
  assertEquals(tokens[1]?.value, "$NAME");
});

Deno.test("tokenizer - tilde at start", () => {
  const tokenizer = new ShellTokenizer("cd ~/foo");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, `${TILDE_MARKER}/foo`);
});

Deno.test("tokenizer - glob pattern", () => {
  const tokenizer = new ShellTokenizer("ls *.ts");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, `${GLOB_MARKER}*.ts`);
});

Deno.test("tokenizer - glob with double star", () => {
  const tokenizer = new ShellTokenizer("ls **/*.json");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, `${GLOB_MARKER}**/*.json`);
});

Deno.test("tokenizer - escape in double quotes", () => {
  const tokenizer = new ShellTokenizer('echo "hello \\"world\\""');
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.value, 'hello "world"');
});

Deno.test("tokenizer - newline as semicolon", () => {
  const tokenizer = new ShellTokenizer("cmd1\ncmd2");
  const tokens = tokenizer.tokenize();

  assertEquals(tokens[1]?.type, "SEMI");
});

// ============================================================================
// Parser Tests
// ============================================================================

Deno.test("parser - simple command", () => {
  const { ast } = parseShellCommand("ls -la");

  assertEquals(ast.type, "simple");
  if (ast.type === "simple") {
    assertEquals(ast.command, "ls");
    assertEquals(ast.args, ["-la"]);
  }
});

Deno.test("parser - pipeline", () => {
  const { ast } = parseShellCommand("ls | grep foo | head");

  assertEquals(ast.type, "pipeline");
  if (ast.type === "pipeline") {
    assertEquals(ast.commands.length, 3);
    assertEquals(ast.commands[0]?.command, "ls");
    assertEquals(ast.commands[1]?.command, "grep");
    assertEquals(ast.commands[2]?.command, "head");
  }
});

Deno.test("parser - AND sequence", () => {
  const { ast } = parseShellCommand("cmd1 && cmd2");

  assertEquals(ast.type, "sequence");
  if (ast.type === "sequence") {
    assertEquals(ast.operator, "&&");
  }
});

Deno.test("parser - OR sequence", () => {
  const { ast } = parseShellCommand("cmd1 || cmd2");

  assertEquals(ast.type, "sequence");
  if (ast.type === "sequence") {
    assertEquals(ast.operator, "||");
  }
});

Deno.test("parser - background command", () => {
  const { ast, isBackground } = parseShellCommand("cmd &");

  assertEquals(ast.type, "background");
  assertEquals(isBackground, true);
});

Deno.test("parser - output redirect", () => {
  const { ast } = parseShellCommand("echo hello > out.txt");

  assertEquals(ast.type, "simple");
  if (ast.type === "simple") {
    assertEquals(ast.redirects.length, 1);
    assertEquals(ast.redirects[0]?.type, ">");
    assertEquals(ast.redirects[0]?.target, "out.txt");
  }
});

Deno.test("parser - input redirect", () => {
  const { ast } = parseShellCommand("cmd < input.txt");

  assertEquals(ast.type, "simple");
  if (ast.type === "simple") {
    assertEquals(ast.redirects.length, 1);
    assertEquals(ast.redirects[0]?.type, "<");
    assertEquals(ast.redirects[0]?.target, "input.txt");
  }
});

Deno.test("parser - inline env vars", () => {
  const { ast } = parseShellCommand("FOO=bar BAZ=qux cmd arg");

  assertEquals(ast.type, "simple");
  if (ast.type === "simple") {
    assertEquals(ast.command, "cmd");
    assertEquals(ast.args, ["arg"]);
    assertEquals(ast.envVars, { FOO: "bar", BAZ: "qux" });
  }
});

Deno.test("parser - stderr merge", () => {
  const { ast } = parseShellCommand("cmd 2>&1");

  assertEquals(ast.type, "simple");
  if (ast.type === "simple") {
    assertEquals(ast.stderrMerge, true);
  }
});

// ============================================================================
// Code Generator Tests
// ============================================================================

Deno.test("generator - simple echo", () => {
  const { code } = parseShellCommand("echo hello");

  assertEquals(code.includes("$.echo('hello')"), true);
});

Deno.test("generator - variable expansion in echo", () => {
  const { code } = parseShellCommand("echo $FOO");

  // Should expand to $.ENV or Deno.env.get
  assertEquals(code.includes("$.ENV['FOO']") || code.includes("Deno.env.get('FOO')"), true);
});

Deno.test("generator - tilde expansion in cd", () => {
  const { code } = parseShellCommand("cd ~/projects");

  assertEquals(code.includes("Deno.env.get('HOME')"), true);
});

Deno.test("generator - glob pattern", () => {
  const { code } = parseShellCommand("ls *.ts");

  // Should use $.glob for expansion
  assertEquals(code.includes("$.glob"), true);
});

Deno.test("generator - external command with args", () => {
  const { code } = parseShellCommand("git status");

  assertEquals(code.includes("$.initCmds(['git'])"), true);
  assertEquals(code.includes("$.cmd('git'"), true);
});

Deno.test("generator - pipeline", () => {
  const { code } = parseShellCommand("git log | head -5");

  assertEquals(code.includes(".pipe('head'"), true);
});

Deno.test("generator - output redirect", () => {
  const { code } = parseShellCommand("echo hello > out.txt");

  assertEquals(code.includes("Deno.writeTextFile"), true);
});

Deno.test("generator - input redirect", () => {
  const { code } = parseShellCommand("cat < input.txt");

  assertEquals(code.includes("Deno.readTextFile"), true);
  assertEquals(code.includes("stdin:"), true);
});

Deno.test("generator - AND sequence", () => {
  const { code } = parseShellCommand("cmd1 && cmd2");

  assertEquals(code.includes("if (") && code.includes("?.code !== 0)"), true);
});

Deno.test("generator - inline env vars", () => {
  const { code } = parseShellCommand("FOO=bar cmd");

  assertEquals(code.includes("env:"), true);
  assertEquals(code.includes("'FOO': 'bar'"), true);
});

Deno.test("generator - export command", () => {
  const { code } = parseShellCommand("export MY_VAR=hello");

  assertEquals(code.includes("$.ENV['MY_VAR']"), true);
  assertEquals(code.includes("Deno.env.set('MY_VAR'"), true);
});

Deno.test("generator - cd with tilde", () => {
  const { code } = parseShellCommand("cd ~");

  assertEquals(code.includes("$.cd("), true);
  assertEquals(code.includes("Deno.env.get('HOME')"), true);
});

Deno.test("generator - complex variable in double quotes", () => {
  const { code } = parseShellCommand('echo "Hello ${USER}!"');

  assertEquals(code.includes("$.ENV['USER']") || code.includes("Deno.env.get('USER')"), true);
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test("integration - complex pipeline with redirects", () => {
  const { code, ast } = parseShellCommand("cat < input.txt | grep foo | head -5 > out.txt");

  assertEquals(ast.type, "pipeline");
  assertEquals(code.includes("Deno.readTextFile"), true);
  assertEquals(code.includes("Deno.writeTextFile"), true);
});

Deno.test("integration - chained commands", () => {
  const { code, ast } = parseShellCommand("mkdir -p foo && cd foo && touch bar.txt");

  assertEquals(ast.type, "sequence");
  assertEquals(code.includes("$.mkdir"), true);
  assertEquals(code.includes("$.cd"), true);
  assertEquals(code.includes("$.touch"), true);
});

Deno.test("integration - variable and tilde together", () => {
  const { code } = parseShellCommand("ls ~/$PROJECT");

  assertEquals(code.includes("Deno.env.get('HOME')"), true);
  assertEquals(code.includes("$.ENV['PROJECT']") || code.includes("Deno.env.get('PROJECT')"), true);
});

Deno.test("integration - repeated builtins use unique variable names", () => {
  const { code } = parseShellCommand("echo a; echo b; echo c");

  // Should NOT redeclare the same variable
  // Count occurrences of 'const _r' - each should be unique
  const matches = code.match(/const _r\d+/g) ?? [];
  const uniqueVars = new Set(matches);
  assertEquals(matches.length, uniqueVars.size, "All variable declarations should be unique");

  // Should have at least 6 unique variables (2 per echo: helper + result)
  assertEquals(uniqueVars.size >= 6, true);
});

Deno.test("integration - repeated file ops use unique variable names", () => {
  const { code } = parseShellCommand("ls; ls; ls");

  const matches = code.match(/const _r\d+/g) ?? [];
  const uniqueVars = new Set(matches);
  assertEquals(matches.length, uniqueVars.size, "All variable declarations should be unique");
});

Deno.test("generator - ls with supported flags uses builtin", () => {
  const { code } = parseShellCommand("ls -la");

  // Should use $.ls() builtin
  assertEquals(code.includes("$.ls('-la')"), true);
  assertEquals(code.includes("$.cmd('ls'"), false);
});

Deno.test("generator - ls with unsupported flags uses external command", () => {
  const { code } = parseShellCommand("ls -F");

  // Should use $.cmd() external command
  assertEquals(code.includes("$.cmd('ls'"), true);
  assertEquals(code.includes("$.ls("), false);
});

Deno.test("generator - ls with mixed flags uses external if any unsupported", () => {
  const { code } = parseShellCommand("ls -laF");

  // -F is unsupported, so should use external command
  assertEquals(code.includes("$.cmd('ls'"), true);
  assertEquals(code.includes("$.ls("), false);
});
