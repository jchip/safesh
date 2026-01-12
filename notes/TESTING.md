# SafeShell Testing Guide

This document describes the testing infrastructure for SafeShell, enabling automated testing and debugging during development.

## Quick Reference

```bash
# Run all tests
nvx deno test --allow-all

# Run specific test file
nvx deno test tests/state_test.ts --allow-all

# Run tests matching pattern
nvx deno test --filter "pipeline" --allow-all

# Run transpiler2 tests only
nvx deno test src/bash/transpiler2/ --allow-all

# Run with watch mode (re-run on changes)
nvx deno test --watch --allow-all

# Run single test by name
nvx deno test --filter "should persist environment variables" --allow-all
```

## Test Organization

### Directory Structure

```
tests/
├── stdlib/                    # Standard library tests
│   ├── stream.test.ts         # Core stream operations
│   ├── io.test.ts             # I/O operations
│   ├── fs-streams.test.ts     # File system streams (SSH-194)
│   ├── command.test.ts        # Command execution (SSH-195)
│   ├── fluent-cat.test.ts     # Cat + text processing (SSH-196)
│   └── fluent-glob.test.ts    # Glob + file processing (SSH-197)
├── integration/               # Integration tests
│   └── streaming-shell.test.ts
├── state_test.ts              # State management (SSH-198)
├── jobs_test.ts               # Background jobs (SSH-199)
├── pipeline_test.ts           # Advanced pipelines (SSH-200)
├── shell_test.ts              # Shell operations
├── fs_test.ts                 # File system operations
├── glob_test.ts               # Glob patterns
├── permissions_test.ts        # Permission system
├── validator_test.ts          # Input validation
└── ...

src/bash/transpiler2/
├── transpiler2.test.ts              # Core transpiler tests
├── transpiler2.comprehensive.test.ts # Comprehensive coverage
├── conformance.test.ts              # Bash conformance tests
└── handlers/
    └── words.test.ts                # Word expansion tests
```

## Test Suites by Feature

### 1. Transpiler2 Tests (43+ tests)
Location: `src/bash/transpiler2/`

Tests Bash-to-TypeScript transpilation:
- Command transpilation
- Pipeline handling
- Variable expansion (simple, default, length, case)
- Parameter expansion modifiers (`:-`, `-`, `/#`, `/%`, etc.)
- Arithmetic expressions
- Control flow (if, for, while, case)
- Test expressions (`[[ ]]`)
- Redirections
- Function declarations with scoping
- Diagnostic warnings for unknown modifiers

```bash
nvx deno test src/bash/transpiler2/ --allow-all
```

### 2. State Management Tests (48 tests)
Location: `tests/state_test.ts`

Tests ENV, VARS, CWD persistence:
- Environment variables (set, read, inherit)
- Shell variables (scope, persistence, complex types)
- Current working directory (cd, persistence)
- Path expansion (relative, absolute, normalization)
- Multi-shell state independence

```bash
nvx deno test tests/state_test.ts --allow-all
```

### 3. Background Jobs Tests (45 tests)
Location: `tests/jobs_test.ts`

Tests script and job management:
- Background execution
- `listScripts()`, `getScriptOutput()`
- `killScript()`, `waitScript()`
- Job tracking and status
- Concurrent job handling

```bash
nvx deno test tests/jobs_test.ts --allow-all
```

### 4. Pipeline Tests (39 tests)
Location: `tests/pipeline_test.ts`

Tests stream pipelines:
- Basic pipelines (multi-stage)
- Stream operations (map, filter, flatMap)
- Text operations (lines, grep, head, tail)
- Terminal operations (collect, first, count)
- Complex patterns (tee, branching)
- Error propagation

```bash
nvx deno test tests/pipeline_test.ts --allow-all
```

### 5. File System Tests (30 tests)
Location: `tests/stdlib/fs-streams.test.ts`

Tests file operations:
- `cat()` - read files
- `glob()` - file discovery
- `src()` - source files
- `dest()` - write destinations
- Binary file handling
- Sandbox permissions

```bash
nvx deno test tests/stdlib/fs-streams.test.ts --allow-all
```

### 6. Command Execution Tests (37 tests)
Location: `tests/stdlib/command.test.ts`

Tests command execution:
- `cmd()` - basic commands
- `git()` - git integration
- `initCmds()` - command initialization
- Stdin/stdout/stderr handling
- Command piping
- Error handling

```bash
nvx deno test tests/stdlib/command.test.ts --allow-all
```

### 7. Fluent Stream Tests (79 tests)
Locations: `tests/stdlib/fluent-cat.test.ts`, `tests/stdlib/fluent-glob.test.ts`

Tests fluent API:
- `.lines()`, `.grep()`, `.filter()`, `.map()`
- `.head()`, `.tail()`, `.collect()`
- File filtering and transformation
- Chained operations

```bash
nvx deno test tests/stdlib/fluent-cat.test.ts tests/stdlib/fluent-glob.test.ts --allow-all
```

## Writing Tests

### Basic Test Pattern

```typescript
import { assertEquals, assertExists } from "jsr:@std/assert";

Deno.test("feature name", async (t) => {
  await t.step("should do something specific", async () => {
    // Arrange
    const input = "test";

    // Act
    const result = await someFunction(input);

    // Assert
    assertEquals(result, "expected");
  });

  await t.step("should handle edge case", async () => {
    // Test implementation
  });
});
```

### Testing Transpiler Output

```typescript
import { BashTranspiler2 } from "./mod.ts";

Deno.test("transpiler", async (t) => {
  const transpiler = new BashTranspiler2();

  await t.step("should transpile command", () => {
    const result = transpiler.transpile('echo "hello"');
    assertStringIncludes(result, '$.cmd`echo hello`');
  });
});
```

### Testing with Temp Files

```typescript
Deno.test("file operations", async (t) => {
  const tempDir = await Deno.makeTempDir();

  try {
    await t.step("should read file", async () => {
      const testFile = `${tempDir}/test.txt`;
      await Deno.writeTextFile(testFile, "content");

      const result = await readFile(testFile);
      assertEquals(result, "content");
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
```

### Testing Streams

```typescript
import { FluentStream } from "../src/stdlib/fluent-stream.ts";

Deno.test("streams", async (t) => {
  await t.step("should filter and map", async () => {
    const result = await FluentStream.from([1, 2, 3, 4, 5])
      .filter(x => x % 2 === 0)
      .map(x => x * 2)
      .collect();

    assertEquals(result, [4, 8]);
  });
});
```

### Testing Shell State

```typescript
import { ShellStateManager } from "../src/runtime/state-persistence.ts";

Deno.test("state", async (t) => {
  const manager = new ShellStateManager();
  const shellId = "test-shell";

  await t.step("should persist variables", () => {
    manager.setVar(shellId, "foo", "bar");
    assertEquals(manager.getVar(shellId, "foo"), "bar");
  });
});
```

## Debugging Tests

### Run Single Test with Verbose Output

```bash
nvx deno test --filter "specific test name" --allow-all 2>&1
```

### Add Console Logging

```typescript
Deno.test("debug test", async () => {
  const result = await someOperation();
  console.log("DEBUG:", JSON.stringify(result, null, 2));
  // assertions...
});
```

### Use Test Sanitizers

```typescript
// Disable resource leak checking for a test
Deno.test({
  name: "test with unclosed resources",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // test code
  },
});
```

## CI/CD Integration

### Run All Tests (CI)

```bash
nvx deno test --allow-all --reporter=junit > test-results.xml
```

### Coverage Report

```bash
nvx deno test --allow-all --coverage=coverage/
nvx deno coverage coverage/ --lcov > coverage.lcov
```

## Test Categories

| Category | Location | Tests | Description |
|----------|----------|-------|-------------|
| Transpiler | `src/bash/transpiler2/` | 43+ | Bash → TypeScript |
| State | `tests/state_test.ts` | 48 | ENV, VARS, CWD |
| Jobs | `tests/jobs_test.ts` | 45 | Background execution |
| Pipelines | `tests/pipeline_test.ts` | 39 | Stream pipelines |
| FS Streams | `tests/stdlib/fs-streams.test.ts` | 30 | File operations |
| Commands | `tests/stdlib/command.test.ts` | 37 | Command execution |
| Fluent Cat | `tests/stdlib/fluent-cat.test.ts` | 35 | Text processing |
| Fluent Glob | `tests/stdlib/fluent-glob.test.ts` | 44 | File processing |

**Total: 320+ tests**

## Adding New Tests

1. **Choose location**: Put tests near the code they test
   - Unit tests: Same directory as source (e.g., `foo.test.ts`)
   - Integration tests: `tests/` or `tests/integration/`

2. **Follow naming conventions**:
   - Files: `*_test.ts` or `*.test.ts`
   - Tests: Descriptive with "should" prefix

3. **Run tests before committing**:
   ```bash
   nvx deno test --allow-all
   ```

4. **Update this document** when adding new test suites
