# Command & Permission Design

## Overview

SafeShell uses a simple, upfront permission model where commands are validated at declaration time via `initCmds()`, not at execution time.

## Key Principles

1. **External commands under project dir** - Can be globally allowed via config
2. **Whitelist scopes** - Commands can be whitelisted at:
   - Local config (project-level)
   - User scope config
   - Defaults
3. **Upfront declaration via initCmds()** - Clients declare commands with `initCmds()` to avoid mid-script permission failures
4. **Permission check at init time** - Critical that `initCmds()` validates permissions immediately

## Permission Logic

Permission check follows this decision tree:

```
Is command basic name only (no `/`)?
├─ Yes → allowed_check(basename)
└─ No (has `/`)
   ├─ basename in allowed? → Yes → ALLOWED
   └─ No
      ├─ Full path (starts with `/`)? → Yes → allowed_check(verbatim)
      └─ No (relative path)
         ├─ Found in CWD? → Yes → allowed_check(resolved)
         └─ No
            └─ Found in projectDir?
               ├─ Yes → config allows project cmds? → Yes → ALLOWED
               │                                   → No → allowed_check(resolved)
               └─ No → COMMAND_NOT_FOUND error
```

Where `allowed_check(x)` = check if `x` is in the allowed commands list.

## Workflow

1. **initCmds() phase**
   - Client declares all external commands needed
   - Check permission for each command
   - Collect list of unallowed commands
   - Return error with ALL unallowed commands (not just first)
   - This allows user to grant permissions for all at once

2. **Execution phase**
   - Once `initCmds()` passes, proceed with execution
   - All declared external commands will work
   - FS access still limited by Deno sandbox

3. **Built-in TS commands**
   - Always allowed by design
   - Still subject to Deno's FS permissions and other Deno permissions

## Example

```typescript
// Declare commands upfront - permission checked here
const [curl, cargo, myScript] = await initCmds([
  "curl",
  "cargo",
  "./scripts/build.sh",  // project-local
]);

// If initCmds() succeeds, these will work
await curl("-s", "https://api.example.com");
await cargo("build", "--release");
await myScript();
```

## Error Handling

When commands are not allowed, `initCmds()` throws and the MCP server returns:

```json
{
  "error": {
    "type": "COMMANDS_BLOCKED",
    "commands": [
      { "command": "curl", "error": "COMMAND_NOT_ALLOWED" },
      { "command": "cargo", "error": "COMMAND_NOT_ALLOWED" }
    ],
    "message": "2 command(s) not allowed, 0 command(s) not found"
  },
  "retry_id": "rt1",
  "hint": "STOP: Present this error to user with options..."
}
```

**Retry workflow:**
1. Present error and options to user (1=once, 2=session, 3=always, 4=deny)
2. On user choice 1-3, retry with: `run({ retry_id: "rt1", userChoice: N })`
3. Server applies userChoice to ALL blocked commands
4. On choice 4 (deny), stop and report error
