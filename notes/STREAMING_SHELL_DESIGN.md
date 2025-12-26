# Streaming Shell Design

**Status**: Design Document
**Epic**: SSH-48
**Author**: Claude (AI Assistant)
**Date**: 2025-12-26

## Overview

Design for a Gulp-inspired streaming/piping API that provides shell-like operations in TypeScript with lazy evaluation, proper stdout/stderr handling, and composable transforms.

## Goals

1. **Gulp-inspired streaming** - Chainable pipes with lazy evaluation
2. **Deno glob integration** - Use Deno's built-in `expandGlob`
3. **Proper stream separation** - Default separate stdout/stderr, options to merge
4. **Type-safe** - Full TypeScript support with generics
5. **Memory efficient** - Async iterators for large data sets
6. **Composable** - Mix and match transforms

## Architecture

### Core Abstractions

```typescript
// 1. Stream - wraps AsyncIterable with pipe() method
interface Stream<T> extends AsyncIterable<T> {
  pipe<U>(transform: Transform<T, U>): Stream<U>

  // Terminal operations
  collect(): Promise<T[]>
  forEach(fn: (item: T) => void | Promise<void>): Promise<void>
  first(): Promise<T | undefined>
  count(): Promise<number>
}

// 2. Transform - function that transforms one stream to another
type Transform<T, U> = (stream: AsyncIterable<T>) => AsyncIterable<U>

// 3. File - object with metadata (like Vinyl from Gulp)
interface File {
  path: string              // absolute path
  base: string              // base directory
  contents: string | Uint8Array | ReadableStream
  stat?: Deno.FileInfo
}

// 4. Command - external command with stream access
interface CommandResult {
  stdout: string
  stderr: string
  output?: string  // Only present if mergeStreams: true
  code: number
  success: boolean
}

interface StreamChunk {
  type: 'stdout' | 'stderr' | 'exit'
  data?: string
  code?: number
}
```

### Stream Implementation

```typescript
class StreamImpl<T> implements Stream<T> {
  constructor(private iterable: AsyncIterable<T>) {}

  [Symbol.asyncIterator]() {
    return this.iterable[Symbol.asyncIterator]()
  }

  pipe<U>(transform: Transform<T, U>): Stream<U> {
    return new StreamImpl(transform(this.iterable))
  }

  async collect(): Promise<T[]> {
    const results: T[] = []
    for await (const item of this) {
      results.push(item)
    }
    return results
  }

  async forEach(fn: (item: T) => void | Promise<void>): Promise<void> {
    for await (const item of this) {
      await fn(item)
    }
  }
}

export function createStream<T>(iterable: AsyncIterable<T>): Stream<T> {
  return new StreamImpl(iterable)
}
```

## Key Components

### 1. File System Streams

#### glob() - Pattern matching

```typescript
// Returns stream of File objects
function glob(pattern: string, options?: GlobOptions): Stream<File>

// Multiple patterns (like gulp.src)
function src(...patterns: string[]): Stream<File>

// Example
await glob("src/**/*.ts")
  .pipe(filter(f => !f.path.includes("test")))
  .pipe(transform(async (file) => {
    file.contents = await minify(file.contents)
    return file
  }))
  .pipe(dest("dist/"))
```

#### cat() - Read file contents

```typescript
function cat(path: string): Stream<string>

// Example
await cat("access.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(stdout())
```

#### dest() - Write to destination

```typescript
function dest(outDir: string): Transform<File, File>

// Writes files to outDir, preserving relative structure
```

### 2. Common Transforms

All transforms are pure functions that return async generators:

```typescript
// Filter
export function filter<T>(
  predicate: (item: T) => boolean | Promise<boolean>
): Transform<T, T> {
  return async function* (stream) {
    for await (const item of stream) {
      if (await predicate(item)) yield item
    }
  }
}

// Map
export function map<T, U>(
  fn: (item: T) => U | Promise<U>
): Transform<T, U> {
  return async function* (stream) {
    for await (const item of stream) {
      yield await fn(item)
    }
  }
}

// FlatMap
export function flatMap<T, U>(
  fn: (item: T) => AsyncIterable<U>
): Transform<T, U> {
  return async function* (stream) {
    for await (const item of stream) {
      for await (const subItem of fn(item)) {
        yield subItem
      }
    }
  }
}

// Take
export function take<T>(n: number): Transform<T, T> {
  return async function* (stream) {
    let count = 0
    for await (const item of stream) {
      if (count++ >= n) break
      yield item
    }
  }
}

// Lines - split text into lines
export function lines(): Transform<string, string> {
  return async function* (stream) {
    for await (const text of stream) {
      for (const line of text.split('\n')) {
        if (line) yield line
      }
    }
  }
}

// Grep
export function grep(pattern: RegExp | string): Transform<string, string> {
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern
  return filter(line => regex.test(line))
}
```

### 3. Output Handling

**Key Decision**: Streams are lazy and silent by default. Explicit transforms for output.

```typescript
// stdout() - Write to stdout and pass through
export function stdout(): Transform<string, string> {
  return async function* (stream) {
    for await (const item of stream) {
      await Deno.stdout.write(new TextEncoder().encode(item + '\n'))
      yield item
    }
  }
}

// stderr() - Write to stderr and pass through
export function stderr(): Transform<string, string> {
  return async function* (stream) {
    for await (const item of stream) {
      await Deno.stderr.write(new TextEncoder().encode(item + '\n'))
      yield item
    }
  }
}

// tee() - Pass through while applying side effect
export function tee<T>(sideEffect: Transform<T, T>): Transform<T, T> {
  return async function* (stream) {
    const sideStream = sideEffect(stream)
    for await (const item of sideStream) {
      yield item
    }
  }
}

// Usage examples
// Silent - just collect
const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .collect()

// Print while collecting
const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(tee(stdout()))
  .collect()

// Just print
await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(stdout())
  .forEach(() => {})  // Terminal operation to execute
```

### 4. External Commands

**Key Decision**: Default separate streams, options to merge.

```typescript
interface CommandOptions {
  mergeStreams?: boolean  // Merge stderr into stdout
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

class Command {
  constructor(
    private cmd: string,
    private args: string[] = [],
    private options: CommandOptions = {}
  ) {}

  // Default: buffered execution
  async exec(): Promise<CommandResult> {
    if (this.options.mergeStreams) {
      // Merge: single output stream
      return {
        output: "...",  // interleaved
        stdout: "",
        stderr: "",
        code: 0,
        success: true
      }
    } else {
      // Separate: two buffers
      return {
        stdout: "...",
        stderr: "...",
        code: 0,
        success: true
      }
    }
  }

  // Streaming: real-time chunks
  async *stream(): AsyncGenerator<StreamChunk> {
    const process = new Deno.Command(this.cmd, {
      args: this.args,
      stdout: "piped",
      stderr: "piped"
    }).spawn()

    if (this.options.mergeStreams) {
      // Yield all chunks as 'stdout' type
      yield* this.mergeStreams(process.stdout, process.stderr)
    } else {
      // Yield chunks marked with source
      yield* this.separateStreams(process.stdout, process.stderr)
    }

    const status = await process.status
    yield { type: 'exit', code: status.code }
  }

  // Pipe-style: access individual streams
  stdout(): Stream<string> {
    return createStream(async function* (this: Command) {
      for await (const chunk of this.stream()) {
        if (chunk.type === 'stdout' && chunk.data) {
          yield chunk.data
        }
      }
    }.call(this))
  }

  stderr(): Stream<string> {
    return createStream(async function* (this: Command) {
      for await (const chunk of this.stream()) {
        if (chunk.type === 'stderr' && chunk.data) {
          yield chunk.data
        }
      }
    }.call(this))
  }

  private async *separateStreams(
    stdout: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>
  ): AsyncGenerator<StreamChunk> {
    const decoder = new TextDecoder()
    const stdoutReader = stdout.getReader()
    const stderrReader = stderr.getReader()

    const pending = [
      { reader: stdoutReader, type: 'stdout' as const },
      { reader: stderrReader, type: 'stderr' as const }
    ]

    // Race: yield whichever stream has data first (preserves interleaving)
    while (pending.length > 0) {
      const results = await Promise.race(
        pending.map(async ({ reader, type }) => {
          const result = await reader.read()
          return { ...result, type, reader }
        })
      )

      if (results.done) {
        const idx = pending.findIndex(p => p.reader === results.reader)
        pending.splice(idx, 1)
      } else if (results.value) {
        yield {
          type: results.type,
          data: decoder.decode(results.value, { stream: true })
        }
      }
    }
  }

  private async *mergeStreams(
    stdout: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>
  ): AsyncGenerator<StreamChunk> {
    // Same as separateStreams but yield all as 'stdout' type
    for await (const chunk of this.separateStreams(stdout, stderr)) {
      if (chunk.type !== 'exit') {
        yield { type: 'stdout', data: chunk.data }
      }
    }
  }
}

// Factory functions
export function cmd(
  command: string,
  args: string[] = [],
  options?: CommandOptions
): Command {
  return new Command(command, args, options)
}

export function git(...args: string[]): Command
export function git(options: CommandOptions, ...args: string[]): Command
export function git(...args: any[]): Command {
  const options = typeof args[0] === 'object' && !Array.isArray(args[0])
    ? args.shift()
    : {}
  return new Command('git', args, options)
}
```

### 5. Usage Examples

```typescript
// File processing (Gulp-style)
await src("src/**/*.ts")
  .pipe(filter(f => !f.path.includes(".test.")))
  .pipe(map(async f => {
    f.contents = await transform(f.contents)
    return f
  }))
  .pipe(dest("dist/"))

// Log analysis
const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(map(line => JSON.parse(line)))
  .pipe(filter(obj => obj.status === 500))
  .collect()

// Find TODOs across files
await glob("**/*.ts")
  .pipe(flatMap(file =>
    cat(file.path)
      .pipe(lines())
      .pipe(grep(/TODO/))
      .pipe(map(line => ({ file: file.path, line })))
  ))
  .forEach(({ file, line }) => {
    console.log(`${file}: ${line}`)
  })

// External commands - default separate streams
const result = await git("status").exec()
console.log("OUT:", result.stdout)
console.error("ERR:", result.stderr)

// External commands - merged streams
const result = await git("status", { mergeStreams: true }).exec()
console.log(result.output)  // Everything in order

// External commands - streaming
for await (const chunk of git("log").stream()) {
  switch (chunk.type) {
    case 'stdout':
      await Deno.stdout.write(new TextEncoder().encode(chunk.data))
      break
    case 'stderr':
      await Deno.stderr.write(new TextEncoder().encode(chunk.data))
      break
  }
}

// External commands - pipe stdout
await git("log")
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix:/))
  .pipe(stdout())
  .forEach(() => {})

// External commands - process both streams
const cmd = git("status")
await Promise.all([
  cmd.stdout().pipe(map(line => `OUT: ${line}`)).pipe(stdout()),
  cmd.stderr().pipe(map(line => `ERR: ${line}`)).pipe(stderr())
])
```

## Module Structure

```
src/stdlib/
├── stream.ts          # Core Stream implementation
├── transforms.ts      # Common transforms (map, filter, etc.)
├── io.ts             # stdout, stderr, tee
├── fs-streams.ts     # glob, src, dest, cat
└── command.ts        # Command class and helpers
```

## Implementation Plan

See Epic SSH-48 for breakdown into issues:

1. **Core Stream Implementation** (SSH-49)
   - Stream interface and class
   - createStream factory
   - Terminal operations (collect, forEach, first, count)

2. **Common Transforms** (SSH-50)
   - filter, map, flatMap, take
   - lines, grep
   - Tests for each

3. **I/O Transforms** (SSH-51)
   - stdout, stderr, tee
   - Tests with captured output

4. **File System Streams** (SSH-52)
   - glob integration with Deno.expandGlob
   - src, cat, dest
   - File object handling

5. **Command Execution** (SSH-53)
   - Command class
   - Separate/merged stream modes
   - Streaming API
   - Factory functions (git, docker, etc.)

6. **Integration & Auto-import** (SSH-54)
   - Add to executor preamble
   - Auto-import common functions
   - Integration tests

7. **Documentation** (SSH-55)
   - API reference
   - Examples
   - Migration guide from shell scripts

## Design Decisions

### Why Async Iterators over Node Streams?

- **Native to JavaScript**: No external dependencies
- **Simpler API**: Just `for await` loops
- **Better backpressure**: Built into the language
- **Type-safe**: Works seamlessly with TypeScript

### Why Lazy by Default?

- **Memory efficiency**: Don't load entire files into memory
- **Composability**: Build pipelines without executing
- **Performance**: Only process what's needed
- **Familiar**: Matches Gulp, RxJS, etc.

### Why Separate stdout/stderr by Default?

- **Information preservation**: Keep the distinction
- **Flexibility**: Let users decide how to handle
- **Debugging**: Easier to see what went where
- **Standard practice**: Most programming languages do this

## Future Extensions

1. **Parallel processing**: `parallel()` transform to process N items concurrently
2. **Batch operations**: `batch(n)` to group items
3. **Error handling**: `catch()` transform to handle errors in pipeline
4. **Progress tracking**: `progress()` transform with callbacks
5. **Caching**: `cache()` transform to memoize expensive operations

## References

- Gulp: https://gulpjs.com/
- Deno FS: https://deno.land/api?s=Deno.expandGlob
- Async Iterators: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of
