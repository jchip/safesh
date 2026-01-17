# Script File Naming Conventions

All cached script files are stored in `/tmp/safesh/scripts/` with consistent prefixes to identify their source and purpose.

## Naming Patterns

### Bash-Prehook Scripts (Claude Code)
Scripts created when bash commands are executed through Claude Code's bash-prehook:

| Pattern | Source | Purpose | Has Pending File? |
|---------|--------|---------|-------------------|
| `tx-script-<hash>.ts` | Bash command transpiled to TypeScript | Transpiled bash commands | ✅ Yes - `pending-<hash>.json` |
| `script-<hash>.ts` | Direct TypeScript with `/*#*/` prefix | TypeScript code from bash tool | ✅ Yes - `pending-<hash>.json` |
| `file_<hash>.ts` | Legacy format | Old timestamp or hash-based | ⚠️ Legacy only |

**Hash:** First 16 characters of URL-safe Base64-encoded SHA-256 of the original command

**Pending files:** Store execution context (cwd, timeout, commands, etc.) for retry flow when commands are blocked

### Direct Desh Execution
Scripts created when code is executed directly via `desh` command:

| Pattern | Source | Purpose | Has Pending File? |
|---------|--------|---------|-------------------|
| `exec-<hash>.ts` | `desh --code` or stdin | Inline code execution | ❌ No |
| `file_<hash>.ts` | `desh --file` | File execution | ❌ No |
| `bg-script-<hash>.ts` | Background script launch | `$.bg()` or similar | ❌ No |

**Hash:** SHA-256 hash of the code

**No pending files:** These are direct executions that don't go through the retry/approval flow

### Legacy Patterns (Being Phased Out)
| Pattern | Description | Status |
|---------|-------------|--------|
| `<hash>.ts` (no prefix) | Old executor scripts | ⚠️ Will be replaced by `exec-<hash>.ts` |
| `file_<timestamp>-<pid>.ts` | Old timestamp-based | ⚠️ Replaced by hash-based naming |

## Script Lifecycle

### Bash-Prehook Flow (Claude Code)
```
User runs bash command
  ↓
bash-prehook.ts validates permissions
  ↓
If blocked → outputDenyWithRetry()
  ├─ Creates tx-script-<hash>.ts or script-<hash>.ts
  ├─ Creates pending-<hash>.json (without tsCode, just metadata)
  └─ User approves → desh retry reads script + pending file
  ↓
If allowed → outputRewriteToDesh()
  ├─ Creates tx-script-<hash>.ts or script-<hash>.ts
  ├─ Creates pending-<hash>.json
  └─ Executes via desh
```

### Direct Desh Flow
```
User runs: desh --code "..."
  ↓
executor.ts creates exec-<hash>.ts
  ↓
Executes with Deno subprocess
  ↓
No pending file (no retry flow needed)
```

## Caching Behavior

### Hash-Based Caching
All script files use content-based hashing:
- **Same command** → **Same hash** → **Reuses cached file**
- **Different command** → **Different hash** → **Creates new file**

**Benefits:**
- Eliminates duplicate scripts for identical commands
- Significantly reduces /tmp/safesh/scripts growth
- Maintains full retry functionality

### Cache Lookup
When creating a script file:
1. Generate hash from original command
2. Check if `<prefix>-<hash>.ts` exists
3. If exists: Reuse cached file (skip write)
4. If not: Write new file

## Cleanup Policy

**Trigger:** When script file count exceeds 100

**Action:** Delete files older than 24 hours

**Cleanup handles:**
- All script file patterns (including legacy)
- Corresponding pending files for bash-prehook scripts
- Orphaned pending files

**Preserved:**
- Recently used scripts (< 24 hours)
- Scripts actively being executed

## File Size Optimization

### Pending File Optimization
**Before:** 1,380 bytes (included full tsCode)
```json
{
  "id": "hash",
  "commands": [],
  "tsCode": "... 1170 characters ...",
  "cwd": "/path",
  "timeout": 120000,
  "createdAt": "..."
}
```

**After:** 124 bytes (91% reduction)
```json
{
  "id": "hash",
  "commands": [],
  "cwd": "/path",
  "timeout": 120000,
  "createdAt": "..."
}
```

**Why:** The `tsCode` is already stored in the cached script file, so storing it again in the pending file is redundant.

## Related Files

- **hooks/bash-prehook.ts** - Creates tx-script-* and script-* files
- **src/runtime/executor.ts** - Creates exec-* and file_* files
- **src/runtime/scripts.ts** - Creates bg-script-* files
- **src/cli/desh.ts** - Retry mechanism reads pending files

## Migration Notes

The system gracefully handles mixed prefix formats:
- Cleanup works with all patterns
- Old unprefixed files will be cleaned up by age
- New scripts automatically use consistent prefixes
- No manual migration needed
