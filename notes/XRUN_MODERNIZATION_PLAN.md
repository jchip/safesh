# xrun Modernization Plan

A comprehensive plan to port @xarc/run to a modern TypeScript package with native Deno support.

## Project Overview

**Goal:** Create a modern, TypeScript-native task runner that preserves all xrun functionality while:
- Native Deno compatibility (no shims)
- Modern dependencies (remove legacy packages)
- Clean TypeScript throughout
- Dual publishing (npm + JSR)

**Package Name:** TBD (suggestions: `xrun-next`, `xrun-modern`, `taskflow`, etc.)

## Dependency Modernization Map

### Direct Dependencies (13 total)

| Current Package | Version | Replacement Strategy | Priority |
|----------------|---------|---------------------|----------|
| `chalk` | ^4.1.2 | → `ansi-colors` ^4.1.3 | HIGH |
| `insync` | ^2.1.1 | → Rewrite with native async/await | HIGH |
| `optional-require` | ^2.1.0 | → Remove (use dynamic import) | HIGH |
| `chalker` | ^1.2.0 | → Remove (thin wrapper over chalk) | MEDIUM |
| `xsh` | ^0.4.5 | → Modernize for Deno compatibility | HIGH |
| `nix-clap` | ^2.4.0 | → Evaluate/modernize CLI parsing | MEDIUM |
| `require-at` | ^1.0.6 | → Remove (use import.meta.resolve) | MEDIUM |
| `jaro-winkler` | ^0.2.8 | → Keep or find lighter alternative | LOW |
| `lodash.foreach` | ^4.5.0 | → Remove (native for...of) | LOW |
| `path-is-inside` | ^1.0.2 | → Native path operations | LOW |
| `read-pkg-up` | ^7.0.1 | → Rewrite for Deno compatibility | MEDIUM |
| `string-array` | ^1.0.1 | → Evaluate necessity | LOW |
| `unwrap-npm-cmd` | ^1.1.2 | → Modernize or remove | LOW |

## Architecture Analysis

### Core Components to Port

```
@xarc/run
├── lib/
│   ├── index.js          → Entry point
│   ├── xrun.js           → Main XRun class
│   ├── xqtor.js          → Task executor
│   ├── xtasks.js         → Task management
│   ├── xqtree.js         → Task dependency tree
│   ├── reporter/         → Output reporting
│   ├── events/           → Event system
│   └── cli/              → CLI interface
```

### Modernization Strategy by Component

#### 1. **chalk → ansi-colors**

```typescript
// Before (chalk)
import chalk from 'chalk';
console.log(chalk.green('Success'));

// After (ansi-colors)
import c from 'ansi-colors';
console.log(c.green('Success'));
```

**Impact:** Low - API is nearly identical

#### 2. **insync → Native async/await**

`insync` provides:
- `each()` - async iteration
- `filter()` - async filtering
- `map()` - async mapping

**Replacement:**
```typescript
// Before (insync)
import { each } from 'insync';
await each(items, async (item) => { ... });

// After (native)
for (const item of items) {
  await processItem(item);
}

// Or for parallel:
await Promise.all(items.map(async (item) => { ... }));
```

**Impact:** Medium - Requires refactoring async patterns

#### 3. **optional-require → Dynamic import**

```typescript
// Before
const optionalRequire = require('optional-require')(require);
const plugin = optionalRequire('some-plugin') || {};

// After
let plugin = {};
try {
  plugin = await import('some-plugin');
} catch {
  // Optional dependency not found
}
```

**Impact:** Low - Simple refactor

#### 4. **xsh → Modern Shell Execution**

xsh provides shell command execution. Need to:
- Make it work with both Node.js and Deno
- Use native APIs (child_process / Deno.Command)
- Preserve streaming/output handling

```typescript
// Dual runtime support
export async function exec(cmd: string, options: ExecOptions) {
  if (typeof Deno !== 'undefined') {
    // Deno implementation
    const process = new Deno.Command(cmd, {
      args: options.args,
      stdout: "piped",
      stderr: "piped",
    });
    return await process.output();
  } else {
    // Node.js implementation
    const { spawn } = await import('node:child_process');
    // ...
  }
}
```

**Impact:** High - Core functionality, needs careful porting

#### 5. **Other Dependencies**

- `lodash.foreach` → Use native `for...of`
- `require-at` → Use `import.meta.resolve()` (Node 20.6+)
- `path-is-inside` → Native path operations
- `chalker` → Remove (was just a chalk wrapper)

## Implementation Phases

### Phase 1: Project Setup (Day 1)

**Tasks:**
1. Create new repository structure
2. Set up TypeScript configuration
   - Target: ES2022
   - Module: ESNext
   - ModuleResolution: bundler
3. Configure dual package.json + deno.json
4. Set up build system (tsc + deno bundle)
5. Initialize git repository

**Deliverable:** Working build system that outputs both npm and Deno-compatible code

### Phase 2: Core Library Port (Days 2-5)

**Priority Order:**
1. Port type definitions (`xrun.d.ts` → pure TypeScript)
2. Port XRun main class
3. Port task executor (xqtor)
4. Port task management (xtasks)
5. Port dependency tree (xqtree)
6. Replace dependencies:
   - chalk → ansi-colors
   - insync → native async
   - optional-require → dynamic import

**Deliverable:** Core task execution working

### Phase 3: Shell & Runtime (Days 6-8)

**Tasks:**
1. Modernize xsh for dual runtime
2. Abstract runtime differences (Node vs Deno)
3. Implement command execution for both platforms
4. Handle stdio streaming
5. Process management (spawn, kill, etc.)

**Deliverable:** Shell commands work on both Node and Deno

### Phase 4: CLI & Utilities (Days 9-10)

**Tasks:**
1. Port/modernize CLI argument parsing (nix-clap)
2. Port reporter system
3. Port utility functions
4. Remove/replace remaining legacy deps

**Deliverable:** Full CLI functionality

### Phase 5: Testing & Validation (Days 11-13)

**Tasks:**
1. Port existing xrun tests
2. Add Deno-specific tests
3. Add dual-runtime integration tests
4. Benchmark against original xrun
5. Test on both Node 24 and Deno

**Deliverable:** Comprehensive test suite passing

### Phase 6: Publishing (Day 14)

**Tasks:**
1. Write documentation
2. Create examples
3. Publish to npm
4. Publish to JSR
5. Create migration guide from xrun

**Deliverable:** Published package

## Project Structure

```
xrun-modern/
├── src/
│   ├── core/
│   │   ├── xrun.ts           # Main class
│   │   ├── executor.ts       # Task executor
│   │   ├── tasks.ts          # Task management
│   │   ├── tree.ts           # Dependency tree
│   │   └── types.ts          # TypeScript types
│   ├── runtime/
│   │   ├── common.ts         # Shared runtime code
│   │   ├── node.ts           # Node.js-specific
│   │   ├── deno.ts           # Deno-specific
│   │   └── shell.ts          # Shell execution
│   ├── cli/
│   │   ├── parser.ts         # Argument parsing
│   │   └── main.ts           # CLI entry
│   ├── reporter/
│   │   └── console.ts        # Output reporting
│   ├── utils/
│   │   ├── async.ts          # insync replacement
│   │   ├── colors.ts         # ansi-colors wrapper
│   │   └── helpers.ts        # Misc utilities
│   └── mod.ts                # Main entry point
├── tests/
│   ├── unit/
│   ├── integration/
│   └── runtime/              # Node vs Deno tests
├── examples/
├── docs/
├── package.json              # npm config
├── deno.json                 # Deno config
├── jsr.json                  # JSR config
├── tsconfig.json
└── README.md
```

## Key Design Decisions

### 1. Runtime Detection

```typescript
// runtime/detect.ts
export const runtime = typeof Deno !== 'undefined' ? 'deno' : 'node';

// Use throughout codebase
import { runtime } from './runtime/detect.ts';

if (runtime === 'deno') {
  // Deno-specific code
} else {
  // Node.js-specific code
}
```

### 2. Dual Package Publishing

**package.json** (npm):
```json
{
  "name": "xrun-modern",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/mod.js",
      "types": "./dist/mod.d.ts"
    }
  }
}
```

**deno.json** (Deno/JSR):
```json
{
  "name": "@scope/xrun-modern",
  "version": "1.0.0",
  "exports": "./src/mod.ts"
}
```

### 3. Dependency Strategy

**Zero Native Dependencies:**
- No chalk, no insync, no lodash
- Only `ansi-colors` for terminal colors
- Everything else: native APIs or small inline implementations

### 4. TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "./dist"
  }
}
```

## Critical Challenges

### 1. **xsh Shell Execution**
- Most complex dependency
- Needs careful porting for both runtimes
- Critical for core functionality

**Mitigation:** Port incrementally, test extensively

### 2. **Event System**
- xrun uses Node.js EventEmitter
- Deno has native EventTarget

**Solution:** Use Node.js EventEmitter for both (via npm:events on Deno)

### 3. **File System Operations**
- Different APIs: `fs` vs `Deno.readFile`

**Solution:** Runtime abstraction layer

### 4. **Module Resolution**
- Different import patterns

**Solution:** Consistent ESM, use import maps for Deno

## Success Criteria

✅ All xrun features working
✅ Runs natively on Node.js 24+
✅ Runs natively on Deno 2+
✅ Zero breaking changes to API
✅ Published to both npm and JSR
✅ Comprehensive test coverage (>80%)
✅ Performance parity with original xrun
✅ Documentation complete

## Timeline

- **Week 1:** Core library port (Phases 1-2)
- **Week 2:** Runtime & CLI (Phases 3-4)
- **Week 3:** Testing & Publishing (Phases 5-6)

**Total Estimate:** 3 weeks full-time (or 6 weeks part-time)

## Next Steps

1. ✅ Create this plan
2. ⏳ Get xrun source code
3. ⏳ Set up project structure
4. ⏳ Begin Phase 1 implementation

---

**Questions to Resolve:**
- Package name?
- Publish under personal scope or org?
- License (same as xrun: Apache-2.0)?
- Maintain API compatibility or allow improvements?
