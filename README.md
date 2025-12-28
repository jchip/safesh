# SafeShell

A secure, sandboxed shell environment for AI assistants and automated workflows. Execute JavaScript/TypeScript code and whitelisted commands with fine-grained permission control.

## What is SafeShell?

SafeShell is a security-first execution environment built on Deno that provides:

- **Sandboxed Code Execution** - Run JS/TS code with pre-configured filesystem, network, and command permissions
- **Whitelisted External Commands** - Control exactly which commands (git, docker, etc.) can run, with subcommand and flag-level restrictions
- **No Permission Prompts** - Configure permissions once, execute repeatedly without interactive prompts
- **Built-in Standard Library** - File operations, text processing, and shell utilities available by default
- **MCP Server Integration** - Use as a Model Context Protocol server for AI assistants like Claude
- **Session Management** - Persistent state (cwd, env, variables) across multiple executions
- **Background Jobs** - Launch and manage long-running processes

## Features

### Security

- **Path Sandbox** - Restrict file access to specific directories with symlink resolution
- **Command Whitelist** - Fine-grained control over external commands, subcommands, and flags
- **Import Policy** - Control which modules can be imported (block npm, http, etc.)
- **Environment Masking** - Automatically hide sensitive environment variables
- **Security Presets** - Strict, standard, and permissive configurations

### Developer Experience

- **Full TypeScript** - Write real code, not just shell scripts
- **Auto-imported Standard Library** - `fs`, `text`, `glob`, `$` available automatically
- **Streaming Shell API** - Gulp-inspired chainable pipelines with lazy evaluation
- **Task Runner** - Define and execute parallel/serial task workflows
- **REPL** - Interactive development environment
- **Real-time Streaming** - Live output for long-running commands

### AI Assistant Integration

- **MCP Tools** - `exec`, `task`, `startShell`, `listShells`, `listJobs`, `waitJob`
- **Shell Support** - Persistent state (cwd, env, variables) between tool calls
- **Background Jobs** - Launch async jobs with `background: true`, poll or wait for completion
- **Structured Errors** - AI-friendly error messages with suggestions
- **No Interactive Prompts** - Fully automated execution

## Installation

### Prerequisites

- [Deno](https://deno.land/) 1.40 or later

### Install as MCP Server

Add to your MCP settings (e.g., `~/.config/claude/mcp_config.json`):

```json
{
  "mcpServers": {
    "safesh": {
      "command": "deno",
      "args": [
        "run",
        "--allow-all",
        "https://raw.githubusercontent.com/your-org/safesh/main/src/mcp/server.ts"
      ]
    }
  }
}
```

### Install as CLI

```bash
# Clone repository
git clone https://github.com/your-org/safesh.git
cd safesh

# Run CLI directly
deno run --allow-all src/cli/main.ts --help

# Or install globally
deno install --allow-all -n safesh src/cli/main.ts
```

## Quick Start

### The Fluent Shell API (`$`)

The primary way to use SafeShell is through the fluent `$` API - a chainable, shell-like interface for file and text processing:

```typescript
// Read and process files with shell-like pipelines
await $('app.log').lines().grep(/ERROR/).head(10).print();

// Collect results
const errors = await $('app.log').lines().grep(/ERROR/).collect();

// Transform and save
await $('data.txt').lines().map(l => l.toUpperCase()).save('output.txt');

// From arrays or text
await $.from(['apple', 'banana', 'cherry']).grep(/a/).print();
const lines = await $.text('hello\nworld').lines().collect();

// Count and analyze
const errorCount = await $('server.log').lines().grep(/ERROR/).count();
const first = await $('config.json').lines().first();
```

**Available methods:**
- **Transforms**: `.lines()`, `.grep(pattern)`, `.head(n)`, `.tail(n)`, `.filter(fn)`, `.map(fn)`, `.take(n)`
- **Terminals**: `.print()`, `.save(path)`, `.collect()`, `.first()`, `.count()`, `.forEach(fn)`
- **Escape hatch**: `.stream()` - access underlying Stream for advanced operations

### Command Execution

```typescript
// Run commands with fluent API
const result = await cmd('ls', ['-la']).exec();
console.log(result.stdout);

// Git, Docker, Deno shortcuts
await git('status').exec();
await docker('ps').exec();
await deno('test').exec();

// Pipe commands together
await cmd('cat', ['file.txt']).pipe('grep', ['pattern']).pipe('sort').exec();
```

### 1. Create a Config File

Create `safesh.config.ts` in your project root:

```typescript
import type { SafeShellConfig } from "https://raw.githubusercontent.com/your-org/safesh/main/src/core/types.ts";

const config: SafeShellConfig = {
  // Use a security preset as a base
  preset: "standard",

  // Allow git and deno commands
  permissions: {
    run: ["git", "deno"],
  },

  // Configure command behavior
  external: {
    git: {
      allow: true,
      denyFlags: ["--force"],
    },
    deno: {
      allow: ["test", "fmt", "lint"],
    },
  },

  // Define tasks
  tasks: {
    test: {
      cmd: 'await $("deno", ["test", "--allow-all"])',
    },
    fmt: {
      cmd: 'await $("deno", ["fmt"])',
    },
    check: {
      parallel: ["fmt", "test"],
    },
  },
};

export default config;
```

### 2. Execute Code

```bash
# Execute inline code
safesh exec 'console.log("Hello, SafeShell!")'

# Read and process files
safesh exec 'const data = await fs.read("data.txt"); console.log(data.toUpperCase())'

# Run whitelisted commands
safesh run git status

# Execute tasks
safesh task test
safesh task check

# Start REPL
safesh repl
```

### 3. Use as MCP Server

Once configured in your MCP client (e.g., Claude Desktop), use the tools:

- `exec` - Execute JS/TS code (use `background: true` for async)
- `task` - Execute defined tasks
- `startShell` - Create persistent shell for state
- `listShells` - List active shells
- `listJobs` - List jobs in a shell
- `getJobOutput` - Get buffered job output
- `waitJob` - Wait for background job to complete
- `killJob` - Stop a running job

## Configuration Reference

### Security Presets

SafeShell provides three security presets:

| Preset | Use Case | Read | Write | Network | Commands |
|--------|----------|------|-------|---------|----------|
| `strict` | Untrusted code | CWD, /tmp | /tmp only | None | None |
| `standard` | Most projects | CWD, /tmp | CWD, /tmp | None | None (configure explicitly) |
| `permissive` | Development | CWD, /tmp, HOME | CWD, /tmp | All | git, deno, node, docker, etc. |

### Configuration Options

```typescript
interface SafeShellConfig {
  // Security preset (optional)
  preset?: "strict" | "standard" | "permissive";

  // File system and command permissions
  permissions?: {
    read?: string[];        // Paths for read access: ["${CWD}", "/tmp"]
    write?: string[];       // Paths for write access
    net?: string[] | true;  // Network hosts or true for all
    run?: string[];         // Allowed external commands
    env?: string[];         // Allowed environment variables
  };

  // External command configuration
  external?: {
    [command: string]: {
      allow: boolean | string[];  // true or specific subcommands
      denyFlags?: string[];       // Forbidden flags
      requireFlags?: string[];    // Required flags
      pathArgs?: {                // Path argument validation
        autoDetect?: boolean;
        validateSandbox?: boolean;
        positions?: number[];
      };
    };
  };

  // Environment variable handling
  env?: {
    allow?: string[];  // Allowed variables (with wildcards)
    mask?: string[];   // Masked variables (with wildcards)
  };

  // Import security policy
  imports?: {
    trusted?: string[];  // Always allowed: ["jsr:@std/*", "safesh:*"]
    allowed?: string[];  // User-allowed imports
    blocked?: string[];  // Blocked patterns: ["npm:*", "http:*"]
  };

  // Task definitions
  tasks?: {
    [name: string]: string | {
      cmd?: string;           // JS/TS code to execute
      parallel?: string[];    // Tasks to run concurrently
      serial?: string[];      // Tasks to run sequentially
      cwd?: string;           // Working directory
      env?: Record<string, string>;  // Additional env vars
    };
  };

  // Default timeout in milliseconds
  timeout?: number;
}
```

### Example Configurations

See the [`examples/`](./examples/) directory for complete examples:

- [`minimal.config.ts`](./examples/minimal.config.ts) - Bare minimum configuration
- [`standard.config.ts`](./examples/standard.config.ts) - Typical project setup
- [`strict.config.ts`](./examples/strict.config.ts) - Maximum security
- [`permissive.config.ts`](./examples/permissive.config.ts) - Development-friendly

## MCP Tools Reference

When running as an MCP server, SafeShell exposes these tools:

### `exec` - Execute Code

Execute JavaScript/TypeScript code in a sandboxed environment.

**Parameters:**
- `code` (required) - JS/TS code to execute
- `shellId` (optional) - Shell ID for persistent state
- `background` (optional) - Run asynchronously, returns `{ jobId, pid }`
- `timeout` (optional) - Timeout in milliseconds
- `env` (optional) - Additional environment variables

**Example (sync):**
```typescript
{
  "code": "const files = await fs.readDir('.'); console.log(files)",
  "shellId": "my-shell"
}
// Returns: { stdout, stderr, code, success, jobId }
```

**Example (background):**
```typescript
{
  "code": "await longRunningTask()",
  "shellId": "my-shell",
  "background": true
}
// Returns: { jobId, pid, shellId, background: true }
```

### `task` - Execute Task

Execute a task defined in configuration.

**Parameters:**
- `name` (required) - Task name from config.tasks
- `shellId` (optional) - Shell ID for context

**Example:**
```typescript
{
  "name": "test",
  "shellId": "my-shell"
}
```

### Shell Management

Shells provide persistent state (cwd, env, variables) between tool calls.

**`startShell`** - Create a new shell
```typescript
{
  "cwd": "/path/to/project",
  "env": { "DEBUG": "true" }
}
// Returns: { shellId, cwd, env, vars, jobs, createdAt }
```

**`updateShell`** - Update shell state
```typescript
{
  "shellId": "abc-123",
  "cwd": "/new/path",
  "env": { "NEW_VAR": "value" }
}
```

**`endShell`** - End a shell and clean up
```typescript
{
  "shellId": "abc-123"
}
```

**`listShells`** - List all active shells with their state

### Job Management

All executions are tracked as jobs within their shell. Jobs provide history and debugging.

**`listJobs`** - List jobs in a shell
```typescript
{
  "shellId": "abc-123",
  "filter": {
    "status": "running",  // or "completed", "failed"
    "background": true,
    "limit": 10
  }
}
// Returns: [{ id, code, pid, status, background, startedAt, duration }]
```

**`getJobOutput`** - Get buffered output from a job
```typescript
{
  "shellId": "abc-123",
  "jobId": "job-abc-123-0",
  "since": 0  // byte offset for incremental reads
}
// Returns: { stdout, stderr, offset, status, exitCode, truncated }
```

**`waitJob`** - Wait for a background job to complete
```typescript
{
  "shellId": "abc-123",
  "jobId": "job-abc-123-0",
  "timeout": 30000
}
// Returns: { stdout, stderr, exitCode, status, duration }
```

**`killJob`** - Stop a running job
```typescript
{
  "shellId": "abc-123",
  "jobId": "job-abc-123-0",
  "signal": "SIGTERM"  // or "SIGKILL"
}
```

## Security Model

SafeShell implements a defense-in-depth security model:

### 1. Deno Permissions Layer

All code executes within Deno's permission system. Permissions are configured once and applied consistently.

### 2. Path Sandbox

File system access is restricted to explicitly allowed directories:

- **Symlink Resolution** - Paths are resolved before validation to prevent symlink escapes
- **Path Validation** - All file operations check against allowed read/write paths
- **Variable Expansion** - Supports `${CWD}`, `${HOME}` for portable configs

### 3. Command Whitelist

External commands are validated at multiple levels:

1. **Command Level** - Only whitelisted commands can execute
2. **Subcommand Level** - Optionally restrict to specific subcommands
3. **Flag Level** - Deny dangerous flags (e.g., `git push --force`)
4. **Path Arguments** - Validate path arguments against sandbox

### 4. Import Policy

Control which modules can be imported:

- **Trusted** - Always allowed (e.g., `jsr:@std/*`)
- **Allowed** - User-specified whitelist
- **Blocked** - Explicit blocklist (e.g., `npm:*`, `http:*`)

### 5. Environment Masking

Sensitive environment variables are automatically masked:

```typescript
env: {
  mask: ["*_KEY", "*_SECRET", "*_TOKEN", "*_PASSWORD"]
}
```

Masked variables are not passed to executed code, preventing credential leakage.

### 6. Configuration Validation

Configs are validated for security issues:

- **Errors** - Dangerous configurations (e.g., `write: ["/"]`)
- **Warnings** - Potentially risky configurations
- **Presets** - Pre-validated secure configurations

## Usage Examples

### Fluent Shell API (`$`) - Primary Interface

```javascript
// Process log files - simple and readable
await $('app.log').lines().grep(/ERROR/).head(10).print();

// Collect results into array
const errors = await $('app.log').lines().grep(/ERROR/).collect();

// Filter, transform, and save
await $('data.csv')
  .lines()
  .filter(line => !line.startsWith('#'))
  .map(line => line.toUpperCase())
  .save('output.csv');

// Count occurrences
const errorCount = await $('server.log').lines().grep(/ERROR/).count();

// Get first match
const firstError = await $('app.log').lines().grep(/FATAL/).first();

// Create from arrays or text
const result = await $.from(['apple', 'banana', 'cherry'])
  .grep(/a/)
  .collect();  // ['apple', 'banana']

const lines = await $.text('line1\nline2\nline3')
  .lines()
  .map(l => l.toUpperCase())
  .collect();  // ['LINE1', 'LINE2', 'LINE3']

// Iterate with for-await-of
for await (const line of $('log.txt').lines().grep(/ERROR/)) {
  console.log('Found:', line);
}
```

### Command Execution

```javascript
// Execute commands
const result = await cmd('ls', ['-la']).exec();
console.log(result.stdout);

// Git, Docker, Deno shortcuts
const status = await git('status', '--short').exec();
const containers = await docker('ps').exec();
const version = await deno('--version').exec();

// Pipe commands together (like Unix pipes)
await cmd('echo', ['hello\nworld\nfoo'])
  .pipe('grep', ['o'])
  .pipe('sort')
  .exec();

// Stream command output
const commits = await git('log', '--oneline')
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix:/))
  .collect();
```

### File Operations

```javascript
// Read/write files
const content = await fs.read("data.txt");
await fs.write("output.txt", "Hello, world!");

// JSON helpers
const config = await fs.readJson("config.json");
await fs.writeJson("data.json", { foo: "bar" });

// Check existence and copy
if (await fs.exists("file.txt")) {
  await fs.copy("file.txt", "backup.txt");
}

// Walk directory tree
for await (const entry of fs.walk(".", { exts: [".ts"] })) {
  console.log(entry.path);
}
```

### Advanced Streaming (escape hatch from $)

```javascript
// Use $ escape hatch for advanced Stream operations
const stream = $('data.txt').lines().stream();
await stream.pipe(customTransform()).collect();

// Or use low-level streaming API directly
await glob("src/**/*.ts")
  .pipe(filter(f => !f.path.includes(".test.")))
  .pipe(flatMap(file =>
    cat(file.path)
      .pipe(lines())
      .pipe(grep(/TODO/))
      .pipe(map(line => ({ file: file.path, line })))
  ))
  .forEach(({ file, line }) => {
    console.log(`${file}: ${line}`);
  });

// Count lines of code across modules
const loc = await glob("src/**/*.ts")
  .pipe(filter(f => !f.path.includes(".test.")))
  .pipe(flatMap(file => cat(file.path).pipe(lines())))
  .count();
```

### ShellJS-like Commands

```javascript
// Familiar shell commands
console.log(pwd());
console.log(await which('git'));
console.log(await test('-f', 'deno.json'));  // true if file exists
console.log(await test('-d', 'src'));        // true if directory exists

// Directory stack
pushd('/tmp');
popd();
```

### Task Composition

```javascript
// In safesh.config.ts
export default {
  tasks: {
    // Simple command
    test: {
      cmd: 'await $("deno", ["test"])',
    },

    // Parallel execution
    "check-all": {
      parallel: ["fmt", "lint", "test"],
    },

    // Serial execution (stops on failure)
    deploy: {
      serial: ["test", "build", "push"],
    },

    // Task reference (alias)
    ci: "check-all",
  },
};
```

### Shell State

```javascript
// Shells persist cwd, env, and variables
const shell = await startShell({ cwd: "/project" });

// Execute with shell context - variables persist via $shell.vars
await exec({
  code: "$shell.vars.counter = ($shell.vars.counter || 0) + 1",
  shellId: shell.shellId,
});

// Variables persist across exec calls
await exec({
  code: "console.log($shell.vars.counter)", // Prints: 1
  shellId: shell.shellId,
});

// Clean up when done
await endShell({ shellId: shell.shellId });
```

### Background Jobs

```javascript
// Launch long-running job with background: true
const { jobId, shellId } = await exec({
  code: `
    for (let i = 0; i < 100; i++) {
      console.log(\`Progress: \${i}%\`);
      await new Promise(r => setTimeout(r, 100));
    }
  `,
  shellId: shell.shellId,
  background: true,
});

// Check job status
const jobs = await listJobs({ shellId });

// Get buffered output (supports incremental reads)
const output = await getJobOutput({ shellId, jobId });
console.log(output.stdout);

// Or wait for completion
const result = await waitJob({ shellId, jobId, timeout: 30000 });
console.log(result.stdout);

// Kill a running job if needed
await killJob({ shellId, jobId, signal: "SIGTERM" });
```

## CLI Reference

```bash
# Execute code
safesh exec <code>

# Run external command
safesh run <cmd> [args...]

# Execute task
safesh task <name>

# Start REPL
safesh repl

# Start MCP server
safesh serve

# Options
-c, --config <file>  Config file (default: ./safesh.config.ts)
-v, --verbose        Verbose output
-h, --help           Show help
--version            Show version
```

## Contributing

Contributions are welcome! Please:

1. Read the security model carefully
2. Add tests for new features
3. Follow the existing code style
4. Update documentation

## License

MIT

## Related Projects

- [Deno](https://deno.land/) - Secure JavaScript/TypeScript runtime
- [Model Context Protocol](https://modelcontextprotocol.io/) - Protocol for AI assistant integration
