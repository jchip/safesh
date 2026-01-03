# SafeShell API Reference

Complete API documentation for SafeShell ($.\*)

## Table of Contents

- [Utility Objects](#utility-objects)
  - [$.fs - File System](#fs---file-system)
  - [$.path - Path Utilities](#path---path-utilities)
  - [$.text - Text Processing](#text---text-processing)
- [Commands](#commands)
  - [Built-in Aliases](#built-in-aliases)
  - [External Commands](#external-commands)
  - [General Command Execution](#general-command-execution)
  - [Data Sources](#data-sources)
- [Streams](#streams)
  - [FluentStream<T>](#fluentstreamt)
  - [FluentShell](#fluentshell)
  - [File Objects](#file-objects)
- [Transform Functions](#transform-functions)
- [I/O Functions](#io-functions)
- [Shell-like Commands](#shell-like-commands)
- [State Variables](#state-variables)
- [Path Expansion](#path-expansion)

---

## Utility Objects

### $.fs - File System

Async file I/O operations that respect sandbox permissions.

**API:**

```typescript
$.fs.read(path: string): Promise<string>
$.fs.write(path: string, content: string): Promise<void>
```

**Examples:**

```javascript
// Read file
const content = await $.fs.read("config.json");
const data = JSON.parse(content);

// Write file
await $.fs.write("output.txt", "Hello, world!");

// Process and write
const logs = await $.fs.read("app.log");
const errors = logs.split("\n").filter((line) => line.includes("ERROR"));
await $.fs.write("errors.log", errors.join("\n"));
```

---

### $.path - Path Utilities

Path manipulation utilities (from @std/path). Accepts ShellString objects.

**API:**

```typescript
$.path.join(...paths: string[]): string
$.path.dirname(path: string): string
$.path.basename(path: string, suffix?: string): string
$.path.extname(path: string): string
$.path.resolve(...paths: string[]): string
$.path.relative(from: string, to: string): string
$.path.normalize(path: string): string
$.path.isAbsolute(path: string): boolean
```

**Examples:**

```javascript
// Build paths
const filePath = $.path.join("/project", "src", "main.ts");
// → '/project/src/main.ts'

// Extract parts
const dir = $.path.dirname("/foo/bar/baz.txt"); // → '/foo/bar'
const base = $.path.basename("/foo/bar/baz.txt"); // → 'baz.txt'
const ext = $.path.extname("/foo/bar/baz.txt"); // → '.txt'

// Works with ShellString from $.pwd()
const cwd = $.pwd();
const targetPath = $.path.join(cwd, "temp", "output.txt");

// Resolve relative paths
const absolute = $.path.resolve("./src", "../lib", "utils.ts");

// Get relative path
const rel = $.path.relative("/data/orandea/test", "/data/orandea/impl/bbb");
// → '../../impl/bbb'
```

---

### $.text - Text Processing

Line-oriented text processing utilities.

**API:**

```typescript
$.text.trim(input: string | string[], mode?: 'both' | 'left' | 'right'): string | string[]
$.text.lines(input: string): string[]
$.text.head(input: string, n?: number): string[]
$.text.tail(input: string, n?: number): string[]
$.text.grep(pattern: RegExp | string, input: string): GrepMatch[]
$.text.replace(input: string, pattern: RegExp | string, replacement: string): string
$.text.sort(input: string | string[], options?): string[]
$.text.uniq(input: string | string[], options?): string[] | {line, count}[]
$.text.count(input: string): {lines, words, chars, bytes}
$.text.cut(input: string | string[], options?): string[]
```

**Examples:**

```javascript
// Trim - returns string for single-line, array for multi-line
$.text.trim("  hello  "); // → 'hello' (string)
$.text.trim("  a  \n  b  "); // → ['a', 'b'] (array)
$.text.trim("  hello  ", "left"); // → 'hello  '

// Split into lines
const lines = $.text.lines("line1\nline2\nline3");
// → ['line1', 'line2', 'line3']

// Head and tail
const preview = $.text.head(content, 10); // First 10 lines
const recent = $.text.tail(logFile, 20); // Last 20 lines

// Search with grep
const errors = $.text.grep(/ERROR/, logContent);
// → [{line: 5, content: 'ERROR: failed', match: 'ERROR'}, ...]

// Replace
const updated = $.text.replace(content, /foo/g, "bar");

// Sort and unique
const sorted = $.text.sort(lines, { numeric: true, reverse: true });
const unique = $.text.uniq(lines);

// Word count
const stats = $.text.count(content);
// → {lines: 42, words: 300, chars: 1500, bytes: 1500}

// Cut columns (like cut command)
const csv = "a,b,c\nd,e,f";
const cols = $.text.cut(csv, { delimiter: ",", fields: [1, 3] });
// → ['a,c', 'd,f']
```

---

## Commands

All commands return a `Command` object with methods:

- `.exec()` → `{code: number, stdout: string, stderr: string, success: boolean}`
- `.stdout()` → `FluentStream<string>`
- `.stderr()` → `FluentStream<string>`
- `.pipe(cmd, args)` → `Command` (for chaining)

### Built-in Aliases

Convenience functions for common commands.

**API:**

```typescript
$.git(...args: string[]): Command
$.docker(...args: string[]): Command
$.tmux(...args: string[]): Command
$.tmuxSubmit(pane: string, text: string, targetClient?: string): Promise<CommandResult>
```

**Examples:**

```javascript
// Git
const status = await $.git("status").exec();
const diff = await $.git("diff", "--cached").exec();

// Docker
const containers = await $.docker("ps", "-a").exec();

// Tmux
await $.tmux("new-session", "-d", "-s", "mysession");
const panes = await $.tmux("list-panes", "-t", "mysession").exec();

// Tmux submit (handles paste mode)
await $.tmuxSubmit("mysession:0.0", 'echo "hello"');
```

---

### External Commands

Initialize external commands with permission checking.

**API:**

```typescript
$.initCmds<T extends readonly string[]>(
  commands: T,
  options?: CommandOptions
): Promise<{[K in keyof T]: CommandFn}>
```

**Examples:**

```javascript
// Initialize commands
const [curl, jq] = await $.initCmds(["curl", "jq"]);

// Use them
const result = await curl("-s", "https://api.example.com/data");
console.log(result.stdout);

// With options
const [gcc] = await $.initCmds(["gcc"], { cwd: "/project" });
await gcc("-o", "output", "main.c");

// Commands can be piped
const data = await $.str('{"name":"John"}').pipe(jq, [".name"]).exec();
```

---

### General Command Execution

Execute any command.

**API:**

```typescript
$.cmd(command: string, ...args: string[]): Command
$.cmd(options: CommandOptions, command: string, ...args: string[]): Command
```

**Examples:**

```javascript
// Simple command
const result = await $.cmd("ls", "-la").exec();

// With options
const output = await $.cmd({ cwd: "/tmp" }, "pwd").exec();

// Capture streams separately
const build = await $.cmd("make", "build").exec();
if (!build.success) {
  console.error(build.stderr);
}

// Stream output
await $.cmd("tail", "-f", "app.log")
  .stdout()
  .lines()
  .grep(/ERROR/)
  .forEach((line) => console.log(line));
```

---

### Data Sources

Create data streams for piping to commands.

**API:**

```typescript
$.str(content: string): Command
$.bytes(content: Uint8Array): Command
```

**Examples:**

```javascript
// Pipe string data to command
const sorted = await $.str("cherry\napple\nbanana").pipe("sort").exec();
console.log(sorted.stdout);
// → apple
//   banana
//   cherry

// Process with grep
const matches = await $.str("foo\nbar\nbaz\nfoo bar")
  .pipe("grep", ["foo"])
  .exec();

// Stream transformations
const lines = await $.str("ERROR: fail\nINFO: ok\nERROR: bad")
  .stdout()
  .lines()
  .grep(/ERROR/)
  .collect();
// → ['ERROR: fail', 'ERROR: bad']

// Binary data
const bytes = new TextEncoder().encode("hello");
const hex = await $.bytes(bytes).pipe("xxd").exec();
```

---

## Streams

### FluentStream&lt;T&gt;

Generic chainable stream for any data type.

**Creators:**

```typescript
$.glob(pattern: string): FluentStream<File>
$.src(...patterns: string[]): FluentStream<File>
$.createStream(iterable: AsyncIterable<T>): FluentStream<T>
$.fromArray(items: T[]): FluentStream<T>
$.empty(): FluentStream<never>
```

**Methods:**

```typescript
// Chainable transforms
.filter(predicate: (item: T) => boolean | Promise<boolean>): FluentStream<T>
.map<U>(fn: (item: T) => U | Promise<U>): FluentStream<U>
.flatMap<U>(fn: (item: T) => AsyncIterable<U>): FluentStream<U>
.head(n: number): FluentStream<T>
.tail(n: number): FluentStream<T>
.take(n: number): FluentStream<T>  // alias for head
.pipe<U>(transform: Transform<T, U>): FluentStream<U>

// String-specific (when T is string)
.lines(): FluentStream<string>
.grep(pattern: RegExp | string): FluentStream<string>

// Terminal operations
.collect(): Promise<T[]>
.first(): Promise<T | undefined>
.count(): Promise<number>
.forEach(fn: (item: T) => void | Promise<void>): Promise<void>
```

**Examples:**

```javascript
// Glob files
const files = await $.glob("src/**/*.ts")
  .filter((f) => !f.path.includes(".test."))
  .map((f) => f.path)
  .collect();

// Multiple patterns
const sources = await $.src("*.ts", "*.js")
  .filter((f) => f.contents.includes("TODO"))
  .collect();

// Process file contents
const errors = await $.glob("logs/*.log")
  .flatMap(async function* (f) {
    const lines = f.contents.toString().split("\n");
    for (const line of lines) {
      if (line.includes("ERROR")) yield line;
    }
  })
  .collect();

// From array
const result = await $.fromArray([1, 2, 3, 4, 5])
  .filter((x) => x > 2)
  .map((x) => x * 2)
  .collect();
// → [6, 8, 10]

// String operations
const errorLines = await $.fromArray([
  "ERROR: one",
  "INFO: two",
  "ERROR: three",
])
  .grep(/ERROR/)
  .collect();
// → ['ERROR: one', 'ERROR: three']

// Count items
const count = await $.glob("**/*.ts").count();

// First match
const firstError = await $.glob("logs/*.log")
  .filter((f) => f.contents.includes("FATAL"))
  .first();
```

---

### FluentShell

Specialized `FluentStream<string>` for file-based text processing.

**Creator:**

```typescript
$.cat(path: string | File | Stream<string>): FluentShell
```

**Methods:**
Same as `FluentStream<string>` plus specialized text processing:

```typescript
.lines(): FluentShell
.grep(pattern: RegExp | string): FluentShell
.head(n?: number): FluentShell
.tail(n?: number): FluentShell
.filter(predicate): FluentShell
.map(fn): FluentShell
.collect(): Promise<string[]>
.forEach(fn): Promise<void>
.first(): Promise<string | undefined>
.count(): Promise<number>
```

**Examples:**

```javascript
// Process log file
const errors = await $.cat("app.log").lines().grep(/ERROR/).head(10).collect();

// Count lines
const lineCount = await $.cat("data.txt").lines().count();

// Filter and transform
const urls = await $.cat("links.txt")
  .lines()
  .filter((line) => line.startsWith("http"))
  .map((line) => line.trim())
  .collect();

// Print to stdout
await $.cat("output.log")
  .lines()
  .grep(/WARN|ERROR/)
  .forEach((line) => console.log(line));
```

---

### File Objects

Objects returned by `$.glob()` and `$.src()`.

**Type:**

```typescript
interface File {
  path: string; // Absolute path
  base: string; // Base directory for relative paths
  contents: string | Uint8Array; // File contents (PROPERTY, not method!)
  stat?: Deno.FileInfo; // File stats (optional)
}
```

**Important:** `contents` is a **property**, not a method. Use `f.contents`, not `f.contents()`.

**Examples:**

```javascript
// Access file properties
const files = await $.glob("*.txt").collect();
for (const f of files) {
  console.log(f.path); // ✅ Correct
  console.log(f.contents); // ✅ Correct - property
  console.log(f.contents()); // ❌ Wrong - not a method!

  // Check if text or binary
  if (typeof f.contents === "string") {
    console.log("Text file:", f.contents.length, "chars");
  } else {
    console.log("Binary file:", f.contents.length, "bytes");
  }
}

// Map over contents
const sizes = await $.glob("src/**/*.ts")
  .map((f) => ({
    path: f.path,
    size: f.contents.length,
    lines: f.contents.toString().split("\n").length,
  }))
  .collect();
```

---

## Transform Functions

Direct transform functions available on `$.*` for use with `.pipe()`.

**Available Transforms:**

```typescript
$.filter(predicate): Transform<T, T>
$.map(fn): Transform<T, U>
$.flatMap(fn): Transform<T, U>
$.take(n): Transform<T, T>
$.head(n): Transform<T, T>
$.tail(n): Transform<T, T>
$.lines(): Transform<string, string>
$.grep(pattern): Transform<string, string>
$.toCmd(cmd, args): Transform<string, string>
$.toCmdLines(cmd, args): Transform<string, string>
```

**Examples:**

```javascript
// Use with pipe
await $.cat("data.txt")
  .pipe($.lines())
  .pipe($.grep(/pattern/))
  .pipe($.head(10))
  .forEach((line) => console.log(line));

// Pipe through external command
const sorted = await $.cat("names.txt").pipe($.toCmd("sort")).collect();

// Process command output line by line
await $.cmd("git", "log", "--oneline")
  .stdout()
  .pipe($.toCmdLines("head", ["-5"]))
  .forEach((line) => console.log(line));
```

---

## I/O Functions

Stream I/O utilities.

**API:**

```typescript
$.stdout(): Transform<string, string>  // Write to stdout, pass through
$.stderr(): Transform<string, string>  // Write to stderr, pass through
$.tee(stream: WritableStream): Transform<T, T>  // Duplicate stream
```

**Examples:**

```javascript
// Print while processing
const result = await $.cat("input.txt")
  .lines()
  .pipe($.stdout()) // Print each line
  .grep(/ERROR/)
  .collect();

// Duplicate to stderr
await $.cat("warnings.log").pipe($.stderr()).collect();
```

---

## Shell-like Commands

Unix-style shell commands.

**API:**

```typescript
// Output commands
$.echo(...args: string[]): void

// Directory navigation
$.cd(dir?: string): ShellString
$.pwd(): ShellString
$.pushd(dir?: string): string[]
$.popd(): string[]
$.dirs(): string[]

// File operations
$.ls(path?: string, options?): string[]
$.mkdir(path: string, options?): Promise<void>
$.touch(path: string, options?): Promise<void>
$.rm(path: string, options?): Promise<void>
$.cp(src: string, dest: string, options?): Promise<void>
$.mv(src: string, dest: string, options?): Promise<void>
$.ln(target: string, link: string, options?): Promise<void>
$.chmod(mode: number | string, path: string): Promise<void>

// Utilities
$.which(cmd: string): Promise<string | null>
$.test(flag: string, path: string): Promise<boolean>
$.tempdir(): string
```

**Examples:**

```javascript
// Echo
$.echo("Hello", "world"); // Prints: Hello world

// Directory navigation
$.cd("/tmp");
const cwd = $.pwd();
console.log(cwd.toString()); // /tmp

// Directory stack
$.pushd("/project/src");
$.pushd("/project/tests");
$.popd(); // Back to /project/src
$.dirs(); // Show directory stack

// List files
const files = await $.ls(".");
const detailed = await $.ls(".", { long: true });

// Create/remove directories
await $.mkdir("temp/nested/dirs", { recursive: true });
await $.rm("temp", { recursive: true });

// Copy/move files
await $.cp("source.txt", "dest.txt");
await $.mv("old.txt", "new.txt");

// Symlinks
await $.ln("target.txt", "link.txt");

// Permissions
await $.chmod(0o755, "script.sh");
await $.chmod("u+x", "build.sh");

// Find commands
const node = await $.which("node");
console.log(node); // /usr/local/bin/node

// Test file properties
if (await $.test("-d", "src")) {
  console.log("src is a directory");
}
if (await $.test("-f", "package.json")) {
  console.log("package.json exists");
}

// Temp directory
const tmp = $.tempdir();
console.log(tmp); // /tmp or project/.temp
```

---

## Timing

Async delay utilities.

**API:**

```typescript
$.sleep(ms: number): Promise<void>
$.delay(ms: number): Promise<void>  // Alias for sleep
```

**Examples:**

```javascript
// Wait 1 second
await $.sleep(1000);

// Delay between operations
console.log("Starting...");
await $.delay(2000);
console.log("Done!");

// Retry with delay
for (let i = 0; i < 3; i++) {
  try {
    const result = await $.cmd("flaky-command").exec();
    if (result.success) break;
  } catch {
    await $.sleep(1000 * (i + 1)); // Exponential backoff
  }
}
```

---

## State Variables

Variables that persist with the shell session (shellId).

**API:**

```typescript
$.ID: string           // Shell session ID (readonly)
$.ProjectDir: string   // Project directory path (readonly)
$.CWD: string          // Current working directory (getter, updates with cd)
$.ENV: object          // Environment variables (modifiable)
$.VARS: object         // Session variables (modifiable)
```

**Examples:**

```javascript
// Shell ID
console.log("Session:", $.ID);

// Project directory
console.log("Project:", $.ProjectDir);

// Current directory (updates with cd)
console.log("Initial:", $.CWD);
$.cd("/tmp");
console.log("After cd:", $.CWD); // /tmp

// Environment variables (synced to Deno.env)
$.ENV.MY_VAR = "value";
console.log(Deno.env.get("MY_VAR")); // 'value'

delete $.ENV.MY_VAR;
console.log(Deno.env.get("MY_VAR")); // undefined

// Session variables (not in env)
$.VARS.counter = 0;
$.VARS.counter++;
console.log($.VARS.counter); // 1

// Use in commands
const result = await $.cmd("sh", "-c", `echo $MY_VAR`).exec();
```

---

## Path Expansion

Path and variable expansion in different contexts.

### In `shcmd` Mode (Shell Command Execution)

```javascript
// Tilde expansion
~           → user home directory
~/Desktop   → /Users/username/Desktop

// Variable expansion
$VAR        → value of VAR environment variable
${VAR}      → value of VAR (braced form)
${HOME}     → user home directory
${CWD}      → current working directory
```

### In `code` Mode (TypeScript/JavaScript)

```javascript
// Tilde expansion in shell-like utils
await $.fs.read("~/config.json"); // Expands ~
await $.mkdir("~/projects/new"); // Expands ~

// Also in $.fs operations
const home = await $.fs.read("~/.bashrc");
```

**Examples:**

```javascript
// Shell command with expansion
const result = await $.cmd("sh", "-c", "ls $HOME").exec();

// File operations with tilde
const config = await $.fs.read("~/config.json");
await $.fs.write("~/output.txt", data);

// Path building
const userFile = $.path.join("~", "Documents", "file.txt");
// Note: ~ expansion happens in fs operations, not in path.join
```

---

## Quick Reference

### Common Patterns

```javascript
// File processing
const errors = await $.glob("logs/*.log")
  .flatMap((f) => f.contents.toString().split("\n"))
  .filter((line) => line.includes("ERROR"))
  .collect();

// Command pipeline
const result = await $.str(data)
  .pipe("grep", ["pattern"])
  .pipe("sort")
  .pipe("uniq")
  .exec();

// Stream transformation
const lines = await $.cat("input.txt")
  .lines()
  .filter((line) => line.trim().length > 0)
  .map((line) => line.toUpperCase())
  .collect();

// Parallel processing
const results = await Promise.all([
  $.git("status").exec(),
  $.git("log", "-1").exec(),
  $.git("branch").exec(),
]);

// Error handling
const build = await $.cmd("make", "build").exec();
if (!build.success) {
  console.error("Build failed:", build.stderr);
  Deno.exit(1);
}
```

---

## Notes

- **Async/Await:** Most operations are async and require `await`
- **Sandbox:** All file operations respect configured permissions
- **Streams:** Operations are lazy - nothing happens until terminal operation (`.collect()`, `.forEach()`, etc.)
- **Chaining:** Most methods return the same type for chaining
- **ShellString:** Commands like `$.pwd()` return ShellString, which works with `$.path.*` utilities
- **File.contents:** This is a **property**, not a method - use `f.contents`, not `f.contents()`

---

**Version:** 1.0.0
**Last Updated:** 2026-01-03
