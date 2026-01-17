# Security Model with Unrestricted --allow-run

## What Does Unrestricted --allow-run Do?

When you use `--allow-run` (without specifying commands), Deno allows execution of **ANY external command**:
- ✅ Any command in PATH (`git`, `npm`, `rm`, `bash`, etc.)
- ✅ Any executable file on the system
- ✅ System commands that could be dangerous

## But Wait - Isn't This Insecure?

**No, because SafeShell has MULTIPLE security layers:**

### Security Layer 1: Bash Pre-hook (PRIMARY GATE)
**Location:** `hooks/bash-prehook.ts:1021-1031`

```typescript
// Check which commands are not allowed
const disallowed = getDisallowedCommands(commands, config, cwd);
if (disallowed.length > 0) {
  // BLOCKED - Prompt user for approval
  await outputDenyWithRetry(disallowed, ...);
  Deno.exit(0);
}
```

**What it checks:**
1. Is the command in `permissions.run` config?
2. Is it in the session-allowed list?
3. If `allowProjectCommands: true`, is it within `projectDir`?
4. Has the user approved it via retry flow?

**Result:** Only approved commands get transpiled and executed.

### Security Layer 2: Deno --allow-run (EXECUTION GATE)
**Location:** `src/runtime/executor.ts:637-642`

```typescript
// When allowProjectCommands is true, use unrestricted --allow-run
if (config.allowProjectCommands && config.projectDir) {
  return "--allow-run"; // Unrestricted
}
```

**What it does:**
- Allows the transpiled code to execute commands that passed Layer 1
- Necessary because Deno doesn't support directory-based run permissions

## Security Flow Example

### Example 1: Project Script (Allowed)
```bash
User: .temp/test-script.sh
```

**Layer 1 (bash-prehook):**
- ✅ Command: `.temp/test-script.sh`
- ✅ `allowProjectCommands: true`
- ✅ Within projectDir: `/Users/jc/dev/safesh`
- ✅ **APPROVED** → Transpile and execute

**Layer 2 (Deno):**
- ✅ `--allow-run` grants permission
- ✅ Script executes

### Example 2: Dangerous Command (Blocked)
```bash
User: rm -rf /
```

**Layer 1 (bash-prehook):**
- ❌ Command: `rm`
- ❌ Not in allowed commands list
- ❌ Not a project command
- ❌ **BLOCKED** → Prompt user

**Layer 2 (Deno):**
- Never reached because Layer 1 blocked it

### Example 3: Approved System Command (Allowed)
```bash
User: git status
```

**Layer 1 (bash-prehook):**
- ✅ Command: `git`
- ✅ In default SAFE_COMMANDS list
- ✅ **APPROVED** → Transpile and execute

**Layer 2 (Deno):**
- ✅ `--allow-run` grants permission
- ✅ Command executes

## Why Not Just Use --allow-run=<projectDir>?

Because **Deno doesn't support it**:
```bash
# ❌ This DOES NOT work
deno run --allow-run=/project/dir script.ts
# Directory query: granted
# Execute /project/dir/script.sh: DENIED

# ✅ This DOES work
deno run --allow-run=/project/dir/script.sh script.ts
# But requires listing every script explicitly
```

See `notes/allow-run-investigation.md` for detailed test results.

## Comparison: With vs Without allowProjectCommands

### Without allowProjectCommands (Strict)
```typescript
// User must explicitly allow each command
{
  "permissions": {
    "run": ["git", "npm", "/path/to/my-script.sh"]
  }
}
```
- Deno flag: `--allow-run=git,npm,/path/to/my-script.sh`
- Security: Very strict, explicit approval required

### With allowProjectCommands (Convenient)
```typescript
// All project scripts are allowed
{
  "allowProjectCommands": true,
  "projectDir": "/Users/jc/dev/myproject"
}
```
- Deno flag: `--allow-run` (unrestricted)
- Security: bash-prehook still checks if commands are within projectDir
- Use case: Claude Code working within a project directory

## When Is Unrestricted --allow-run Used?

**Only when ALL of these conditions are met:**
1. `allowProjectCommands: true` is set
2. `projectDir` is defined
3. Command passes bash-prehook permission checks

**Not used when:**
- Direct `desh` usage without `allowProjectCommands`
- Explicit permission lists are provided
- `allowProjectCommands: false` (default for direct desh)

## Security Recommendations

### For Claude Code Context (Current)
✅ **Safe** - Pre-hook validates all commands before execution
- Default: `allowProjectCommands: true`
- Pre-hook checks every command
- User can see and approve blocked commands

### For Direct desh Usage
✅ **Strict** - Requires explicit permissions
- Default: `allowProjectCommands: false`
- Must list allowed commands explicitly
- Deno enforces specific --allow-run list

### For Production Environments
⚠️ **Consider** setting `allowProjectCommands: false` in:
- CI/CD pipelines
- Automated scripts
- Shared environments
- Use explicit permission lists instead

## Summary

| Layer | What It Does | When Active |
|-------|-------------|-------------|
| Bash Pre-hook | Validates ALL commands against config | Always |
| Deno --allow-run | Allows approved commands to execute | After pre-hook approval |

**Key Point:** Unrestricted `--allow-run` is NOT a security hole because the bash-prehook **already validated** which commands are allowed. The unrestricted flag just prevents Deno from double-checking permissions that were already validated.
