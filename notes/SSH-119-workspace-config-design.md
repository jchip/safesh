# SSH-119: Workspace and Project Directory Configuration Design

## Overview

Add comprehensive support for configuring workspace, project, and working directories with automatic permission management.

## Key Concepts

| Directory      | Purpose                                  | Example            |
| -------------- | ---------------------------------------- | ------------------ |
| `workspaceDir` | Parent directory containing all projects | `~/dev`            |
| `projectDir`   | Current project directory                | `~/dev/safesh`     |
| `cwd`          | Current working directory within project | `~/dev/safesh/src` |

## Requirements

1. Allow read/write under workspaceDir
2. Allow read/write under projectDir
3. Support relative paths for commands - resolve against cwd if specified, else projectDir
4. Auto-allow any command under projectDir

## Design Decision: Mutability

| Setting        | Mutability               | Rationale                                             |
| -------------- | ------------------------ | ----------------------------------------------------- |
| `workspaceDir` | **Fixed per connection** | Defines security boundary                             |
| `projectDir`   | **Fixed per connection** | Defines security boundary                             |
| `cwd`          | **Mutable anytime**      | Just path resolution context, no security implication |

To change workspaceDir or projectDir, client must reconnect.

## Design Options: How to Accept Configuration

### Option 1: Per-tool args

Every tool (run, etc.) accepts projectDir/cwd/workspaceDir as parameters.

```typescript
run({
  code: "...",
  projectDir: "/path",
  cwd: "/path",
  workspaceDir: "/workspace",
});
```

**Pros:**

- Stateless - each call is self-contained
- Maximum flexibility - can change context per-call

**Cons:**

- Verbose - every call repeats the same paths
- Inconsistency risk - different calls might use different values
- Client burden - MCP client must track and pass these every time
- Conflicts with "fixed per connection" requirement for workspaceDir/projectDir

### Option 2: Upfront config/init tool

New `configure` tool sets session state once.

```typescript
configure({ workspaceDir: "~/dev", projectDir: "~/dev/safesh", cwd: "./src" });
run({ code: "..." }); // uses configured paths
```

**Pros:**

- Set once, applies to all subsequent calls
- Cleaner tool API - `run` stays simple
- Natural fit for "working in a project" workflow
- Enforces "fixed per connection" for workspaceDir/projectDir

**Cons:**

- Stateful - need to manage session state
- Client must call configure before other operations (or have good defaults)
- Extra round-trip before first operation

### Option 3: Hybrid - First-use initialization

First `run` call with projectDir/workspaceDir sets them; subsequent calls inherit.

```typescript
// First call - sets workspaceDir/projectDir (locked after this)
run({ code: "...", projectDir: "/path", workspaceDir: "/workspace" });

// Subsequent calls - inherit, only cwd can change
run({ code: "...", cwd: "./tests" });
```

**Pros:**

- No extra configure call needed
- Natural flow - just start using
- Still enforces "fixed per connection" after first set

**Cons:**

- Implicit behavior - less obvious when lock happens
- First call is "special"

### Option 4: CLI args only (current approach extended)

No runtime configure - must set workspaceDir/projectDir at server start via CLI args.

```bash
safesh --workspace-dir=~/dev --project-dir=~/dev/safesh --cwd=./src
```

**Pros:**

- Simple - no new tools needed
- Clear lifecycle - set at start, done

**Cons:**

- No dynamic configuration
- Client can't set these - only whoever starts the server
- Less flexible for IDE/tool integration where client knows the context

### Option 5: Connection-time auto-configure

MCP client sends configuration as part of connection handshake or initialization.

**Pros:**

- Natural fit for MCP lifecycle
- Client-driven configuration

**Cons:**

- May require MCP protocol understanding
- Less explicit

## Open Questions

1. **Who knows the context?** Server (launched with context) or client (IDE, Claude Code)?

   - If server knows: CLI args work well
   - If client knows: Need init tool or per-tool args

2. **What happens if configure not called?**

   - Error on first run?
   - Use defaults (CWD at server start)?
   - Auto-detect from first file access?

3. **Should cwd changes be explicit tool or implicit?**

   - Explicit: `configure({ cwd: "./new" })` or `run({ cwd: "./new" })`
   - Implicit: `cd("./new")` in user code affects subsequent runs

4. **Validation timing:**
   - Validate paths exist at configure time?
   - Or lazy validation on first use?

## Chosen Approach: MCP Roots (Option 5)

**Decision**: Use MCP protocol's built-in `roots` capability instead of CLI args or custom configure tool.

### Implementation (SSH-121)

After server connects and receives `initialized` notification:

1. Check if client supports `roots` capability via `getClientCapabilities()`
2. Call `server.listRoots()` to get root URIs from client
3. Parse `file://` URIs to local paths
4. First root becomes `projectDir`
5. All roots added to `permissions.read` and `permissions.write`
6. Listen for `notifications/roots/list_changed` to handle dynamic updates

### Benefits

- Uses MCP standard instead of custom protocol
- Client-driven (IDE/Claude Code knows the context)
- Dynamic updates when roots change
- No extra CLI args or tools needed
- Works with any MCP client that supports roots

### Files Changed

- `src/mcp/server.ts`: Added roots fetching and config updates
- `tests/mcp_roots_test.ts`: Unit tests for URI parsing

## Related

- Epic: SSH-119 (closed)
- Implementation: SSH-121
- Current implementation: CLI args still supported as fallback
- Files: `src/mcp/server.ts`, `src/core/config.ts`, `src/core/permissions.ts`
