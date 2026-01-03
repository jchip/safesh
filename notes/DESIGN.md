# SafeShell (safesh) - Design Document

## Overview

SafeShell is a secure, Deno-based shell replacement designed to provide AI assistants with controlled system access. Instead of the traditional bash tool with limited permission matching, SafeShell leverages Deno's built-in permission system to provide:

1. **Full JS/TS power** in a sandboxed runtime
2. **Pre-configured permissions** - no prompts for allowed operations
3. **Fine-grained whitelist** for external commands (git, docker, etc.)
4. **Comprehensive control** over filesystem, network, and subprocess access

## Core Philosophy

**Bash Tool Limitations:**

- Limited regex-based command matching
- Permission prompts interrupt flow
- String-based, error-prone
- Platform-dependent behavior

**SafeShell Approach:**

- Full JS/TS with Deno's sandboxed runtime
- Pre-configured permissions per project
- Type-safe APIs, proper error handling
- Cross-platform consistency via Deno

## Key Design Decisions (from Review)

### 1. Code Execution Model

Code execution uses **temp file + deno run**:

```typescript
async function exec(code: string, options: ExecOptions): Promise<ExecResult> {
  // 1. Hash code for caching
  const hash = await crypto.subtle.digest("SHA-256", encode(code));
  const scriptPath = `/tmp/safesh/scripts/${toHex(hash)}.ts`;

  // 2. Prepend stdlib imports and session context
  const fullCode = `
    import * as fs from "safesh:fs";
    import * as text from "safesh:text";
    import $ from "safesh:shell";
    declare const $session: Session;
    ${code}
  `;
  await Deno.writeTextFile(scriptPath, fullCode);

  // 3. Run with configured permissions + import map
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--import-map=/path/to/safesh/import-map.json",
      ...buildPermFlags(config),
      scriptPath,
    ],
    cwd: session.cwd,
    env: filterEnv(session.env, config),
  });

  const result = await cmd.output();
  return { stdout, stderr, code: result.code };
}
```

### 2. Session Management

Sessions provide persistent state between calls:

```typescript
interface Session {
  id: string;
  cwd: string;                      // Working directory
  env: Record<string, string>;      // Environment variables
  vars: Record<string, unknown>;    // JS variables to persist
  jobs: Map<string, Job>;           // Background processes
}

// MCP tools are session-aware
exec({ code, sessionId }): Result
run({ command, args, sessionId }): Result
startSession(): Session
endSession(sessionId): void
```

### 3. Security Hardening

**Path Argument Validation:**

```typescript
interface ExternalCommandConfig {
  allow: boolean | string[];
  denyFlags?: string[];
  pathArgs?: {
    autoDetect?: boolean; // Detect /path and ./path
    validateSandbox?: boolean; // Must be in allowed dirs
  };
}
```

**Symlink Resolution:**

```typescript
// Always resolve real path before validation
const realPath = await Deno.realPath(requestedPath);
if (!isWithinAllowedPaths(realPath, config.paths.allowed)) {
  throw new PathViolationError(requestedPath, realPath);
}
```

**Import Security (three-tier):**

```typescript
const importPolicy = {
  trusted: ["jsr:@std/*", "safesh:*"],
  allowed: [], // User whitelist
  blocked: ["npm:*", "http:*", "https:*"],
};
```

### 4. Background Job Control

```typescript
// New MCP tools for job management
bg(request): Job              // Launch background job
jobs(): Job[]                 // List running jobs
jobOutput(jobId): string      // Get buffered output
kill(jobId, signal?): void    // Stop job
fg(jobId): AsyncGenerator     // Stream job output
```

### 5. Output Streaming

Long-running commands use MCP streaming:

```typescript
async function* exec(request: ExecRequest): AsyncGenerator<ExecChunk> {
  const process = spawn(/* ... */);
  for await (const chunk of process.stdout) {
    yield { type: "stdout", data: chunk };
  }
  yield { type: "exit", code: await process.status };
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SafeShell                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   MCP Server                         │   │
│  │  • exec(code) - run inline JS/TS                    │   │
│  │  • run(command) - run whitelisted external cmd      │   │
│  │  • task(name) - run defined task                    │   │
│  │  • stream(pipeline) - run streaming pipeline        │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────▼─────────────────────────────┐ │
│  │              Deno Runtime + Permission Layer          │ │
│  │                                                       │ │
│  │  --allow-read=/project,/tmp                          │ │
│  │  --allow-write=/project,/tmp                         │ │
│  │  --allow-net=github.com,npmjs.org                    │ │
│  │  --allow-run=git,docker,fyn                          │ │
│  │  --allow-env=HOME,PATH,NODE_ENV                      │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│  ┌─────────────────────────▼─────────────────────────────┐ │
│  │              External Command Whitelist               │ │
│  │                                                       │ │
│  │  git: allow all, deny --force                        │ │
│  │  docker: allow [ps, logs, build]                     │ │
│  │  fyn: allow all                                      │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Config: safesh.config.ts (project) + ~/.config/safesh/     │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
safesh/
├── src/
│   ├── core/
│   │   ├── permissions.ts    # Deno permission management
│   │   ├── whitelist.ts      # External command whitelist
│   │   ├── config.ts         # Configuration loading/merging
│   │   └── errors.ts         # AI-friendly error types
│   │
│   ├── runtime/
│   │   ├── executor.ts       # JS/TS code execution
│   │   ├── sandbox.ts        # Sandbox configuration
│   │   └── context.ts        # Execution context (cwd, env)
│   │
│   ├── external/
│   │   ├── runner.ts         # External command executor
│   │   ├── validator.ts      # Command/flag validation
│   │   └── registry.ts       # Whitelist registry
│   │
│   ├── stdlib/               # SafeShell standard library
│   │   ├── fs.ts             # File system utilities
│   │   ├── text.ts           # Text processing (grep, sed, etc.)
│   │   ├── glob.ts           # Glob matching
│   │   ├── archive.ts        # tar, zip utilities
│   │   └── process.ts        # Process management
│   │
│   ├── streams/              # Gulp-like streaming
│   │   ├── source.ts         # src() - file sources
│   │   ├── dest.ts           # dest() - destinations
│   │   ├── transforms.ts     # Built-in transforms
│   │   └── pipeline.ts       # Pipeline composition
│   │
│   ├── runner/               # Task runner (xrun-like)
│   │   ├── tasks.ts          # Task definitions
│   │   ├── serial.ts         # Sequential execution
│   │   ├── parallel.ts       # Concurrent execution
│   │   └── watch.ts          # File watching
│   │
│   ├── mcp/
│   │   ├── server.ts         # MCP server implementation
│   │   ├── tools.ts          # Tool definitions
│   │   └── handlers.ts       # Request handlers
│   │
│   └── cli/
│       ├── main.ts           # CLI entry point
│       └── repl.ts           # Interactive mode
│
├── lib/                      # Pre-built standard library
├── tests/
├── deno.json
└── README.md
```

## Security Model

### Deno's Permission System (Foundation)

SafeShell leverages Deno's built-in security:

```typescript
// Permissions are configured, not prompted
const permissions = {
  read: ["/project", "/tmp"],
  write: ["/project", "/tmp"],
  net: ["github.com", "npmjs.org"],
  run: ["git", "docker", "fyn"],
  env: ["HOME", "PATH", "NODE_ENV"],
};
```

### External Command Whitelist (Layer 2)

Even with `--allow-run`, SafeShell adds fine-grained control:

```typescript
interface ExternalCommandConfig {
  // Command name
  [command: string]: {
    // Allow all subcommands or specific ones
    allow: boolean | string[];

    // Blocked flags (even if command allowed)
    denyFlags?: string[];

    // Required flags (must include)
    requireFlags?: string[];

    // Argument validation regex
    argPatterns?: Record<string, RegExp>;
  };
}
```

### Example Configuration

```typescript
// safesh.config.ts
import { defineConfig } from "safesh";

export default defineConfig({
  // Deno permissions
  permissions: {
    read: ["${CWD}", "/tmp", "${HOME}/.config"],
    write: ["${CWD}", "/tmp"],
    net: ["github.com", "api.github.com", "registry.npmjs.org"],
    run: ["git", "docker", "fyn", "nvx"],
    env: ["HOME", "PATH", "NODE_ENV", "EDITOR"],
  },

  // External command fine-tuning
  external: {
    git: {
      allow: true,
      denyFlags: ["--force", "-f", "--hard"],
    },
    docker: {
      allow: ["ps", "logs", "build", "images", "exec"],
      denyFlags: ["--privileged"],
    },
    fyn: { allow: true },
    nvx: { allow: true },
  },

  // Environment variable handling
  env: {
    // Pass through these
    allow: ["HOME", "PATH", "NODE_ENV", "EDITOR"],
    // Never expose (even if in allow list)
    mask: ["*_KEY", "*_SECRET", "*_TOKEN", "AWS_*"],
  },

  // Tasks (xrun-style)
  tasks: {
    build: "deno task build",
    test: "deno test --allow-read",
    dev: {
      parallel: ["watch:ts", "serve"],
    },
  },
});
```

## JS/TS Execution Model

### Direct Code Execution

AI can write and execute JS/TS directly:

```typescript
// MCP tool: exec({ code: "..." })

// File operations - uses Deno APIs directly
const content = await Deno.readTextFile("src/main.ts");
const lines = content.split("\n").filter((l) => l.includes("TODO"));
console.log(`Found ${lines.length} TODOs`);

// Complex transformations
import { walk } from "jsr:@std/fs";
for await (const entry of walk("src", { exts: [".ts"] })) {
  const text = await Deno.readTextFile(entry.path);
  if (text.includes("deprecated")) {
    console.log(`${entry.path}: contains deprecated code`);
  }
}

// JSON manipulation
const pkg = JSON.parse(await Deno.readTextFile("deno.json"));
pkg.version = "2.0.0";
await Deno.writeTextFile("deno.json", JSON.stringify(pkg, null, 2));
```

### Standard Library

SafeShell provides **namespaced utilities** with consistent contracts:

```typescript
// Namespace imports
import * as fs from "safesh:fs";
import * as text from "safesh:text";
import $ from "safesh:shell";

// fs namespace - file operations
await fs.read("file.txt"); // Read file
await fs.write("file.txt", content); // Write file
await fs.copy("src.txt", "dest.txt"); // Copy
await fs.move("old.txt", "new.txt"); // Move/rename
await fs.remove("file.txt"); // Delete
await fs.exists("file.txt"); // Check existence
for await (const f of fs.glob("**/*.ts")) {
} // Glob files
for await (const e of fs.walk("src")) {
} // Walk directory

// text namespace - text processing
const matches = await text.grep(/TODO/, content); // Returns Match[]
const first10 = await text.head(content, 10); // First N lines
const last20 = await text.tail(content, 20); // Last N lines
const replaced = text.replace(content, /old/g, "new");
const stats = await text.count(content); // { lines, words, chars }

// All functions RETURN results (never print to stdout)
// All functions THROW on errors with AI-friendly messages
```

### Fluent Shell API ($)

For shell-like ergonomics with chaining:

```typescript
import $ from "safesh:shell";

// Fluent file operations
await $("file.txt").read();
await $("file.txt")
  .grep(/pattern/)
  .print();
await $("src/**/*.ts").grep(/TODO/).count();

// Chain operations
await $("logs/*.log")
  .lines()
  .filter((l) => l.includes("ERROR"))
  .take(10)
  .save("errors.txt");

// External command shortcuts
await $.git("status");
await $.git("add", ".");
await $.git("commit", "-m", "Update");

// Piping between commands (using streams)
await $.git("diff").pipe($.grep("TODO")).print();
```

### Legacy/Flat Imports (also supported)

```typescript
import { grep, head, tail, find, replace } from "safesh:stdlib";

// grep equivalent
const matches = await grep("src/**/*.ts", /TODO|FIXME/);

// head/tail
const first10 = await head("log.txt", 10);
const last20 = await tail("log.txt", 20);

// find files
const tsFiles = await find("src", { ext: ".ts", name: /test/ });

// sed-like replace
await replace("config.ts", /localhost/g, "production.server.com");
```

### Streaming API

For large file processing:

```typescript
import { src, dest, transform, filter } from "safesh/streams";

// Process log files
await src("logs/**/*.log")
  .pipe(filter((line) => line.includes("ERROR")))
  .pipe(transform((line) => `[EXTRACTED] ${line}`))
  .pipe(dest("errors.txt"));

// Transform and copy
await src("src/**/*.ts")
  .pipe(
    transform((content) => content.replace(/console\.log/g, "logger.debug"))
  )
  .pipe(dest("dist/"));
```

## External Command Execution

### Whitelist Validation Flow

```
Command Request: "git push origin main"
         │
         ▼
┌─────────────────────┐
│ Is 'git' in         │──No──▶ DENIED: Command not whitelisted
│ --allow-run?        │
└─────────┬───────────┘
          │ Yes
          ▼
┌─────────────────────┐
│ Is 'git' in         │──No──▶ Execute directly (basic whitelist)
│ external config?    │
└─────────┬───────────┘
          │ Yes
          ▼
┌─────────────────────┐
│ Check subcommand    │
│ 'push' allowed?     │──No──▶ DENIED: Subcommand not allowed
└─────────┬───────────┘
          │ Yes
          ▼
┌─────────────────────┐
│ Check flags         │
│ Any denied flags?   │──Yes─▶ DENIED: Flag '--force' not allowed
└─────────┬───────────┘
          │ No
          ▼
      EXECUTE
```

### Command Wrapper

```typescript
// MCP tool: run({ command: "git", args: ["push", "origin", "main"] })

import { runExternal } from "safesh/external";

const result = await runExternal("git", ["push", "origin", "main"], {
  cwd: "/project",
  timeout: 30000,
});

// Returns: { stdout, stderr, code, success }
```

## MCP Server Interface

### Tools

#### Core Execution

1. **exec** - Execute JS/TS code (supports streaming)

   ```typescript
   {
     code: string,        // JS/TS code to execute
     sessionId?: string,  // Use existing session
     timeout?: number,    // Max execution time (ms)
     stream?: boolean,    // Stream output in real-time
   }
   // Returns: { stdout, stderr, code } or AsyncGenerator<Chunk>
   ```

2. **run** - Execute whitelisted external command

   ```typescript
   {
     command: string,     // Command name
     args?: string[],     // Arguments
     sessionId?: string,  // Use session's cwd/env
     timeout?: number,
     stream?: boolean,    // Stream output
   }
   ```

3. **task** - Execute defined task
   ```typescript
   {
     name: string,        // Task name from config
     args?: string[],     // Additional arguments
     sessionId?: string,
   }
   ```

#### Session Management

4. **startSession** - Create new session

   ```typescript
   {
     cwd?: string,        // Initial working directory
     env?: Record<string, string>,  // Initial env vars
   }
   // Returns: { sessionId, cwd, env }
   ```

5. **endSession** - Destroy session and cleanup

   ```typescript
   {
     sessionId: string,
   }
   ```

6. **updateSession** - Modify session state
   ```typescript
   {
     sessionId: string,
     cwd?: string,        // Change working directory
     env?: Record<string, string>,  // Set/update env vars
   }
   ```

#### Background Job Control

7. **bg** - Launch background job

   ```typescript
   {
     code?: string,       // JS/TS code
     command?: string,    // Or external command
     args?: string[],
     sessionId?: string,
   }
   // Returns: { jobId, pid }
   ```

8. **jobs** - List running jobs

   ```typescript
   {
     sessionId?: string,  // Filter by session
   }
   // Returns: Job[]
   ```

9. **jobOutput** - Get job's buffered output

   ```typescript
   {
     jobId: string,
     since?: number,      // Byte offset
   }
   // Returns: { stdout, stderr, offset }
   ```

10. **kill** - Stop a background job

    ```typescript
    {
      jobId: string,
      signal?: string,    // SIGTERM, SIGKILL, etc.
    }
    ```

11. **fg** - Stream job output (bring to foreground)
    ```typescript
    {
      jobId: string,
    }
    // Returns: AsyncGenerator<Chunk>
    ```

### Error Responses

```typescript
interface SafeShellError {
  code:
    | "PERMISSION_DENIED" // Deno permission blocked
    | "COMMAND_NOT_WHITELISTED" // External command not in whitelist
    | "FLAG_NOT_ALLOWED" // Specific flag blocked
    | "PATH_VIOLATION" // Path outside allowed dirs
    | "TIMEOUT" // Execution timeout
    | "EXECUTION_ERROR"; // Runtime error

  message: string;
  details?: {
    command?: string;
    flag?: string;
    path?: string;
    allowed?: string[]; // What IS allowed (helpful for AI)
  };
  suggestion?: string; // AI-friendly suggestion
}
```

**Example:**

```json
{
  "code": "FLAG_NOT_ALLOWED",
  "message": "Flag '--force' is not allowed for 'git push'",
  "details": {
    "command": "git push",
    "flag": "--force",
    "allowed": ["--set-upstream", "-u", "--tags"]
  },
  "suggestion": "Remove --force flag. If you need to force push, ask the user to approve this operation."
}
```

## Task Runner

### Task Definition

```typescript
// In safesh.config.ts
tasks: {
  // Simple command
  build: "deno task build",

  // With options
  test: {
    cmd: "deno test",
    args: ["--allow-read", "--allow-net"],
    env: { CI: "true" },
  },

  // Parallel execution
  dev: {
    parallel: ["watch:ts", "serve"],
  },

  // Serial execution
  ci: {
    serial: ["lint", "test", "build"],
  },

  // xrun array syntax
  "full-build": "[lint, [-s, test, build]]",  // lint || (test && build)
}
```

### CLI Usage

```bash
# Run task
safesh task build

# Run with xrun syntax
safesh task '[build, [-s, lint, test]]'

# List tasks
safesh tasks
```

## Configuration Hierarchy

1. **Default config** (built into safesh)
2. **Global config** (`~/.config/safesh/config.ts`)
3. **Project config** (`./safesh.config.ts`)

Later configs override earlier ones. Permissions are merged (union), while deny rules are also merged (union).

## Implementation Phases

### Phase 1: Core Runtime (SSH-1)

- [ ] Deno permission configuration
- [ ] Config file loading and merging
- [ ] Basic JS/TS execution in sandbox
- [ ] Error types and AI-friendly messages

### Phase 2: External Commands (SSH-6)

- [ ] Command whitelist registry
- [ ] Subcommand validation
- [ ] Flag filtering
- [ ] External command executor

### Phase 3: MCP Integration (SSH-7)

- [ ] MCP server setup
- [ ] exec tool implementation
- [ ] run tool implementation
- [ ] Error response formatting

### Phase 4: Standard Library (SSH-2, SSH-3)

- [ ] File system utilities (grep, find, etc.)
- [ ] Text processing utilities
- [ ] Glob matching

### Phase 5: Streaming (SSH-4)

- [ ] src/dest primitives
- [ ] Transform pipelines
- [ ] Built-in transforms

### Phase 6: Task Runner (SSH-5)

- [ ] Task definition parsing
- [ ] Serial/parallel execution
- [ ] xrun array syntax
- [ ] Watch mode

### Phase 7: Advanced Features (SSH-8)

- [ ] Archive utilities (tar, zip)
- [ ] Process management
- [ ] Network utilities

## Comparison: Bash Tool vs SafeShell

| Aspect           | Bash Tool              | SafeShell                    |
| ---------------- | ---------------------- | ---------------------------- |
| Permission model | Regex command matching | Deno permissions + whitelist |
| Prompts          | Frequent               | Pre-configured, none         |
| Language         | Shell commands         | Full JS/TS                   |
| Type safety      | None                   | Full TypeScript              |
| Error messages   | Shell errors           | AI-friendly with suggestions |
| Platform         | OS-dependent           | Cross-platform (Deno)        |
| File ops         | Shell commands         | Deno APIs                    |
| Text processing  | grep, sed, awk         | JS/TS + stdlib               |
| Extensibility    | Limited                | Full JS/TS ecosystem         |

## Open Questions

1. **REPL mode**: Provide interactive mode for exploration?

   - Proposal: Yes, useful for debugging and learning

2. **Import permissions**: Allow arbitrary JSR/npm imports?

   - Proposal: Whitelist specific packages or trust all JSR

3. **Subprocess output streaming**: Real-time output for long commands?

   - Proposal: Use MCP streaming or periodic updates

4. **State persistence**: Share state between exec calls?

   - Proposal: Optional context object passed between calls

5. **Timeout defaults**: Per-command-type timeouts?
   - Proposal: Config-based with sensible defaults
