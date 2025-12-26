# SafeShell MCP Server Lifecycle

**Status**: Documentation
**Issue**: SSH-42
**Author**: Claude (AI Assistant)
**Date**: 2025-12-26

## Overview

This document describes the complete lifecycle of the SafeShell MCP (Model Context Protocol) server, from startup to tool execution. Understanding this flow is essential for debugging, extending, and integrating SafeShell with AI assistants.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Assistant                            │
│                  (Claude, GPT, etc.)                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ MCP Protocol (stdio)
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   SafeShell MCP Server                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  1. Startup & Initialization                          │ │
│  │     - Load config from disk                           │ │
│  │     - Initialize command registry                     │ │
│  │     - Create session manager                          │ │
│  │     - Register MCP tools                              │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  2. Tool Execution                                    │ │
│  │     - Validate request                                │ │
│  │     - Get/create session                              │ │
│  │     - Execute (exec, run, etc.)                       │ │
│  │     - Return formatted response                       │ │
│  └────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Validated Execution
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   Sandboxed Runtime                          │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Code Executor   │  │ External Runner  │                 │
│  │  (Deno runtime)  │  │ (whitelisted)    │                 │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Server Startup

### 1.1 Entry Point

**File**: `src/mcp/server.ts` (lines 942-947)

```typescript
if (import.meta.main) {
  main().catch((error) => {
    console.error("Failed to start server:", error);
    Deno.exit(1);
  });
}
```

**What happens**:
- Server is invoked directly via `deno run --allow-all src/mcp/server.ts`
- The `main()` function is called as the entry point
- Any uncaught errors terminate the server with exit code 1

### 1.2 Configuration Loading

**File**: `src/core/config.ts` (lines 315-343)

**Loading Order** (cascading priority):

1. **Default Config** (line 140)
   - Starts with `STANDARD_PRESET`
   - Location: Built into the binary
   - Provides: Minimal safe defaults

2. **Global Config** (lines 319-328)
   - Path: `~/.config/safesh/config.ts`
   - Loaded via: `loadConfigFile(globalPath)`
   - If preset specified: Replaces defaults entirely
   - Otherwise: Merged with defaults

3. **Project Config** (lines 331-340)
   - Path: `./safesh.config.ts` (in current directory)
   - Loaded via: `loadConfigFile(projectPath)`
   - If preset specified: Replaces all previous config
   - Otherwise: Merged with global + defaults
   - **Highest priority**: Project config wins

**Config Merging Logic**:

```typescript
// Permissions: UNION (all are combined)
read: [...defaultRead, ...globalRead, ...projectRead]

// External commands: MERGE (project overrides specific commands)
external: {
  ...defaultExternal,
  ...globalExternal,
  ...projectExternal  // Command-level override
}

// Timeout: LAST WINS
timeout: projectTimeout ?? globalTimeout ?? defaultTimeout
```

**Error Handling**:
- Missing config files: Silently ignored (use defaults)
- Malformed config: Throws `ConfigError` with details
- TypeScript errors: Import fails with syntax error

### 1.3 Validation Phase

**When**: After config is loaded but before server starts

**File**: `src/core/config.ts` (lines 380-542)

**Validation Checks**:

1. **Permission Validation**:
   - ERROR: `write: ['/']` (root filesystem write)
   - ERROR: `run: ['*']` (wildcard commands)
   - WARNING: `read: ['/']` (entire filesystem)
   - WARNING: `net: true` (unrestricted network)

2. **External Command Validation**:
   - ERROR: Conflicting flags (denied + required)
   - WARNING: Commands with no restrictions

3. **Import Policy Validation**:
   - ERROR: Pattern both trusted AND blocked
   - WARNING: Empty blocked list
   - WARNING: `npm:*` or `http:*` allowed

4. **Cross-Concern Validation**:
   - WARNING: Unrestricted net + npm imports
   - WARNING: CWD write + no import blocks

**Result**:
- Errors: Server fails to start (logged to stderr)
- Warnings: Server starts, warnings logged (lines 364-367)

### 1.4 Server Initialization

**File**: `src/mcp/server.ts` (lines 95-109)

```typescript
export function createServer(config: SafeShellConfig, cwd: string): Server {
  const server = new Server(...)
  const registry = createRegistry(config)
  const sessionManager = createSessionManager(cwd)
  // ...
}
```

**Components Created**:

1. **Server Instance** (line 96-105)
   - MCP SDK server
   - Name: "safesh", Version: "0.1.0"
   - Capabilities: `{ tools: {} }`

2. **Command Registry** (line 108)
   - Loads from `config.external`
   - Merges with default command configs
   - Validates command whitelist

3. **Session Manager** (line 109)
   - Default CWD: Current directory
   - Empty session map initially
   - Will create sessions on-demand

4. **Permission Summary** (lines 112-118)
   - Builds human-readable permission description
   - Used in tool descriptions for AI context

### 1.5 Tool Registration

**File**: `src/mcp/server.ts` (lines 121-362)

**Registered Tools**:

1. `exec` - Execute JS/TS code in sandbox
2. `run` - Execute whitelisted external command
3. `startSession` - Create persistent session
4. `updateSession` - Modify session state
5. `endSession` - Destroy session
6. `listSessions` - List active sessions
7. `bg` - Launch background job
8. `jobs` - List background jobs
9. `jobOutput` - Get job output
10. `kill` - Kill background job
11. `fg` - Stream job output

**Tool Metadata**:
- Name, description, input schema (JSON Schema)
- Permissions shown in description (AI context)
- Required vs optional parameters

### 1.6 Transport Connection

**File**: `src/mcp/server.ts` (lines 933-938)

```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("SafeShell MCP Server started");
```

**What happens**:
- Server listens on stdin/stdout (stdio transport)
- AI assistant connects via MCP protocol
- Server is now ready to handle requests
- Startup complete message logged to stderr

## Phase 2: Tool Execution Flow

### 2.1 Request Reception

**File**: `src/mcp/server.ts` (lines 364-839)

**MCP Request Format**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "exec",
    "arguments": {
      "code": "console.log('hello')",
      "sessionId": "abc-123"
    }
  }
}
```

**Handler**: `CallToolRequestSchema` (line 365)

### 2.2 Request Routing

**Switch Statement** (lines 369-813)

```typescript
switch (name) {
  case "exec": // Execute code
  case "run": // Run command
  case "startSession": // Session management
  // ... other tools
}
```

**Per-Tool Processing**:

#### exec Tool (lines 370-407)

1. **Parse Arguments** (line 371)
   - Validate against `ExecSchema`
   - Extract: `code`, `sessionId`, `timeout`, `env`

2. **Session Handling** (lines 374-376)
   - Get existing session OR create temporary
   - Temporary sessions not persisted
   - Merge additional env vars (line 380-384)

3. **Code Execution** (lines 386-391)
   - Call `executeCode()` from runtime/executor
   - Pass: code, config, options, session
   - Sandboxed Deno subprocess spawned

4. **Update Session** (lines 394-396)
   - If NOT temporary AND success
   - Update persisted vars from execution
   - Session state saved

5. **Format Response** (lines 399-406)
   - Call `formatExecResult()`
   - Include stdout, stderr, exit code
   - Return MCP response

#### run Tool (lines 409-456)

1. **Parse Arguments** (line 410-411)
   - Validate against `RunSchema`
   - Extract: `command`, `args`, `sessionId`, `cwd`, `timeout`

2. **Session & CWD** (lines 414-417)
   - Get/create session for context
   - Working dir: explicit > session > default

3. **Command Execution** (lines 420-430)
   - Call `runExternal()` from external/runner
   - Validates against whitelist
   - Validates against sandbox
   - Executes with timeout

4. **Error Handling** (lines 441-455)
   - Catch `SafeShellError` specifically
   - Format with AI-friendly message
   - Return as error response

### 2.3 Session Management

**Temporary vs Persistent Sessions**:

```typescript
// Temporary session (not saved)
const { session, isTemporary } = sessionManager.getOrTemp(undefined, { cwd });

// Persistent session (saved)
const session = sessionManager.create({ cwd: "/project", env: {...} });
```

**Session Lifecycle**:

1. **Create** (`startSession` tool):
   - Generates UUID
   - Stores in SessionManager map
   - Returns session ID to AI

2. **Use** (`exec`/`run` with sessionId):
   - Retrieve from map
   - Pass to executor/runner
   - Session provides: cwd, env, vars, jobs

3. **Update** (`updateSession` tool):
   - Modify: cwd, env, vars
   - Merge semantics (don't replace)
   - Session persists across calls

4. **End** (`endSession` tool):
   - Kill running jobs
   - Remove from map
   - Session destroyed

### 2.4 Code Execution Deep Dive

**File**: `src/runtime/executor.ts` (lines 166-271)

**Steps**:

1. **Prepare Script** (lines 180-191)
   - Hash code to create cache key
   - Create temp file: `/tmp/safesh/scripts/{hash}.ts`
   - Build preamble with `$session` global
   - Write full code to disk

2. **Import Validation** (lines 176-177)
   - Parse code for import statements
   - Check against `config.imports` policy
   - Reject blocked imports (npm:*, http:*, etc.)

3. **Build Deno Command** (lines 196-220)
   - Generate import map from policy
   - Build permission flags from config
   - Add: `--no-prompt`, `--import-map`, permissions
   - Args: `['run', ...flags, scriptPath]`

4. **Environment Setup** (lines 217)
   - Build allowed env vars
   - Apply masking patterns
   - Merge session env

5. **Spawn Subprocess** (line 214)
   - `new Deno.Command('deno', ...)`
   - Isolated Deno runtime
   - Stdout/stderr piped

6. **Execution with Timeout** (lines 226-244)
   - Collect stdout/stderr concurrently
   - Wrap in deadline() for timeout
   - Return structured result

7. **Cleanup** (lines 245-263)
   - On timeout: Kill process (SIGKILL)
   - Cancel streams to prevent leaks
   - Throw appropriate error

### 2.5 External Command Execution

**File**: `src/external/runner.ts` (lines 26-108)

**Steps**:

1. **Validation** (lines 37-42)
   - Create command registry from config
   - Call `validateExternal(command, args, ...)`
   - Checks: whitelist, subcommands, flags, paths
   - Throws if denied

2. **Environment** (lines 45)
   - Build from: config.env.allow
   - Apply: config.env.mask
   - Merge: session.env
   - Add: options.env

3. **Execute** (lines 48-55)
   - `new Deno.Command(command, ...)`
   - `clearEnv: true` - Don't inherit parent
   - Explicit env vars only
   - Stdout/stderr piped

4. **Timeout & Collection** (lines 60-79)
   - Same pattern as code execution
   - Wrap in deadline()
   - Collect streams concurrently
   - Return structured result

5. **Error Handling** (lines 80-108)
   - Kill on timeout: SIGKILL
   - Cancel streams
   - Throw TimeoutError or ExecutionError

### 2.6 Response Formatting

**File**: `src/mcp/server.ts` (lines 845-920)

**Format Functions**:

1. **formatExecResult** (lines 847-875)
   ```
   [stdout content]

   [stderr]
   [stderr content]

   [exit code: N]  (if failed)
   [session: abc-123]  (if provided)
   ```

2. **formatRunResult** (lines 880-905)
   ```
   $ command arg1 arg2

   [stdout content]

   [stderr]
   [stderr content]

   [exit code: N]  (if failed)
   ```

3. **formatError** (lines 910-920)
   ```
   Error [ERROR_CODE]: message

   Suggestion: how to fix it
   ```

**MCP Response Structure**:
```json
{
  "content": [
    {
      "type": "text",
      "text": "[formatted output]"
    }
  ],
  "isError": false
}
```

## Security Boundaries

### Sandbox Enforcement Points

1. **Config Loading** (startup):
   - Validates permission boundaries
   - Rejects dangerous configurations

2. **Import Validation** (code execution):
   - Checks every import statement
   - Blocks untrusted sources

3. **Path Validation** (file operations):
   - Every file access checked
   - Symlinks resolved and validated

4. **Command Validation** (external execution):
   - Whitelist check
   - Subcommand filtering
   - Flag denial
   - Path argument validation

5. **Environment Isolation**:
   - Explicit env var allow list
   - Masking for secrets
   - `clearEnv: true` for subprocesses

### Defense in Depth

Multiple layers protect against escape:

```
┌─────────────────────────────────────────┐
│ Layer 1: Config Validation              │ ← Reject bad config
├─────────────────────────────────────────┤
│ Layer 2: Import Policy                  │ ← Block malicious imports
├─────────────────────────────────────────┤
│ Layer 3: Deno Permissions                │ ← OS-level restrictions
├─────────────────────────────────────────┤
│ Layer 4: Path Validation                │ ← Sandbox boundaries
├─────────────────────────────────────────┤
│ Layer 5: Command Whitelist              │ ← External command filter
├─────────────────────────────────────────┤
│ Layer 6: Environment Masking            │ ← Secret protection
└─────────────────────────────────────────┘
```

## Debugging Guide

### Enable Verbose Logging

Add to config:
```typescript
// safesh.config.ts
export default {
  // ... config
  __debug: true,  // Enable debug output (not yet implemented)
}
```

### Common Issues

1. **"Command not whitelisted"**
   - Check: `config.permissions.run` includes command
   - Check: `config.external.{command}` is defined
   - Solution: Add to both places

2. **"Path outside allowed directories"**
   - Check: `config.permissions.read/write`
   - Note: Symlinks are resolved to real path
   - Solution: Add both `/tmp` and `/private/tmp` on macOS

3. **"Import not allowed"**
   - Check: `config.imports.blocked` patterns
   - Check: `config.imports.allowed` or `trusted`
   - Solution: Add to allowed or remove from blocked

4. **"Timeout"**
   - Check: `config.timeout` (default 30000ms)
   - Check: Per-call `timeout` option
   - Solution: Increase timeout or optimize code

### Inspecting Server State

**List active sessions**:
```typescript
// Via MCP tool
{
  "name": "listSessions",
  "arguments": {}
}
```

**Check background jobs**:
```typescript
{
  "name": "jobs",
  "arguments": {}
}
```

## Performance Considerations

### Startup Cost

- Config loading: ~10ms (async import)
- Validation: ~1ms
- Server init: ~5ms
- Total: ~20ms to ready

### Per-Call Overhead

| Tool | Overhead | Notes |
|------|----------|-------|
| exec | ~50-100ms | Deno subprocess spawn |
| run | ~10-50ms | Direct command exec |
| Session ops | <1ms | In-memory map |
| Background jobs | ~50ms | Async spawn |

### Optimization Tips

1. **Reuse sessions**: Avoid creating new sessions per call
2. **Cache imports**: Repeated code hits cached scripts
3. **Use background jobs**: For long-running tasks
4. **Batch operations**: Combine multiple file ops in single exec

## Extension Points

### Adding New Tools

**Template**:
```typescript
// In createServer() function

// 1. Define schema
const MyToolSchema = z.object({
  param: z.string(),
});

// 2. Register tool
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "myTool",
      description: "Does something useful",
      inputSchema: { /* JSON Schema */ },
    },
  ],
}));

// 3. Handle calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "myTool":
      const args = MyToolSchema.parse(request.params.arguments);
      const result = await myToolImpl(args, config);
      return { content: [{ type: "text", text: result }] };
  }
});
```

### Custom Validators

**Add to** `src/external/validator.ts`:

```typescript
export function validateMyRule(
  command: string,
  args: string[],
  config: SafeShellConfig,
): ValidationResult {
  // Your validation logic
}
```

### Custom Error Types

**Add to** `src/core/errors.ts`:

```typescript
export function myCustomError(details: string): SafeShellError {
  return new SafeShellError(
    "MY_ERROR_CODE",
    "Human-readable message",
    { details },
    "Suggestion: how to fix it"
  );
}
```

## References

- **MCP Protocol**: https://modelcontextprotocol.io
- **Config Types**: `src/core/types.ts`
- **Error Handling**: `src/core/errors.ts`
- **Validation Logic**: `src/core/config.ts` (lines 380-542)
- **Executor**: `src/runtime/executor.ts`
- **External Runner**: `src/external/runner.ts`
- **Server Implementation**: `src/mcp/server.ts`
