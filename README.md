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

- **MCP Tools** - `exec`, `run`, `task`, `bg`, `jobs`, `kill`, `fg`
- **Session Support** - Persistent state between tool calls
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

- `exec` - Execute JS/TS code
- `run` - Run whitelisted external commands
- `task` - Execute defined tasks
- `startSession` - Create persistent session
- `bg` - Launch background job
- `jobs` - List running jobs

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
- `sessionId` (optional) - Session ID for persistent state
- `timeout` (optional) - Timeout in milliseconds
- `env` (optional) - Additional environment variables

**Example:**
```typescript
{
  "code": "const files = await fs.readDir('.'); console.log(files)",
  "sessionId": "my-session"
}
```

### `run` - Execute External Command

Execute a whitelisted external command.

**Parameters:**
- `command` (required) - Command name (must be whitelisted)
- `args` (optional) - Command arguments
- `sessionId` (optional) - Session ID for cwd/env context
- `cwd` (optional) - Working directory override
- `timeout` (optional) - Timeout in milliseconds

**Example:**
```typescript
{
  "command": "git",
  "args": ["status", "--short"],
  "sessionId": "my-session"
}
```

### `task` - Execute Task

Execute a task defined in configuration.

**Parameters:**
- `name` (required) - Task name from config.tasks
- `sessionId` (optional) - Session ID for context

**Example:**
```typescript
{
  "name": "test",
  "sessionId": "my-session"
}
```

### Session Management

**`startSession`** - Create a new session
```typescript
{
  "cwd": "/path/to/project",
  "env": { "DEBUG": "true" }
}
```

**`updateSession`** - Update session state
```typescript
{
  "sessionId": "my-session",
  "cwd": "/new/path",
  "env": { "NEW_VAR": "value" }
}
```

**`endSession`** - End a session
```typescript
{
  "sessionId": "my-session"
}
```

**`listSessions`** - List all active sessions

### Background Jobs

**`bg`** - Launch background job
```typescript
{
  "code": "await longRunningTask()",
  "sessionId": "my-session"
}
```

**`jobs`** - List running jobs
```typescript
{
  "sessionId": "my-session"  // optional filter
}
```

**`jobOutput`** - Get buffered job output
```typescript
{
  "jobId": "job-123",
  "since": 0  // byte offset
}
```

**`kill`** - Stop a job
```typescript
{
  "jobId": "job-123",
  "signal": "SIGTERM"
}
```

**`fg`** - Stream job output
```typescript
{
  "jobId": "job-123"
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

### File Operations

```javascript
// Read file
const content = await fs.read("data.txt");

// Write file
await fs.write("output.txt", "Hello, world!");

// Read JSON
const data = await fs.readJson("config.json");

// Write JSON
await fs.writeJson("data.json", { foo: "bar" });

// Check existence
if (await fs.exists("file.txt")) {
  console.log("File exists");
}

// Copy files
await fs.copy("source.txt", "dest.txt");

// Walk directory tree
for await (const entry of fs.walk(".", { exts: [".ts"] })) {
  console.log(entry.path);
}
```

### Text Processing

```javascript
// Read file and process lines
const lines = await text.read("file.txt");
const filtered = lines.filter(line => line.includes("ERROR"));

// Grep for patterns
const matches = await text.grep("**/*.ts", /TODO/);
for (const match of matches) {
  console.log(`${match.path}:${match.line}: ${match.text}`);
}

// Head and tail
const first10 = await text.head("log.txt", 10);
const last20 = await text.tail("log.txt", 20);

// Word count
const wc = await text.wc("document.txt");
console.log(`Lines: ${wc.lines}, Words: ${wc.words}`);
```

### Streaming Shell API

```javascript
// Process log files with streaming pipeline
const errors = await cat("app.log")
  .pipe(lines())
  .pipe(grep(/ERROR/))
  .pipe(take(10))
  .collect();

// Find and analyze code
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

// Stream git command output
const commits = await git("log", "--oneline")
  .stdout()
  .pipe(lines())
  .pipe(grep(/fix:/))
  .collect();

// Count lines of code across modules
const loc = await glob("src/**/*.ts")
  .pipe(filter(f => !f.path.includes(".test.")))
  .pipe(flatMap(file => cat(file.path).pipe(lines())))
  .count();
```

### Shell Operations

```javascript
// Execute external command
const result = await $("git", ["status", "--short"]);
console.log(result.stdout);

// Check exit code
if (result.code === 0) {
  console.log("Success!");
}

// Capture output
const files = await $("ls", ["-la"]);
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

### Session State

```javascript
// Sessions persist cwd, env, and variables
const session = await startSession({ cwd: "/project" });

// Execute with session context
await exec({
  code: "$session.vars.counter = ($session.vars.counter || 0) + 1",
  sessionId: session.id,
});

// Variables persist
await exec({
  code: "console.log($session.vars.counter)", // Prints: 1
  sessionId: session.id,
});
```

### Background Jobs

```javascript
// Launch long-running job
const job = await bg({
  code: `
    for (let i = 0; i < 100; i++) {
      console.log(\`Progress: \${i}%\`);
      await new Promise(r => setTimeout(r, 100));
    }
  `,
});

// Check job status
const allJobs = await jobs();

// Get buffered output
const output = await jobOutput({ jobId: job.jobId });
console.log(output.stdout);

// Stream output in real-time
await fg({ jobId: job.jobId });
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
