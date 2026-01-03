# SafeShell Design Review

## Executive Summary

The current design has solid foundations but **critical gaps** in:

1. Code execution model (how exactly does `exec()` work?)
2. Path argument validation for external commands
3. Session/state management
4. Real-time output streaming
5. Stdlib availability mechanism

This review identifies issues and proposes solutions.

---

## 1. CRITICAL: Execution Model Undefined

### Problem

The design says AI can `exec({ code: "..." })` but doesn't specify HOW the code runs:

```typescript
// What happens internally?
exec({
  code: `
  const data = await Deno.readTextFile("file.txt");
  console.log(data);
`,
});
```

**Options and trade-offs:**

| Approach               | Pros                 | Cons                       |
| ---------------------- | -------------------- | -------------------------- |
| `deno eval`            | Simple, imports work | New process per call, slow |
| Temp file + `deno run` | Full script support  | File I/O overhead, cleanup |
| Worker thread          | Fast, reusable       | Limited isolation          |
| Deno subhost/isolate   | Best isolation       | Complex, may not exist     |

### Recommendation

**Use temp file + `deno run` with caching:**

```typescript
// Execution flow
async function exec(code: string, options: ExecOptions) {
  // 1. Hash code to create cache key
  const hash = await crypto.subtle.digest("SHA-256", code);
  const scriptPath = `/tmp/safesh/${hash}.ts`;

  // 2. Write script with stdlib imports prepended
  const fullCode = `
    import * as $ from "safesh:stdlib";
    ${code}
  `;
  await Deno.writeTextFile(scriptPath, fullCode);

  // 3. Run with configured permissions
  const cmd = new Deno.Command("deno", {
    args: ["run", ...buildPermFlags(config), scriptPath],
    cwd: config.cwd,
    env: filterEnv(config),
  });

  // 4. Capture output
  const result = await cmd.output();
  return {
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
    code: result.code,
  };
}
```

### Missing: Imports Resolution

How does this work?

```typescript
import { grep } from "safesh/stdlib";
```

**Solution: Import map injection**

```json
{
  "imports": {
    "safesh:stdlib": "/path/to/safesh/lib/stdlib.ts",
    "safesh/streams": "/path/to/safesh/lib/streams.ts"
  }
}
```

Pass via `--import-map` flag.

---

## 2. CRITICAL: External Command Path Validation

### Problem

Current design validates command names and flags but **NOT path arguments**:

```typescript
// Config says git is allowed
external: {
  git: { allow: true, denyFlags: ["--force"] }
}

// But what about this?
run({ command: "git", args: ["clone", "repo", "/etc/cron.d/malicious"] })
// Or this?
run({ command: "docker", args: ["run", "-v", "/:/host", "alpine"] })
```

**The sandbox is bypassed via command arguments!**

### Recommendation

**Add path argument validation:**

```typescript
interface ExternalCommandConfig {
  allow: boolean | string[];
  denyFlags?: string[];

  // NEW: Path argument positions or patterns
  pathArgs?: {
    // Which argument positions contain paths
    positions?: number[];
    // Or detect by pattern (starts with / or ./)
    autoDetect?: boolean;
    // Validate these paths against sandbox
    validateSandbox?: boolean;
  };
}

// Example config
external: {
  git: {
    allow: true,
    denyFlags: ["--force"],
    pathArgs: {
      autoDetect: true,  // Detect paths in args
      validateSandbox: true  // Must be in allowed dirs
    }
  },
  docker: {
    allow: ["ps", "logs", "build"],
    denyFlags: ["--privileged", "-v", "--volume"],  // Block volume mounts entirely
  }
}
```

### Implementation

```typescript
function validatePathArgs(
  command: string,
  args: string[],
  config: Config
): void {
  const cmdConfig = config.external[command];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Check if this looks like a path
    if (looksLikePath(arg)) {
      const resolved = path.resolve(config.cwd, arg);

      // Resolve symlinks to prevent attacks
      const real = await Deno.realPath(resolved).catch(() => resolved);

      if (!isWithinAllowedPaths(real, config.paths.allowed)) {
        throw new PathViolationError(arg, config.paths.allowed);
      }
    }
  }
}

function looksLikePath(arg: string): boolean {
  return (
    arg.startsWith("/") ||
    arg.startsWith("./") ||
    arg.startsWith("../") ||
    arg.includes("/")
  );
}
```

---

## 3. CRITICAL: Symlink Attack Prevention

### Problem

```bash
# Attacker creates symlink in project
ln -s /etc/passwd ./config/users.txt

# AI reads "project file"
exec({ code: `await Deno.readTextFile("./config/users.txt")` })
# Actually reads /etc/passwd!
```

### Recommendation

**Always resolve to real path before permission check:**

```typescript
async function validatePath(
  requestedPath: string,
  config: Config
): Promise<string> {
  const absolute = path.resolve(config.cwd, requestedPath);

  // Get real path (follows symlinks)
  const realPath = await Deno.realPath(absolute);

  // Validate REAL path, not requested path
  if (!isWithinAllowedPaths(realPath, config.paths.allowed)) {
    throw new PathViolationError(
      `Path '${requestedPath}' resolves to '${realPath}' which is outside allowed directories`,
      config.paths.allowed
    );
  }

  return realPath;
}
```

**Note:** Deno's built-in permissions already do this, but our stdlib functions need to as well.

---

## 4. HIGH: Missing Session/State Management

### Problem

Shell workflows often need persistent state:

```bash
# Set variable
export API_URL="https://api.example.com"

# Use in later command
curl $API_URL/users
```

Current design is stateless - each `exec()` is isolated.

### Recommendation

**Add session concept:**

```typescript
interface Session {
  id: string;
  env: Record<string, string>;  // Persistent env vars
  cwd: string;  // Current working directory
  vars: Record<string, unknown>;  // JS variables to persist
}

// MCP tools become session-aware
interface ExecRequest {
  code: string;
  sessionId?: string;  // Use existing session
  timeout?: number;
}

// Session management
startSession(): Session
exec({ code, sessionId }): Result
endSession(sessionId): void
```

**Implementation approach:**

1. Sessions stored in MCP server memory
2. Each `exec()` can read/write session state
3. Session variables injected into execution context

```typescript
// In executed code, session is available as global
declare const $session: {
  env: Record<string, string>;
  vars: Record<string, unknown>;
  cwd: string;
};

// Usage
$session.vars.lastResult = data;
$session.env.API_URL = "https://...";
```

---

## 5. HIGH: Real-Time Output Streaming

### Problem

Long-running commands need streaming output:

```typescript
exec({
  code: `
  for (let i = 0; i < 100; i++) {
    console.log(\`Processing \${i}...\`);
    await sleep(1000);
  }
`,
});
// Currently: Wait 100 seconds, then get all output
// Needed: Stream output as it happens
```

### Recommendation

**Use MCP's streaming capabilities:**

```typescript
// Tool returns generator/async iterator
async function* exec(request: ExecRequest): AsyncGenerator<ExecChunk> {
  const process = spawn(/* ... */);

  for await (const chunk of process.stdout) {
    yield { type: "stdout", data: chunk };
  }

  for await (const chunk of process.stderr) {
    yield { type: "stderr", data: chunk };
  }

  yield { type: "exit", code: await process.status };
}
```

**MCP tool definition:**

```typescript
{
  name: "exec",
  description: "Execute JS/TS code with streaming output",
  streaming: true,  // Enable streaming responses
}
```

---

## 6. HIGH: Background Process Management

### Problem

Dev workflows need long-running processes:

```typescript
// Start dev server
task({ name: "dev" }); // Runs forever

// How to:
// - Run in background?
// - Check if still running?
// - Stop it later?
// - Get its output?
```

### Recommendation

**Add job control:**

```typescript
interface Job {
  id: string;
  pid: number;
  command: string;
  status: "running" | "stopped" | "exited";
  exitCode?: number;
}

// New MCP tools
interface BackgroundRequest {
  code?: string;
  command?: string;
  args?: string[];
}

// Launch background job
bg(request: BackgroundRequest): Job

// List jobs
jobs(): Job[]

// Get job output (buffered)
jobOutput(jobId: string, since?: number): string

// Stop job
kill(jobId: string, signal?: string): void

// Bring to foreground (streaming)
fg(jobId: string): AsyncGenerator<OutputChunk>
```

---

## 7. MEDIUM: Stdlib Design Review

### Current Design Issues

1. **Function naming inconsistency**

   - `grep` vs `find` vs `replace`
   - Some shell-like, some not

2. **Return types unclear**

   - Does `grep` return matches or write to stdout?
   - Does `replace` modify in place or return new content?

3. **Error handling unspecified**
   - File not found - throw or return empty?
   - Permission denied - throw with suggestion?

### Recommendation

**Consistent stdlib design:**

```typescript
// All functions return results, never print
// Use explicit options for behavior control
// Throw on errors with AI-friendly messages

// File system
namespace fs {
  read(path: string): Promise<string>
  readLines(path: string): AsyncIterable<string>
  write(path: string, content: string): Promise<void>
  append(path: string, content: string): Promise<void>
  copy(src: string, dest: string): Promise<void>
  move(src: string, dest: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileInfo>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  glob(pattern: string): AsyncIterable<string>
  walk(dir: string, options?: WalkOptions): AsyncIterable<WalkEntry>
}

// Text processing
namespace text {
  grep(pattern: RegExp, input: string | AsyncIterable<string>): AsyncIterable<Match>
  head(input: string | AsyncIterable<string>, n: number): Promise<string[]>
  tail(input: string | AsyncIterable<string>, n: number): Promise<string[]>
  replace(input: string, pattern: RegExp, replacement: string): string
  split(input: string, separator?: string | RegExp): string[]
  lines(input: string): string[]
  count(input: string | AsyncIterable<string>): Promise<{ lines: number, words: number, chars: number }>
}

// Convenience: shell-like shorthand
const $ = {
  cat: fs.read,
  ls: (dir?: string) => fs.glob(dir ? `${dir}/*` : "*"),
  rm: fs.remove,
  cp: fs.copy,
  mv: fs.move,
  mkdir: fs.mkdir,
  grep: text.grep,
  head: text.head,
  tail: text.tail,
  // ... etc
};
```

---

## 8. MEDIUM: Configuration Validation

### Problem

Config is TypeScript - what if it's malicious or broken?

```typescript
// safesh.config.ts
export default {
  permissions: {
    read: ["/"], // Oops, allow reading everything
    run: ["*"], // Oops, allow running anything
  },
};
```

### Recommendation

**Add config validation and warnings:**

```typescript
interface ConfigValidation {
  errors: string[];
  warnings: string[];
}

function validateConfig(config: Config): ConfigValidation {
  const result = { errors: [], warnings: [] };

  // Check for overly permissive settings
  if (config.permissions.read?.includes("/")) {
    result.warnings.push("read: ['/'] allows reading entire filesystem");
  }

  if (config.permissions.run?.includes("*")) {
    result.errors.push("run: ['*'] is not allowed - explicitly list commands");
  }

  // Check for conflicting settings
  if (
    config.external?.git?.denyFlags?.includes("--force") &&
    config.external?.git?.requireFlags?.includes("--force")
  ) {
    result.errors.push("git: --force is both denied and required");
  }

  return result;
}
```

**Also add security presets:**

```typescript
// Built-in security levels
const presets = {
  strict: {
    permissions: {
      read: ["${CWD}"],
      write: ["${CWD}"],
      net: [],
      run: [],
    }
  },
  standard: {
    permissions: {
      read: ["${CWD}", "/tmp", "${HOME}/.config"],
      write: ["${CWD}", "/tmp"],
      net: ["github.com", "npmjs.org"],
      run: ["git", "deno"],
    }
  },
  permissive: {
    permissions: {
      read: ["${CWD}", "/tmp", "${HOME}"],
      write: ["${CWD}", "/tmp"],
      net: true,  // All networks
      run: ["git", "docker", "deno", "node"],
    }
  }
};

// Usage
export default defineConfig({
  extends: "standard",
  // Override specific settings
  external: { ... }
});
```

---

## 9. MEDIUM: Import Security

### Problem

```typescript
exec({
  code: `
  import { malware } from "npm:malicious-package";
  malware.stealSecrets();
`,
});
```

JSR/npm imports can execute arbitrary code.

### Recommendation

**Three-tier import policy:**

```typescript
interface ImportPolicy {
  // Always allowed (Deno std, safesh)
  trusted: string[];

  // Allowed if in list
  allowed: string[];

  // Blocked patterns
  blocked: string[];
}

// Default policy
const defaultImportPolicy: ImportPolicy = {
  trusted: [
    "jsr:@std/*", // Deno standard library
    "safesh:*", // SafeShell stdlib
  ],
  allowed: [
    // User can add to this list
  ],
  blocked: [
    "npm:*", // Block npm by default (use JSR)
    "http:*", // Block HTTP imports
    "https:*", // Block HTTPS imports (use JSR)
  ],
};
```

**Implementation via import map:**

```typescript
function buildImportMap(policy: ImportPolicy): ImportMap {
  return {
    imports: {
      // Map trusted imports
      "safesh:stdlib": "file:///path/to/stdlib.ts",
      // Block disallowed by mapping to error module
      "npm:": "file:///path/to/blocked-import.ts",
    },
  };
}
```

---

## 10. LOW: Ergonomics Improvements

### Problem: Verbose Code

```typescript
// Current: verbose Deno APIs
const content = await Deno.readTextFile("file.txt");
const lines = content.split("\n").filter(l => l.includes("TODO"));
console.log(lines.join("\n"));

// Shell: concise
grep TODO file.txt
```

### Recommendation: Fluent API

```typescript
// Fluent, chainable API
import $ from "safesh:shell";

// Read file, grep, output
await $("file.txt").grep(/TODO/).print();

// Chain operations
await $("src/**/*.ts")
  .grep(/console\.log/)
  .replace(/console\.log/g, "logger.debug")
  .save();

// External command with fluent interface
await $.git("status");
await $.git("add", ".");
await $.git("commit", "-m", "Update");

// Pipeline style
await $("logs/*.log")
  .lines()
  .filter((l) => l.includes("ERROR"))
  .take(10)
  .map((l) => l.split(" ").slice(0, 3).join(" "))
  .print();
```

**Implementation sketch:**

```typescript
class Shell {
  constructor(private source?: string | Iterable<string>) {}

  static file(path: string): Shell {
    return new Shell(path);
  }

  grep(pattern: RegExp): Shell {
    // Return new Shell with filtered source
  }

  lines(): Shell {
    // Split into lines
  }

  filter(predicate: (line: string) => boolean): Shell {
    // Filter lines
  }

  async print(): Promise<void> {
    // Output to stdout
  }

  async save(dest?: string): Promise<void> {
    // Write back
  }

  // External commands
  static git(...args: string[]): Promise<CommandResult> {
    return runExternal("git", args);
  }
}

export default function $(source?: string): Shell {
  return new Shell(source);
}
$.git = Shell.git;
$.docker = (...args) => runExternal("docker", args);
// ... etc
```

---

## 11. Architecture: MCP Server Lifecycle

### Current Gap

Design doesn't address:

- How MCP server starts
- How it discovers project config
- How permissions are initialized

### Recommendation

```
┌─────────────────────────────────────────────────────────────┐
│                    SafeShell Lifecycle                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Claude Code starts safesh MCP server                    │
│     $ safesh serve --project /path/to/project               │
│                                                             │
│  2. Server loads config hierarchy                           │
│     ~/.config/safesh/config.ts (global)                     │
│     /path/to/project/safesh.config.ts (project)             │
│                                                             │
│  3. Server validates config                                 │
│     - Check for dangerous permissions                        │
│     - Warn on permissive settings                           │
│     - Fail on invalid config                                │
│                                                             │
│  4. Server exposes MCP tools                                │
│     - exec: Run JS/TS code                                  │
│     - run: Run external command                             │
│     - task: Run defined task                                │
│     - jobs: Manage background processes                     │
│                                                             │
│  5. Each tool call:                                         │
│     a. Validate against permissions                         │
│     b. Spawn sandboxed subprocess                           │
│     c. Stream output back                                   │
│     d. Return structured result                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Summary: Required Changes

### Critical (Must Fix)

| Issue               | Current State | Required Change                      |
| ------------------- | ------------- | ------------------------------------ |
| Execution model     | Undefined     | Define temp file + deno run approach |
| Path arg validation | Missing       | Add path argument sandbox checking   |
| Symlink attacks     | Unaddressed   | Resolve real paths before validation |

### High Priority

| Issue            | Current State | Required Change         |
| ---------------- | ------------- | ----------------------- |
| Session/state    | Stateless     | Add session management  |
| Output streaming | Not addressed | Implement MCP streaming |
| Background jobs  | Not addressed | Add job control         |

### Medium Priority

| Issue             | Current State | Required Change                    |
| ----------------- | ------------- | ---------------------------------- |
| Stdlib design     | Informal      | Formalize namespaces and contracts |
| Config validation | None          | Add validation and presets         |
| Import security   | Vague         | Define concrete import policy      |

### New Issues to Create

1. SSH-33: Define code execution model (temp file + deno run)
2. SSH-34: Implement path argument validation for external commands
3. SSH-35: Add symlink resolution to path validation
4. SSH-36: Design and implement session management
5. SSH-37: Implement real-time output streaming via MCP
6. SSH-38: Add background job control (bg, jobs, kill, fg)
7. SSH-39: Add config validation and security presets
8. SSH-40: Define import security policy
9. SSH-41: Design fluent shell API ($)
10. SSH-42: Document MCP server lifecycle
