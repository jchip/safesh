---
name: safesh-permission
description: Check command permissions before executing via safesh, prompt user if needed
allowed-tools: Read, Edit, Write
---

# SafeShell Command Permission Workflow

Before executing external commands via safesh, always check if they are allowed and prompt the user if needed.

## Pre-Flight Permission Check

**BEFORE** sending code to safesh that includes external commands (via `cmd()`, `git()`, `docker()`, etc.):

1. Read `.claude/safesh.local.ts` to check if the command is already allowed
2. If NOT allowed, prompt the user for permission
3. If approved, update the config file
4. THEN execute the code

This prevents partial script execution when a command is blocked midway.

## Checking Permissions

Read the project's config file:

```
.claude/safesh.local.ts
```

Example contents:
```typescript
export default {
  allowedCommands: ["cargo", "rustc", "make"]
};
```

If the command you need (e.g., `npm`) is not in `allowedCommands`, you must prompt first.

## Prompting the User

Ask clearly:

```
The command 'npm' is not in the allowed list for safesh.
Would you like to add it to .claude/safesh.local.ts?
- Yes: Add and proceed
- No: Cancel
```

## Updating the Config

**If file doesn't exist**, create `.claude/safesh.local.ts`:

```typescript
export default {
  allowedCommands: ["npm"]
};
```

**If file exists**, add to the array:

```typescript
export default {
  allowedCommands: ["cargo", "rustc", "npm"]  // added npm
};
```

## Then Execute

Only after the config is updated, send the code to safesh.

## Config Format

```typescript
export default {
  allowedCommands: [
    // Simple string - allows command with any args
    "cargo",
    "make",

    // Object - granular control (optional)
    {
      command: "git",
      subcommands: ["status", "log", "diff", "add", "commit"]
    }
  ]
};
```

## Important Notes

- Always check BEFORE executing, not after failure
- Commands under `${PROJECT_DIR}` are project-scoped
- System commands outside workspace require manual config in `~/.config/safesh/config.ts`
- The `.claude/` directory is typically gitignored (local to each developer)
