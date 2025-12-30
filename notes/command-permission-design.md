# Command & Permission Design

## Overview

SafeShell uses a simple, upfront permission model where commands are validated at declaration time via `init()`, not at execution time.

## Key Principles

1. **External commands under project dir** - Can be globally allowed via config
2. **Whitelist scopes** - Commands can be whitelisted at:
   - Local config (project-level)
   - User scope config
   - Defaults
3. **Upfront declaration via init()** - Clients declare commands with `init()` to avoid mid-script permission failures
4. **Permission check at init time** - Critical that `init()` validates permissions immediately

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

1. **init() phase**
   - Client declares all external commands needed
   - Check permission for each command
   - Collect list of unallowed commands
   - Return error with ALL unallowed commands (not just first)
   - This allows user to grant permissions for all at once

2. **Execution phase**
   - Once `init()` passes, proceed with execution
   - All declared external commands will work
   - FS access still limited by Deno sandbox

3. **Built-in TS commands**
   - Always allowed by design
   - Still subject to Deno's FS permissions and other Deno permissions

## Example

```typescript
// Declare commands upfront - permission checked here
const commands = init({
  curl: "curl",
  cargo: "cargo",
  myScript: "./scripts/build.sh",  // project-local
});

// If init() succeeds, these will work
await commands.curl.exec(["-s", "https://api.example.com"]);
await commands.cargo.exec(["build", "--release"]);
await commands.myScript.stdout().print();
```

## Error Handling

When commands are not allowed, `init()` returns:

```json
{
  "error": "COMMAND_NOT_ALLOWED",
  "commands": ["curl", "cargo"],
  "retry_id": "rt1"
}
```

Client presents options to user and retries with permission choice.
