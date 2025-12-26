# xrun Architecture Analysis

Based on analysis of `~/dev/fynjs/packages/xarc-run`

## Code Structure

```
xarc-run/
├── lib/ (1,885 LOC JavaScript)
│   ├── xrun.js          (234 LOC) - Main XRun class
│   ├── xqtor.js         (545 LOC) - Task executor (CORE)
│   ├── xtasks.js        (92 LOC)  - Task management
│   ├── xqtree.js        (18 LOC)  - Task dependency tree
│   ├── xqitem.js        (36 LOC)  - Queue item wrapper
│   ├── xtask-spec.js    (40 LOC)  - Task specification
│   ├── cli-context.js   (92 LOC)  - CLI argument context
│   ├── ns-order.js      (53 LOC)  - Namespace ordering
│   ├── logger.js        (52 LOC)  - Logging utilities
│   ├── util/            - Various utilities
│   ├── reporters/       - Output reporters
│   └── print-tasks/     - Task listing
├── cli/                 - CLI interface
└── test/                - Test suite
```

## Core Components

### 1. XRun (xrun.js)
**Extends:** `EventEmitter`

**Dependencies:**
- ❌ `chalk` → Replace with `ansi-colors`
- ❌ `jaro-winkler` → Keep (fuzzy task name matching)
- ✅ `events` → Keep (standard Node.js)
- ❌ `child_process` → Abstract for Deno
- ❌ `xsh` → Modernize

**Key Responsibilities:**
- Task loading (`load()`)
- Task execution orchestration (`run()`, `asyncRun()`)
- Event emission (spawn-async, done-async, execute, done-item, run, not-found)
- Child process management
- Error handling and stopOnError modes

**API Surface:**
```javascript
class XRun extends EventEmitter {
  constructor(namespace, tasks)
  load(namespace, tasks, priority = 1)
  run(taskNames, stopOnError = false)
  asyncRun(task, ...args)
  killChildProcess(child)
  // Events: spawn-async, done-async, execute, done-item, run, not-found
}
```

### 2. XQtor (xqtor.js) - **THE CORE ENGINE**
**Dependencies:**
- ❌ `insync` → **CRITICAL** - Replace with native async/await
- ❌ `xsh` → Modernize for dual runtime
- ❌ `unwrap-npm-cmd` → Modernize or remove
- ❌ `nix-clap` → Modernize

**Key Responsibilities:**
- Stack-based task execution
- Handles all task types:
  - String (task name lookup)
  - Function/AsyncFunction
  - Array (serial/concurrent)
  - XTaskSpec (shell, env)
  - Stream (pipe operations)
  - Object (task with options)
- Serial/concurrent execution control
- Shell command execution
- Finally blocks
- Error propagation

**Execution Model:**
```javascript
// Stack-based execution
xqItems = [task1, mark, task2, mark, ...]

execute() {
  const qItem = popItem()

  if (qItem.mark) processMark()

  switch (valueType) {
    case 'String': processLookup()
    case 'Function': functionXer()
    case 'Array': arrayXer() // serial/concurrent
    case 'XTaskSpec': shellXer() or envXer()
    // ...
  }
}
```

**insync Usage:**
```javascript
// Parallel execution
Insync.parallel(items, (item, cb) => {
  // Execute item
}, callback);

// Serial execution
Insync.each(items, (item, cb) => {
  // Execute item
}, callback);
```

**Replacement Strategy:**
```typescript
// Parallel → Promise.all()
await Promise.all(items.map(async (item) => {
  await executeItem(item);
}));

// Serial → for...of
for (const item of items) {
  await executeItem(item);
}
```

### 3. XTasks (xtasks.js)
**No problematic dependencies**

**Responsibilities:**
- Task storage by namespace
- Task lookup with namespace priority
- Task name fuzzy matching (jaro-winkler)

### 4. XQTree (xqtree.js)
**No dependencies**

**Responsibilities:**
- Track task execution tree
- Store XQItem instances by ID

### 5. XQItem (xqitem.js)
**No dependencies**

**Responsibilities:**
- Wrapper for queue items
- Stores task value, name, ID, status

## Dependency Replacement Plan

### Critical (Breaks core functionality)

#### 1. **insync → Native async/await**
**Usage locations:**
- `xqtor.js` - Parallel/serial execution
- ~30 occurrences

**Replacement:**
```typescript
// Before
Insync.parallel(items, (item, cb) => {
  executor(item, cb);
}, done);

// After
try {
  await Promise.all(items.map(item => executor(item)));
  done(null);
} catch (err) {
  done(err);
}
```

**Effort:** 4-6 hours (careful refactoring needed)

#### 2. **xsh → Modern shell execution**
**Usage:**
- `xqtor.js` - Shell command execution

**Current xsh API:**
```javascript
const exec = require("xsh").exec;
await exec(cmd, options);
```

**Modernization:**
```typescript
// runtime/shell.ts
export async function exec(cmd: string, options: ExecOptions) {
  if (typeof Deno !== 'undefined') {
    const process = new Deno.Command(cmd, {
      args: parseShellArgs(cmd),
      stdout: "piped",
      stderr: "piped",
      cwd: options.cwd,
    });
    const { stdout, stderr, code } = await process.output();
    return {
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      code,
    };
  } else {
    const { spawn } = await import('node:child_process');
    // Node.js implementation
  }
}
```

**Effort:** 6-8 hours (xsh has ~500 LOC)

### High Priority

#### 3. **chalk → ansi-colors**
**Usage:**
- `xrun.js` - ~10 occurrences
- `reporters/` - Output formatting

**Replacement:**
```javascript
// Before
const chalk = require('chalk');
console.log(chalk.green('Success'));

// After
const c = require('ansi-colors');
console.log(c.green('Success'));
```

**Effort:** 1-2 hours (mostly find/replace)

#### 4. **unwrap-npm-cmd → Modernize**
**Purpose:** Unwrap npm bin scripts
**Usage:** `xqtor.js` - When executing shell commands

**Decision:** Keep or inline (it's tiny - 20 LOC)

#### 5. **nix-clap → Modernize**
**Purpose:** CLI argument parsing
**Usage:** `cli-context.js`, CLI entry points

**Options:**
- Port to TypeScript
- Replace with simpler parser
- Use `node:util.parseArgs()` (Node 18.3+)

**Effort:** 4-6 hours

### Medium Priority

#### 6. **optional-require → Dynamic import**
**Usage:**
- Loading optional plugins/reporters

**Replacement:**
```typescript
// Before
const optionalRequire = require('optional-require')(require);
const plugin = optionalRequire('plugin') || {};

// After
let plugin = {};
try {
  plugin = await import('plugin');
} catch {
  // Optional
}
```

**Effort:** 1-2 hours

### Low Priority

#### 7. **child_process → Abstract for Deno**
**Usage:**
- `xrun.js` - `exec()` for shell expansion
- Child process killing

**Abstraction:**
```typescript
// runtime/process.ts
export async function spawn(...) {
  if (typeof Deno !== 'undefined') {
    return new Deno.Command(...);
  } else {
    const { spawn } = await import('node:child_process');
    return spawn(...);
  }
}
```

**Effort:** 2-3 hours

#### 8. Other utilities
- `jaro-winkler` - Keep (fuzzy matching)
- `lodash.foreach` - Remove (use for...of)
- `path-is-inside` - Replace with native path operations

## Modernization Strategy

### Phase 1: Setup & Scaffolding (Day 1)
1. Create new repository structure
2. Set up TypeScript config (target: ES2022)
3. Set up dual package (npm + JSR)
4. Configure build system

### Phase 2: Core Port (Days 2-4)
1. Port type definitions (xrun.d.ts → pure TS)
2. Port XRun class (replace chalk)
3. Port XQtor (replace insync - MOST CRITICAL)
4. Port XTasks, XQTree, XQItem
5. Port utilities

### Phase 3: Runtime Abstraction (Days 5-6)
1. Create runtime detection
2. Modernize xsh for dual runtime
3. Abstract child_process
4. Test on both Node and Deno

### Phase 4: CLI & Utilities (Day 7)
1. Modernize nix-clap or replace
2. Port CLI entry points
3. Port reporters
4. Replace remaining dependencies

### Phase 5: Testing (Days 8-9)
1. Port existing tests
2. Add Deno-specific tests
3. Integration testing
4. Ensure parity with original

### Phase 6: Polish & Publish (Day 10)
1. Documentation
2. Examples
3. Publish to npm and JSR

## Critical Success Factors

### 1. insync Replacement
**Most complex dependency** - Used extensively for async control flow

**Test coverage needed:**
- Parallel execution
- Serial execution
- Error handling in parallel
- Error handling in serial
- Nested serial/parallel

### 2. xsh Modernization
**Second most complex** - Shell execution is core functionality

**Requirements:**
- Work on Node.js and Deno
- Stream handling
- Exit code handling
- Error reporting

### 3. Type Safety
Convert entire codebase to TypeScript with strict mode:
- No `any` types
- Proper interfaces for all APIs
- Full type coverage

## API Compatibility

**Goal:** 100% backward compatible API

**XRun Public API (must preserve):**
```typescript
interface XRun {
  load(namespace: string | object, tasks?: object, priority?: number): XRun
  run(taskNames: string | string[], stopOnError?: boolean | string): Promise<any>
  asyncRun(task: any, ...args: any[]): Promise<any>

  // Events
  on(event: 'spawn-async' | 'done-async' | 'execute' | 'done-item' | 'run', handler: Function): this

  // Properties
  stopOnError: boolean | 'soft' | 'full' | ''
  failed: Error | null
}
```

**Static helpers (preserve):**
```typescript
XRun.concurrent(...tasks): any[]
XRun.serial(...tasks): any[]
```

## Risk Assessment

### Low Risk
- ✅ Type definitions port
- ✅ XTasks, XQTree, XQItem port
- ✅ chalk → ansi-colors replacement
- ✅ optional-require removal

### Medium Risk
- ⚠️ nix-clap modernization
- ⚠️ child_process abstraction
- ⚠️ CLI port

### High Risk
- 🔴 insync replacement (core execution)
- 🔴 xsh modernization (shell execution)
- 🔴 Deno compatibility throughout

## Estimated Effort

**Total:** ~80 hours (2 weeks full-time)

**Breakdown:**
- Setup & scaffolding: 8h
- Core port (insync replacement): 24h
- xsh modernization: 16h
- CLI & utilities: 12h
- Testing: 16h
- Polish & publish: 4h

## Next Steps

1. ✅ Create this analysis
2. ⏳ Set up project repository
3. ⏳ Begin Phase 1 (setup)
4. ⏳ Tackle insync replacement (most critical)
5. ⏳ Modernize xsh
6. ⏳ Complete port & test
7. ⏳ Publish

---

**Decision Point:** Do you want to:
A. Start implementing now?
B. Review and refine the plan first?
C. Do a proof-of-concept for the riskiest parts (insync, xsh)?
