# Streaming Shell API

A Gulp-inspired streaming API for TypeScript shell operations with lazy evaluation, proper stdout/stderr handling, and type-safe async iterator-based transforms.

## Table of Contents

- [Fluent Shell API ($)](#fluent-shell-api-)
- [Quick Start](#quick-start)
- [MCP Server Integration](#mcp-server-integration)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Common Patterns](#common-patterns)
- [Performance](#performance)
- [Migration Guide](#migration-guide)
- [Example Scripts](#example-scripts)

## Fluent Shell API ($)

The **recommended** way to use SafeShell is through the fluent `$` API - a simple, chainable interface for file-based text processing:

```typescript
// Process log files with shell-like syntax
await $('app.log').lines().grep(/ERROR/).head(10).print();

// Collect results into array
const errors = await $('app.log').lines().grep(/ERROR/).collect();

// Transform and save
await $('data.txt').lines().map(l => l.toUpperCase()).save('output.txt');

// Count, filter, analyze
const errorCount = await $('server.log').lines().grep(/ERROR/).count();
const firstError = await $('app.log').lines().grep(/FATAL/).first();

// Create from arrays or text
const fruits = await $.from(['apple', 'banana', 'cherry']).grep(/a/).collect();
const lines = await $.text('line1\nline2').lines().collect();
```

### $ API Methods

| Method | Type | Description |
|--------|------|-------------|
| `$('file.txt')` | Constructor | Create from file path |
| `$.from(array)` | Constructor | Create from string array |
| `$.text(string)` | Constructor | Create from text content |
| `$.wrap(stream)` | Constructor | Wrap existing Stream |
| `.lines()` | Transform | Split into lines |
| `.grep(pattern)` | Transform | Filter by regex/string |
| `.head(n)` | Transform | Take first n items |
| `.tail(n)` | Transform | Take last n items |
| `.filter(fn)` | Transform | Filter with predicate |
| `.map(fn)` | Transform | Transform items |
| `.take(n)` | Transform | Alias for head() |
| `.print()` | Terminal | Output to stdout |
| `.save(path)` | Terminal | Write to file |
| `.collect()` | Terminal | Return as array |
| `.first()` | Terminal | Get first item |
| `.count()` | Terminal | Count items |
| `.forEach(fn)` | Terminal | Iterate with function |
| `.stream()` | Escape | Get underlying Stream |

### Escape Hatch

When you need advanced Stream operations, use `.stream()` to access the full Stream API:

```typescript
const stream = $('data.txt').lines().stream();
await stream.pipe(customTransform()).pipe(flatMap(fn)).collect();
```

## Quick Start

For advanced streaming operations beyond the `$` API:

```typescript
// Low-level streaming with pipe()
const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .collect();

// File operations with glob
await src("src/**/*.ts")
  .pipe(filter((f) => !f.path.includes(".test.")))
  .pipe(dest("dist/"));

// Command execution
const result = await git("status").exec();
console.log(result.stdout);
```

## MCP Server Integration

The streaming shell API is fully available when SafeShell runs as an MCP server. The `$` API and all streaming functions are auto-imported and ready to use.

### Using Through MCP Tools

```typescript
// Through Claude Desktop or other MCP clients
// Use the 'run' tool with code

// Fluent $ API (recommended)
{
  "code": "const errors = await $('app.log').lines().grep(/ERROR/).head(10).collect(); console.log('Errors:', errors);"
}

// Or with streaming API
{
  "code": `
    const errors = await cat("app.log")
      .pipe(lines())
      .pipe(grep(/ERROR/))
      .pipe(take(10))
      .collect();

    console.log("Found errors:", errors);
  `
}
```

### Real-World MCP Examples

#### Code Analysis Tasks

```typescript
// Find SSH-related commits
{
  "code": `
    const commits = await git("log", "--oneline")
      .stdout()
      .pipe(lines())
      .pipe(grep(/SSH/))
      .pipe(take(10))
      .collect();

    console.log("SSH commits:", commits);
  `
}

// Extract TODO comments
{
  "code": `
    const todos = await glob("**/*.ts")
      .pipe(flatMap(file =>
        cat(file.path)
          .pipe(lines())
          .pipe(grep(/TODO/))
          .pipe(map(line => ({ file: file.path, line })))
      ))
      .collect();

    console.log("Found TODOs:", todos);
  `
}
```

#### Metrics & Reporting

```typescript
// Count lines of code by module
{
  "code": `
    const modules = ["core", "stdlib", "mcp"];
    const metrics = {};

    for (const module of modules) {
      const count = await glob(\`src/\${module}/**/*.ts\`)
        .pipe(filter(f => !f.path.includes(".test.")))
        .pipe(flatMap(file => cat(file.path).pipe(lines())))
        .count();

      metrics[module] = count;
    }

    console.log("Lines of code:", metrics);
  `
}

// Find large files needing refactoring
{
  "code": `
    const largeFiles = await glob("src/**/*.ts")
      .pipe(filter(async file => {
        const lineCount = await cat(file.path).pipe(lines()).count();
        return lineCount > 400;
      }))
      .pipe(map(async file => ({
        path: file.path,
        lines: await cat(file.path).pipe(lines()).count()
      })))
      .collect();

    console.log("Large files:", largeFiles);
  `
}
```

#### Git Operations

```typescript
// Check repository status
{
  "code": `
    const status = await git("status", "--short")
      .stdout()
      .pipe(lines())
      .collect();

    console.log("Modified files:", status);
  `
}

// Analyze commit history
{
  "code": `
    const commitTypes = new Map();

    await git("log", "--oneline", "--since='1 month ago'")
      .stdout()
      .pipe(lines())
      .pipe(map(line => {
        const match = line.match(/^[a-f0-9]+ (\\w+):/);
        return match ? match[1] : "other";
      }))
      .forEach(type => {
        commitTypes.set(type, (commitTypes.get(type) || 0) + 1);
      });

    console.log("Commit breakdown:", Object.fromEntries(commitTypes));
  `
}
```

### Benefits Over Traditional Bash Tool

| Traditional Bash | Streaming Shell via MCP |
|-----------------|------------------------|
| `git log --oneline \| grep SSH \| head -10` | `await git('log', '--oneline').stdout().pipe(lines()).pipe(grep(/SSH/)).pipe(take(10)).collect()` |
| No type safety | Full TypeScript support |
| String manipulation only | Rich data transformations |
| Sequential execution | Composable pipelines |
| Manual error handling | Automatic error propagation |
| Limited debugging | Stack traces and breakpoints |

### Auto-imported Functions

When using the MCP `run` tool, these are automatically available:

**Fluent Shell API (Primary):**
- `$('file')` - Create from file path
- `$.from(array)` - Create from array
- `$.text(string)` - Create from text
- `$.wrap(stream)` - Wrap existing stream

**Core Streams:**
- `createStream()`, `fromArray()`, `empty()`

**Transforms:**
- `filter()`, `map()`, `flatMap()`, `take()`, `head()`, `tail()`
- `lines()`, `grep()`

**I/O:**
- `stdout()`, `stderr()`, `tee()`

**File System:**
- `fs.*` - read, write, exists, readJson, writeJson, etc.
- `glob()`, `src()`, `cat()`, `dest()`

**Commands:**
- `cmd()`, `git()`, `docker()`, `deno()`

**ShellJS-like:**
- `pwd()`, `which()`, `test()`, `echo()`, `cd()`, etc.

**Shell Context:**
- `$shell` - Persistent state (id, cwd, env, vars)

No imports needed - just start using them!

## Core Concepts

### Streams

Streams are lazy async iterables that only execute when consumed by a terminal operation:

```typescript
// Create stream (doesn't execute yet)
const stream = fromArray([1, 2, 3])
  .pipe(map((x) => x * 2));

// Execute with terminal operation
const result = await stream.collect(); // [2, 4, 6]
```

### Transforms

Transforms are pure functions that return async generators. They can be chained with `.pipe()`:

```typescript
const transform1 = filter((x) => x > 0);
const transform2 = map((x) => x * 2);

const result = await stream
  .pipe(transform1)
  .pipe(transform2)
  .collect();
```

### Terminal Operations

Operations that consume the stream and return results:

- `collect()` - Collect all items into an array
- `forEach(fn)` - Execute function for each item
- `first()` - Get first item
- `count()` - Count total items

## API Reference

### Core Stream (`safesh:stream`)

#### `createStream<T>(iterable: AsyncIterable<T>): Stream<T>`

Create a stream from an async iterable.

```typescript
const stream = createStream(async function* () {
  yield 1;
  yield 2;
  yield 3;
});
```

#### `fromArray<T>(items: T[]): Stream<T>`

Create a stream from an array.

```typescript
const stream = fromArray([1, 2, 3]);
```

#### `empty<T>(): Stream<T>`

Create an empty stream.

```typescript
const stream = empty<number>();
```

### Transform Functions (`safesh:transforms`)

#### `filter<T>(predicate: (item: T) => boolean | Promise<boolean>): Transform<T, T>`

Filter items based on a predicate.

```typescript
const evens = stream.pipe(filter((x) => x % 2 === 0));
```

#### `map<T, U>(fn: (item: T) => U | Promise<U>): Transform<T, U>`

Transform each item.

```typescript
const doubled = stream.pipe(map((x) => x * 2));
```

#### `flatMap<T, U>(fn: (item: T) => AsyncIterable<U>): Transform<T, U>`

Transform and flatten nested iterables.

```typescript
const chars = stream.pipe(
  flatMap(async function* (str) {
    for (const char of str) {
      yield char;
    }
  })
);
```

#### `take<T>(n: number): Transform<T, T>`

Take only the first n items.

```typescript
const first10 = stream.pipe(take(10));
```

#### `lines(): Transform<string, string>`

Split text into lines.

```typescript
const textLines = textStream.pipe(lines());
```

#### `grep(pattern: RegExp | string): Transform<string, string>`

Filter lines matching a pattern.

```typescript
const errors = logStream
  .pipe(lines())
  .pipe(grep(/ERROR/));
```

### I/O Transforms (`safesh:io`)

#### `stdout(): Transform<string, string>`

Write to stdout and pass through.

```typescript
await stream
  .pipe(stdout())
  .forEach(() => {});
```

#### `stderr(): Transform<string, string>`

Write to stderr and pass through.

```typescript
await errorStream
  .pipe(stderr())
  .forEach(() => {});
```

#### `tee<T>(sideEffect: Transform<T, T>): Transform<T, T>`

Apply side effect while passing through.

```typescript
const data = await stream
  .pipe(tee(stdout()))
  .collect();
```

### File System Streams (`safesh:fs-streams`)

#### `File` Interface

```typescript
interface File {
  path: string;              // Absolute path
  base: string;              // Base directory
  contents: string | Uint8Array;  // File contents
  stat?: Deno.FileInfo;      // Optional file stats
}
```

#### `glob(pattern: string, options?: GlobOptions): Stream<File>`

Stream files matching a glob pattern.

```typescript
await glob("src/**/*.ts")
  .pipe(filter((f) => !f.path.includes(".test.")))
  .pipe(dest("dist/"));
```

#### `src(...patterns: string[]): Stream<File>`

Stream files from multiple glob patterns.

```typescript
await src("src/**/*.ts", "lib/**/*.ts")
  .pipe(dest("dist/"));
```

#### `cat(path: string): Stream<string>`

Read file as a stream.

```typescript
await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .collect();
```

#### `dest(outDir: string): Transform<File, File>`

Write files to a directory.

```typescript
await src("src/**/*.ts")
  .pipe(dest("dist/"));
```

### Command Execution (`safesh:command`)

#### `Command` Class

```typescript
class Command {
  exec(): Promise<CommandResult>;
  stream(): AsyncGenerator<StreamChunk>;
  stdout(): Stream<string>;
  stderr(): Stream<string>;
}
```

#### `cmd(command: string, args?: string[], options?: CommandOptions): Command`

Create a command.

```typescript
const result = await cmd("echo", ["hello"]).exec();
```

#### `git(...args: string[]): Command`

Create a git command.

```typescript
const status = await git("status").exec();
```

#### Command Options

```typescript
interface CommandOptions {
  mergeStreams?: boolean;  // Merge stderr into stdout
  cwd?: string;            // Working directory
  env?: Record<string, string>;  // Environment variables
  clearEnv?: boolean;      // Clear inherited environment
}
```

## Common Patterns

### Log File Analysis

```typescript
// Find all errors in log file
const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .collect();

// Count errors by type
const errorCounts = new Map<string, number>();

await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(map((line) => line.match(/ERROR: (\w+)/)?.[1] ?? "unknown"))
  .forEach((type) => {
    errorCounts.set(type, (errorCounts.get(type) ?? 0) + 1);
  });
```

### File Processing

```typescript
// Copy and transform files
await src("src/**/*.ts")
  .pipe(filter((f) => !f.path.includes(".test.")))
  .pipe(map(async (file) => {
    // Add header comment
    if (typeof file.contents === "string") {
      file.contents = "// Auto-generated\n" + file.contents;
    }
    return file;
  }))
  .pipe(dest("dist/"));

// Find TODO comments
await glob("**/*.ts")
  .pipe(flatMap((file) =>
    cat(file.path)
      .pipe(lines())
      .pipe(grep(/TODO/))
      .pipe(map((line) => ({ file: file.path, line })))
  ))
  .forEach(({ file, line }) => {
    console.log(`${file}: ${line}`);
  });
```

### Command Pipelines

```typescript
// Process git log
await git("log", "--oneline")
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix:/))
  .pipe(stdout())
  .forEach(() => {});

// Parallel command processing
const [status, diff] = await Promise.all([
  git("status", "--short").exec(),
  git("diff", "--stat").exec(),
]);
```

### Combining Multiple Sources

```typescript
// Merge outputs from multiple commands
async function* combined() {
  yield* await cmd("echo", ["first"]).stdout().collect();
  yield* await cmd("echo", ["second"]).stdout().collect();
}

const all = await createStream(combined()).collect();
```

## Performance

### Memory Efficiency

Streams process data lazily without loading everything into memory:

```typescript
// Efficient: processes one line at a time
await cat("huge-file.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(take(10))
  .collect();

// Inefficient: loads entire file
const allLines = (await Deno.readTextFile("huge-file.log")).split("\n");
const errors = allLines.filter((line) => line.includes("ERROR")).slice(0, 10);
```

### Early Termination

Use `take()` to stop processing early:

```typescript
// Stops after finding 10 errors
const first10Errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(take(10))
  .collect();
```

### Parallelization

Process multiple streams concurrently:

```typescript
// Process files in parallel
const results = await Promise.all([
  cat("file1.log").pipe(lines()).count(),
  cat("file2.log").pipe(lines()).count(),
  cat("file3.log").pipe(lines()).count(),
]);
```

## Migration Guide

### From Shell Scripts

#### Grep and Filter

```bash
# Shell
cat app.log | grep ERROR | head -10
```

```typescript
// SafeShell - Fluent API (recommended)
await $('app.log').lines().grep(/ERROR/).head(10).print();

// SafeShell - Streaming API
await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(take(10))
  .pipe(stdout())
  .forEach(() => {});
```

#### Find and Process Files

```bash
# Shell
find src -name "*.ts" -not -path "*/test/*" -exec cp {} dist/ \;
```

```typescript
// SafeShell
await glob("src/**/*.ts")
  .pipe(filter((f) => !f.path.includes("/test/")))
  .pipe(dest("dist/"));
```

#### Command Pipelines

```bash
# Shell
git log --oneline | grep fix | wc -l
```

```typescript
// SafeShell
const count = await git("log", "--oneline")
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix/))
  .count();
```

#### Quick Text Processing

```bash
# Shell
head -5 file.txt
tail -10 file.txt
wc -l file.txt
```

```typescript
// SafeShell - Fluent API
const first5 = await $('file.txt').lines().head(5).collect();
const last10 = await $('file.txt').lines().tail(10).collect();
const lineCount = await $('file.txt').lines().count();
```

### From Node.js Streams

```javascript
// Node.js
const stream = require("stream");
const { pipeline } = require("stream/promises");

await pipeline(
  fs.createReadStream("input.txt"),
  split(),
  through((line) => line.toUpperCase()),
  fs.createWriteStream("output.txt")
);
```

```typescript
// Safesh Streaming
await cat("input.txt")
  .pipe(lines())
  .pipe(map((line) => line.toUpperCase()))
  .pipe(async function* (stream) {
    const lines = [];
    for await (const line of stream) {
      lines.push(line);
    }
    await Deno.writeTextFile("output.txt", lines.join("\n"));
  })
  .forEach(() => {});
```

### From Gulp

```javascript
// Gulp
gulp.src("src/**/*.js")
  .pipe(babel())
  .pipe(uglify())
  .pipe(gulp.dest("dist/"));
```

```typescript
// Safesh Streaming
await src("src/**/*.js")
  .pipe(map(async (file) => {
    // Transform file.contents
    return file;
  }))
  .pipe(dest("dist/"));
```

## Advanced Topics

### Custom Transforms

Create your own transforms:

```typescript
function uppercase(): Transform<string, string> {
  return async function* (stream) {
    for await (const item of stream) {
      yield item.toUpperCase();
    }
  };
}

await stream.pipe(uppercase()).collect();
```

### Error Handling

Handle errors in streams:

```typescript
try {
  await cat("file.txt")
    .pipe(lines())
    .collect();
} catch (error) {
  console.error("Failed to process file:", error);
}
```

### Type Safety

Leverage TypeScript's type system:

```typescript
const numbers: Stream<number> = fromArray([1, 2, 3]);
const strings: Stream<string> = numbers.pipe(map((n) => n.toString()));
const filtered: Stream<string> = strings.pipe(filter((s) => s.length > 0));
```

## Example Scripts

The `scripts/` directory contains real-world examples of the streaming shell API in action:

### `code-audit.ts`

Comprehensive codebase audit tool that demonstrates:

- Finding debug statements with `grep()` and `filter()`
- Extracting TODO comments across files
- Checking test coverage
- Identifying long files for refactoring
- Git status checks
- Anti-pattern detection

Run with:
```bash
deno run --allow-all scripts/code-audit.ts
```

### `dev-tasks.ts`

Common development tasks showcasing how to replace bash commands:

- Git log analysis: `git log | grep | head` → streaming pipeline
- File counting: `find | wc -l` → `glob().count()`
- TODO extraction: `grep -r` → `flatMap()` with `cat()`
- Log processing: `cat | grep | sed` → chained transforms
- File copying with transforms: `cp` + modifications → `src().pipe(dest())`

Run with:
```bash
deno run --allow-all scripts/dev-tasks.ts
```

Both scripts demonstrate how the streaming shell API provides a more powerful, type-safe alternative to traditional shell scripts while maintaining composability and readability.

## See Also

- [Core Stream Implementation](../src/stdlib/stream.ts)
- [Transform Functions](../src/stdlib/transforms.ts)
- [File System Streams](../src/stdlib/fs-streams.ts)
- [Command Execution](../src/stdlib/command.ts)
- [Example Scripts](../scripts/)
