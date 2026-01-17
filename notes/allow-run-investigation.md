# Deno --allow-run Permission Investigation

## Problem
When `allowProjectCommands: true` is set, SafeShell adds `projectDir` to the `--allow-run` flag, expecting it to grant permission to execute scripts within that directory. However, project scripts like `.temp/test-script.sh` still fail with permission errors.

## Test Results

### Test 1: Directory Permission
```bash
deno run --allow-run=/tmp/deno-test /tmp/test-allow-run.ts
```

**Results:**
- Directory permission query: `granted`
- Script in root: `FAILED - Requires run access`
- Script in subdir: `FAILED - Requires run access`

**Conclusion:** `--allow-run=/dir` does NOT grant permission to execute files within that directory.

### Test 2: Explicit File Paths
```bash
deno run --allow-run=/tmp/deno-test/test-root.sh,/tmp/deno-test/subdir/test-sub.sh /tmp/test.ts
```

**Results:**
- Both scripts: `SUCCESS`
- Permission queries: `granted`

**Conclusion:** Must explicitly list each executable's full path.

### Test 3: Wildcard Patterns
```bash
deno run --allow-run=/tmp/deno-test/* /tmp/test.ts
```

**Results:**
- Directory permission query: `prompt` (not `granted`)
- Scripts: `FAILED`

**Conclusion:** Wildcards are NOT supported.

## Deno --allow-run Behavior

### What --allow-run Accepts:
1. **Command names**: `--allow-run=git,npm,cargo`
   - Searches in PATH
2. **Absolute paths**: `--allow-run=/usr/bin/git,/home/user/script.sh`
   - Exact file paths only

### What --allow-run Does NOT Accept:
- ❌ Directory paths for recursive permission
- ❌ Wildcard patterns (`*`, `**`)
- ❌ Glob patterns
- ❌ Relative paths

## Solution for SafeShell

Since Deno doesn't support directory-based run permissions, we have two options:

### Option 1: Dynamic Permission Collection
When `allowProjectCommands: true`, dynamically collect all executable scripts in the project directory and add them to `--allow-run`:

```typescript
if (config.allowProjectCommands && config.projectDir) {
  const scripts = await findExecutablesInDirectory(config.projectDir);
  runCommands.push(...scripts);
}
```

**Pros:**
- Works with Deno's permission model
- Explicit control

**Cons:**
- Performance overhead (directory traversal)
- Scripts created after process starts won't be allowed
- Large projects might hit --allow-run length limits

### Option 2: --allow-all for Project Context
When `allowProjectCommands: true` in Claude Code context, use `--allow-all` or `--allow-run` (unrestricted):

```typescript
if (config.allowProjectCommands && config.projectDir) {
  return "--allow-run"; // Unrestricted
}
```

**Pros:**
- Simple
- No performance overhead
- Works for dynamically created scripts

**Cons:**
- Less secure
- Defeats purpose of sandboxing

### Option 3: Hybrid Approach (Recommended)
Use unrestricted `--allow-run` only when:
1. `allowProjectCommands: true` AND
2. Running in Claude Code context (detected via bash-prehook)

```typescript
if (config.allowProjectCommands && config.projectDir && isClaudeCodeContext()) {
  return "--allow-run"; // Unrestricted for Claude Code
}
```

For direct `desh` usage, require explicit permission grants.

## Recommendation

Implement **Option 3 (Hybrid Approach)**:
- Claude Code gets convenience with `allowProjectCommands` → unrestricted `--allow-run`
- Direct `desh` usage maintains security with explicit permissions
- Can be controlled via environment variable `SAFESH_CLAUDE_CODE_MODE`

## Related Files
- `src/runtime/executor.ts:631-651` - `buildRunPermission()`
- `hooks/bash-prehook.ts:863-868` - Sets `allowProjectCommands: true`
- `src/cli/desh.ts:390-395` - Reads `SAFESH_ALLOW_PROJECT_COMMANDS` env var
