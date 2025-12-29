# SafeShell Standard Library Design

**Status**: Design Document
**Issue**: SSH-43
**Author**: Claude (AI Assistant)
**Date**: 2025-12-26

## Overview

This document formalizes the design contracts for SafeShell's standard library, ensuring consistency across all modules and providing clear guidelines for future development.

## Core Principles

### 1. Return Values, Never Print

**Rule**: All stdlib functions MUST return values. No function should print to stdout/stderr directly.

**Rationale**:
- Composability: Results can be chained and transformed
- Testability: Output can be captured and verified
- AI-friendliness: Structured data is easier to process than text

**Examples**:
```typescript
// ✅ GOOD: Returns result
const matches = grep(/pattern/, content);
console.log(matches.length);

// ❌ BAD: Prints directly
function grepAndPrint(pattern, content) {
  const matches = grep(pattern, content);
  console.log(matches);  // Don't do this in stdlib
}
```

### 2. AI-Friendly Error Messages

**Rule**: All errors MUST be `SafeShellError` instances with actionable suggestions.

**Rationale**:
- Helps AI assistants understand what went wrong
- Provides clear recovery paths
- Maintains security context

**Pattern**:
```typescript
import { pathViolation, executionError } from "../core/errors.ts";

// ✅ GOOD: Specific error with suggestion
if (!isPathAllowed(path, allowed)) {
  throw pathViolation(path, allowed);
}

// ❌ BAD: Generic error
if (!isPathAllowed(path, allowed)) {
  throw new Error(`Path not allowed: ${path}`);
}
```

### 3. Type Safety First

**Rule**: All functions MUST have explicit TypeScript types. No `any`.

**Rationale**:
- Catches errors at compile time
- Enables IDE autocomplete
- Documents API contracts

**Pattern**:
```typescript
// ✅ GOOD: Explicit types
export async function readJson<T = unknown>(
  path: string,
  options: SandboxOptions = {},
): Promise<T> { ... }

// ❌ BAD: Implicit any
export async function readJson(path, options) { ... }
```

## Namespace Organization

### fs.* - File System Operations

**Purpose**: File and directory operations with sandbox validation

**Naming Convention**:
- Verb-based: `read()`, `write()`, `copy()`, `move()`, `remove()`
- Noun-based for info: `stat()`, `exists()`
- Specialized readers: `readJson()`, `readBytes()`

**Standard Signature**:
```typescript
function operation(
  path: string,
  ...specificArgs,
  options: SandboxOptions = {},
): Promise<Result>
```

**Required Validation**:
- All paths MUST be validated against sandbox
- Use `validatePath()` from `../core/permissions.ts`
- Throw `pathViolation()` on sandbox violations

**Current Functions**:
- `read(path, options)` - Read file as string
- `readBytes(path, options)` - Read file as bytes
- `readJson<T>(path, options)` - Read and parse JSON
- `write(path, content, options)` - Write string to file
- `writeJson(path, data, options)` - Write JSON to file
- `append(path, content, options)` - Append to file
- `exists(path, options)` - Check if path exists
- `stat(path, options)` - Get file info
- `remove(path, options)` - Delete file/directory
- `mkdir(path, options)` - Create directory
- `copy(src, dest, options)` - Copy file/directory
- `move(src, dest, options)` - Move/rename file
- `touch(path, options)` - Create empty file or update mtime
- `readDir(path, options)` - List directory contents
- `walk(path, options)` - Recursively walk directory
- `find(path, predicate, options)` - Find files matching condition

**Return Types**:
- Simple operations: `Promise<void>`
- Data operations: `Promise<T>` (string, Uint8Array, T, etc.)
- Info operations: `Promise<Deno.FileInfo>`
- List operations: `Promise<Entry[]>` or `AsyncGenerator<Entry>`

### text.* - Text Processing

**Purpose**: Text manipulation and analysis (grep, sed, diff, etc.)

**Naming Convention**:
- Unix command names where appropriate: `grep()`, `head()`, `tail()`, `wc()`
- Descriptive for new functions: `replace()`, `split()`, `diff()`

**Dual Mode Pattern**:
Many text functions support both string input and file input:

```typescript
// String mode - no sandbox needed
export function grep(pattern: RegExp, input: string, options?): Match[]

// File mode - requires sandbox
export async function grepFiles(
  pattern: RegExp,
  glob: string,
  options: GrepOptions
): Promise<Match[]>
```

**Current Functions**:
- `grep(pattern, input, options)` - Search in string
- `grepFiles(pattern, glob, options)` - Search in files
- `head(input, n)` - First N lines
- `headFile(path, n, options)` - First N lines from file
- `tail(input, n)` - Last N lines
- `tailFile(path, n, options)` - Last N lines from file
- `wc(input)` - Count lines, words, chars
- `wcFile(path, options)` - Count in file
- `split(input, delimiter)` - Split string
- `replace(input, pattern, replacement)` - Replace text
- `sort(lines, options)` - Sort lines
- `uniq(lines)` - Remove duplicates
- `diff(left, right)` - Diff two texts

**Return Types**:
- Match operations: `Match[]` with `{ line, content, match, groups? }`
- Transform operations: `string`
- Count operations: `CountResult` with `{ lines, words, chars }`
- Diff operations: `DiffLine[]` with `{ type: 'add'|'remove'|'same', content }`

### glob.* - Pattern Matching

**Purpose**: File pattern matching with glob syntax

**Naming Convention**:
- Main function: `glob()` - returns async generator
- Variants: `globArray()`, `globPaths()` - convenience wrappers
- Helpers: `hasMatch()`, `countMatches()`, `findFirst()`

**Standard Signature**:
```typescript
function glob(
  pattern: string,
  options: GlobOptions = {},
  config?: SafeShellConfig,
): AsyncGenerator<GlobEntry>
```

**Current Functions**:
- `glob(pattern, options, config)` - Async generator of matches
- `globArray(pattern, options, config)` - Array of entries
- `globPaths(pattern, options, config)` - Array of paths only
- `hasMatch(pattern, options, config)` - Boolean check
- `countMatches(pattern, options, config)` - Count matches
- `findFirst(pattern, options, config)` - First match or undefined

**Return Types**:
- `glob()`: `AsyncGenerator<GlobEntry>` where `GlobEntry` is `{ path, name, isFile, isDirectory, isSymlink }`
- Convenience: `Promise<Entry[]>` or `Promise<string[]>`
- Checks: `Promise<boolean>` or `Promise<number>`

### shelljs.* - ShellJS-Compatible Commands

**Purpose**: Unix command implementations that respect Deno's sandbox permissions

**Design Rationale**:
- External system commands like `rm`, `cp`, `mv` run outside Deno's sandbox
- These TypeScript implementations use Deno's sandboxed filesystem APIs
- Provides familiar shelljs-style API for file operations

**Current Commands**:
- `rm(options?, ...paths)` - Remove files/directories (-r, -f)
- `cp(options?, ...sources, dest)` - Copy files/directories (-r, -n, -u)
- `mv(options?, ...sources, dest)` - Move/rename files (-f, -n)
- `mkdir(options?, ...paths)` - Create directories (-p)
- `touch(options?, ...paths)` - Create/update timestamps (-c, -a, -m)
- `ls(options?, ...paths)` - List directory contents (-a, -l, -R, -d)
- `chmod(mode, ...paths)` - Change file permissions
- `ln(options?, source, dest)` - Create links (-s, -f)
- `cat(options?, ...paths)` - Concatenate files (-n)
- `echo(options?, ...args)` - Print text (-n, -e)
- `test(flag, path)` - Test file attributes (-e, -f, -d, etc.)
- `which(command)` - Locate command in PATH
- `cd(path)` / `pwd()` - Directory navigation

**Standard Signature**:
```typescript
// Options as first string arg (-rf, -p, etc.)
await rm("-rf", "some-dir");
await mkdir("-p", "path/to/dir");

// Or as object
await rm({ recursive: true, force: true }, "some-dir");
```

**Return Types**:
- Most commands: `ShellString` with `.toString()`, `.stdout`, `.stderr`, `.code`
- ls: `ShellArray<string>` with array methods

**Security Note**:
These commands use Deno's `--allow-write` restricted paths (${CWD}, /tmp by default).
Attempts to access paths outside the sandbox fail with "Permission denied" errors.

### $.* - Fluent Shell API

**Purpose**: Chainable, ergonomic API for common shell-like workflows

**Status**: Planned (SSH-41)

**Design Goals**:
1. Fluent chaining: `$('file.txt').grep(/pattern/).take(10).print()`
2. Lazy evaluation: Operations build a pipeline, execute on terminal operation
3. External shortcuts: `$.git()`, `$.docker()` with proper validation
4. Type-safe: Each method returns typed Shell instance

**Proposed API**:
```typescript
// File operations
$('input.txt')
  .grep(/ERROR/)
  .take(10)
  .save('errors.txt');

// External commands
await $.git('status');
await $.docker('ps');

// Chaining transformations
$('log.txt')
  .lines()
  .filter(line => line.includes('ERROR'))
  .map(line => line.toUpperCase())
  .unique()
  .print();
```

**Implementation Rules**:
1. MUST validate all operations against sandbox
2. MUST use existing fs/text/glob functions internally
3. SHOULD delay execution until terminal operation (`.save()`, `.print()`, `.toArray()`)
4. External shortcuts MUST use `runExternal()` with validation

## Options Patterns

### SandboxOptions Interface

**Base interface** for all operations that need sandbox validation:

```typescript
export interface SandboxOptions {
  /** SafeShell config for sandbox validation */
  config?: SafeShellConfig;
  /** Current working directory */
  cwd?: string;
}
```

### Extending Options

Specific operations extend `SandboxOptions`:

```typescript
export interface GrepOptions extends SandboxOptions {
  limit?: number;
  ignoreCase?: boolean;
  invert?: boolean;
  // ... grep-specific options
}

export interface GlobOptions extends SandboxOptions {
  exclude?: string[];
  includeDirs?: boolean;
  // ... glob-specific options
}
```

**Rule**: Always extend `SandboxOptions` for operations that access files/paths.

## Error Handling Contracts

### When to Throw

1. **Sandbox Violations**: ALWAYS throw `pathViolation()`
2. **Invalid Input**: Throw `executionError()` with helpful message
3. **File Not Found**: Let Deno errors propagate (they're clear)
4. **Parse Errors**: Wrap in `executionError()` with context

### Error Message Quality

**Components of a good error**:
1. **Error Code**: Specific code (e.g., `PATH_VIOLATION`)
2. **Message**: What went wrong in user terms
3. **Details**: Structured data about the error
4. **Suggestion**: How to fix it

**Example**:
```typescript
throw pathViolation('/etc/passwd', ['/tmp/sandbox'], '/etc/passwd');
// Error [PATH_VIOLATION]: Path '/etc/passwd' is outside allowed directories
//
// Suggestion: Allowed directories: /tmp/sandbox
// Make sure your paths are within the sandbox.
```

## Documentation Standards

### Function Documentation

Every exported function MUST have:

```typescript
/**
 * Brief one-line description
 *
 * Optional longer description explaining behavior, edge cases,
 * or important implementation details.
 *
 * @param paramName - Description of parameter
 * @param options - Options object (reference the interface)
 * @returns Description of return value
 * @throws SafeShellError - When sandbox violation occurs
 *
 * @example
 * ```ts
 * const content = await read('config.json');
 * const data = JSON.parse(content);
 * ```
 */
export async function read(
  path: string,
  options: SandboxOptions = {},
): Promise<string> {
  // ...
}
```

### Module Documentation

Every module file MUST have:

```typescript
/**
 * Module Name
 *
 * Brief description of module purpose and key exports.
 * Mention any important patterns or conventions.
 *
 * @module
 */
```

## Async Patterns

### When to Use Async

**Use `async`** for:
- File I/O operations
- Network operations
- External command execution
- Operations that need sandbox validation (often async)

**Don't use `async`** for:
- Pure transformations (text manipulation on strings)
- Synchronous operations (path parsing, string formatting)
- Constructors and factory functions

**Example**:
```typescript
// ✅ Async - reads file
export async function read(path: string): Promise<string>

// ✅ Sync - transforms string
export function grep(pattern: RegExp, input: string): Match[]

// ✅ Async - searches files
export async function grepFiles(pattern: RegExp, glob: string): Promise<Match[]>
```

### Generator Patterns

Use **async generators** for streaming large results:

```typescript
// ✅ Generator for potentially large results
export async function* walk(
  path: string,
  options?: WalkOptions,
): AsyncGenerator<WalkEntry> {
  for await (const entry of stdWalk(path, options)) {
    yield entry;
  }
}

// Also provide convenience array wrapper
export async function walkArray(
  path: string,
  options?: WalkOptions,
): Promise<WalkEntry[]> {
  const results: WalkEntry[] = [];
  for await (const entry of walk(path, options)) {
    results.push(entry);
  }
  return results;
}
```

## Testing Contracts

### Test Coverage Requirements

Every stdlib function MUST have tests for:

1. **Happy path**: Normal usage succeeds
2. **Sandbox violations**: Properly rejected with `SafeShellError`
3. **Edge cases**: Empty input, missing files, etc.
4. **Error messages**: Verify error codes and suggestions

### Test Structure

```typescript
Deno.test({
  name: "functionName - describes what it tests",
  async fn() {
    // Arrange
    const input = "test data";

    // Act
    const result = await functionName(input);

    // Assert
    assertEquals(result.expected, "value");
  },
});
```

### Sandbox Testing

For functions with sandbox validation:

```typescript
Deno.test("read - respects sandbox boundaries", async () => {
  const config: SafeShellConfig = {
    permissions: { read: ["/tmp/sandbox"] },
  };

  // Should succeed within sandbox
  await read("/tmp/sandbox/file.txt", { config });

  // Should fail outside sandbox
  await assertRejects(
    () => read("/etc/passwd", { config }),
    SafeShellError,
    "PATH_VIOLATION",
  );
});
```

## Future Extensions

### Planned Additions

1. **streams.*** (SSH-4): Gulp-like streaming
   - `src(glob)` - Create ReadableStream from files
   - `dest(path)` - Create WritableStream to destination
   - `transform(fn)` - Transform stream data

2. **runner.*** (SSH-5): Task execution
   - `task(name)` - Run defined task
   - `series(...tasks)` - Sequential execution
   - `parallel(...tasks)` - Concurrent execution

3. **process.*** (SSH-31): Process management
   - `spawn(cmd, args)` - Spawn subprocess
   - `ps()` - List processes
   - `kill(pid)` - Terminate process

### Extension Guidelines

When adding new modules:

1. Follow established naming patterns
2. Extend `SandboxOptions` for file/path operations
3. Return values, never print
4. Use `SafeShellError` for all errors
5. Document with examples
6. Test sandbox validation
7. Provide both low-level and convenience APIs where appropriate

## Migration Checklist

For existing code not following these contracts:

- [ ] All functions have explicit return types
- [ ] No functions print directly to stdout/stderr
- [ ] All errors are `SafeShellError` instances
- [ ] All file operations validate against sandbox
- [ ] All functions have JSDoc documentation
- [ ] All functions have test coverage
- [ ] Options interfaces extend `SandboxOptions` where needed
- [ ] Async/sync usage follows guidelines

## References

- **Error types**: `src/core/errors.ts`
- **Sandbox validation**: `src/core/permissions.ts`
- **Type definitions**: `src/core/types.ts`
- **Example implementation**: `src/stdlib/fs.ts`
