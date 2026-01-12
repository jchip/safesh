# SafeShell API Reference

Complete API documentation for SafeShell ($.\*)

## Table of Contents

- [Type Definitions](#type-definitions)
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

## Type Definitions

Core TypeScript types used throughout the SafeShell API.

### Command Types

```typescript
// Command execution result
interface CommandResult {
  code: number;           // Exit code
  stdout: string;         // Standard output
  stderr: string;         // Standard error
  success: boolean;       // true if code === 0
}

// Command configuration options
interface CommandOptions {
  cwd?: string;                      // Working directory
  env?: Record<string, string>;      // Environment variables
  stdin?: "inherit" | "piped" | "null";
  stdout?: "inherit" | "piped" | "null";
  stderr?: "inherit" | "piped" | "null";
}

// Command function type (from $.initCmds)
type CommandFn = (...args: string[]) => Command;
```

### File and Glob Types

```typescript
// File object returned by $.glob() and $.src()
interface File {
  path: string;                    // Absolute path
  base: string;                    // Base directory for relative paths
  contents: string | Uint8Array;   // File contents (property, not method!)
  stat?: Deno.FileInfo;           // File stats (present after read)
}

// Glob entry with metadata
interface GlobEntry {
  path: string;        // Absolute path
  name: string;        // File/directory name
  isFile: boolean;     // Is a regular file
  isDirectory: boolean;// Is a directory
  isSymlink: boolean;  // Is a symbolic link
}
```

### Text Processing Types

```typescript
// Grep match result
interface GrepMatch {
  line: number;        // Line number (1-indexed)
  content: string;     // Full line content
  match: string;       // The matched text
}

// Text statistics
interface TextStats {
  lines: number;       // Number of lines
  words: number;       // Number of words
  chars: number;       // Number of characters
  bytes: number;       // Number of bytes
}

// Sort options
interface SortOptions {
  numeric?: boolean;   // Sort numerically
  reverse?: boolean;   // Reverse order
  unique?: boolean;    // Remove duplicates
}

// Uniq options
interface UniqOptions {
  count?: boolean;     // Return {line, count}[] instead of string[]
  ignoreCase?: boolean;// Case-insensitive comparison
}

// Cut options
interface CutOptions {
  delimiter?: string;  // Field delimiter (default: tab)
  fields?: number[];   // Field numbers to extract (1-indexed)
}
```

### Stream Types

```typescript
// Generic transform function
type Transform<T, U> = (stream: AsyncIterable<T>) => AsyncIterable<U>;

// Stream predicate
type Predicate<T> = (item: T, index: number) => boolean | Promise<boolean>;

// Stream mapper
type Mapper<T, U> = (item: T, index: number) => U | Promise<U>;
```

### Shell Types

```typescript
// ShellString - returned by $.pwd(), $.cd()
// Extends String with additional methods
interface ShellString extends String {
  toString(): string;
  valueOf(): string;
}
```

---

## Utility Objects

### $.fs - File System

Async file I/O operations that respect sandbox permissions.

**API:**

```typescript
// Text file operations
$.fs.read(path: string): Promise<string>
$.fs.write(path: string, content: string): Promise<void>
$.fs.append(path: string, content: string): Promise<void>

// Binary file operations
$.fs.readBytes(path: string): Promise<Uint8Array>
$.fs.writeBytes(path: string, data: Uint8Array): Promise<void>

// JSON operations
$.fs.readJson<T>(path: string): Promise<T>
$.fs.writeJson(path: string, data: unknown, options?: { spaces?: number }): Promise<void>

// File info
$.fs.exists(path: string): Promise<boolean>
$.fs.stat(path: string): Promise<Deno.FileInfo | null>

// File management
$.fs.remove(path: string, options?: { recursive?: boolean }): Promise<void>
$.fs.mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
$.fs.ensureDir(path: string): Promise<void>
$.fs.copy(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void>
$.fs.move(src: string, dest: string): Promise<void>
$.fs.touch(path: string): Promise<void>
$.fs.symlink(target: string, link: string): Promise<void>

// Directory operations
$.fs.readDir(path: string): Promise<Deno.DirEntry[]>
$.fs.walk(root: string, options?: WalkOptions): AsyncIterable<WalkEntry>
$.fs.find(pattern: string): Promise<string[]>
```

**Examples:**

```javascript
// Read/write text files
const content = await $.fs.read("config.json");
await $.fs.write("output.txt", "Hello, world!");
await $.fs.append("log.txt", "New entry\n");

// JSON operations
const config = await $.fs.readJson("config.json");
await $.fs.writeJson("data.json", { name: "test" }, { spaces: 2 });

// Binary files
const bytes = await $.fs.readBytes("image.png");
await $.fs.writeBytes("copy.png", bytes);

// File checks
if (await $.fs.exists("file.txt")) {
  const stat = await $.fs.stat("file.txt");
  console.log("Size:", stat?.size);
}

// Directory operations
await $.fs.ensureDir("logs/2024");
await $.fs.mkdir("temp/nested/dirs", { recursive: true });

// Copy/move
await $.fs.copy("src.txt", "dest.txt");
await $.fs.move("old.txt", "new.txt");

// Walk directory tree
for await (const entry of $.fs.walk("src")) {
  if (entry.isFile && entry.name.endsWith(".ts")) {
    console.log(entry.path);
  }
}

// Find files by pattern
const logs = await $.fs.find("logs/**/*.log");
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
$.path.parse(path: string): { root, dir, base, ext, name }
$.path.format(pathObject: { root?, dir?, base?, ext?, name? }): string
$.path.toFileUrl(path: string): URL
$.path.fromFileUrl(url: string | URL): string
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
// String operations
$.text.trim(input: string | string[], mode?: 'both' | 'left' | 'right'): string | string[]
$.text.lines(input: string): string[]
$.text.joinLines(lines: string[], separator?: string): string
$.text.head(input: string, n?: number): string[]
$.text.tail(input: string, n?: number): string[]
$.text.grep(pattern: RegExp | string, input: string): GrepMatch[]
$.text.replace(input: string, pattern: RegExp | string, replacement: string): string
$.text.sort(input: string | string[], options?: SortOptions): string[]
$.text.uniq(input: string | string[], options?: UniqOptions): string[] | {line, count}[]
$.text.count(input: string): TextStats
$.text.cut(input: string | string[], options?: CutOptions): string[]
$.text.filter(input: string | string[], predicate: (line: string, idx: number) => boolean): string[]
$.text.map(input: string | string[], mapper: (line: string, idx: number) => string): string[]

// File-based operations (read file, process, return result)
$.text.grepFiles(pattern: RegExp | string, path: string, options?: GrepOptions): Promise<GrepMatch[]>
$.text.headFile(path: string, n?: number): Promise<string[]>
$.text.tailFile(path: string, n?: number): Promise<string[]>
$.text.countFile(path: string): Promise<TextStats>
$.text.replaceFile(path: string, pattern: RegExp | string, replacement: string): Promise<string>
$.text.diffFiles(oldPath: string, newPath: string): Promise<DiffLine[]>
```

**Examples:**

```javascript
// Trim - returns string for single-line, array for multi-line
$.text.trim("  hello  "); // → 'hello' (string)
$.text.trim("  a  \n  b  "); // → ['a', 'b'] (array)
$.text.trim("  hello  ", "left"); // → 'hello  '

// Split and join lines
const lines = $.text.lines("line1\nline2\nline3");
// → ['line1', 'line2', 'line3']
const joined = $.text.joinLines(lines, "\n");

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

// Filter and map
const nonEmpty = $.text.filter(lines, line => line.trim().length > 0);
const upper = $.text.map(lines, line => line.toUpperCase());

// File-based operations
const matches = await $.text.grepFiles(/ERROR/, "app.log");
const first10 = await $.text.headFile("data.txt", 10);
const last20 = await $.text.tailFile("log.txt", 20);
const fileStats = await $.text.countFile("document.md");
const diff = await $.text.diffFiles("old.txt", "new.txt");
```

---

## Commands

All commands return a `Command` object with methods:

- `.exec()` → `{code: number, stdout: string, stderr: string, success: boolean}`
- `.stdout()` → `FluentStream<string>`
- `.stderr()` → `FluentStream<string>`
- `.pipe(cmd, args)` → `Command` (for chaining)
- `.trans(transform)` → `FluentStream<U>` (convenience for `.stdout().trans(transform)`)

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

Execute any command. Intentionally not documented in MCP instructions.

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
.pipe(commandFn: CommandFn, args?: string[]): FluentStream<string>
.trans<U>(transform: Transform<T, U>): FluentStream<U>  // alias for pipe(transform)

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

### Direct Array Functions

For simple cases where you just need paths or entries without streaming.

**API:**

```typescript
$.globPaths(pattern: string): Promise<string[]>
$.globArray(pattern: string): Promise<GlobEntry[]>
```

**Examples:**

```javascript
// Get file paths directly (no .collect() needed)
const paths = await $.globPaths("src/**/*.ts");
// → ['/project/src/main.ts', '/project/src/utils.ts', ...]

// Get full entries with metadata
const entries = await $.globArray("*.json");
// → [{path: '/project/package.json', name: 'package.json', isFile: true, ...}, ...]

// Use in loops
for (const path of await $.globPaths("tests/*.test.ts")) {
  console.log(`Running ${path}`);
}
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
// Collection transforms
$.filter(predicate): Transform<T, T>
$.map(fn): Transform<T, U>
$.flatMap(fn): Transform<T, U>
$.take(n): Transform<T, T>
$.head(n): Transform<T, T>
$.tail(n): Transform<T, T>

// String/text transforms
$.lines(): Transform<string, string>
$.grep(pattern): Transform<string, string>

// Command transforms
$.toCmd(cmd, args): Transform<string, string>
$.toCmdLines(cmd, args): Transform<string, string>

// JSON transforms
$.jq(query: string, options?: JqOptions): Transform<string, string>
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

// Parse JSON with jq-like queries
const names = await $.cat("data.json")
  .pipe($.jq(".users[].name"))
  .collect();

// jq with options
const compact = await $.cat("data.json")
  .pipe($.jq(".items", { compact: true }))
  .collect();
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

## Deno File Aliases

Direct aliases for Deno file operations, available on the `$` object.

**API:**

```typescript
// Async file operations
$.writeFile(path: string, data: Uint8Array): Promise<void>
$.writeTextFile(path: string, data: string): Promise<void>
$.readFile(path: string): Promise<Uint8Array>
$.readTextFile(path: string): Promise<string>
$.readDir(path: string): AsyncIterable<Deno.DirEntry>
$.readLink(path: string): Promise<string>

// Sync file operations
$.writeFileSync(path: string, data: Uint8Array): void
$.writeTextFileSync(path: string, data: string): void
$.readFileSync(path: string): Uint8Array
$.readTextFileSync(path: string): string
$.readDirSync(path: string): Iterable<Deno.DirEntry>
$.readLinkSync(path: string): string
```

**Examples:**

```javascript
// Async operations
const content = await $.readTextFile("file.txt");
await $.writeTextFile("output.txt", "Hello");

// Binary files
const bytes = await $.readFile("image.png");
await $.writeFile("copy.png", bytes);

// Iterate directory
for await (const entry of $.readDir("src")) {
  console.log(entry.name, entry.isFile);
}

// Sync operations (use sparingly)
const data = $.readTextFileSync("config.json");
```

---

## Advanced Glob Utilities

Additional glob utility functions beyond the streaming API.

**API:**

```typescript
$.globPaths(pattern: string): Promise<string[]>
$.globArray(pattern: string): Promise<GlobEntry[]>
$.getGlobBase(pattern: string): string
$.hasMatch(pattern: string): Promise<boolean>
$.countMatches(pattern: string): Promise<number>
$.findFirst(pattern: string): Promise<string | undefined>
```

**Examples:**

```javascript
// Get paths directly (no streaming)
const paths = await $.globPaths("src/**/*.ts");
// → ['/project/src/main.ts', ...]

// Get full entries with metadata
const entries = await $.globArray("*.json");
// → [{path: '...', name: '...', isFile: true, ...}]

// Get the base directory of a glob pattern
const base = $.getGlobBase("src/**/*.ts");
// → 'src'

// Check if any files match
if (await $.hasMatch("logs/*.error")) {
  console.log("Error logs exist");
}

// Count matches
const count = await $.countMatches("**/*.test.ts");
console.log(`Found ${count} test files`);

// Get first match
const first = await $.findFirst("config.*.json");
```

---

## Environment Helpers

Helper functions for managing environment variables.

**API:**

```typescript
$.getEnv(name: string): string | undefined
$.setEnv(name: string, value: string): void
$.deleteEnv(name: string): void
$.getAllEnv(): Record<string, string>
```

**Examples:**

```javascript
// Get environment variable
const nodeEnv = $.getEnv("NODE_ENV");

// Set environment variable
$.setEnv("MY_VAR", "value");

// Delete environment variable
$.deleteEnv("TEMP_VAR");

// Get all environment variables
const env = $.getAllEnv();
console.log(env.HOME);

// These are also accessible via $.ENV proxy
$.ENV.MY_VAR = "value";  // Same as $.setEnv
delete $.ENV.MY_VAR;     // Same as $.deleteEnv
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

**Version:** 1.1.0
**Last Updated:** 2026-01-12
